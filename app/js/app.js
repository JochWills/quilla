// Quilla app (app.quilla.co.za)
// Plain ES modules, no build step. Supabase provides auth + database; all AI calls go
// through the `ai` edge function so the Anthropic key never reaches the browser.
//
// Flow: Source notes → Draft (AI) → Document review + compliance check → Sign-off → Export.
// See docs/PRODUCT.md for the rules behind each step.

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";
import { buildPdf, buildDocx } from "./export.js";
import { renderClients, renderClient } from "./clients.js";
import { renderMeetings, renderMeeting, isRecording, flushMeeting } from "./meetings.js";
import { renderTemplates } from "./templates.js";
import { renderCompliance } from "./compliance.js";
import { initControls } from "./controls.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
// The landing site's "Sign out" link (no session of its own) points here with ?signout=1.
if (new URLSearchParams(location.search).get("signout") === "1") {
  const u = new URL(location.href); u.searchParams.delete("signout");
  history.replaceState(null, "", u.pathname + u.search + u.hash);
  supabase.auth.signOut();
}

/* ---------------- Constants ---------------- */
// Keep in sync with supabase/functions/ai/prompts.ts
const SECTIONS = [
  ["client_profile", "Client details and circumstances", "Who the client is: age, occupation, family, dependants and relevant personal circumstances."],
  ["financial_situation", "Financial situation", "Income, assets, liabilities, existing savings and cash flow as recorded."],
  ["needs_objectives", "Needs and objectives", "What the client wants to achieve, with amounts and timeframes where stated."],
  ["risk_profile", "Risk profile", "Risk tolerance and capacity, and how it was determined."],
  ["existing_products", "Existing products reviewed", "Current policies and investments considered, with values where stated."],
  ["products_considered", "Products and alternatives considered", "Every product or option discussed, including those not recommended and why."],
  ["recommendation", "Recommendation", "Exactly what the advisor recommended: product, provider, fund and amounts."],
  ["reasons", "Why the recommendation suits the client", "The advisor's reasons linking the recommendation to the client's needs."],
  ["fees", "Fees and charges disclosed", "Initial and ongoing advice fees, platform fees, fund costs and any changes agreed."],
  ["replacement", "Replacement analysis", "If an existing product is replaced: termination penalties, cost comparison, tax impact, benefits lost and reasons."],
  ["risks_disclosures", "Material risks and disclosures", "Risks, material terms and limitations explained to the client."],
  ["conflicts", "Remuneration and conflicts of interest", "Commission or fees received and any conflicts disclosed."],
  ["client_decision", "Client's decision", "Whether the client accepted, declined or deviated from the advice, and any conditions."],
];
const SEC_TITLE = Object.fromEntries(SECTIONS.map((s) => [s[0], s[1]]));
const SEC_IDS = SECTIONS.map((s) => s[0]);
// Sections that must have content before sign-off, and the severity used when they're empty.
const REQUIRED = { recommendation: "critical", reasons: "critical", fees: "critical", needs_objectives: "critical", products_considered: "important", risk_profile: "important", financial_situation: "important", client_decision: "important", conflicts: "important", client_profile: "important" };
const SEV_ORDER = { critical: 0, important: 1, minor: 2 };
const SEV_LABEL = { critical: "Critical", important: "Important", minor: "Minor" };
const AREAS = ["Retirement planning", "Investment planning", "Risk cover", "Estate planning", "Tax-free savings", "Other"];

const EXAMPLE = {
  meta: { client: "Claire Bennett", ref: "CB-0921", area: "Retirement planning", date: "2026-09-21" },
  notes: `Meeting 21 Sept 2026 with Claire Bennett (45), video call.

Claire is a marketing director, annual income approx R1.8m. Married, two children (9 and 13). Husband is a self-employed architect, income irregular. Home loan approx R2.4m outstanding.

Goals: retire by 60 with an income of at least 70% of current income. Wants to maintain a similar lifestyle. Children's university education is a big priority, from 2031. Also concerned about tax and being structured efficiently.

Existing: employer pension fund, approx R3.1m per July statement. Legacy RA with Liberty from 2011, R2,500 pm, value R640,000. She thinks the fees are high. Discretionary unit trusts approx R450,000 with her bank. No TFSA.

Risk profile: completed our questionnaire today, result moderately aggressive. 15 years to retirement, comfortable with volatility.

Recommendation: open a TFSA for the education goal at R3,833 pm (the annual limit). Transfer the Liberty RA to a unit trust RA on the Karoo platform, invested in the Northgate Balanced Fund (Reg 28 compliant). Increase RA contributions to use more of her tax deduction, amount to confirm after her salary review in March.

Looked at the Karoo Global Equity fund for the TFSA but chose Northgate Balanced for lower volatility given the 2031 timeline.

Fees: ongoing advice fee 0.75%, initial fee 1% on TFSA contributions, 1.5% on the RA transfer. Platform fee 0.35%. Fund TIC approx 1.1%.

Claire is happy to open the TFSA now. RA transfer on hold until the Liberty termination charge is confirmed.`,
};

/* ---------------- State ---------------- */
const today = () => new Date().toISOString().slice(0, 10);
let profile = { full_name: "", fsp_number: "", practice_name: "", template: {} }; // this advisor's saved profile, prefills new records
function blank() {
  return {
    id: crypto.randomUUID(),
    meta: { client: "", ref: "", adviser: profile.full_name, fsp: profile.fsp_number, practice: profile.practice_name, date: today(), area: "Retirement planning" },
    notes: "", summary: "", sections: null, gaps: [], replacement: { is_replacement: false, existing_product: "" },
    signoff: { outcome: "", declared: false, override: "", signedAt: null, signedBy: "", version: null, sha256: "", sealedAt: null },
    status: "draft", audit: [], createdAt: new Date().toISOString(), updatedAt: null,
    clientId: null, meetingId: null, // optional links (Clients, Meetings)
  };
}
let S = blank();
let view = "list"; // list | record | account | clients | client | meetings | meeting | templates | compliance
let viewParam = null; // e.g. the client or meeting id for "client" / "meeting"
let clients = []; // this advisor's clients: {id, name, reference, email, phone, notes, updated_at}
let leaveGuard = null; // () => true when the current screen has unsaved changes
let tab = "notes"; // notes | document | signoff | activity
let authMode = "signin"; // signin | signup | forgot | reset
let busy = null; // AbortController for the in-flight AI call
let session = null;
let records = []; // list rows: {id, client_name, advice_area, meeting_date, status, updated_at}
let dirty = false, query = "";
const improveUndo = {};

/* ---------------- Helpers ---------------- */
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function toast(m) { const t = $("#toast"); t.textContent = m; t.classList.add("show"); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove("show"), 2600); }
// Quilla-styled replacement for window.confirm(). Resolves true only when the
// confirm button is pressed; Esc, Cancel and clicking the backdrop resolve false.
function confirmBox({ title, body = "", confirmLabel = "Confirm", danger = false }) {
  return new Promise((resolve) => {
    const d = document.createElement("dialog");
    d.className = "qdialog";
    d.setAttribute("aria-labelledby", "qdT");
    d.innerHTML = `<div class="qd-in">
      ${danger ? `<div class="qd-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/></svg></div>` : ""}
      <h2 id="qdT">${esc(title)}</h2>
      ${body ? `<p>${esc(body)}</p>` : ""}
      <div class="qd-actions">
        <button type="button" class="btn btn-sm" data-v="0">Cancel</button>
        <button type="button" class="btn btn-sm ${danger ? "btn-danger" : "btn-primary"}" data-v="1">${esc(confirmLabel)}</button>
      </div></div>`;
    const done = (v) => { d.close(); d.remove(); resolve(v); };
    d.addEventListener("click", (e) => { const b = e.target.closest("[data-v]"); if (b) done(b.dataset.v === "1"); else if (e.target === d) done(false); });
    d.addEventListener("cancel", (e) => { e.preventDefault(); done(false); });
    document.body.appendChild(d);
    d.showModal();
    d.querySelector('[data-v="0"]').focus();
  });
}
function log(text) { S.audit.push({ at: new Date().toISOString(), text }); }
function fmtTime(iso) { const d = new Date(iso); return d.toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" }) + ", " + d.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" }); }
function fmtDate(s) { if (!s) return "—"; const d = new Date(s + "T00:00:00"); return isNaN(d) ? s : d.toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" }); }
function gid() { return "g" + Math.random().toString(36).slice(2, 9); }
function autosize(t) { t.style.height = "auto"; t.style.height = (t.scrollHeight + 2) + "px"; }
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
// A signed record is read-only until it's reopened; its sealed version lives in record_versions.
const locked = () => S.status === "signed";
function statusOf(r) { return r.status === "signed" ? "signed" : (r.sections ? "draft" : "notes"); }
const STATUS_LABEL = { signed: "Signed off", draft: "Draft", notes: "Notes only" };
function errCopy(code) {
  if (code === "unauthorized") return "Your session expired. Sign in again, then retry.";
  if (code === "rate_limited") return "Too many requests in a short time. Wait a few minutes, then try again.";
  if (code === "invalid_json") return "The response came back incomplete. Try again; if it repeats, tidy up the notes first.";
  if (code === "bad_request") return "Quilla couldn't read that request. Check the notes describe an advice meeting.";
  return "The request was interrupted by a connection problem. Try again.";
}

/* ---------------- AI (edge function) ---------------- */
async function ai(kind, input, signal) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw { code: "unauthorized" };
  let res;
  try {
    res = await fetch(`${SUPABASE_URL}/functions/v1/ai`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY },
      body: JSON.stringify({ kind, input }),
      signal,
    });
  } catch (e) {
    if (e?.name === "AbortError") throw { code: "cancelled" };
    throw { code: "network" };
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw { code: body.error || (res.status === 401 ? "unauthorized" : "network") };
  return body.result;
}

/* ---------------- Persistence ---------------- */
async function loadRecords() {
  const { data, error } = await supabase.from("records")
    .select("id, client_name, advice_area, meeting_date, status, updated_at, client_id")
    .order("updated_at", { ascending: false }).limit(500);
  if (!error) records = data || [];
  $("#recCount").textContent = records.length ? String(records.length) : "";
}
async function loadProfile() {
  const { data, error } = await supabase.from("profiles").select("full_name, fsp_number, practice_name, template").eq("id", session.user.id).single();
  if (!error && data) profile = data;
}
async function saveProfile(next) {
  const { error } = await supabase.from("profiles").update(next).eq("id", session.user.id);
  if (error) { toast("Couldn't save your profile. Try again."); return false; }
  profile = { ...profile, ...next }; renderAcctBtn();
  return true;
}
function rowOf(r) {
  // A client deleted since the record was last saved is dropped rather than failing the save.
  const clientId = r.clientId && clients.some((c) => c.id === r.clientId) ? r.clientId : null;
  return { id: r.id, client_name: r.meta.client || "", advice_area: r.meta.area || "", meeting_date: r.meta.date || null, status: statusOf(r), client_id: clientId, data: r };
}
let saveTimer = null, saving = false, saveAgain = false;
function scheduleSave() { clearTimeout(saveTimer); saveTimer = setTimeout(save, 1500); }
async function save() {
  clearTimeout(saveTimer);
  if (!S.notes.trim() && !S.sections) return;
  if (saving) { saveAgain = true; return; }
  saving = true; $("#savestate").textContent = "Saving…";
  const row = rowOf(S);
  const { error } = await supabase.from("records").upsert(row);
  if (error) { $("#savestate").textContent = "Not saved"; console.error(error); }
  else {
    dirty = false; $("#savestate").textContent = "Saved";
    const i = records.findIndex((r) => r.id === S.id);
    const listRow = { id: S.id, client_name: row.client_name, advice_area: row.advice_area, meeting_date: row.meeting_date, status: row.status, client_id: row.client_id, updated_at: new Date().toISOString() };
    if (i >= 0) records[i] = listRow; else records.unshift(listRow);
    $("#recCount").textContent = String(records.length);
  }
  saving = false; if (saveAgain) { saveAgain = false; save(); }
}

/* ---------------- App render ---------------- */
const NAV_OF = { list: "list", record: "list", clients: "clients", client: "clients", meetings: "meetings", meeting: "meetings", templates: "templates", compliance: "compliance" };
function renderApp() {
  leaveGuard = null; $("#savestate").textContent = view === "record" ? $("#savestate").textContent : "";
  $("#navRecords").setAttribute("aria-current", NAV_OF[view] === "list" ? "page" : "false");
  document.querySelectorAll("[data-nav]").forEach((b) => b.setAttribute("aria-current", NAV_OF[view] === b.dataset.nav ? "page" : "false"));
  if (view === "list") renderList();
  else if (view === "clients") renderClients(ctx); else if (view === "client") renderClient(ctx, viewParam);
  else if (view === "meetings") renderMeetings(ctx); else if (view === "meeting") renderMeeting(ctx, viewParam);
  else if (view === "templates") renderTemplates(ctx); else if (view === "compliance") renderCompliance(ctx);
  else renderRecord();
}
// Leave the current screen: finish saves, protect a live recording and unsaved templates.
async function canLeave() {
  if (busy) return false;
  if (isRecording()) { toast("Stop or discard the recording first."); return false; }
  if (leaveGuard?.() && !(await confirmBox({ title: "Leave without saving?", body: "Your changes on this screen haven't been saved.", confirmLabel: "Leave without saving", danger: true }))) return false;
  leaveGuard = null;
  if (dirty) await save();
  await flushMeeting(ctx);
  return true;
}
async function go(next, param = null) {
  if (!(await canLeave())) return false;
  view = next; viewParam = param; renderApp(); window.scrollTo(0, 0); closeSide();
  return true;
}
async function loadClients() {
  const { data, error } = await supabase.from("clients").select("id, name, reference, email, phone, notes, updated_at").order("name").limit(2000);
  if (!error) clients = data || [];
  return clients;
}
// Start a new record, optionally for a client and/or from a meeting (Clients and Meetings screens).
async function startRecord({ client = null, meeting = null, notes = "" } = {}) {
  if (!(await canLeave())) return;
  S = blank(); view = "record"; closeSide(); window.scrollTo(0, 0);
  if (client) { S.clientId = client.id; S.meta.client = client.name; S.meta.ref = client.reference || ""; }
  if (meeting) { S.meetingId = meeting.id; if (meeting.meeting_date) S.meta.date = meeting.meeting_date; }
  S.notes = notes; tab = "notes"; $("#savestate").textContent = "";
  if (meeting) log("Started from a recorded meeting");
  renderApp();
  if (S.notes.trim()) {
    await save();
    if (meeting) await supabase.from("meetings").update({ record_id: S.id }).eq("id", meeting.id);
  }
}
// Shared context handed to the Clients / Meetings / Templates / Compliance screens.
// Folder-style breadcrumb: crumbs([["Clients", "clients"], ["Courtney Wickens"]]). Every item but
// the last is a link to that view; the last is the current page.
const FOLDER = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>`;
function crumbs(items) {
  return `<nav class="crumbs" aria-label="Breadcrumb"><ol>${items.map(([label, view], i) => i < items.length - 1
    ? `<li><button type="button" class="crumb" data-go="${esc(view)}">${i === 0 ? FOLDER : ""}${esc(label)}</button></li>`
    : `<li><span class="crumb-cur" aria-current="page">${esc(label)}</span></li>`).join("")}</ol></nav>`;
}
$("#content").addEventListener("click", (e) => { const b = e.target.closest(".crumb[data-go]"); if (b) go(b.dataset.go); });
initControls(); // custom dropdowns and date pickers for every <select> / date input

const ctx = {
  supabase, $, esc, crumbs, toast, confirmBox, fmtDate, fmtTime, today, SECTIONS, STATUS_LABEL,
  fnUrl: `${SUPABASE_URL}/functions/v1`, anonKey: SUPABASE_ANON_KEY,
  get session() { return session; }, get profile() { return profile; },
  records: () => records, clients: () => clients, loadClients, saveProfile,
  go, openRecord: (id) => openRecord(id), startRecord, setLeaveGuard: (fn) => { leaveGuard = fn; },
};

/* ---------------- Account settings (popup) ---------------- */
// A settings dialog with a section sidebar, opened from the account menu (or ?view=account).
function openSettings(section = "profile") {
  const d = document.createElement("dialog");
  d.className = "qdialog settings";
  d.setAttribute("aria-label", "Account settings");
  const SECTIONS_NAV = [["profile", "Profile"], ["password", "Password"]];
  d.innerHTML = `<div class="st-wrap">
      <nav class="st-nav" aria-label="Settings sections">
        <h2>Settings</h2>
        ${SECTIONS_NAV.map(([k, t]) => `<button type="button" class="st-tab" data-sec="${k}">${t}</button>`).join("")}
      </nav>
      <div class="st-body">
        <button type="button" class="st-close" aria-label="Close settings">×</button>
        <div id="stPane"></div>
      </div>
    </div>`;
  const pane = () => d.querySelector("#stPane");
  const show = (key) => {
    d.querySelectorAll(".st-tab").forEach((b) => b.setAttribute("aria-current", String(b.dataset.sec === key)));
    if (key === "profile") {
      pane().innerHTML = `<h3>Profile</h3><p class="note st-sub">Used to prefill new records and on your exports.</p>
        <label class="f">Full name<input type="text" id="p_name" autocomplete="name"></label>
        <label class="f" style="margin-top:12px">FSP number<input type="text" id="p_fsp" inputmode="numeric" autocomplete="off"></label>
        <label class="f" style="margin-top:12px"><span>Practice name <span class="opt">(optional)</span></span><input type="text" id="p_practice" autocomplete="organization"></label>
        <div class="cap-foot"><button class="btn btn-primary btn-sm" id="saveProfileBtn">Save profile</button></div>`;
      d.querySelector("#p_name").value = profile.full_name || ""; d.querySelector("#p_fsp").value = profile.fsp_number || ""; d.querySelector("#p_practice").value = profile.practice_name || "";
      d.querySelector("#saveProfileBtn").addEventListener("click", async (e) => {
        const btn = e.currentTarget; btn.disabled = true; btn.textContent = "Saving…";
        const ok = await saveProfile({ full_name: d.querySelector("#p_name").value.trim(), fsp_number: d.querySelector("#p_fsp").value.trim(), practice_name: d.querySelector("#p_practice").value.trim() });
        btn.disabled = false; btn.textContent = "Save profile";
        if (ok) toast("Profile saved");
      });
      d.querySelector("#p_name").focus();
    } else {
      pane().innerHTML = `<h3>Password</h3><p class="note st-sub">Signed in as ${esc(session.user.email || "")}</p>
        <label class="f">New password<input type="password" id="p_pw1" autocomplete="new-password" minlength="8"></label>
        <label class="f" style="margin-top:12px">Confirm new password<input type="password" id="p_pw2" autocomplete="new-password" minlength="8"></label>
        <div class="cap-foot"><button class="btn btn-primary btn-sm" id="savePwBtn">Update password</button></div>
        <div id="pwMsg" aria-live="polite"></div>`;
      d.querySelector("#savePwBtn").addEventListener("click", async (e) => {
        const btn = e.currentTarget, msg = d.querySelector("#pwMsg"), p1 = d.querySelector("#p_pw1").value, p2 = d.querySelector("#p_pw2").value;
        if (p1.length < 8) { msg.innerHTML = `<div class="err">Password must be at least 8 characters.</div>`; return; }
        if (p1 !== p2) { msg.innerHTML = `<div class="err">Passwords don't match.</div>`; return; }
        btn.disabled = true; btn.textContent = "Saving…";
        const { error } = await supabase.auth.updateUser({ password: p1 });
        btn.disabled = false; btn.textContent = "Update password";
        if (error) { msg.innerHTML = `<div class="err">Couldn't update your password. Try again.</div>`; return; }
        d.querySelector("#p_pw1").value = ""; d.querySelector("#p_pw2").value = ""; msg.innerHTML = "";
        toast("Password updated");
      });
      d.querySelector("#p_pw1").focus();
    }
  };
  const close = () => { d.close(); d.remove(); $("#acctBtn").focus(); };
  d.querySelectorAll(".st-tab").forEach((b) => b.addEventListener("click", () => show(b.dataset.sec)));
  d.querySelector(".st-close").addEventListener("click", close);
  d.addEventListener("click", (e) => { if (e.target === d) close(); });
  d.addEventListener("cancel", (e) => { e.preventDefault(); close(); });
  document.body.appendChild(d);
  d.showModal();
  show(section);
}

/* ---------------- Records list ---------------- */
function renderList() {
  const q = query.trim().toLowerCase();
  const rows = q ? records.filter((r) => `${r.client_name} ${r.advice_area}`.toLowerCase().includes(q)) : records;
  const c = $("#content");
  if (!records.length) {
    c.innerHTML = `<div class="card empty">
      <h2>Your first Record of Advice</h2>
      <p>Paste your notes from a client meeting and Quilla will draft every section, then flag anything a compliance officer would query.</p>
      <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap"><button class="btn btn-primary" data-act="new">Start a record</button><button class="btn" data-act="example">Try an example meeting</button></div>
    </div>`;
  } else {
    c.innerHTML = `<div class="list-head"><div><h1>Advice records</h1><div class="rec-sub">${records.length} record${records.length === 1 ? "" : "s"}</div></div><button class="btn btn-primary btn-sm" data-act="new">New record</button></div>
    <div class="card" style="overflow-x:auto">
      ${rows.length ? `<table class="rtable"><thead><tr><th>Client</th><th class="hide-sm">Advice area</th><th class="hide-sm">Meeting date</th><th>Status</th><th><span style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)">Actions</span></th></tr></thead><tbody>
      ${rows.map((r) => `<tr data-open="${esc(r.id)}" tabindex="0"><td class="client">${esc(r.client_name || "Unnamed client")}</td><td class="hide-sm">${esc(r.advice_area)}</td><td class="hide-sm">${esc(fmtDate(r.meeting_date))}</td><td><span class="status ${esc(r.status)}">${STATUS_LABEL[r.status] || "Draft"}</span></td><td style="text-align:right"><button class="row-del" data-del="${esc(r.id)}" aria-label="Delete record for ${esc(r.client_name || "unnamed client")}">Delete</button></td></tr>`).join("")}
      </tbody></table>` : `<div class="empty"><p>No records match “${esc(query)}”.</p></div>`}
    </div>`;
  }
  c.querySelectorAll("[data-act=new]").forEach((b) => b.addEventListener("click", newRecord));
  c.querySelectorAll("[data-act=example]").forEach((b) => b.addEventListener("click", async () => { await newRecord(); if (view === "record") loadExample(); }));
  c.querySelectorAll("[data-open]").forEach((tr) => {
    const open = () => openRecord(tr.dataset.open);
    tr.addEventListener("click", (e) => { if (e.target.closest("[data-del]")) return; open(); });
    tr.addEventListener("keydown", (e) => { if (e.key === "Enter") open(); });
  });
  c.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", async (e) => {
    e.stopPropagation();
    const rec = records.find((r) => r.id === b.dataset.del);
    const ok = await confirmBox({ title: "Delete this record?", body: `${rec?.client_name ? `The record for ${rec.client_name}` : "This record"}, including its draft, sign-off and history, will be permanently deleted. This can't be undone.`, confirmLabel: "Delete record", danger: true });
    if (!ok) return;
    const { error } = await supabase.from("records").delete().eq("id", b.dataset.del);
    if (error) { toast("Couldn't delete the record. Try again."); return; }
    records = records.filter((r) => r.id !== b.dataset.del);
    if (S.id === b.dataset.del) S = blank();
    $("#recCount").textContent = records.length ? String(records.length) : "";
    renderList(); toast("Record deleted");
  }));
}
async function openRecord(id) {
  if (!(await canLeave())) return;
  if (id !== S.id) {
    const { data, error } = await supabase.from("records").select("data").eq("id", id).single();
    if (error || !data) { toast("Couldn't open that record."); return; }
    S = Object.assign(blank(), data.data, { id });
  }
  view = "record"; tab = S.sections ? (S.status === "signed" ? "signoff" : "document") : "notes";
  renderApp(); window.scrollTo(0, 0);
}
async function newRecord() {
  if (!(await canLeave())) return;
  S = blank(); view = "record"; tab = "notes"; $("#savestate").textContent = "";
  renderApp(); window.scrollTo(0, 0); closeSide();
}
function loadExample() { Object.assign(S.meta, EXAMPLE.meta); S.notes = EXAMPLE.notes; dirty = true; tab = "notes"; renderApp(); scheduleSave(); }

/* ---------------- Record shell ---------------- */
function gapCounts() {
  const open = S.gaps.filter((g) => g.state === "open");
  return { crit: open.filter((g) => g.severity === "critical").length, imp: open.filter((g) => g.severity === "important").length, min: open.filter((g) => g.severity === "minor").length, done: S.gaps.length - open.length, open: open.length };
}
function renderRecord() {
  const m = S.meta, st = statusOf(S), has = !!S.sections, c = gapCounts();
  $("#content").innerHTML = `
    ${crumbs([["Advice records", "list"], [m.client || "New record"]])}
    <div class="rec-head">
      <div>
        <h1 class="rec-title">${esc(m.client || "New record")} <span class="status ${st}">${STATUS_LABEL[st]}</span></h1>
        <div class="rec-sub">${esc(m.area)} · ${esc(fmtDate(m.date))}${m.ref ? ` · ${esc(m.ref)}` : ""}</div>
      </div>
      <div class="rec-actions" id="recActions"></div>
    </div>
    <div class="tabs" role="tablist" aria-label="Record sections">
      <button class="tab" role="tab" data-tab="document" aria-selected="${tab === "document"}" ${has ? "" : "disabled"}>Document${has && c.open ? `<span class="n">${c.open}</span>` : (has ? `<span class="n ok">✓</span>` : "")}</button>
      <button class="tab" role="tab" data-tab="notes" aria-selected="${tab === "notes"}">Source notes</button>
      <button class="tab" role="tab" data-tab="signoff" aria-selected="${tab === "signoff"}" ${has ? "" : "disabled"}>Sign-off</button>
      <button class="tab" role="tab" data-tab="activity" aria-selected="${tab === "activity"}">Activity</button>
    </div>
    ${locked() ? lockedBar() : ""}
    <div id="tabBody"></div>`;
  const rb = $("#reopenBar"); if (rb) rb.addEventListener("click", reopenRecord);
  $("#content").querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => { if (b.disabled || busy) return; tab = b.dataset.tab; renderRecord(); }));
  if (tab === "document" && has) renderDocument();
  else if (tab === "signoff" && has) renderSignoff();
  else if (tab === "activity") renderActivity();
  else { tab = "notes"; renderNotes(); }
}
function lockedBar() {
  const so = S.signoff;
  return `<div class="locked-bar" role="status"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
    <div><b>${so.version ? `Signed and sealed as version ${so.version}` : "Signed off"}</b> on ${esc(fmtTime(so.sealedAt || so.signedAt))}. This record is read-only.</div>
    <button class="btn btn-sm" id="reopenBar">Reopen for editing</button></div>`;
}
function refreshTabBadge() {
  const b = $('[data-tab="document"]'); if (!b || !S.sections) return;
  const c = gapCounts(); const old = b.querySelector(".n"); if (old) old.remove();
  b.insertAdjacentHTML("beforeend", c.open ? `<span class="n">${c.open}</span>` : `<span class="n ok">✓</span>`);
}
function renderHeaderOnly() {
  const t = $(".rec-title"), sub = $(".rec-sub"); if (!t || !sub) return;
  const st = statusOf(S), m = S.meta;
  const cur = $(".crumb-cur"); if (cur) cur.textContent = m.client || "New record";
  t.innerHTML = `${esc(m.client || "New record")} <span class="status ${st}">${STATUS_LABEL[st]}</span>`;
  sub.textContent = `${m.area} · ${fmtDate(m.date)}${m.ref ? ` · ${m.ref}` : ""}`;
}

/* ---------------- Source notes tab ---------------- */
function renderNotes() {
  const m = S.meta;
  $("#recActions").innerHTML = "";
  $("#tabBody").innerHTML = `
  <div class="notes-grid">
    <section class="card" aria-label="Meeting details and notes">
      <div class="client-link" id="clientLink"></div>
      <div class="meta-grid">
        <label class="f"><span>Client name</span><input type="text" id="m_client" autocomplete="off"></label>
        <label class="f"><span>Client reference <span class="opt">(optional)</span></span><input type="text" id="m_ref" autocomplete="off" placeholder="Your own reference, not an ID number"></label>
        <label class="f"><span>Meeting date</span><input type="date" id="m_date"></label>
        <label class="f"><span>Advice area</span><select id="m_area">${AREAS.map((a) => `<option ${m.area === a ? "selected" : ""}>${a}</option>`).join("")}</select></label>
      </div>
      <label class="f" for="notes" style="margin-top:18px">Meeting notes or transcript <span class="hint">Include what the client said, what you considered, what you recommended and why, and the fees you disclosed.</span></label>
      <textarea id="notes" placeholder="Meeting with the client on…"></textarea>
      <div class="cap-foot">
        ${locked() ? "" : `<button class="btn btn-primary" id="draftBtn">${S.sections ? "Draft again" : "Draft the record"}</button>
        <button class="btn" id="exampleBtn">Load an example meeting</button>`}
        <span class="note count" id="count"></span>
      </div>
      <div id="capStatus"></div>
    </section>
    <aside class="card how" aria-label="How it works">
      <h3>What happens next</h3>
      <ol>
        <li><b>Draft.</b> Quilla writes all 13 FAIS sections from your notes, showing the words each one came from.</li>
        <li><b>Check.</b> Anything a compliance officer would query is flagged beside the document.</li>
        <li><b>Sign off.</b> Resolve or explain each item, confirm the record and export it for the client file.</li>
      </ol>
      <p class="note">Quilla documents your advice. It never recommends products, and you stay responsible for the final record.</p>
    </aside>
  </div>`;
  const bind = (id, key) => { const el = $("#" + id); el.value = m[key] || ""; el.addEventListener("input", () => { m[key] = el.value; dirty = true; scheduleSave(); }); el.addEventListener("change", renderHeaderOnly); };
  bind("m_client", "client"); bind("m_ref", "ref"); bind("m_date", "date");
  renderClientLink();
  $("#m_client").addEventListener("input", renderClientLink);
  $("#m_area").addEventListener("change", (e) => { m.area = e.target.value; dirty = true; scheduleSave(); renderHeaderOnly(); });
  const n = $("#notes"); n.value = S.notes;
  const upd = () => { const w = S.notes.trim() ? S.notes.trim().split(/\s+/).length : 0; $("#count").textContent = w ? `${w} words` : ""; };
  n.addEventListener("input", () => { S.notes = n.value; dirty = true; upd(); scheduleSave(); }); upd();
  if (locked()) { $("#tabBody").querySelectorAll("input, select, textarea").forEach((el) => { el.disabled = true; }); return; }
  $("#exampleBtn").addEventListener("click", async () => { if (S.notes.trim() && !(await confirmBox({ title: "Replace your notes?", body: "Your current notes will be replaced with the example meeting.", confirmLabel: "Replace notes" }))) return; loadExample(); });
  $("#draftBtn").addEventListener("click", () => draft(!!S.sections));
  if (S.sections) $("#capStatus").innerHTML = `<p class="note" style="margin-top:12px">Drafting again replaces the sections and flagged items, and clears any sign-off.</p>`;
}

// Link the record to a saved client (fills name + reference), or save the typed name as a new client.
function renderClientLink() {
  const el = $("#clientLink"); if (!el) return;
  const linked = clients.find((c) => c.id === S.clientId), ro = locked();
  const typed = S.meta.client.trim(), known = clients.some((c) => c.name.trim().toLowerCase() === typed.toLowerCase());
  el.innerHTML = `<label class="f">Client record
      <select id="m_clientSel" ${ro ? "disabled" : ""}><option value="">${clients.length ? "Not linked to a saved client" : "No saved clients yet"}</option>${clients.map((c) => `<option value="${esc(c.id)}" ${c.id === S.clientId ? "selected" : ""}>${esc(c.name)}${c.reference ? ` (${esc(c.reference)})` : ""}</option>`).join("")}</select></label>
    ${linked ? `<button class="linkbtn" id="m_openClient">View client</button>` : (!ro && typed && !known ? `<button class="linkbtn" id="m_saveClient">Save "${esc(typed.slice(0, 40))}" as a client</button>` : "")}`;
  $("#m_clientSel").addEventListener("change", (e) => {
    const c = clients.find((x) => x.id === e.target.value);
    S.clientId = c ? c.id : null;
    if (c) { S.meta.client = c.name; if (c.reference) S.meta.ref = c.reference; $("#m_client").value = S.meta.client; $("#m_ref").value = S.meta.ref; log(`Linked to client ${c.name}`); }
    dirty = true; scheduleSave(); renderHeaderOnly(); renderClientLink();
  });
  $("#m_openClient")?.addEventListener("click", () => go("client", S.clientId));
  $("#m_saveClient")?.addEventListener("click", async () => {
    const { data, error } = await supabase.from("clients").insert({ name: S.meta.client.trim(), reference: S.meta.ref.trim() }).select("id, name, reference, email, phone, notes, updated_at").single();
    if (error) { toast("Couldn't save the client. Try again."); return; }
    clients.push(data); clients.sort((a, b) => a.name.localeCompare(b.name));
    S.clientId = data.id; log(`Saved and linked client ${data.name}`); dirty = true; scheduleSave(); renderClientLink(); toast("Client saved");
  });
}

/* ---------------- Drafting ---------------- */
function normGap(g) { return { id: gid(), section_id: SEC_IDS.includes(g.section_id) ? g.section_id : "client_decision", severity: SEV_ORDER[g.severity] !== undefined ? g.severity : "important", issue: String(g.issue).trim(), fix: String(g.fix || "").trim(), state: "open", note: "", source: "ai" }; }
function normalizeDraft(r) {
  if (!r || typeof r !== "object") throw { code: "invalid_json" };
  const out = { summary: typeof r.summary === "string" ? r.summary.trim() : "", replacement: { is_replacement: !!r.replacement?.is_replacement, existing_product: String(r.replacement?.existing_product || "") }, sections: {}, gaps: [] };
  const byId = {}; (Array.isArray(r.sections) ? r.sections : []).forEach((s) => { if (s && SEC_IDS.includes(s.id)) byId[s.id] = s; });
  if (Object.keys(byId).length < 6) throw { code: "invalid_json" };
  SEC_IDS.forEach((id) => {
    const s = byId[id] || {}; const content = typeof s.content === "string" ? s.content.trim() : "";
    let status = ["captured", "partial", "not_captured"].includes(s.status) ? s.status : (content ? "partial" : "not_captured"); if (!content) status = "not_captured";
    out.sections[id] = { content, original: content, status, evidence: (Array.isArray(s.evidence) ? s.evidence : []).filter((q) => typeof q === "string" && q.trim()).slice(0, 2), edited: false };
  });
  out.gaps = (Array.isArray(r.gaps) ? r.gaps : []).filter((g) => g && typeof g.issue === "string" && g.issue.trim()).map(normGap);
  return out;
}
// Deterministic checks layered on top of the AI's gaps, so required sections are never silently skipped.
function addRuleGaps(sections, gaps, replacement) {
  const openFor = (id) => gaps.some((g) => g.section_id === id && g.state === "open");
  Object.entries(REQUIRED).forEach(([id, sev]) => {
    if (sections[id].status === "not_captured" && !openFor(id)) gaps.push({ id: gid(), section_id: id, severity: sev, issue: `${SEC_TITLE[id]} is not recorded in the notes.`, fix: `Add what was discussed about ${SEC_TITLE[id].toLowerCase()}, or explain why it doesn't apply.`, state: "open", note: "", source: "rule" });
  });
  if (replacement.is_replacement && sections.replacement.status !== "captured" && !openFor("replacement"))
    gaps.push({ id: gid(), section_id: "replacement", severity: "critical", issue: "An existing product is being replaced, but the replacement analysis is incomplete.", fix: "Record termination charges, a cost comparison, tax impact and any benefits the client loses.", state: "open", note: "", source: "rule" });
  return gaps;
}
const NOTES_MAX = 150000; // matches LIMITS.notes in supabase/functions/ai/prompts.ts
// Templates → "standard wording" is the advisor's own text, appended (not generated) after drafting.
function applyStandardWording(sections) {
  const added = [];
  Object.entries(profile.template || {}).forEach(([id, e]) => {
    const std = (e?.standard || "").trim(), s = sections[id]; if (!std || !s) return;
    s.content = s.content ? `${s.content}\n\n${std}` : std; s.original = s.content; s.standard = true;
    if (s.status === "not_captured") s.status = "partial";
    added.push(id);
  });
  return added;
}
async function draft(again) {
  if (busy) return;
  const st = $("#capStatus");
  if (S.notes.length > NOTES_MAX) { st.innerHTML = `<div class="err">These notes are too long to draft in one go (${S.notes.length.toLocaleString("en-ZA")} characters; the limit is ${NOTES_MAX.toLocaleString("en-ZA")}). Remove small talk or split the meeting into two records.</div>`; return; }
  if (S.notes.trim().split(/\s+/).length < 25) { st.innerHTML = `<div class="err">Add more detail to the notes first. A useful record needs at least what the client wants, what you recommended and why.</div>`; return; }
  busy = new AbortController(); $("#draftBtn").disabled = true; $("#exampleBtn").disabled = true;
  const started = Date.now();
  st.innerHTML = `<div class="working" role="status"><span class="pulse" aria-hidden="true"></span><div><b>Drafting the record…</b><div class="note" id="wkTime">This usually takes 20 to 60 seconds.</div></div><button class="btn btn-xs" id="stopBtn" style="margin-left:auto">Stop</button></div>`;
  $("#stopBtn").addEventListener("click", () => busy && busy.abort());
  const timer = setInterval(() => { const el = $("#wkTime"); if (el) el.textContent = `${Math.round((Date.now() - started) / 1000)}s elapsed`; }, 1000);
  try {
    const raw = await ai("draft", { notes: S.notes, meta: { client: S.meta.client, area: S.meta.area, date: S.meta.date } }, busy.signal);
    const d = normalizeDraft(raw);
    const std = applyStandardWording(d.sections);
    S.summary = d.summary; S.replacement = d.replacement; S.sections = d.sections; S.gaps = addRuleGaps(d.sections, d.gaps, d.replacement);
    if (std.length) log(`Added your standard wording to: ${std.map((id) => SEC_TITLE[id]).join(", ")}`);
    S.signoff = { outcome: "", declared: false, override: "", signedAt: null, signedBy: S.signoff.signedBy || "" }; S.status = "draft";
    log(again ? "Record redrafted from notes" : "Record drafted from notes");
    clearInterval(timer); busy = null; tab = "document"; renderRecord(); window.scrollTo(0, 0); save();
  } catch (e) {
    clearInterval(timer); busy = null;
    st.innerHTML = e?.code === "cancelled" ? `<p class="note" style="margin-top:12px">Drafting stopped. Your notes are unchanged.</p>` : `<div class="err">${esc(errCopy(e?.code))}</div>`;
    const b = $("#draftBtn"); if (b) b.disabled = false; const x = $("#exampleBtn"); if (x) x.disabled = false;
  }
}

/* ---------------- Document tab ---------------- */
function renderDocument() {
  const ro = locked();
  $("#recActions").innerHTML = ro ? `<button class="btn btn-sm" id="toSign">View sign-off and exports</button>` : `<button class="btn btn-sm" id="recheckBtn">Check again</button><button class="btn btn-primary btn-sm" id="toSign">Continue to sign-off</button>`;
  $("#tabBody").innerHTML = `
  <div id="recheckStatus"></div>
  <div class="doc-grid">
    <div>${S.summary ? `<p class="summary">${esc(S.summary)}</p>` : ""}<div id="secs"></div></div>
    <aside class="margin" aria-label="Compliance check" id="margin"></aside>
  </div>`;
  $("#secs").innerHTML = SECTIONS.map(([id, title, hint], i) => {
    const s = S.sections[id]; const na = id === "replacement" && !S.replacement.is_replacement && s.status === "not_captured";
    return `<section class="sec-card" id="sec-${id}" data-state="${na ? "captured" : s.status}">
      <div class="sec-card-h"><span class="num">${i + 1}</span><h3>${esc(title)}</h3><span class="pill" id="pill-${id}"></span>
        <div class="sec-tools">${ro ? "" : `<button class="improve" data-improve="${id}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l1.8 5.2L19 9l-5.2 1.8L12 16l-1.8-5.2L5 9l5.2-1.8zM19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z"/></svg>Improve with AI</button>`}</div>
      </div>
      ${s.status === "not_captured" && !na ? `<p class="sec-hint">${esc(hint)}</p>` : ""}
      <div class="sec-body"><textarea data-sec="${id}" aria-label="${esc(title)}" rows="2" ${ro ? "readonly" : ""} placeholder="${na ? "Not applicable: no existing product is being replaced." : "Not captured in the notes. Add it here or resolve the flagged item."}"></textarea></div>
      ${s.evidence.length ? `<div class="evidence">From your notes: ${s.evidence.map((q) => `<q>${esc(q)}</q>`).join(" · ")}</div>` : ""}
      ${s.standard ? `<div class="evidence">Includes your standard wording from Templates.</div>` : ""}
      <div class="sec-msg" id="msg-${id}" aria-live="polite"></div>
    </section>`;
  }).join("");
  $("#secs").querySelectorAll("textarea").forEach((t) => {
    const id = t.dataset.sec; t.value = S.sections[id].content; requestAnimationFrame(() => autosize(t));
    t.addEventListener("input", () => { const s = S.sections[id]; s.content = t.value; s.edited = t.value.trim() !== s.original.trim(); autosize(t); dirty = true; setPill(id); syncImprove(id); scheduleSave(); });
    t.addEventListener("change", () => { if (S.sections[id].edited) log(`Edited "${SEC_TITLE[id]}"`); });
    setPill(id); syncImprove(id);
  });
  $("#secs").querySelectorAll("[data-improve]").forEach((b) => b.addEventListener("click", () => improve(b.dataset.improve)));
  renderMargin();
  $("#toSign").addEventListener("click", () => { tab = "signoff"; renderRecord(); window.scrollTo(0, 0); });
  if (!ro) $("#recheckBtn").addEventListener("click", recheck);
}
function syncImprove(id) { const b = document.querySelector(`[data-improve="${id}"]`); if (b) b.disabled = !S.sections[id].content.trim() || !!busy; }
function setPill(id) {
  const p = $("#pill-" + id); if (!p) return; const s = S.sections[id];
  const na = id === "replacement" && !S.replacement.is_replacement && !s.content.trim();
  let cls, txt;
  if (na) { cls = "captured"; txt = "Not applicable"; }
  else if (s.edited) { cls = "edited"; txt = "Edited by you"; }
  else if (s.status === "captured") { cls = "captured"; txt = "From notes"; }
  else if (s.status === "partial") { cls = "partial"; txt = "Partly captured"; }
  else { cls = "not_captured"; txt = "Not captured"; }
  if (s.edited && s.content.trim()) { const c = $("#sec-" + id); if (c) c.dataset.state = "captured"; }
  p.className = "pill " + cls; p.textContent = txt;
}
async function improve(id) {
  if (busy) return;
  const s = S.sections[id]; if (!s.content.trim()) return;
  const msg = $("#msg-" + id); busy = new AbortController();
  document.querySelectorAll("[data-improve]").forEach((b) => (b.disabled = true));
  msg.innerHTML = `<span class="pulse" style="display:inline-block;vertical-align:middle;margin-right:8px" aria-hidden="true"></span>Improving the wording… <button class="linkbtn" id="stopImp">Stop</button>`;
  $("#stopImp").addEventListener("click", () => busy && busy.abort());
  try {
    const r = await ai("improve", { section_id: id, content: s.content, notes: S.notes }, busy.signal);
    const text = typeof r?.content === "string" ? r.content.trim() : "";
    if (!text) throw { code: "invalid_json" };
    improveUndo[id] = s.content; s.content = text; s.edited = text !== s.original.trim();
    log(`Improved wording of "${SEC_TITLE[id]}" with AI`);
    const t = document.querySelector(`textarea[data-sec="${id}"]`); if (t) { t.value = text; autosize(t); }
    setPill(id); dirty = true; save();
    msg.innerHTML = `Wording improved. Check it still says exactly what happened. <button class="linkbtn" id="undo-${id}">Undo</button>`;
    $("#undo-" + id).addEventListener("click", () => { s.content = improveUndo[id]; s.edited = s.content.trim() !== s.original.trim(); if (t) { t.value = s.content; autosize(t); } setPill(id); log(`Undid AI wording in "${SEC_TITLE[id]}"`); msg.textContent = "Change undone."; dirty = true; scheduleSave(); });
  } catch (e) { msg.textContent = e?.code === "cancelled" ? "" : errCopy(e?.code); }
  busy = null; SEC_IDS.forEach(syncImprove);
}
function renderMargin() {
  const el = $("#margin"); if (!el) return; const c = gapCounts();
  const sorted = [...S.gaps].sort((a, b) => (a.state === "open" ? 0 : 1) - (b.state === "open" ? 0 : 1) || SEV_ORDER[a.severity] - SEV_ORDER[b.severity] || SEC_IDS.indexOf(a.section_id) - SEC_IDS.indexOf(b.section_id));
  el.innerHTML = `<div class="card">
    <div class="margin-head"><h3>Compliance check</h3><span class="note">${c.open} open</span></div>
    <div class="tally">${c.crit ? `<span class="t-crit">${c.crit} critical</span>` : ""}${c.imp ? `<span class="t-imp">${c.imp} important</span>` : ""}${c.min ? `<span class="t-min">${c.min} minor</span>` : ""}${c.done ? `<span class="t-done">${c.done} resolved</span>` : ""}</div>
    ${sorted.length ? sorted.map(gapCard).join("") : `<div class="empty-gaps">Nothing flagged. Read the record through once more before signing off.</div>`}
    <p class="disclaimer">Items are suggestions based on FAIS record-keeping requirements. They don't replace your compliance officer's review.</p></div>`;
  el.querySelectorAll("[data-jump]").forEach((b) => b.addEventListener("click", () => jump(b.dataset.jump)));
  el.querySelectorAll("[data-resolve]").forEach((b) => b.addEventListener("click", () => openResolve(b.dataset.gid, b.dataset.resolve)));
  el.querySelectorAll("[data-reopen]").forEach((b) => b.addEventListener("click", () => { const g = S.gaps.find((x) => x.id === b.dataset.reopen); g.state = "open"; g.note = ""; log(`Reopened: ${g.issue}`); dirty = true; renderMargin(); scheduleSave(); }));
  refreshTabBadge();
}
function gapCard(g) {
  const r = g.state !== "open";
  if (locked()) return `<div class="gap ${r ? "resolved" : g.severity}" id="gap-${g.id}">
    <div class="g-sec"><span class="g-sev">${r ? (g.state === "addressed" ? "Addressed" : "Not applicable") : SEV_LABEL[g.severity]}</span><button class="linkbtn" data-jump="${g.section_id}" style="font-size:12px">${esc(SEC_TITLE[g.section_id])}</button></div>
    <p>${esc(g.issue)}</p>${r ? `<div class="res-note">${esc(g.note)}</div>` : ""}</div>`;
  return `<div class="gap ${r ? "resolved" : g.severity}" id="gap-${g.id}">
    <div class="g-sec"><span class="g-sev">${r ? (g.state === "addressed" ? "Addressed" : "Not applicable") : SEV_LABEL[g.severity]}</span><button class="linkbtn" data-jump="${g.section_id}" style="font-size:12px">${esc(SEC_TITLE[g.section_id])}</button></div>
    <p>${esc(g.issue)}</p>${!r && g.fix ? `<p class="fix">${esc(g.fix)}</p>` : ""}
    ${r ? `<div class="res-note">${esc(g.note)}</div><div class="g-actions"><button class="btn btn-xs" data-reopen="${g.id}">Reopen</button></div>`
      : `<div class="g-actions"><button class="btn btn-xs" data-resolve="addressed" data-gid="${g.id}">Mark addressed</button><button class="btn btn-xs" data-resolve="na" data-gid="${g.id}">Not applicable</button></div><div class="resolve-slot"></div>`}
  </div>`;
}
function openResolve(id, kind) {
  const card = $("#gap-" + id); const slot = card?.querySelector(".resolve-slot"); if (!slot) return;
  const g = S.gaps.find((x) => x.id === id); const sec = S.sections[g.section_id];
  const pre = kind === "addressed" && sec.edited ? `Updated "${SEC_TITLE[g.section_id]}" in the record.` : "";
  slot.innerHTML = `<div class="resolve-form"><label class="note" for="rs-${id}">${kind === "addressed" ? "How was this addressed?" : "Why doesn't this apply?"}</label><input type="text" id="rs-${id}" value="${esc(pre)}" placeholder="${kind === "addressed" ? "e.g. Termination charge of R18,400 confirmed with Liberty" : "e.g. No commission is earned on this product"}"><div class="g-actions" style="margin-top:0"><button class="btn btn-xs btn-primary" data-save>Save</button><button class="btn btn-xs" data-cancel>Cancel</button></div></div>`;
  const inp = slot.querySelector("input"); inp.focus();
  const commit = () => { const v = inp.value.trim(); if (v.length < 5) { inp.style.borderColor = "var(--red-line)"; inp.setAttribute("aria-invalid", "true"); return; } g.state = kind; g.note = v; log(`${kind === "addressed" ? "Addressed" : "Marked not applicable"}: ${g.issue} (${v})`); dirty = true; renderMargin(); scheduleSave(); };
  slot.querySelector("[data-save]").addEventListener("click", commit);
  inp.addEventListener("keydown", (e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") slot.innerHTML = ""; });
  slot.querySelector("[data-cancel]").addEventListener("click", () => (slot.innerHTML = ""));
}
function jump(id) {
  const c = $("#sec-" + id); if (!c) return;
  c.scrollIntoView({ behavior: reduced() ? "auto" : "smooth", block: "start" });
  c.classList.add("flash"); setTimeout(() => c.classList.remove("flash"), 1500);
  const t = c.querySelector("textarea"); if (t) setTimeout(() => t.focus({ preventScroll: true }), 300);
}
async function recheck() {
  if (busy) return;
  const st = $("#recheckStatus"), btn = $("#recheckBtn");
  busy = new AbortController(); btn.disabled = true; SEC_IDS.forEach(syncImprove);
  st.innerHTML = `<div class="working" role="status" style="margin:0 0 18px"><span class="pulse" aria-hidden="true"></span><b>Checking the edited record…</b><button class="btn btn-xs" id="stopRc" style="margin-left:auto">Stop</button></div>`;
  $("#stopRc").addEventListener("click", () => busy && busy.abort());
  try {
    const r = await ai("recheck", {
      sections: Object.fromEntries(SEC_IDS.map((id) => [id, S.sections[id].content])),
      resolved: S.gaps.filter((g) => g.state !== "open").map((g) => ({ section_id: g.section_id, issue: g.issue, state: g.state, note: g.note })),
      replacement: S.replacement,
    }, busy.signal);
    const fresh = (Array.isArray(r?.gaps) ? r.gaps : []).filter((g) => g && typeof g.issue === "string" && g.issue.trim()).map(normGap);
    const kept = S.gaps.filter((g) => g.state !== "open");
    const secView = {}; SEC_IDS.forEach((id) => { const s = S.sections[id]; secView[id] = { status: s.content.trim() ? (s.edited ? "captured" : s.status) : "not_captured" }; });
    S.gaps = addRuleGaps(secView, kept.concat(fresh), S.replacement).filter((g) => kept.includes(g) || !(g.source === "rule" && kept.some((k) => k.section_id === g.section_id)));
    const c = gapCounts(); log(`Record re-checked: ${c.open} open item${c.open === 1 ? "" : "s"}`);
    busy = null; btn.disabled = false; st.innerHTML = ""; renderMargin(); SEC_IDS.forEach(syncImprove);
    toast(c.open ? `${c.open} item${c.open === 1 ? "" : "s"} to look at` : "Nothing new flagged"); save();
  } catch (e) {
    busy = null; btn.disabled = false; SEC_IDS.forEach(syncImprove);
    st.innerHTML = e?.code === "cancelled" ? "" : `<div class="err" style="margin:0 0 18px">${esc(errCopy(e?.code))}</div>`;
  }
}

/* ---------------- Sign-off tab ---------------- */
function emptyRequired() { return Object.keys(REQUIRED).filter((id) => !S.sections[id].content.trim()); }
function renderSignoff() {
  const c = gapCounts(), so = S.signoff, m = S.meta, er = emptyRequired(), signed = S.status === "signed";
  $("#recActions").innerHTML = "";
  const checks = [
    [c.crit ? `${c.crit} critical item${c.crit === 1 ? "" : "s"} still open` : "No critical items open", c.crit ? "no" : "ok"],
    [c.imp ? `${c.imp} important item${c.imp === 1 ? "" : "s"} still open` : "No important items open", c.imp ? "warn" : "ok"],
    [er.length ? `Empty: ${er.map((id) => SEC_TITLE[id]).join(", ")}` : "All required sections have content", er.length ? "no" : "ok"],
    [(m.adviser.trim() && m.fsp.trim()) ? "Advisor name and FSP number recorded" : "Advisor name or FSP number missing", (m.adviser.trim() && m.fsp.trim()) ? "ok" : "no"],
  ];
  $("#tabBody").innerHTML = `
  <div class="sign-grid">
    <section class="card">
      <h3 class="sub">Before you sign</h3>
      <ul class="checklist">${checks.map((k) => `<li><span class="tick ${k[1]}" aria-hidden="true">${k[1] === "ok" ? "✓" : "!"}</span><span>${esc(k[0])}</span></li>`).join("")}</ul>
      <div class="meta-grid" style="margin-top:18px">
        <label class="f">Advisor<input type="text" id="s_adviser" autocomplete="name" ${signed ? "disabled" : ""}></label>
        <label class="f">FSP number<input type="text" id="s_fsp" inputmode="numeric" ${signed ? "disabled" : ""}></label>
      </div>
      <label class="f" style="margin-top:14px">Client's decision
        <select id="s_outcome" ${signed ? "disabled" : ""}><option value="">Choose…</option>${["Accepted the advice", "Accepted with changes", "Declined the advice", "Decision pending"].map((o) => `<option ${so.outcome === o ? "selected" : ""}>${o}</option>`).join("")}</select>
      </label>
      <div id="overrideWrap"></div>
      <label class="declare"><input type="checkbox" id="s_declare" ${so.declared ? "checked" : ""} ${signed ? "disabled" : ""}><span>I confirm this record accurately reflects the information considered, the products considered and the advice I gave, and that I am responsible for its content.</span></label>
      <div class="cap-foot">${signed ? `<button class="btn" id="unsign">Reopen for editing</button>` : `<button class="btn btn-primary" id="signBtn">Sign off and seal</button><button class="btn" id="backDoc">Back to document</button>`}</div>
      ${signed ? `<div class="signed" role="status"><b>Signed off</b> by ${esc(so.signedBy)} on ${esc(fmtTime(so.signedAt))}.${so.version ? `<div class="seal-line">Sealed as version ${so.version}. Fingerprint <code class="fp">${esc(so.sha256.slice(0, 16))}…</code></div>` : ""}</div>` : `<p class="note" style="margin:12px 0 0">Signing seals a read-only copy of the record. To change it later you reopen it, and the next sign-off becomes a new version.</p>`}
      <h3 class="sub" style="margin-top:26px">Export</h3>
      <p class="note" style="margin:0">${signed && so.version ? `Exports version ${so.version} exactly as sealed` : "Exports the current draft, marked as not signed"}: the record, your sign-off, how each flagged item was resolved and the full history, ready for the client file.</p>
      <div class="exports"><button class="btn btn-sm btn-primary" data-export="pdf">Download PDF</button><button class="btn btn-sm" data-export="docx">Download Word (.docx)</button><button class="btn btn-sm" data-export="md">Text (.md)</button></div>
    </section>
    <aside class="card"><h3 class="sub">Sealed versions</h3><div id="versions"><p class="note">Loading…</p></div>
      <h3 class="sub" style="margin-top:22px">Recent activity</h3><ul class="audit">${S.audit.slice(-6).reverse().map((a) => `<li><time datetime="${esc(a.at)}">${esc(fmtTime(a.at))}</time><span>${esc(a.text)}</span></li>`).join("") || `<li><span class="note">No activity yet.</span></li>`}</ul></aside>
  </div>`;
  const a = $("#s_adviser"), f = $("#s_fsp"); a.value = m.adviser; f.value = m.fsp;
  const rerender = () => { clearTimeout(renderSignoff._t); renderSignoff._t = setTimeout(() => { const id = document.activeElement?.id, pos = document.activeElement?.selectionStart; renderSignoff(); if (id) { const el = $("#" + id); if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch (_) { /* not a text field */ } } } }, 500); };
  a.addEventListener("input", () => { m.adviser = a.value; dirty = true; rerender(); scheduleSave(); });
  f.addEventListener("input", () => { m.fsp = f.value; dirty = true; rerender(); scheduleSave(); });
  $("#s_outcome").addEventListener("change", (e) => { so.outcome = e.target.value; dirty = true; scheduleSave(); updateSignBtn(); });
  $("#s_declare").addEventListener("change", (e) => { so.declared = e.target.checked; updateSignBtn(); });
  if (!signed && c.crit) {
    $("#overrideWrap").innerHTML = `<label class="f" style="margin-top:14px">Reason for signing with critical items open <span class="hint">Required. This is written into the record's history and export.</span><textarea id="s_override" rows="2"></textarea></label>`;
    const o = $("#s_override"); o.value = so.override; o.addEventListener("input", () => { so.override = o.value; updateSignBtn(); });
  }
  if (!signed) { $("#signBtn").addEventListener("click", signOff); $("#backDoc").addEventListener("click", () => { tab = "document"; renderRecord(); }); updateSignBtn(); }
  else $("#unsign").addEventListener("click", reopenRecord);
  $("#tabBody").querySelectorAll("[data-export]").forEach((b) => b.addEventListener("click", () => exportRecord(b.dataset.export, null, b)));
  renderVersions();
}
function signReady() { const c = gapCounts(), so = S.signoff, m = S.meta; return so.declared && so.outcome && m.adviser.trim() && m.fsp.trim() && emptyRequired().length === 0 && (c.crit === 0 || so.override.trim().length >= 15); }
function updateSignBtn() { const b = $("#signBtn"); if (b) b.disabled = !signReady(); }
// Signing seals an immutable snapshot in record_versions. The database assigns the
// version number, sealing time and SHA-256 fingerprint; nothing is signed unless that succeeds.
async function signOff() {
  if (!signReady() || busy) return;
  const so = S.signoff, c = gapCounts(), btn = $("#signBtn");
  busy = new AbortController(); btn.disabled = true; btn.textContent = "Sealing…";
  const before = JSON.stringify({ signoff: so, status: S.status, audit: S.audit, practice: S.meta.practice });
  const fail = (msg) => { const b = JSON.parse(before); Object.assign(so, b.signoff); S.status = b.status; S.audit = b.audit; S.meta.practice = b.practice; busy = null; renderRecord(); toast(msg); };
  // The records row must exist (and be current) before a version can reference it.
  clearTimeout(saveTimer);
  const { error: rowErr } = await supabase.from("records").upsert(rowOf(S));
  if (rowErr) return fail("Couldn't sign off: the record didn't save. Check your connection and try again.");
  if (!S.meta.practice) S.meta.practice = profile.practice_name || "";
  so.signedAt = new Date().toISOString(); so.signedBy = S.meta.adviser.trim(); S.status = "signed";
  so.version = null; so.sha256 = ""; so.sealedAt = null;
  if (c.crit) log(`Signed with ${c.crit} critical item${c.crit === 1 ? "" : "s"} open. Reason: ${so.override.trim()}`);
  log(`Signed off by ${so.signedBy} (FSP ${S.meta.fsp.trim()}). Client decision: ${so.outcome}`);
  const { data, error } = await supabase.from("record_versions").insert({ record_id: S.id, snapshot: S }).select("version, sha256, signed_at").single();
  if (error) { console.error(error); return fail("Couldn't seal the record. Check your connection and try again."); }
  so.version = data.version; so.sha256 = data.sha256; so.sealedAt = data.signed_at;
  log(`Sealed as version ${data.version} (fingerprint ${data.sha256.slice(0, 16)})`);
  busy = null; dirty = true; await save(); renderRecord(); toast(`Signed and sealed as version ${data.version}`);
}
async function reopenRecord() {
  if (busy) return;
  const so = S.signoff, v = so.version;
  const ok = await confirmBox({ title: "Reopen this record?", body: v ? `Version ${v} stays sealed exactly as you signed it. Your changes become version ${v + 1} when you sign again. Reopening is logged in the record's history.` : "The sign-off will be removed so you can edit. You'll need to sign it again, and this is logged in the record's history.", confirmLabel: "Reopen record" });
  if (!ok) return;
  S.status = "draft"; so.signedAt = null; so.declared = false; so.version = null; so.sha256 = ""; so.sealedAt = null;
  log(v ? `Reopened for editing. Version ${v} stays sealed; signing again creates version ${v + 1}` : "Sign-off removed to edit the record");
  dirty = true; save(); renderRecord();
}
async function renderVersions() {
  const id = S.id;
  const { data, error } = await supabase.from("record_versions").select("id, version, sha256, signed_at").eq("record_id", id).order("version", { ascending: false });
  const el = $("#versions"); if (!el || S.id !== id) return;
  if (error) { el.innerHTML = `<p class="note">Couldn't load sealed versions.</p>`; return; }
  el.innerHTML = data.length ? `<ul class="versions">${data.map((v) => `<li>
      <div><b>Version ${v.version}</b>${locked() && v.version === S.signoff.version ? ` <span class="status signed">Current</span>` : ""}
        <div class="note">Sealed ${esc(fmtTime(v.signed_at))}</div><code class="fp" title="SHA-256 fingerprint: ${esc(v.sha256)}">${esc(v.sha256.slice(0, 16))}…</code></div>
      <div class="v-dl"><button class="btn btn-xs" data-vexport="pdf" data-vid="${esc(v.id)}" aria-label="Download version ${v.version} as PDF">PDF</button><button class="btn btn-xs" data-vexport="docx" data-vid="${esc(v.id)}" aria-label="Download version ${v.version} as Word">Word</button></div>
    </li>`).join("")}</ul>` : `<p class="note">Nothing sealed yet. Signing off seals a read-only copy of the record as version 1.</p>`;
  el.querySelectorAll("[data-vexport]").forEach((b) => b.addEventListener("click", () => exportRecord(b.dataset.vexport, b.dataset.vid, b)));
}

/* ---------------- Activity tab ---------------- */
function renderActivity() {
  $("#recActions").innerHTML = "";
  $("#tabBody").innerHTML = `<div class="card" style="padding:22px;max-width:820px"><h3 class="sub">Record history</h3>
  <ul class="audit">${S.audit.slice().reverse().map((a) => `<li><time datetime="${esc(a.at)}">${esc(fmtTime(a.at))}</time><span>${esc(a.text)}</span></li>`).join("") || `<li><span class="note">Nothing yet. Drafting, edits, resolved items and sign-off will appear here.</span></li>`}</ul></div>`;
}

/* ---------------- Export ---------------- */
// Flattens a record (the live draft, or a sealed snapshot) into display-ready text.
function docModel(r, seal) {
  const m = r.meta, so = r.signoff, signed = r.status === "signed";
  return {
    practice: (m.practice ?? profile.practice_name ?? "").trim(),
    client: m.client || "Client",
    meta: [["Client", m.client || "—"], ["Reference", m.ref || "—"], ["Advisor", m.adviser || "—"], ["FSP number", m.fsp || "—"], ["Meeting date", fmtDate(m.date)], ["Advice area", m.area || "—"]],
    summary: r.summary || "",
    sections: SECTIONS.map(([id, title], i) => {
      const text = (r.sections?.[id]?.content || "").trim(), na = id === "replacement" && !r.replacement?.is_replacement && !text;
      return { n: i + 1, title, text, note: na ? "Not applicable: no existing product is being replaced." : "Not recorded." };
    }),
    signed, signedBy: so.signedBy || "", signedAt: so.signedAt ? fmtTime(so.signedAt) : "", outcome: so.outcome || "", override: (r.gaps || []).some((g) => g.state === "open" && g.severity === "critical") ? (so.override || "").trim() : "",
    gaps: (r.gaps || []).map((g) => ({ section: SEC_TITLE[g.section_id] || "", severity: SEV_LABEL[g.severity] || "", issue: g.issue, open: g.state === "open", resolution: g.state === "open" ? "Open" : (g.state === "addressed" ? "Addressed: " : "Not applicable: ") + g.note })),
    audit: (r.audit || []).map((a) => [fmtTime(a.at), a.text]),
    seal: seal ? { version: seal.version, sha256: seal.sha256, sealedAt: fmtTime(seal.sealedAt) } : null,
    statusLabel: seal ? `SIGNED · VERSION ${seal.version}` : (signed ? "SIGNED" : "DRAFT"),
  };
}
function exportMd(d) {
  let md = `# Record of Advice\n\n${d.practice ? `**Practice:** ${d.practice}  \n` : ""}` + d.meta.map(([k, v]) => `**${k}:** ${v}`).join("  \n") + "\n\n";
  if (d.summary) md += `_${d.summary}_\n\n`;
  d.sections.forEach((s) => { md += `## ${s.n}. ${s.title}\n\n${s.text || `_${s.note}_`}\n\n`; });
  md += `## Advisor declaration\n\n${d.signed ? `Signed off by ${d.signedBy} on ${d.signedAt}. Client's decision: ${d.outcome}.${d.override ? ` Signed with critical items open. Reason: ${d.override}` : ""}` : "**Draft: not yet signed off.**"}\n\n## Compliance review items\n\n`;
  md += d.gaps.length ? d.gaps.map((g) => `- **${g.severity}** (${g.section}): ${g.issue} — ${g.resolution}`).join("\n") : "No items were flagged.";
  md += `\n\n## Record history\n\n` + d.audit.map(([t, x]) => `- ${t}: ${x}`).join("\n") + "\n";
  if (d.seal) md += `\n## Record integrity\n\nGenerated from version ${d.seal.version}, sealed on ${d.seal.sealedAt}. SHA-256 fingerprint: \`${d.seal.sha256}\`\n`;
  return md;
}
const EXPORT_LABEL = { pdf: "PDF", docx: "Word (.docx)", md: "text (.md)" };
// versionId: export that sealed version. Otherwise a signed record exports its current
// sealed version (never the editable row), and a draft exports as a draft.
async function exportRecord(kind, versionId, btn) {
  let r = S, seal = null;
  const which = versionId ? ["id", versionId] : (locked() && S.signoff.version ? ["version", S.signoff.version] : null);
  const label = btn?.textContent; if (btn) { btn.disabled = true; btn.textContent = "Preparing…"; }
  try {
    if (which) {
      const { data, error } = await supabase.from("record_versions").select("version, sha256, signed_at, snapshot").eq("record_id", S.id).eq(which[0], which[1]).single();
      if (error || !data) throw new Error("version");
      r = Object.assign(blank(), data.snapshot); seal = { version: data.version, sha256: data.sha256, sealedAt: data.signed_at };
    }
    const d = docModel(r, seal);
    const blob = kind === "pdf" ? await buildPdf(d) : kind === "docx" ? await buildDocx(d) : new Blob([exportMd(d)], { type: "text/markdown" });
    const base = ("ROA " + (r.meta.client || "client") + " " + (r.meta.date || today()) + (seal ? ` v${seal.version}` : " draft")).replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-");
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${base}.${kind}`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    log(`Exported ${seal ? `version ${seal.version}` : "draft"} as ${EXPORT_LABEL[kind]}`); dirty = true; scheduleSave(); toast("Download started");
  } catch (e) {
    console.error(e); toast(which ? "Couldn't load the sealed version. Try again." : "Couldn't create the file. Check your connection and try again.");
  } finally { if (btn) { btn.disabled = false; btn.textContent = label; } }
}

/* ---------------- Sidebar & search ---------------- */
function closeSide() { $("#side").classList.remove("open"); $("#menuBtn").setAttribute("aria-expanded", "false"); }
$("#menuBtn").addEventListener("click", () => { const o = $("#side").classList.toggle("open"); $("#menuBtn").setAttribute("aria-expanded", String(o)); });
$("#newRec").addEventListener("click", newRecord);
$("#navRecords").addEventListener("click", () => go("list"));
document.querySelectorAll("[data-nav]").forEach((b) => b.addEventListener("click", () => go(b.dataset.nav)));
// Account menu (bottom of the sidebar): opens upwards; Esc or clicking elsewhere closes it.
function setAcctMenu(open) { $("#acctMenu").hidden = !open; $("#acctBtn").setAttribute("aria-expanded", String(open)); }
function renderAcctBtn() {
  const email = session?.user.email || "", name = (profile.full_name || "").trim();
  const initials = (name ? name.split(/\s+/).slice(0, 2).map((w) => w[0]).join("") : email[0] || "?").toUpperCase();
  $("#acctAv").textContent = initials;
  $("#acctName").textContent = name || email;
  $("#acctSub").textContent = name ? (profile.practice_name || email) : "Add your name in Account settings";
  $("#acctEmail").textContent = email;
}
$("#acctBtn").addEventListener("click", (e) => { e.stopPropagation(); setAcctMenu($("#acctMenu").hidden); });
document.addEventListener("click", (e) => { if (!e.target.closest("#acct")) setAcctMenu(false); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#acctMenu").hidden) { setAcctMenu(false); $("#acctBtn").focus(); } });
$("#navAccount").addEventListener("click", () => { setAcctMenu(false); openSettings(); });
$("#searchBox").addEventListener("input", async (e) => { query = e.target.value; if (view !== "list") { if (!(await go("list"))) return; } else renderApp(); });
$("#signOut").addEventListener("click", async () => { if (dirty) await save(); await supabase.auth.signOut(); });
window.addEventListener("beforeunload", (e) => { if (dirty) save(); if (dirty || isRecording() || leaveGuard?.()) e.preventDefault(); });

/* ---------------- Auth ---------------- */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function showAuth() {
  $("#boot").hidden = true; $("#app").hidden = true; $("#auth").hidden = false;
  document.title = "Sign in · Quilla";
  renderAuth();
}
function setAuthMode(mode) { authMode = mode; renderAuth(); }
function renderAuth() {
  const card = $("#authCard");

  if (authMode === "reset") {
    card.innerHTML = `
      <h1>Set a new password</h1>
      <p class="note" style="font-size:14.5px">Choose a new password for your account.</p>
      <form id="authForm" novalidate>
        <label class="f" for="a_pw1">New password<input type="password" id="a_pw1" autocomplete="new-password" required minlength="8"></label>
        <label class="f" for="a_pw2" style="margin-top:12px">Confirm new password<input type="password" id="a_pw2" autocomplete="new-password" required minlength="8"></label>
        <button class="btn btn-primary" id="authBtn" type="submit" style="width:100%;margin-top:14px">Set password</button>
      </form>
      <div id="authMsg" aria-live="polite"></div>`;
    $("#authForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const p1 = $("#a_pw1").value, p2 = $("#a_pw2").value, msg = $("#authMsg"), btn = $("#authBtn");
      if (p1.length < 8) { msg.innerHTML = `<div class="err">Password must be at least 8 characters.</div>`; return; }
      if (p1 !== p2) { msg.innerHTML = `<div class="err">Passwords don't match.</div>`; return; }
      btn.disabled = true; btn.textContent = "Saving…";
      const { error } = await supabase.auth.updateUser({ password: p1 });
      btn.disabled = false; btn.textContent = "Set password";
      if (error) { msg.innerHTML = `<div class="err">Couldn't update your password. Try again.</div>`; return; }
      toast("Password updated"); startApp();
    });
    return;
  }

  if (authMode === "signup") {
    card.innerHTML = `
      <h1>Create your account</h1>
      <p class="note" style="font-size:14.5px">Set up sign-in for your practice.</p>
      <form id="authForm" novalidate>
        <label class="f" for="a_email">Email address<input type="email" id="a_email" autocomplete="email" required placeholder="you@yourpractice.co.za"></label>
        <label class="f" for="a_pw1" style="margin-top:12px">Password<input type="password" id="a_pw1" autocomplete="new-password" required minlength="8"></label>
        <label class="f" for="a_pw2" style="margin-top:12px">Confirm password<input type="password" id="a_pw2" autocomplete="new-password" required minlength="8"></label>
        <button class="btn btn-primary" id="authBtn" type="submit" style="width:100%;margin-top:14px">Create account</button>
      </form>
      <div id="authMsg" aria-live="polite"></div>
      <p class="note" style="margin-top:16px;text-align:center">Already have an account? <button class="linkbtn" id="toSignin" type="button">Sign in</button></p>`;
    $("#toSignin").addEventListener("click", () => setAuthMode("signin"));
    $("#authForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = $("#a_email").value.trim(), p1 = $("#a_pw1").value, p2 = $("#a_pw2").value, msg = $("#authMsg"), btn = $("#authBtn");
      if (!EMAIL_RE.test(email)) { msg.innerHTML = `<div class="err">Enter a valid email address.</div>`; return; }
      if (p1.length < 8) { msg.innerHTML = `<div class="err">Password must be at least 8 characters.</div>`; return; }
      if (p1 !== p2) { msg.innerHTML = `<div class="err">Passwords don't match.</div>`; return; }
      btn.disabled = true; btn.textContent = "Creating…";
      const { data, error } = await supabase.auth.signUp({ email, password: p1, options: { emailRedirectTo: location.origin + "/" + location.search } });
      btn.disabled = false; btn.textContent = "Create account";
      if (error) { msg.innerHTML = `<div class="err">${error.message.includes("registered") ? "That email is already registered. Try signing in instead." : "Couldn't create the account. Try again."}</div>`; return; }
      if (!data.session) msg.innerHTML = `<div class="auth-ok">Check your inbox. We've sent a confirmation link to <b>${esc(email)}</b>.</div>`;
    });
    return;
  }

  if (authMode === "forgot") {
    card.innerHTML = `
      <h1>Reset your password</h1>
      <p class="note" style="font-size:14.5px">Enter your email and we'll send you a password reset link.</p>
      <form id="authForm" novalidate>
        <label class="f" for="a_email">Email address<input type="email" id="a_email" autocomplete="email" required placeholder="you@yourpractice.co.za"></label>
        <button class="btn btn-primary" id="authBtn" type="submit" style="width:100%;margin-top:14px">Send reset link</button>
      </form>
      <div id="authMsg" aria-live="polite"></div>
      <p class="note" style="margin-top:16px;text-align:center"><button class="linkbtn" id="toSignin" type="button">Back to sign in</button></p>`;
    $("#toSignin").addEventListener("click", () => setAuthMode("signin"));
    $("#authForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = $("#a_email").value.trim(), msg = $("#authMsg"), btn = $("#authBtn");
      if (!EMAIL_RE.test(email)) { msg.innerHTML = `<div class="err">Enter a valid email address.</div>`; return; }
      btn.disabled = true; btn.textContent = "Sending…";
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: location.origin + "/" + location.search });
      btn.disabled = false; btn.textContent = "Send reset link";
      msg.innerHTML = error ? `<div class="err">We couldn't send the link. Check the address and try again.</div>` : `<div class="auth-ok">Check your inbox for a link to reset your password for <b>${esc(email)}</b>.</div>`;
    });
    return;
  }

  // default: signin
  card.innerHTML = `
    <h1>Sign in to Quilla</h1>
    <p class="note" style="font-size:14.5px">Enter your email and password.</p>
    <form id="authForm" novalidate>
      <label class="f" for="a_email">Email address<input type="email" id="a_email" autocomplete="email" required placeholder="you@yourpractice.co.za"></label>
      <label class="f" for="a_pw1" style="margin-top:12px">Password<input type="password" id="a_pw1" autocomplete="current-password" required></label>
      <button class="btn btn-primary" id="authBtn" type="submit" style="width:100%;margin-top:14px">Sign in</button>
    </form>
    <div id="authMsg" aria-live="polite"></div>
    <div class="auth-links">
      <button class="linkbtn" id="toForgot" type="button">Forgot password?</button>
    </div>
    <p class="note" style="margin-top:16px;text-align:center">New to Quilla? <button class="linkbtn" id="toSignup" type="button">Create an account</button></p>`;
  $("#toForgot").addEventListener("click", () => setAuthMode("forgot"));
  $("#toSignup").addEventListener("click", () => setAuthMode("signup"));
  $("#authForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("#a_email").value.trim(), pw = $("#a_pw1").value, msg = $("#authMsg"), btn = $("#authBtn");
    if (!EMAIL_RE.test(email)) { msg.innerHTML = `<div class="err">Enter a valid email address.</div>`; return; }
    btn.disabled = true; btn.textContent = "Signing in…";
    const { error } = await supabase.auth.signInWithPassword({ email, password: pw });
    btn.disabled = false; btn.textContent = "Sign in";
    if (error) msg.innerHTML = `<div class="err">Incorrect email or password.</div>`;
  });
}
// A same-origin-only session isn't visible to the landing site on quilla.co.za, so on
// sign-in/out we also set a cookie carrying just the email (no token) shared across the
// .quilla.co.za domain, purely so the landing nav can show an account menu instead of
// "Log in / Get started". This is a UX nicety, not a security boundary: real auth is the
// Supabase JWT + RLS, and the landing site's "Account settings"/"Sign out" links just
// navigate here with a query param rather than acting on the session themselves.
function cookieDomain() { return location.hostname.endsWith("quilla.co.za") ? "; domain=.quilla.co.za" : ""; }
function setSignedInCookie() { document.cookie = "quilla_signed_in=" + encodeURIComponent(session.user.email || "1") + "; path=/; max-age=" + 60 * 60 * 24 * 180 + cookieDomain() + "; samesite=lax" + (location.protocol === "https:" ? "; secure" : ""); }
function clearSignedInCookie() { document.cookie = "quilla_signed_in=; path=/; max-age=0" + cookieDomain() + "; samesite=lax" + (location.protocol === "https:" ? "; secure" : ""); }
async function startApp() {
  setSignedInCookie();
  $("#boot").hidden = true; $("#auth").hidden = true; $("#app").hidden = false;
  document.title = "Quilla · Advice records";
  renderAcctBtn();
  await loadProfile(); renderAcctBtn();
  await loadClients();
  await loadRecords();
  const params = new URLSearchParams(location.search);
  if (params.get("view") === "account") {
    history.replaceState(null, "", "/");
    view = "list"; renderApp(); openSettings();
    return;
  }
  if (params.get("example") === "1") {
    history.replaceState(null, "", "/");
    S = blank(); view = "record"; loadExample();
  } else {
    view = "list"; renderApp();
  }
}
supabase.auth.onAuthStateChange((event, s) => {
  if (event === "PASSWORD_RECOVERY") {
    session = s; authMode = "reset";
    $("#boot").hidden = true; $("#app").hidden = true; $("#auth").hidden = false;
    document.title = "Set password · Quilla"; renderAuth();
    return;
  }
  const had = !!session; session = s;
  if (s && !had) startApp();
  if (!s) { S = blank(); records = []; authMode = "signin"; clearSignedInCookie(); showAuth(); }
});
