// Quilla `delete-account` edge function (Supabase, Deno).
// POST { password } with the user's Supabase JWT. Re-checks the password (so a left-open
// session can't delete an account), then deletes the auth user. Every table's user_id
// references auth.users ON DELETE CASCADE, so profile, clients, records, sealed versions,
// meetings and usage rows go with it.
// The app tells the advisor to download their data first: FAIS record keeping is theirs.
// Never logs personal data.

import { createClient } from "npm:@supabase/supabase-js@2";

const ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ?? "https://app.quilla.co.za").split(",").map((s) => s.trim());

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return json(req, 405, { error: "method_not_allowed" });

  const url = Deno.env.get("SUPABASE_URL")!, anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const userClient = createClient(url, anon, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user?.email) return json(req, 401, { error: "unauthorized" });

  let password = "";
  try { password = String((await req.json()).password ?? ""); } catch { /* handled below */ }
  if (!password) return json(req, 400, { error: "bad_request" });

  // Re-authenticate with a throwaway client (no session persisted).
  const check = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: pwErr } = await check.auth.signInWithPassword({ email: user.email, password });
  if (pwErr) return json(req, 403, { error: "wrong_password" });

  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  const { error: delErr } = await admin.auth.admin.deleteUser(user.id);
  if (delErr) { console.error("delete_user_error", delErr.status); return json(req, 500, { error: "server_error" }); }
  console.log("account_deleted");
  return json(req, 200, { ok: true });
});
