// Quilla `transcribe` edge function (Supabase, Deno).
// POST { meeting_id } with the user's Supabase JWT.
// The meeting's audio is already in the private `meeting-audio` bucket (uploaded by the
// app). This function checks ownership and recorded consent, hands Deepgram a short-lived
// signed URL, saves the text transcript on the meeting, then deletes the audio.
//
// Secrets (set with `supabase secrets set ...`):
//   DEEPGRAM_API_KEY       required for transcription (503 not_configured without it)
//   DEEPGRAM_BASE_URL      optional, default "https://api.deepgram.com"
//   ALLOWED_ORIGINS        optional, shared with the `ai` function
//   TRANSCRIBE_HOURLY_LIMIT optional, default 10 transcriptions per user per hour
// Never logs audio, transcript text or client details.

import { createClient } from "npm:@supabase/supabase-js@2";

const DG_KEY = (Deno.env.get("DEEPGRAM_API_KEY") ?? "").trim();
const DG_BASE = (Deno.env.get("DEEPGRAM_BASE_URL") ?? "https://api.deepgram.com").trim().replace(/\/$/, "");
const HOURLY_LIMIT = Number(Deno.env.get("TRANSCRIBE_HOURLY_LIMIT") ?? "10");
const ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ?? "https://app.quilla.co.za").split(",").map((s) => s.trim());
const BUCKET = "meeting-audio";

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
const stamp = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

// Deepgram utterances → "Speaker 1 [0:12]: …" paragraphs, merging consecutive turns by the same speaker.
// deno-lint-ignore no-explicit-any
function formatTranscript(dg: any): string {
  const utts = dg?.results?.utterances;
  if (Array.isArray(utts) && utts.length) {
    const out: { speaker: number; start: number; text: string }[] = [];
    for (const u of utts) {
      const text = String(u.transcript ?? "").trim(); if (!text) continue;
      const last = out[out.length - 1];
      if (last && last.speaker === u.speaker) last.text += " " + text;
      else out.push({ speaker: Number(u.speaker ?? 0), start: Number(u.start ?? 0), text });
    }
    return out.map((p) => `Speaker ${p.speaker + 1} [${stamp(p.start)}]: ${p.text}`).join("\n\n");
  }
  return String(dg?.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "").trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return json(req, 405, { error: "method_not_allowed" });

  const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json(req, 401, { error: "unauthorized" });
  if (!DG_KEY) return json(req, 503, { error: "not_configured" });

  let meetingId = "";
  try { meetingId = String((await req.json()).meeting_id ?? ""); } catch { /* handled below */ }
  if (!/^[0-9a-f-]{36}$/i.test(meetingId)) return json(req, 400, { error: "bad_request" });

  // Read through the caller's own client so row level security proves ownership.
  const { data: m } = await userClient.from("meetings").select("id, audio_path, consent_recording").eq("id", meetingId).maybeSingle();
  if (!m) return json(req, 404, { error: "not_found" });
  if (!m.consent_recording) return json(req, 400, { error: "consent_required" });
  if (!m.audio_path || !m.audio_path.startsWith(`${user.id}/`)) return json(req, 400, { error: "no_audio" });

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count, error: countErr } = await admin.from("ai_usage").select("id", { count: "exact", head: true })
    .eq("user_id", user.id).eq("kind", "transcribe").gte("created_at", since);
  if (countErr) { console.error("usage_count_error", countErr.code); return json(req, 500, { error: "server_error" }); }
  if ((count ?? 0) >= HOURLY_LIMIT) return json(req, 429, { error: "rate_limited" });

  const setMeeting = (patch: Record<string, unknown>) => admin.from("meetings").update(patch).eq("id", meetingId).eq("user_id", user.id);
  await setMeeting({ transcription_status: "processing", transcription_error: null });

  const { data: signed, error: signErr } = await admin.storage.from(BUCKET).createSignedUrl(m.audio_path, 15 * 60);
  if (signErr || !signed?.signedUrl) {
    await setMeeting({ transcription_status: "failed", transcription_error: "audio_missing" });
    return json(req, 400, { error: "no_audio" });
  }

  const params = new URLSearchParams({
    model: "nova-3", language: "en", smart_format: "true", punctuate: "true",
    diarize: "true", utterances: "true", mip_opt_out: "true",
  });
  const res = await fetch(`${DG_BASE}/v1/listen?${params}`, {
    method: "POST",
    headers: { Authorization: `Token ${DG_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ url: signed.signedUrl }),
  });
  if (!res.ok) {
    console.error("deepgram_error", res.status);
    await setMeeting({ transcription_status: "failed", transcription_error: `provider_${res.status}` });
    return json(req, res.status === 429 ? 429 : 502, { error: res.status === 429 ? "rate_limited" : "upstream_error" });
  }
  const dg = await res.json();
  const transcript = formatTranscript(dg);
  const duration = Math.round(Number(dg?.metadata?.duration ?? 0));
  if (!transcript) {
    await setMeeting({ transcription_status: "failed", transcription_error: "no_speech" });
    return json(req, 422, { error: "no_speech" });
  }

  // Keep the text, drop the audio (POPIA: keep only what's needed).
  // transcript_source (recording / audio_upload) was set by the app when it uploaded the audio.
  const { error: saveErr } = await setMeeting({ transcript, transcription_status: "done", duration_seconds: duration, audio_path: null });
  if (saveErr) { console.error("save_error", saveErr.code); return json(req, 500, { error: "server_error" }); }
  await admin.storage.from(BUCKET).remove([m.audio_path]);
  await admin.from("ai_usage").insert({ user_id: user.id, kind: "transcribe", model: "deepgram-nova-3", input_tokens: duration, output_tokens: null });

  return json(req, 200, { transcript, duration_seconds: duration });
});
