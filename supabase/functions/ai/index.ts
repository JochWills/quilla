// Quilla `ai` edge function (Supabase, Deno).
// POST { kind: "draft" | "recheck" | "improve", input: {...} }  with the user's Supabase JWT.
// Builds the prompt server-side, calls the Anthropic Messages API, returns parsed JSON.
//
// Secrets (set with `supabase secrets set ...`):
//   ANTHROPIC_API_KEY   required
//   ANTHROPIC_MODEL     optional, default "claude-sonnet-5"
//   ALLOWED_ORIGINS     optional, comma-separated, default "https://app.quilla.co.za"
//   AI_HOURLY_LIMIT     optional, default 40 calls per user per hour
// SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.

import { createClient } from "npm:@supabase/supabase-js@2";
import { draftPrompt, improvePrompt, recheckPrompt, SECTION_IDS } from "./prompts.ts";

const MODEL = Deno.env.get("ANTHROPIC_MODEL") ?? "claude-sonnet-5";
const HOURLY_LIMIT = Number(Deno.env.get("AI_HOURLY_LIMIT") ?? "40");
const ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ?? "https://app.quilla.co.za").split(",").map((s) => s.trim());
const MAX_TOKENS: Record<string, number> = { draft: 8000, recheck: 3000, improve: 2000 };

function cors(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  return {
    "Access-Control-Allow-Origin": ORIGINS.includes(origin) ? origin : ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}
function json(req: Request, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors(req), "Content-Type": "application/json" } });
}
function parseJson(text: string): unknown {
  const clean = text.replace(/```json|```/g, "").trim();
  const start = clean.indexOf("{"), end = clean.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("no_json");
  return JSON.parse(clean.slice(start, end + 1));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return json(req, 405, { error: "method_not_allowed" });

  // 1. Who is calling?
  const authHeader = req.headers.get("Authorization") ?? "";
  const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json(req, 401, { error: "unauthorized" });

  // 2. Rate limit per user.
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count } = await admin.from("ai_usage").select("id", { count: "exact", head: true })
    .eq("user_id", user.id).gte("created_at", since);
  if ((count ?? 0) >= HOURLY_LIMIT) return json(req, 429, { error: "rate_limited" });

  // 3. Validate input and build the prompt.
  let body: { kind?: string; input?: Record<string, unknown> };
  try { body = await req.json(); } catch { return json(req, 400, { error: "bad_request" }); }
  const kind = body.kind ?? "";
  const input = (body.input ?? {}) as Record<string, unknown>;
  let prompt: string;
  try {
    if (kind === "draft") {
      if (typeof input.notes !== "string" || input.notes.trim().length < 20) throw new Error("notes");
      prompt = draftPrompt({ notes: input.notes, meta: (input.meta ?? {}) as Record<string, string> });
    } else if (kind === "recheck") {
      prompt = recheckPrompt(input as never);
    } else if (kind === "improve") {
      if (!SECTION_IDS.includes(String(input.section_id)) || typeof input.content !== "string") throw new Error("section");
      prompt = improvePrompt(input as never);
    } else {
      return json(req, 400, { error: "unknown_kind" });
    }
  } catch {
    return json(req, 400, { error: "bad_request" });
  }

  // 4. Call Anthropic.
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": Deno.env.get("ANTHROPIC_API_KEY")!,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS[kind],
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) {
    console.error("anthropic_error", res.status, await res.text());
    return json(req, res.status === 429 ? 429 : 502, { error: res.status === 429 ? "rate_limited" : "upstream_error" });
  }
  const data = await res.json();
  const text = (data.content ?? []).filter((b: { type: string }) => b.type === "text").map((b: { text: string }) => b.text).join("\n");

  // 5. Log usage (never log prompt or response content: it contains client personal information).
  await admin.from("ai_usage").insert({
    user_id: user.id, kind, model: MODEL,
    input_tokens: data.usage?.input_tokens ?? null, output_tokens: data.usage?.output_tokens ?? null,
  });

  try {
    return json(req, 200, { result: parseJson(text) });
  } catch {
    return json(req, 502, { error: "invalid_json" });
  }
});
