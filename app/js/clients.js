// Clients: a list of the advisor's clients, and a client page showing their details,
// Records of Advice and meetings. Rendered into #content with the shared ctx from app.js.
// No ID numbers are collected (POPIA minimisation).

const FIELDS = [
  ["name", "Client name", "text", "name"],
  ["reference", "Your reference", "text", "off", "e.g. CB-0921"],
  ["email", "Email", "email", "email"],
  ["phone", "Phone", "tel", "tel"],
];

function fieldsHtml(ctx, c, prefix) {
  return `<div class="meta-grid">${FIELDS.map(([k, label, type, ac, ph]) => `<label class="f"><span>${label}${k === "name" ? "" : ` <span class="opt">(optional)</span>`}</span><input type="${type}" id="${prefix}${k}" autocomplete="${ac}" ${ph ? `placeholder="${ph}"` : ""} value="${ctx.esc(c[k] || "")}"></label>`).join("")}</div>
    <label class="f" style="margin-top:14px"><span>Notes <span class="opt">(optional)</span></span><textarea id="${prefix}notes" rows="3" placeholder="Household, preferences, anything useful before your next meeting">${ctx.esc(c.notes || "")}</textarea></label>`;
}
function readFields(prefix) {
  const v = (k) => document.getElementById(prefix + k).value.trim();
  return { name: v("name"), reference: v("reference"), email: v("email"), phone: v("phone"), notes: v("notes") };
}

/* ---------------- List ---------------- */
// Screens draw at once from what's already loaded (clients load at sign-in; meetings are cached
// from the last visit), then refresh in the background and repaint only if something changed.
const MEETING_COLS = "id, title, meeting_date, kind, client_id, transcript_source, transcription_status, record_id";
let meetingsCache = null;
async function refreshMeetings(ctx) {
  const { data, error } = await ctx.supabase.from("meetings").select(MEETING_COLS).order("meeting_date", { ascending: false }).limit(2000);
  if (!error) meetingsCache = data || [];
  return meetingsCache || [];
}

export function renderClients(ctx) {
  const seq = ctx.seq();
  let shown = "";
  const paint = () => {
    const html = clientsHtml(ctx);
    if (html === shown) return;
    shown = html; ctx.$("#content").innerHTML = html; bindClients(ctx);
  };
  paint();
  Promise.all([ctx.loadClients(), refreshMeetings(ctx)]).then(() => { if (ctx.seq() === seq) paint(); });
}
function clientsHtml(ctx) {
  const { esc } = ctx;
  const meetingsBy = {}; (meetingsCache || []).forEach((m) => { if (m.client_id) meetingsBy[m.client_id] = (meetingsBy[m.client_id] || 0) + 1; });
  const recordsBy = {}; ctx.records().forEach((r) => { if (r.client_id) recordsBy[r.client_id] = (recordsBy[r.client_id] || 0) + 1; });
  const clients = ctx.clients();
  const mCount = (id) => (meetingsCache ? meetingsBy[id] || 0 : "…");
  return `
    <div class="list-head"><div><h1>Clients</h1><div class="rec-sub">${clients.length} client${clients.length === 1 ? "" : "s"}</div></div><button class="btn btn-primary btn-sm" id="addClient">New client</button></div>
    ${clients.length ? `<div class="card" style="overflow-x:auto"><table class="rtable"><thead><tr><th>Client</th><th class="hide-sm">Reference</th><th>Records</th><th class="hide-sm">Meetings</th><th class="hide-sm">Updated</th></tr></thead><tbody>
      ${clients.map((c) => `<tr data-client="${esc(c.id)}" tabindex="0"><td class="client">${esc(c.name)}</td><td class="hide-sm">${esc(c.reference || "—")}</td><td>${recordsBy[c.id] || 0}</td><td class="hide-sm">${mCount(c.id)}</td><td class="hide-sm">${esc(ctx.fmtDate(String(c.updated_at).slice(0, 10)))}</td></tr>`).join("")}
    </tbody></table></div>` : `<div class="card empty"><h2>Keep your clients in one place</h2><p>Add a client once, then start their Records of Advice and meetings from their page. Their name and reference fill in for you.</p><button class="btn btn-primary" id="addClient2">Add your first client</button></div>`}`;
}
function bindClients(ctx) {
  const { $ } = ctx;
  const openForm = () => newClientDialog(ctx);
  $("#addClient").addEventListener("click", openForm);
  $("#addClient2")?.addEventListener("click", openForm);
  $("#content").querySelectorAll("[data-client]").forEach((tr) => {
    tr.addEventListener("click", () => ctx.go("client", tr.dataset.client));
    tr.addEventListener("keydown", (e) => { if (e.key === "Enter") ctx.go("client", tr.dataset.client); });
  });
}

// New client popup (same <dialog> styling as confirmBox in app.js). Esc, Cancel or a
// click on the backdrop closes it; saving opens the new client's page.
function newClientDialog(ctx) {
  const d = document.createElement("dialog");
  d.className = "qdialog qdialog-form";
  d.setAttribute("aria-labelledby", "ncT");
  d.innerHTML = `<form class="qd-in" method="dialog" novalidate>
      <h2 id="ncT">New client</h2>
      ${fieldsHtml(ctx, {}, "nc_")}
      <div id="nc_msg" aria-live="polite"></div>
      <div class="qd-actions"><button type="button" class="btn btn-sm" data-cancel>Cancel</button><button type="submit" class="btn btn-sm btn-primary" id="nc_save">Add client</button></div>
    </form>`;
  const close = () => { d.close(); d.remove(); };
  d.addEventListener("click", (e) => { if (e.target === d || e.target.closest("[data-cancel]")) close(); });
  d.addEventListener("cancel", (e) => { e.preventDefault(); close(); });
  d.querySelector("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const row = readFields("nc_"), msg = d.querySelector("#nc_msg"), btn = d.querySelector("#nc_save");
    if (!row.name) { msg.innerHTML = `<div class="err">Add the client's name.</div>`; d.querySelector("#nc_name").focus(); return; }
    btn.disabled = true; btn.textContent = "Adding…";
    const { data, error } = await ctx.supabase.from("clients").insert(row).select().single();
    if (error) { btn.disabled = false; btn.textContent = "Add client"; msg.innerHTML = `<div class="err">Couldn't add the client. Try again.</div>`; return; }
    close(); ctx.toast("Client added"); ctx.go("client", data.id);
  });
  document.body.appendChild(d);
  d.showModal();
  d.querySelector("#nc_name").focus();
}

/* ---------------- Client page ---------------- */
export async function renderClient(ctx, id) {
  const seq = ctx.seq();
  const cached = ctx.clients().find((x) => x.id === id);
  if (cached) drawClient(ctx, id, cached, meetingsCache?.filter((m) => m.client_id === id) ?? null);
  const [{ data: c }, { data: meetings }] = await Promise.all([
    ctx.supabase.from("clients").select("*").eq("id", id).maybeSingle(),
    ctx.supabase.from("meetings").select(MEETING_COLS).eq("client_id", id).order("meeting_date", { ascending: false }),
  ]);
  if (ctx.seq() !== seq) return; // moved on meanwhile
  if (!c) { ctx.toast("Couldn't find that client."); ctx.go("clients"); return; }
  // Repaint only if the fresh data differs, and never over details the advisor is editing.
  const editing = ctx.$("#content").querySelector("[id^='cl_']:focus") || ctx.$("#content").dataset.clDirty === "1";
  const same = cached && JSON.stringify(pick(cached)) === JSON.stringify(pick(c)) && ctx.$("#content").dataset.clMeetings === JSON.stringify(meetings || []);
  if (!cached || (!same && !editing)) drawClient(ctx, id, c, meetings || []);
}
const pick = (c) => [c.name, c.reference, c.email, c.phone, c.notes];
function drawClient(ctx, id, c, meetings) {
  const { $, esc } = ctx;
  const recs = ctx.records().filter((r) => r.client_id === id);
  $("#content").innerHTML = `
    ${ctx.crumbs([["Clients", "clients"], [c.name]])}
    <div class="list-head"><div><h1>${esc(c.name)}</h1><div class="rec-sub">${esc([c.reference, c.email, c.phone].filter(Boolean).join(" · ") || "No contact details yet")}</div></div>
      <div class="rec-actions"><button class="btn btn-sm" id="cNewMeeting">New meeting</button><button class="btn btn-primary btn-sm" id="cNewRecord">New record</button></div></div>
    <div class="sign-grid">
      <div>
        <section class="card" style="padding:22px">
          <h3 class="sub">Records of Advice</h3>
          ${recs.length ? `<ul class="plain-list">${recs.map((r) => `<li><button class="row-link" data-rec="${esc(r.id)}"><span>${esc(r.advice_area || "Record of Advice")}<span class="note"> · ${esc(ctx.fmtDate(r.meeting_date))}</span></span><span class="status ${esc(r.status)}">${ctx.STATUS_LABEL[r.status] || "Draft"}</span></button></li>`).join("")}</ul>` : `<p class="note" style="margin:0">No records yet.</p>`}
        </section>
        <section class="card" style="padding:22px;margin-top:18px">
          <h3 class="sub">Meetings</h3>
          ${meetings === null ? `<p class="note" style="margin:0">Loading…</p>` : meetings.length ? `<ul class="plain-list">${meetings.map((m) => `<li><button class="row-link" data-meeting="${esc(m.id)}"><span>${esc(m.title || "Meeting")}<span class="note"> · ${esc(ctx.fmtDate(m.meeting_date))}</span></span><span class="note">${esc(transcriptLabel(m))}</span></button></li>`).join("")}</ul>` : `<p class="note" style="margin:0">No meetings yet.</p>`}
        </section>
      </div>
      <aside class="card">
        <h3 class="sub">Details</h3>
        ${fieldsHtml(ctx, c, "cl_").replace('class="meta-grid"', 'class="meta-grid one"')}
        <div class="cap-foot"><button class="btn btn-primary btn-sm" id="cl_save">Save details</button><button class="btn btn-sm btn-quiet-danger" id="cl_del">Delete client</button></div>
        <div id="cl_msg" aria-live="polite"></div>
      </aside>
    </div>`;
  $("#content").dataset.clMeetings = JSON.stringify(meetings || []);
  $("#content").dataset.clDirty = "0";
  $("#content").querySelectorAll("[id^='cl_']").forEach((el) => el.addEventListener("input", () => { $("#content").dataset.clDirty = "1"; }));
  $("#cNewRecord").addEventListener("click", () => ctx.startRecord({ client: c }));
  $("#cNewMeeting").addEventListener("click", () => ctx.go("meeting", { clientId: c.id }));
  $("#content").querySelectorAll("[data-rec]").forEach((b) => b.addEventListener("click", () => ctx.openRecord(b.dataset.rec)));
  $("#content").querySelectorAll("[data-meeting]").forEach((b) => b.addEventListener("click", () => ctx.go("meeting", b.dataset.meeting)));
  $("#cl_save").addEventListener("click", async () => {
    const row = readFields("cl_");
    if (!row.name) { $("#cl_msg").innerHTML = `<div class="err">The client needs a name.</div>`; return; }
    const { error } = await ctx.supabase.from("clients").update(row).eq("id", id);
    if (error) { $("#cl_msg").innerHTML = `<div class="err">Couldn't save. Try again.</div>`; return; }
    await ctx.loadClients(); ctx.toast("Client saved"); $("#content").dataset.clDirty = "0"; renderClient(ctx, id);
  });
  $("#cl_del").addEventListener("click", async () => {
    const ok = await ctx.confirmBox({ title: `Delete ${c.name}?`, body: "Their Records of Advice and meetings are kept, but no longer linked to a client. This can't be undone.", confirmLabel: "Delete client", danger: true });
    if (!ok) return;
    const { error } = await ctx.supabase.from("clients").delete().eq("id", id);
    if (error) { ctx.toast("Couldn't delete the client. Try again."); return; }
    ctx.records().forEach((r) => { if (r.client_id === id) r.client_id = null; });
    await ctx.loadClients(); ctx.toast("Client deleted"); ctx.go("clients");
  });
}

export function transcriptLabel(m) {
  if (m.transcription_status === "processing") return "Transcribing…";
  if (m.transcription_status === "failed") return "Transcription failed";
  if (m.transcription_status === "uploaded") return "Audio waiting";
  if (m.transcript_source) return "Transcript";
  return "Notes only";
}
