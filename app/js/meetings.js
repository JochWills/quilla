// Meetings: log a client meeting with your notes (and, optionally, a transcript from Teams,
// Zoom or Google Meet, uploaded as a file or pasted), then start a Record of Advice from it.
// Quilla doesn't record or transcribe audio.

import { transcriptLabel } from "./clients.js";
import { IC, initials, pageHead, skeletonPage, tabsBar, bindTabs, setTabCounts, searchBox, sortTh, sortRows, bindSort, rowMenu, kebab } from "./ui.js";

const KINDS = { in_person: "In person", video: "Video call", phone: "Phone call" };
const MAMMOTH = ["https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.12.3/mammoth.browser.min.js", "sha384-xqNXvcKbEqifokHcBnB0H32p+OQchhD/T/xJGWCMAW5fC0c0MBf9atO3weoPCT84"];

let M = null;            // the meeting being edited
let saveTimer = null;

/* ---------------- List ---------------- */
// The list draws at once from the last visit's rows, then refreshes in the background and
// repaints only if something changed.
const LIST_COLS = "id, title, meeting_date, kind, client_id, transcript_source, record_id";
const KIND_IC = { in_person: IC.users, video: IC.video, phone: IC.phone };
let listCache = null, mTab = "all", mQuery = "", mSort = { key: "", dir: 1 };

export async function renderMeetings(ctx) {
  const seq = ctx.seq();
  if (listCache) drawMeetingsShell(ctx);
  else ctx.$("#content").innerHTML = skeletonPage("Meetings", "Log a client meeting with your notes and turn it into a Record of Advice.");
  const { data, error } = await ctx.supabase.from("meetings").select(LIST_COLS).order("meeting_date", { ascending: false }).limit(500);
  if (ctx.seq() !== seq) return;
  if (error) { if (!listCache) ctx.$("#content").innerHTML = `${pageHead("Meetings", "")}<div class="err">Couldn't load meetings. Refresh to try again.</div>`; return; }
  const was = JSON.stringify(listCache); listCache = data || [];
  if (was === JSON.stringify(listCache) && ctx.$("#mtTable, .empty")) return;
  if (ctx.$("#mtSearch") && listCache.length) { setTabCounts(ctx.$("#content"), mCounts()); drawMeetingsTable(ctx); }
  else drawMeetingsShell(ctx);
}
const mCounts = () => ({ all: listCache.length, open: listCache.filter((m) => !m.record_id).length, started: listCache.filter((m) => m.record_id).length });
const clientName = (ctx, id) => ctx.clients().find((c) => c.id === id)?.name || "";
function transcriptPill(m) {
  return m.transcript_source ? `<span class="pill signed">${IC.check}${transcriptLabel(m)}</span>` : `<span class="pill notes">${IC.note}${transcriptLabel(m)}</span>`;
}
function drawMeetingsShell(ctx) {
  const { $, esc } = ctx, add = { id: "addMeeting", label: "New meeting" };
  if (!listCache.length) {
    $("#content").innerHTML = `${pageHead("Meetings", "Log a client meeting with your notes and turn it into a Record of Advice.", add)}
      <div class="card empty"><h2>Log a meeting, get a Record of Advice</h2><p>Add your notes from a client meeting and, if you have one, the transcript from Teams, Zoom or Google Meet. Quilla turns them into a draft Record of Advice.</p><button class="btn btn-primary" id="addMeeting2">New meeting</button></div>`;
  } else {
    const n = mCounts();
    $("#content").innerHTML = `${pageHead("Meetings", "Log a client meeting with your notes and turn it into a Record of Advice.", add)}
      <div class="ltools">
        ${tabsBar([["all", "All meetings", IC.meet, n.all], ["open", "No record yet", IC.pen, n.open], ["started", "Record started", IC.file, n.started]], mTab, "Filter meetings")}
        <div class="lsearch-wrap">${searchBox("mtSearch", "Search meetings…", esc(mQuery))}</div>
      </div>
      <div class="card ltable-card" id="mtTable"></div>`;
    drawMeetingsTable(ctx);
    bindTabs($("#content"), (k) => { mTab = k; drawMeetingsShell(ctx); });
    $("#mtSearch").addEventListener("input", (e) => { mQuery = e.target.value; drawMeetingsTable(ctx); });
  }
  const go = () => ctx.go("meeting", {});
  $("#addMeeting").addEventListener("click", go);
  $("#addMeeting2")?.addEventListener("click", go);
}
function drawMeetingsTable(ctx) {
  const { $, esc } = ctx, wrap = $("#mtTable"); if (!wrap) return;
  const q = mQuery.trim().toLowerCase();
  let rows = listCache.filter((m) => (mTab === "open" ? !m.record_id : mTab === "started" ? m.record_id : true));
  if (q) rows = rows.filter((m) => `${m.title || ""} ${KINDS[m.kind] || ""} ${clientName(ctx, m.client_id)} ${ctx.fmtDate(m.meeting_date)}`.toLowerCase().includes(q));
  rows = sortRows(rows, mSort, { title: (m) => (m.title || KINDS[m.kind] || "").toLowerCase(), client: (m) => clientName(ctx, m.client_id).toLowerCase() || "~", date: (m) => m.meeting_date || "" });
  wrap.innerHTML = rows.length ? `<table class="rtable ltable"><thead><tr>
      ${sortTh(mSort, "title", "Meeting")}${sortTh(mSort, "client", "Client")}${sortTh(mSort, "date", "Date", "hide-sm")}<th class="hide-sm">Source</th><th class="hide-sm">Record of Advice</th><th class="act">Actions</th></tr></thead><tbody>
    ${rows.map((m) => { const cn = clientName(ctx, m.client_id); return `<tr data-meeting="${esc(m.id)}" tabindex="0">
      <td><div class="who"><span class="wav ic" aria-hidden="true">${KIND_IC[m.kind] || IC.meet}</span><div class="who-t"><span class="who-n">${esc(m.title || KINDS[m.kind] || "Meeting")}</span><span class="who-none">${esc(KINDS[m.kind] || "Meeting")}</span></div></div></td>
      <td>${cn ? `<span class="icell"><span class="wav sm" aria-hidden="true">${esc(initials(cn))}</span>${esc(cn)}</span>` : `<span class="who-none">Not linked</span>`}</td>
      <td class="hide-sm"><span class="icell">${IC.cal}${esc(ctx.fmtDate(m.meeting_date))}</span></td>
      <td class="hide-sm">${transcriptPill(m)}</td>
      <td class="hide-sm">${m.record_id ? `<button class="who-link" data-rec="${esc(m.record_id)}">Open record${IC.arrow}</button>` : `<span class="who-none">Not started</span>`}</td>
      <td class="act">${kebab(esc(m.id), esc(m.title || "meeting"), "data-mmenu")}</td></tr>`; }).join("")}</tbody></table>`
    : `<div class="lempty">${q ? `No meetings match “${esc(mQuery.trim())}”.` : mTab === "open" ? "Every meeting has a Record of Advice started." : "No meetings have a Record of Advice yet."}</div>`;
  bindSort(wrap, () => mSort, (s) => { mSort = s; drawMeetingsTable(ctx); });
  wrap.querySelectorAll("tr[data-meeting]").forEach((tr) => {
    tr.addEventListener("click", () => ctx.go("meeting", tr.dataset.meeting));
    tr.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target === tr) ctx.go("meeting", tr.dataset.meeting); });
  });
  wrap.querySelectorAll("[data-rec]").forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); ctx.openRecord(b.dataset.rec); }));
  wrap.querySelectorAll("[data-mmenu]").forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); meetingMenu(ctx, b); }));
}
function meetingMenu(ctx, btn) {
  const m = listCache.find((x) => x.id === btn.dataset.mmenu); if (!m) return;
  rowMenu(btn, [
    { a: "open", label: "Open meeting", icon: IC.meet },
    m.record_id && { a: "rec", label: "Open Record of Advice", icon: IC.file },
    m.client_id && clientName(ctx, m.client_id) && { a: "client", label: "View client", icon: IC.user },
    "sep", { a: "del", label: "Delete meeting", icon: IC.trash, danger: true },
  ], async (a) => {
    if (a === "open") ctx.go("meeting", m.id);
    else if (a === "rec") ctx.openRecord(m.record_id);
    else if (a === "client") ctx.go("client", m.client_id);
    else if (a === "del") {
      if (!(await deleteMeeting(ctx, m))) return;
      listCache = listCache.filter((x) => x.id !== m.id); drawMeetingsShell(ctx);
    }
  });
}
// Shared by the list menu and the meeting page.
async function deleteMeeting(ctx, m) {
  const ok = await ctx.confirmBox({ title: "Delete this meeting?", body: "The meeting details, notes and transcript will be permanently deleted. Any Record of Advice started from it is kept.", confirmLabel: "Delete meeting", danger: true });
  if (!ok) return false;
  // Drop any pending autosave of this meeting first, or leaving the page would save it back.
  const open = M?.id === m.id;
  if (open) { clearTimeout(saveTimer); saveTimer = null; }
  const { error } = await ctx.supabase.from("meetings").delete().eq("id", m.id);
  if (error) { ctx.toast("Couldn't delete the meeting. Try again."); if (open) queueSave(ctx); return false; }
  if (open) M = null;
  ctx.toast("Meeting deleted");
  return true;
}

/* ---------------- Meeting page ---------------- */
// param: a meeting id (open) or {clientId} (new meeting).
export async function renderMeeting(ctx, param) {
  if (typeof param === "string") {
    const { data } = await ctx.supabase.from("meetings").select("*").eq("id", param).maybeSingle();
    if (!data) { ctx.toast("Couldn't find that meeting."); ctx.go("meetings"); return; }
    M = { ...data, _saved: true };
  } else {
    M = { id: crypto.randomUUID(), client_id: param?.clientId || null, record_id: null, title: "", meeting_date: ctx.today(), kind: "in_person", attendees: "", notes: "", transcript: "", transcript_source: "", _saved: false };
  }
  // One of notes / transcript is open at a time; the other folds to a summary bar.
  M._open = M.transcript.trim() && !M.notes.trim() ? "transcript" : "notes";
  draw(ctx);
}

function draw(ctx) {
  const { $, esc } = ctx;
  const clients = ctx.clients();
  $("#content").innerHTML = `
    ${ctx.crumbs([["Meetings", "meetings"], [M.title || "New meeting"]])}
    <div class="list-head"><div><h1>${esc(M.title || "New meeting")}</h1><div class="rec-sub">${esc([clients.find((c) => c.id === M.client_id)?.name, ctx.fmtDate(M.meeting_date), KINDS[M.kind]].filter(Boolean).join(" · "))}</div></div>
      <div class="rec-actions" id="mActions"></div></div>
    <div class="meet-grid">
      <section class="card" style="padding:22px">
        <h3 class="sub">Meeting details</h3>
        <div class="form-grid">
          <label class="f span2"><span>Client</span><select id="mt_client"><option value="">Not linked to a client</option>${clients.map((c) => `<option value="${esc(c.id)}" ${c.id === M.client_id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></label>
          <label class="f"><span>Date</span><input type="date" id="mt_date" value="${esc(M.meeting_date || "")}"></label>
          <label class="f"><span>Type</span><select id="mt_kind">${Object.entries(KINDS).map(([k, v]) => `<option value="${k}" ${k === M.kind ? "selected" : ""}>${v}</option>`).join("")}</select></label>
          <label class="f span2"><span>Title <span class="opt">(optional)</span></span><input type="text" id="mt_title" placeholder="e.g. Retirement review" value="${esc(M.title)}"></label>
          <label class="f span2"><span>Who attended <span class="opt">(optional)</span></span><input type="text" id="mt_att" placeholder="e.g. Claire and Tom Bennett, and you" value="${esc(M.attendees)}"></label>
        </div>
      </section>
      <div class="meet-main">
        <section class="card nt-card" id="ntCard"></section>
        <section class="card tr-card" id="trCard"></section>
      </div>
    </div>`;

  const bind = (id, key, ev = "input") => $("#" + id).addEventListener(ev, (e) => { M[key] = e.target.value; queueSave(ctx); if (key === "title" || key === "meeting_date") drawHead(ctx); });
  bind("mt_title", "title"); bind("mt_date", "meeting_date", "change"); bind("mt_att", "attendees");
  $("#mt_kind").addEventListener("change", (e) => { M.kind = e.target.value; queueSave(ctx); drawHead(ctx); });
  $("#mt_client").addEventListener("change", (e) => { M.client_id = e.target.value || null; queueSave(ctx); drawHead(ctx); });
  drawPanels(ctx); drawActions(ctx);
}
function drawHead(ctx) {
  const h = document.querySelector(".list-head h1"), sub = document.querySelector(".list-head .rec-sub"); if (!h) return;
  h.textContent = M.title || "New meeting";
  sub.textContent = [ctx.clients().find((c) => c.id === M.client_id)?.name, ctx.fmtDate(M.meeting_date), KINDS[M.kind]].filter(Boolean).join(" · ");
}
const words = (t) => (t.trim() ? t.trim().split(/\s+/).length : 0);
function updCount(ctx) {
  const n = ctx.$("#ntCount"), t = ctx.$("#trCount");
  if (n) n.textContent = words(M.notes) ? `${words(M.notes).toLocaleString("en-ZA")} words` : "";
  if (t) t.textContent = words(M.transcript) ? `${words(M.transcript).toLocaleString("en-ZA")} words` : "";
}

/* ---------------- Notes and transcript ---------------- */
// Notes are the main input; a transcript (uploaded file or pasted) is optional. Only one is
// open at a time: opening one folds the other into a one-line summary you can click to switch.
function drawPanels(ctx) { drawNotes(ctx); drawTranscript(ctx); updCount(ctx); }
function openPanel(ctx, which, focus = true) {
  if (M._open === which) return;
  M._open = which; drawPanels(ctx);
  if (focus) ctx.$(which === "notes" ? "#mt_notes" : "#mt_tr")?.focus();
}
const preview = (t) => { const one = t.trim().replace(/\s+/g, " "); return one.length > 110 ? one.slice(0, 110) + "…" : one; };
function foldBar(ctx, id, title, detail, text, action) {
  return `<button type="button" class="fold" id="${id}" aria-expanded="false">
      <span class="fold-t"><b>${title}</b>${detail ? `<span class="note">${ctx.esc(detail)}</span>` : ""}</span>
      ${text ? `<span class="fold-p">${ctx.esc(preview(text))}</span>` : ""}
      <span class="fold-a">${action}${IC.down}</span></button>`;
}
function drawNotes(ctx) {
  const el = ctx.$("#ntCard"); if (!el) return;
  el.classList.toggle("folded", M._open !== "notes");
  if (M._open !== "notes") {
    const n = words(M.notes);
    el.innerHTML = foldBar(ctx, "ntOpen", "Meeting notes", n ? `${n.toLocaleString("en-ZA")} words` : "None yet", M.notes, n ? "Show notes" : "Add notes");
    ctx.$("#ntOpen").addEventListener("click", () => openPanel(ctx, "notes"));
    return;
  }
  el.innerHTML = `<label class="f" for="mt_notes"><span class="sub-l">Meeting notes</span><span class="hint">What the client told you, what you considered and recommended, the fees you disclosed, and what they decided. Quilla drafts only from what's here.</span></label>
    <textarea id="mt_notes" class="transcript" placeholder="e.g. Claire (45), marketing director. Wants to retire at 60 on 70% of income…">${ctx.esc(M.notes)}</textarea>
    <div class="note count" id="ntCount"></div>`;
  ctx.$("#mt_notes").addEventListener("input", (e) => { M.notes = e.target.value; updCount(ctx); drawActions(ctx); queueSave(ctx); });
}
function drawTranscript(ctx) {
  const el = ctx.$("#trCard"); if (!el) return;
  const has = !!M.transcript.trim(), open = M._open === "transcript";
  el.classList.toggle("folded", has && !open);
  const upload = (label) => `<label class="btn btn-sm"><input type="file" id="upText" accept=".vtt,.srt,.txt,.docx,text/plain,text/vtt" hidden>${label}</label>`;
  if (has && !open) {
    el.innerHTML = foldBar(ctx, "trOpen", "Transcript", `${words(M.transcript).toLocaleString("en-ZA")} words · ${M.transcript_source === "file" ? "from a file" : "pasted"}`, M.transcript, "Show transcript");
    ctx.$("#trOpen").addEventListener("click", () => openPanel(ctx, "transcript"));
    return;
  }
  if (!open) {
    el.innerHTML = `<div class="tr-empty"><div><h3 class="sub" style="margin:0 0 4px">Transcript <span class="opt">(optional)</span></h3>
        <p class="note" style="margin:0">Have a transcript from Teams, Zoom or Google Meet? Add it and Quilla drafts from it together with your notes.</p></div>
      <div class="tr-btns">${upload("Upload transcript file")}<button class="btn btn-sm" id="trPaste">Paste a transcript</button></div></div>
      <div id="trStatus" aria-live="polite"></div>`;
    ctx.$("#trPaste").addEventListener("click", () => openPanel(ctx, "transcript"));
  } else {
    el.innerHTML = `<div class="tr-head"><h3 class="sub-l" style="margin:0">Transcript <span class="opt">(optional)</span></h3>
        <div class="tr-btns">${upload(has ? "Replace with a file" : "Upload transcript file")}<button class="btn btn-sm btn-quiet-danger" id="trRemove">Remove</button></div></div>
      <p class="note" style="margin:6px 0 10px">Check names, amounts and percentages against your notes: transcripts often mishear them.</p>
      <div id="trStatus" aria-live="polite"></div>
      <div id="speakers"></div>
      <textarea id="mt_tr" class="transcript" aria-label="Transcript" placeholder="Paste the transcript here.">${ctx.esc(M.transcript)}</textarea>
      <div class="note count" id="trCount"></div>`;
    const tr = ctx.$("#mt_tr");
    tr.addEventListener("input", () => { M.transcript = tr.value; if (!M.transcript_source && tr.value.trim()) M.transcript_source = "pasted"; if (!tr.value.trim() && M.transcript_source === "pasted") M.transcript_source = ""; updCount(ctx); drawSpeakers(ctx); drawActions(ctx); queueSave(ctx); });
    ctx.$("#trRemove").addEventListener("click", async () => {
      if (has && !(await ctx.confirmBox({ title: "Remove the transcript?", body: "The transcript will be removed from this meeting. Your notes stay as they are.", confirmLabel: "Remove", danger: true }))) return;
      Object.assign(M, { transcript: "", transcript_source: "", _open: "notes" });
      drawPanels(ctx); drawActions(ctx); queueSave(ctx);
    });
    drawSpeakers(ctx);
  }
  ctx.$("#upText").addEventListener("change", (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) importTranscript(ctx, f); });
}

/* ---------------- Actions: start record, delete ---------------- */
function drawActions(ctx) {
  const el = ctx.$("#mActions"); if (!el) return;
  const hasText = M.transcript.trim() || M.notes.trim();
  el.innerHTML = `${M._saved ? `<button class="btn btn-sm btn-quiet-danger" id="mDel">Delete</button>` : ""}
    ${M.record_id ? `<button class="btn btn-primary btn-sm" id="mOpenRec">Open Record of Advice</button>` : `<button class="btn btn-primary btn-sm" id="mStartRec" ${hasText ? "" : "disabled"}>Start Record of Advice</button>`}`;
  ctx.$("#mOpenRec")?.addEventListener("click", () => ctx.openRecord(M.record_id));
  ctx.$("#mStartRec")?.addEventListener("click", async () => {
    await saveNow(ctx);
    const client = ctx.clients().find((c) => c.id === M.client_id) || null;
    const head = [`Meeting${M.title ? `: ${M.title}` : ""} (${KINDS[M.kind].toLowerCase()}), ${ctx.fmtDate(M.meeting_date)}.`, M.attendees ? `Attendees: ${M.attendees}.` : ""].filter(Boolean).join(" ");
    const notes = [head, M.notes.trim() ? `Advisor's notes:\n${M.notes.trim()}` : "", M.transcript.trim() ? `Transcript:\n${M.transcript.trim()}` : ""].filter(Boolean).join("\n\n");
    await ctx.startRecord({ client, meeting: M, notes });
  });
  ctx.$("#mDel")?.addEventListener("click", async () => {
    const id = M.id;
    if (!(await deleteMeeting(ctx, M))) return;
    if (listCache) listCache = listCache.filter((x) => x.id !== id);
    ctx.go("meetings");
  });
}

/* ---------------- Saving ---------------- */
// Database columns only: drop UI-only fields (prefixed "_") and server-managed ones.
function rowOf() {
  return Object.fromEntries(Object.entries(M).filter(([k]) => !k.startsWith("_") && !["created_at", "updated_at", "user_id"].includes(k)));
}
function queueSave(ctx) { clearTimeout(saveTimer); saveTimer = setTimeout(() => saveNow(ctx), 1200); ctx.$("#savestate").textContent = "Unsaved"; }
async function saveNow(ctx) {
  clearTimeout(saveTimer); saveTimer = null;
  if (!M) return false;
  const { error } = await ctx.supabase.from("meetings").upsert(rowOf());
  if (error) { console.error(error); ctx.$("#savestate").textContent = "Not saved"; return false; }
  const first = !M._saved; M._saved = true; ctx.$("#savestate").textContent = "Saved";
  if (first) drawActions(ctx);
  return true;
}
export async function flushMeeting(ctx) { if (saveTimer) await saveNow(ctx); }

/* ---------------- Speakers ---------------- */
// Transcripts often label voices "Speaker 1", "Speaker 2"… Let the advisor name them once.
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

function status(ctx, kind, text) {
  const el = ctx.$("#trStatus"); if (!el) return;
  el.innerHTML = !text ? "" : kind === "ok" ? `<p class="okmsg" style="margin:0 0 10px">${ctx.esc(text)}</p>` : `<div class="err" style="margin:10px 0">${ctx.esc(text)}</div>`;
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
  Object.assign(M, { transcript: text, transcript_source: "file", _open: "transcript" });
  drawPanels(ctx); drawActions(ctx); await saveNow(ctx); status(ctx, "ok", `Imported ${file.name}. Check it over, then start the Record of Advice.`);
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
