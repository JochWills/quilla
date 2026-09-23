// Meetings: log a client meeting, record it in the browser or upload audio / a transcript
// file, get a transcript, and start a Record of Advice from it.
// Audio goes to the private `meeting-audio` bucket, is transcribed by the `transcribe` edge
// function (Deepgram) and is then deleted: only the text is kept. Recording and audio
// upload need the client's consent to be recorded first (the function checks it too).

import { transcriptLabel } from "./clients.js";

const KINDS = { in_person: "In person", video: "Video call", phone: "Phone call" };
const MAX_AUDIO = 50 * 1024 * 1024; // matches the bucket limit
const MAMMOTH = ["https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.12.3/mammoth.browser.min.js", "sha384-xqNXvcKbEqifokHcBnB0H32p+OQchhD/T/xJGWCMAW5fC0c0MBf9atO3weoPCT84"];
const AUDIO_TYPES = { webm: "audio/webm", ogg: "audio/ogg", mp3: "audio/mpeg", m4a: "audio/mp4", mp4: "audio/mp4", aac: "audio/aac", wav: "audio/wav", flac: "audio/flac" };
const ERR = {
  not_configured: "Transcription isn't switched on yet. You can still upload a transcript file or paste your notes.",
  consent_required: "Confirm the client agreed to the recording first.",
  rate_limited: "Too many transcriptions in the last hour. Try again later.",
  no_speech: "No speech was found in that audio.",
  no_audio: "The audio couldn't be found. Record or upload it again.",
  upstream_error: "The transcription service had a problem. Try again in a minute.",
};

let M = null;            // the meeting being edited
let rec = null;          // in-progress recording {mr, stream, chunks, started, elapsed, paused, timer}
let saveTimer = null;

/* ---------------- List ---------------- */
export async function renderMeetings(ctx) {
  const { $, esc } = ctx;
  const { data, error } = await ctx.supabase.from("meetings").select("id, title, meeting_date, kind, client_id, transcript_source, transcription_status, record_id").order("meeting_date", { ascending: false }).limit(500);
  const rows = data || [];
  const name = (id) => ctx.clients().find((c) => c.id === id)?.name || "—";
  $("#content").innerHTML = `
    <div class="list-head"><div><h1>Meetings</h1><div class="rec-sub">${rows.length} meeting${rows.length === 1 ? "" : "s"}</div></div><button class="btn btn-primary btn-sm" id="addMeeting">New meeting</button></div>
    ${error ? `<div class="err">Couldn't load meetings. Refresh to try again.</div>` : rows.length ? `<div class="card" style="overflow-x:auto"><table class="rtable"><thead><tr><th>Meeting</th><th>Client</th><th class="hide-sm">Date</th><th class="hide-sm">Transcript</th><th class="hide-sm">Record</th></tr></thead><tbody>
      ${rows.map((m) => `<tr data-meeting="${esc(m.id)}" tabindex="0"><td class="client">${esc(m.title || KINDS[m.kind] || "Meeting")}</td><td>${esc(name(m.client_id))}</td><td class="hide-sm">${esc(ctx.fmtDate(m.meeting_date))}</td><td class="hide-sm">${esc(transcriptLabel(m))}</td><td class="hide-sm">${m.record_id ? "Started" : "—"}</td></tr>`).join("")}
    </tbody></table></div>` : `<div class="card empty"><h2>Record a meeting, get a Record of Advice</h2><p>Log a client meeting, record it here or upload the recording or transcript from Teams, Zoom or Google Meet. Quilla turns the transcript into a draft Record of Advice.</p><button class="btn btn-primary" id="addMeeting2">New meeting</button></div>`}`;
  const add = () => ctx.go("meeting", {});
  $("#addMeeting").addEventListener("click", add);
  $("#addMeeting2")?.addEventListener("click", add);
  $("#content").querySelectorAll("[data-meeting]").forEach((tr) => {
    tr.addEventListener("click", () => ctx.go("meeting", tr.dataset.meeting));
    tr.addEventListener("keydown", (e) => { if (e.key === "Enter") ctx.go("meeting", tr.dataset.meeting); });
  });
}

/* ---------------- Meeting page ---------------- */
// param: a meeting id (open) or {clientId} (new meeting).
export async function renderMeeting(ctx, param) {
  if (typeof param === "string") {
    const { data } = await ctx.supabase.from("meetings").select("*").eq("id", param).maybeSingle();
    if (!data) { ctx.toast("Couldn't find that meeting."); ctx.go("meetings"); return; }
    M = { ...data, _saved: true };
  } else {
    M = { id: crypto.randomUUID(), client_id: param?.clientId || null, record_id: null, title: "", meeting_date: ctx.today(), kind: "in_person", attendees: "", consent_recording: false, consent_at: null, notes: "", transcript: "", transcript_source: "", audio_path: null, transcription_status: "none", transcription_error: null, duration_seconds: null, _saved: false };
  }
  draw(ctx);
}

export function isRecording() { return !!rec; }

function draw(ctx) {
  const { $, esc } = ctx;
  const clients = ctx.clients();
  const busy = M.transcription_status === "processing";
  $("#content").innerHTML = `
    <div class="list-head"><div><button class="linkbtn back" id="backMeetings">← Meetings</button><h1>${esc(M.title || "New meeting")}</h1><div class="rec-sub">${esc([clients.find((c) => c.id === M.client_id)?.name, ctx.fmtDate(M.meeting_date), KINDS[M.kind]].filter(Boolean).join(" · "))}</div></div>
      <div class="rec-actions" id="mActions"></div></div>
    <div class="meet-grid">
      <section class="card" style="padding:22px">
        <h3 class="sub">Meeting details</h3>
        <div class="meta-grid">
          <label class="f">Client<select id="mt_client"><option value="">Not linked to a client</option>${clients.map((c) => `<option value="${esc(c.id)}" ${c.id === M.client_id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></label>
          <label class="f">Title <span class="hint" style="display:inline">(optional)</span><input type="text" id="mt_title" placeholder="e.g. Retirement review" value="${esc(M.title)}"></label>
          <label class="f">Date<input type="date" id="mt_date" value="${esc(M.meeting_date || "")}"></label>
          <label class="f">Type<select id="mt_kind">${Object.entries(KINDS).map(([k, v]) => `<option value="${k}" ${k === M.kind ? "selected" : ""}>${v}</option>`).join("")}</select></label>
        </div>
        <label class="f" style="margin-top:14px">Who attended <span class="hint" style="display:inline">(optional)</span><input type="text" id="mt_att" placeholder="e.g. Claire and Tom Bennett, you" value="${esc(M.attendees)}"></label>
        <label class="f" style="margin-top:14px">Your notes <span class="hint">Anything not in the recording: documents seen, what you checked afterwards.</span><textarea id="mt_notes" rows="6">${esc(M.notes)}</textarea></label>
      </section>
      <section class="card" style="padding:22px">
        <h3 class="sub">Recording and transcript</h3>
        <label class="declare" style="margin-top:0"><input type="checkbox" id="mt_consent" ${M.consent_recording ? "checked" : ""} ${busy || rec ? "disabled" : ""}><span>The client agreed to this meeting being recorded and transcribed.${M.consent_at ? ` <span class="note">Confirmed ${esc(ctx.fmtTime(M.consent_at))}.</span>` : ""}</span></label>
        <p class="note" style="margin:8px 0 0">Tip: ask again once the recording starts, so their agreement is in the transcript too.</p>
        <div id="recArea"></div>
        <div id="trStatus" aria-live="polite"></div>
        <label class="f" style="margin-top:16px" for="mt_tr">Transcript <span class="hint">Recorded, uploaded or pasted. Edit anything the transcription got wrong.</span></label>
        <div id="speakers"></div>
        <textarea id="mt_tr" class="transcript" placeholder="The transcript appears here. You can also paste one." ${busy ? "readonly" : ""}>${esc(M.transcript)}</textarea>
        <div class="note count" id="trCount"></div>
      </section>
    </div>`;

  $("#backMeetings").addEventListener("click", () => ctx.go("meetings"));
  const bind = (id, key, ev = "input") => $("#" + id).addEventListener(ev, (e) => { M[key] = e.target.value; queueSave(ctx); if (key === "title" || key === "client_id") drawHead(ctx); });
  bind("mt_title", "title"); bind("mt_date", "meeting_date", "change"); bind("mt_att", "attendees"); bind("mt_notes", "notes");
  $("#mt_kind").addEventListener("change", (e) => { M.kind = e.target.value; queueSave(ctx); drawHead(ctx); });
  $("#mt_client").addEventListener("change", (e) => { M.client_id = e.target.value || null; queueSave(ctx); drawHead(ctx); });
  $("#mt_consent").addEventListener("change", (e) => { M.consent_recording = e.target.checked; M.consent_at = e.target.checked ? new Date().toISOString() : null; saveNow(ctx).then(() => draw(ctx)); });
  const tr = $("#mt_tr");
  tr.addEventListener("input", () => { M.transcript = tr.value; if (!M.transcript_source && tr.value.trim()) M.transcript_source = "pasted"; if (!tr.value.trim() && M.transcript_source === "pasted") M.transcript_source = ""; updCount(ctx); drawSpeakers(ctx); drawActions(ctx); queueSave(ctx); });
  updCount(ctx); drawSpeakers(ctx); drawRecArea(ctx); drawStatus(ctx); drawActions(ctx);
}
function drawHead(ctx) {
  const h = document.querySelector(".list-head h1"), sub = document.querySelector(".list-head .rec-sub"); if (!h) return;
  h.textContent = M.title || "New meeting";
  sub.textContent = [ctx.clients().find((c) => c.id === M.client_id)?.name, ctx.fmtDate(M.meeting_date), KINDS[M.kind]].filter(Boolean).join(" · ");
}
function updCount(ctx) {
  const w = M.transcript.trim() ? M.transcript.trim().split(/\s+/).length : 0;
  ctx.$("#trCount").textContent = w ? `${w.toLocaleString("en-ZA")} words${M.duration_seconds ? ` · ${Math.round(M.duration_seconds / 60)} min of audio` : ""}` : "";
}

/* ---------------- Actions: start record, delete ---------------- */
function drawActions(ctx) {
  const el = ctx.$("#mActions"); if (!el) return;
  const hasText = M.transcript.trim() || M.notes.trim();
  el.innerHTML = `${M._saved ? `<button class="btn btn-sm btn-quiet-danger" id="mDel">Delete</button>` : ""}
    ${M.record_id ? `<button class="btn btn-primary btn-sm" id="mOpenRec">Open Record of Advice</button>` : `<button class="btn btn-primary btn-sm" id="mStartRec" ${hasText && !rec && M.transcription_status !== "processing" ? "" : "disabled"}>Start Record of Advice</button>`}`;
  ctx.$("#mOpenRec")?.addEventListener("click", () => ctx.openRecord(M.record_id));
  ctx.$("#mStartRec")?.addEventListener("click", async () => {
    await saveNow(ctx);
    const client = ctx.clients().find((c) => c.id === M.client_id) || null;
    const head = [`Meeting${M.title ? `: ${M.title}` : ""} (${KINDS[M.kind].toLowerCase()}), ${ctx.fmtDate(M.meeting_date)}.`, M.attendees ? `Attendees: ${M.attendees}.` : "", M.consent_recording ? "The client agreed to the meeting being recorded." : ""].filter(Boolean).join(" ");
    const notes = [head, M.notes.trim() ? `Advisor's notes:\n${M.notes.trim()}` : "", M.transcript.trim() ? `Transcript:\n${M.transcript.trim()}` : ""].filter(Boolean).join("\n\n");
    await ctx.startRecord({ client, meeting: M, notes });
  });
  ctx.$("#mDel")?.addEventListener("click", async () => {
    const ok = await ctx.confirmBox({ title: "Delete this meeting?", body: "The meeting details and transcript will be permanently deleted. Any Record of Advice started from it is kept.", confirmLabel: "Delete meeting", danger: true });
    if (!ok) return;
    if (M.audio_path) await ctx.supabase.storage.from("meeting-audio").remove([M.audio_path]);
    const { error } = await ctx.supabase.from("meetings").delete().eq("id", M.id);
    if (error) { ctx.toast("Couldn't delete the meeting. Try again."); return; }
    ctx.toast("Meeting deleted"); ctx.go("meetings");
  });
}

/* ---------------- Saving ---------------- */
// Database columns only: drop UI-only fields (prefixed "_") and server-managed ones.
function rowOf() {
  return Object.fromEntries(Object.entries(M).filter(([k]) => !k.startsWith("_") && !["created_at", "updated_at", "user_id"].includes(k)));
}
function queueSave(ctx) { clearTimeout(saveTimer); saveTimer = setTimeout(() => saveNow(ctx), 1200); ctx.$("#savestate").textContent = "Unsaved"; }
async function saveNow(ctx) {
  clearTimeout(saveTimer);
  if (!M) return false;
  const { error } = await ctx.supabase.from("meetings").upsert(rowOf());
  if (error) { console.error(error); ctx.$("#savestate").textContent = "Not saved"; return false; }
  const first = !M._saved; M._saved = true; ctx.$("#savestate").textContent = "Saved";
  if (first) drawActions(ctx);
  return true;
}
export async function flushMeeting(ctx) { if (saveTimer) await saveNow(ctx); }

/* ---------------- Speakers ---------------- */
// Transcripts label voices "Speaker 1", "Speaker 2"… Let the advisor name them once.
function drawSpeakers(ctx) {
  const el = ctx.$("#speakers"); if (!el) return;
  const labels = [...new Set([...M.transcript.matchAll(/^(Speaker \d+)(?= \[|:)/gm)].map((m) => m[1]))];
  if (!labels.length) { el.innerHTML = ""; return; }
  el.innerHTML = `<div class="speakers"><span class="note">Name the speakers:</span>${labels.map((l, i) => `<label class="spk"><span>${ctx.esc(l)}</span><input type="text" data-spk="${ctx.esc(l)}" placeholder="${i === 0 ? "e.g. Advisor" : "e.g. Client"}"></label>`).join("")}<button class="btn btn-xs" id="spkApply">Rename</button></div>`;
  ctx.$("#spkApply").addEventListener("click", () => {
    let t = M.transcript;
    el.querySelectorAll("[data-spk]").forEach((inp) => {
      const to = inp.value.trim().replace(/[\r\n]/g, " "); if (!to) return;
      const from = inp.dataset.spk.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      t = t.replace(new RegExp(`^${from}(?= \\[|:)`, "gm"), to);
    });
    if (t === M.transcript) return;
    M.transcript = t; ctx.$("#mt_tr").value = t; drawSpeakers(ctx); queueSave(ctx); ctx.toast("Speakers renamed");
  });
}

/* ---------------- Recording + uploads ---------------- */
function drawRecArea(ctx) {
  const el = ctx.$("#recArea"); if (!el) return;
  const busy = M.transcription_status === "processing";
  if (rec) {
    el.innerHTML = `<div class="recbar" role="status"><span class="recdot ${rec.paused ? "paused" : ""}" aria-hidden="true"></span><b id="recTime">${fmtDur(elapsed())}</b><span class="note">${rec.paused ? "Paused" : "Recording. Keep this tab open."}</span>
      <span class="recbtns"><button class="btn btn-xs" id="recPause">${rec.paused ? "Resume" : "Pause"}</button><button class="btn btn-xs btn-primary" id="recStop">Stop and transcribe</button><button class="btn btn-xs" id="recCancel">Discard</button></span></div>`;
    ctx.$("#recPause").addEventListener("click", () => { if (rec.paused) { rec.mr.resume(); rec.started = Date.now(); } else { rec.mr.pause(); rec.elapsed += Date.now() - rec.started; } rec.paused = !rec.paused; drawRecArea(ctx); });
    ctx.$("#recStop").addEventListener("click", () => stopRecording(ctx, true));
    ctx.$("#recCancel").addEventListener("click", async () => { if (await ctx.confirmBox({ title: "Discard this recording?", body: "The audio recorded so far will be thrown away.", confirmLabel: "Discard", danger: true })) stopRecording(ctx, false); });
    return;
  }
  const off = !M.consent_recording || busy;
  el.innerHTML = `<div class="rec-actions-row">
      <button class="btn btn-sm btn-rec" id="recStart" ${off ? "disabled" : ""}><span class="recdot" aria-hidden="true"></span>Record</button>
      <label class="btn btn-sm ${off ? "is-disabled" : ""}"><input type="file" id="upAudio" accept="audio/*,.m4a,.mp3,.wav,.webm,.ogg,.flac" hidden ${off ? "disabled" : ""}>Upload audio</label>
      <label class="btn btn-sm ${busy ? "is-disabled" : ""}"><input type="file" id="upText" accept=".vtt,.srt,.txt,.docx,text/plain,text/vtt" hidden ${busy ? "disabled" : ""}>Upload transcript file</label>
    </div>
    <p class="note" style="margin:8px 0 0">${M.consent_recording ? "Audio is transcribed, then deleted. Only the text is kept." : "Recording and audio upload unlock once you confirm the client agreed."} Transcript files: Teams, Zoom or Meet (.vtt), .srt, .txt or Word.</p>`;
  ctx.$("#recStart").addEventListener("click", () => startRecording(ctx));
  ctx.$("#upAudio").addEventListener("change", (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) uploadAudio(ctx, f, "audio_upload", f.name); });
  ctx.$("#upText").addEventListener("change", (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) importTranscript(ctx, f); });
}
const elapsed = () => rec ? rec.elapsed + (rec.paused ? 0 : Date.now() - rec.started) : 0;
const fmtDur = (ms) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 3600) ? Math.floor(s / 3600) + ":" : ""}${String(Math.floor(s / 60) % 60).padStart(Math.floor(s / 3600) ? 2 : 1, "0")}:${String(s % 60).padStart(2, "0")}`; };

async function startRecording(ctx) {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") { status(ctx, "err", "This browser can't record audio. Try Chrome, Edge or Safari, or upload a recording."); return; }
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
  catch { status(ctx, "err", "Quilla couldn't use your microphone. Allow microphone access for this site in your browser settings, then try again."); return; }
  if (!(await saveNow(ctx))) { stream.getTracks().forEach((t) => t.stop()); status(ctx, "err", "Couldn't save the meeting. Check your connection and try again."); return; }
  const type = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"].find((t) => MediaRecorder.isTypeSupported?.(t)) || "";
  const mr = new MediaRecorder(stream, type ? { mimeType: type, audioBitsPerSecond: 32000 } : undefined);
  rec = { mr, stream, chunks: [], started: Date.now(), elapsed: 0, paused: false };
  mr.ondataavailable = (e) => { if (e.data.size) rec?.chunks.push(e.data); };
  mr.start(10000);
  rec.timer = setInterval(() => { const t = document.getElementById("recTime"); if (t) t.textContent = fmtDur(elapsed()); }, 500);
  status(ctx, "", ""); draw(ctx);
}
async function stopRecording(ctx, keep) {
  const r = rec; if (!r) return;
  await new Promise((resolve) => { r.mr.onstop = resolve; r.mr.stop(); });
  r.stream.getTracks().forEach((t) => t.stop()); clearInterval(r.timer); rec = null;
  if (!keep) { draw(ctx); return; }
  const mime = r.mr.mimeType || "audio/webm";
  const blob = new Blob(r.chunks, { type: mime });
  draw(ctx);
  await uploadAudio(ctx, blob, "recording", `recording.${mime.includes("mp4") ? "m4a" : mime.includes("ogg") ? "ogg" : "webm"}`);
}

async function uploadAudio(ctx, blob, source, filename) {
  if (!M.consent_recording) { status(ctx, "err", ERR.consent_required); return; }
  if (blob.size > MAX_AUDIO) { status(ctx, "err", `That file is ${(blob.size / 1048576).toFixed(0)} MB. The limit is 50 MB. Try a compressed format such as .m4a or .mp3.`); return; }
  const ext = (filename.split(".").pop() || "").toLowerCase();
  const type = AUDIO_TYPES[ext] || (blob.type || "").split(";")[0];
  if (!type || !Object.values(AUDIO_TYPES).includes(type)) { status(ctx, "err", "That file type isn't supported. Use .m4a, .mp3, .wav, .webm, .ogg or .flac."); return; }
  if (!(await saveNow(ctx))) { status(ctx, "err", "Couldn't save the meeting. Check your connection and try again."); return; }
  status(ctx, "work", "Uploading audio…");
  const path = `${ctx.session.user.id}/${M.id}/${Date.now()}.${Object.keys(AUDIO_TYPES).find((k) => AUDIO_TYPES[k] === type) || "webm"}`;
  const { error } = await ctx.supabase.storage.from("meeting-audio").upload(path, blob, { contentType: type, upsert: false });
  if (error) { console.error(error); status(ctx, "err", "The upload didn't finish. Check your connection and try again."); return; }
  if (M.audio_path && M.audio_path !== path) await ctx.supabase.storage.from("meeting-audio").remove([M.audio_path]);
  Object.assign(M, { audio_path: path, transcript_source: source, transcription_status: "uploaded", transcription_error: null });
  await saveNow(ctx);
  await transcribe(ctx);
}

async function transcribe(ctx) {
  const before = M.transcript.trim();
  M.transcription_status = "processing"; draw(ctx);
  status(ctx, "work", "Transcribing… a one-hour meeting usually takes under a minute.");
  let body = {}, ok = false;
  try {
    const token = (await ctx.supabase.auth.getSession()).data.session?.access_token;
    const res = await fetch(`${ctx.fnUrl}/transcribe`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, apikey: ctx.anonKey }, body: JSON.stringify({ meeting_id: M.id }) });
    body = await res.json().catch(() => ({})); ok = res.ok;
  } catch { body = { error: "network" }; }
  if (ok) {
    // The function stores the new transcript; keep any earlier text (e.g. part one of a meeting).
    M.transcript = before ? `${before}\n\n${body.transcript}` : body.transcript;
    Object.assign(M, { transcription_status: "done", audio_path: null, duration_seconds: (M.duration_seconds || 0) + (body.duration_seconds || 0) });
    if (before) await saveNow(ctx);
    draw(ctx); status(ctx, "ok", "Transcript ready. Name the speakers, check it over, then start the Record of Advice.");
  } else {
    const { data } = await ctx.supabase.from("meetings").select("transcription_status, audio_path").eq("id", M.id).maybeSingle();
    Object.assign(M, { transcription_status: data?.transcription_status === "processing" ? "failed" : (data?.transcription_status || "failed"), audio_path: data?.audio_path ?? M.audio_path });
    draw(ctx);
    status(ctx, "err", ERR[body.error] || "Transcription didn't finish. Check your connection and try again.", !!M.audio_path && body.error !== "not_configured");
  }
}

function status(ctx, kind, text, retry = false) {
  const el = ctx.$("#trStatus"); if (!el) return;
  M._status = { kind, text, retry };
  el.innerHTML = !text ? "" : kind === "work" ? `<div class="working" role="status" style="margin-top:14px"><span class="pulse" aria-hidden="true"></span><b>${ctx.esc(text)}</b></div>`
    : kind === "ok" ? `<p class="okmsg">${ctx.esc(text)}</p>`
    : `<div class="err">${ctx.esc(text)}${retry ? ` <button class="linkbtn" id="trRetry">Try again</button>` : ""}</div>`;
  ctx.$("#trRetry")?.addEventListener("click", () => transcribe(ctx));
}
function drawStatus(ctx) {
  if (M._status) { status(ctx, M._status.kind, M._status.text, M._status.retry); return; }
  if (M.transcription_status === "failed") status(ctx, "err", "The last transcription didn't finish.", !!M.audio_path);
  else if (M.transcription_status === "uploaded" && M.audio_path) status(ctx, "err", "Audio is uploaded but not transcribed yet.", true);
}

/* ---------------- Transcript files ---------------- */
async function importTranscript(ctx, file) {
  if (file.size > 10 * 1024 * 1024) { status(ctx, "err", "That file is too large for a transcript."); return; }
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  let text = "";
  try {
    if (ext === "docx") text = (await (await loadMammoth()).extractRawText({ arrayBuffer: await file.arrayBuffer() })).value;
    else {
      const raw = await file.text();
      text = ext === "vtt" || raw.startsWith("WEBVTT") ? parseCues(raw) : ext === "srt" ? parseCues(raw) : raw;
    }
  } catch (e) { console.error(e); status(ctx, "err", "Couldn't read that file. Try .vtt, .srt, .txt or .docx."); return; }
  text = text.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
  if (!text) { status(ctx, "err", "That file doesn't contain any text."); return; }
  if (M.transcript.trim() && !(await ctx.confirmBox({ title: "Replace the transcript?", body: "The transcript already on this meeting will be replaced with the file's text.", confirmLabel: "Replace" }))) return;
  Object.assign(M, { transcript: text, transcript_source: "file" });
  draw(ctx); await saveNow(ctx); status(ctx, "ok", `Imported ${file.name}. Check it over, then start the Record of Advice.`);
}
// WebVTT / SRT → "Speaker: text" lines, merging consecutive cues by the same speaker.
function parseCues(raw) {
  const out = [];
  for (const block of raw.replace(/\r/g, "").split(/\n\s*\n/)) {
    // A cue is: optional identifier, a timing line ("… --> …"), then the text. Blocks without timing (header, NOTE, STYLE) are skipped.
    const all = block.split("\n"), at = all.findIndex((l) => l.includes("-->"));
    if (at < 0) continue;
    const lines = all.slice(at + 1).filter((l) => l.trim());
    if (!lines.length) continue;
    let text = lines.join(" "), speaker = "";
    const v = text.match(/<v\s+([^>]+)>/); if (v) speaker = v[1].trim();
    text = text.replace(/<[^>]+>/g, "").trim();
    const colon = !speaker && text.match(/^([A-Z][\w .'-]{0,40}):\s+(.*)$/); if (colon) { speaker = colon[1]; text = colon[2]; }
    const last = out[out.length - 1];
    if (last && last.speaker === speaker) last.text += " " + text; else out.push({ speaker, text });
  }
  return out.map((p) => (p.speaker ? `${p.speaker}: ${p.text}` : p.text)).join("\n\n");
}
let mammothReady = null;
function loadMammoth() {
  return (mammothReady ||= new Promise((resolve, reject) => {
    const s = document.createElement("script"); s.src = MAMMOTH[0]; s.integrity = MAMMOTH[1]; s.crossOrigin = "anonymous";
    s.onload = () => resolve(window.mammoth); s.onerror = () => { mammothReady = null; reject(new Error("script_load")); };
    document.head.appendChild(s);
  }));
}
