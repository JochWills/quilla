// Compliance: one screen across all of the advisor's records. What still needs work before
// sign-off, what was signed with critical items open, which signed records were never
// sealed, and how long signed records must be kept.

import { IC, initials, pageHead, tabsBar, bindTabs, searchBox } from "./ui.js";

const STALE_DAYS = 14;
const KEEP_YEARS = 5; // FAIS: keep records of advice for at least five years

// Draws at once from the last visit's data, then refreshes in the background and repaints only
// if something changed.
let cache = null, shown = "", cTab = "attention", cQuery = "";
export async function renderCompliance(ctx) {
  const seq = ctx.seq();
  shown = "";
  if (cache) paint(ctx, cache.recs, cache.vers);
  else ctx.$("#content").innerHTML = pageHead("Compliance", "Loading…");
  const [{ data: recs, error }, { data: vers }] = await Promise.all([
    ctx.supabase.from("records").select("id, client_name, advice_area, meeting_date, status, updated_at, archived_at, gaps:data->gaps, signoff:data->signoff").order("updated_at", { ascending: false }).limit(1000),
    ctx.supabase.from("record_versions").select("record_id, version, signed_at").order("version", { ascending: false }),
  ]);
  if (ctx.seq() !== seq) return; // moved on meanwhile
  if (error) { if (!cache) ctx.$("#content").innerHTML = `${pageHead("Compliance", "")}<div class="err">Couldn't load your records. Refresh to try again.</div>`; return; }
  cache = { recs, vers };
  paint(ctx, recs, vers);
}

// Work out everything the screen shows from the records and sealed versions.
function model(ctx, recs, vers) {
  const latest = {}; (vers || []).forEach((v) => { if (!latest[v.record_id]) latest[v.record_id] = v; });
  const firstSeal = {}; (vers || []).forEach((v) => { if (!firstSeal[v.record_id] || v.signed_at < firstSeal[v.record_id]) firstSeal[v.record_id] = v.signed_at; });
  const openOf = (r, sev) => (r.gaps || []).filter((g) => g.state === "open" && (!sev || g.severity === sev)).length;
  const days = (iso) => Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  const addYears = (iso, n) => { const d = new Date(iso); d.setFullYear(d.getFullYear() + n); return d.toISOString().slice(0, 10); };
  const all = recs || [];
  const drafts = all.filter((r) => r.status !== "signed" && !r.archived_at); // archived drafts are put away on purpose
  const signed = all.filter((r) => r.status === "signed");
  const stale = drafts.filter((r) => days(r.updated_at) >= STALE_DAYS);
  const overrides = signed.filter((r) => openOf(r, "critical"));
  const unsealed = signed.filter((r) => !latest[r.id]);
  const critTotal = drafts.reduce((n, r) => n + openOf(r, "critical"), 0);
  const blocked = drafts.filter((r) => openOf(r, "critical"));
  const attention = drafts.map((r) => {
    const why = [];
    if (openOf(r, "critical")) why.push([`${openOf(r, "critical")} critical`, "bad"]);
    if (openOf(r, "important")) why.push([`${openOf(r, "important")} important`, "draft"]);
    if (days(r.updated_at) >= STALE_DAYS) why.push([`Untouched ${days(r.updated_at)} days`, "draft"]);
    if (!r.gaps) why.push(["Not drafted yet", "notes"]);
    return { r, why, score: openOf(r, "critical") * 100 + openOf(r, "important") * 10 + Math.min(days(r.updated_at), 99) / 100 };
  }).sort((a, b) => b.score - a.score);
  const retention = signed.map((r) => { const v = latest[r.id], from = firstSeal[r.id] || r.signoff?.signedAt; return { r, v, keep: from ? addYears(from, KEEP_YEARS) : "" }; });
  return { all, drafts, signed, stale, overrides, unsealed, critTotal, blocked, attention, retention };
}

function paint(ctx, recs, vers) {
  const key = JSON.stringify([recs, vers]);
  if (key === shown && ctx.$("#cpTable")) return;
  shown = key;
  const { $ } = ctx, m = model(ctx, recs, vers);
  const tile = (icon, n, label, tone, sub) => `<div class="card ctile2 ${n && tone ? tone : ""}"><span class="ct-ic" aria-hidden="true">${icon}</span><div><b>${n}</b><span>${label}</span>${sub ? `<small>${sub}</small>` : ""}</div></div>`;
  $("#content").innerHTML = `
    ${pageHead("Compliance", `What needs your attention across your ${m.all.length} record${m.all.length === 1 ? "" : "s"}, and how long to keep them.`)}
    <div class="ctiles2">
      ${tile(IC.clock, m.drafts.length, "Awaiting sign-off", "warn", m.stale.length ? `${m.stale.length} untouched for ${STALE_DAYS}+ days` : "")}
      ${tile(IC.warn, m.critTotal, "Open critical items", "bad", m.blocked.length ? `in ${m.blocked.length} draft${m.blocked.length === 1 ? "" : "s"}` : "")}
      ${tile(IC.shield, m.overrides.length, "Signed with critical items open", "warn", "each has a written reason")}
      ${tile(IC.lock, m.signed.length - m.unsealed.length, "Signed and sealed", "", m.unsealed.length ? `${m.unsealed.length} signed before sealing existed` : "")}
    </div>
    <div class="ltools">
      ${tabsBar([["attention", "Needs attention", IC.clock, m.attention.length], ["overrides", "Signed with open items", IC.warn, m.overrides.length], ["retention", "Retention", IC.lock, m.retention.length]], cTab, "Compliance views")}
      <div class="lsearch-wrap">${searchBox("cpSearch", "Search clients…", ctx.esc(cQuery))}</div>
    </div>
    <div id="cpNote"></div>
    <div class="card ltable-card" id="cpTable"></div>
    <p class="disclaimer" style="max-width:720px">This overview is a working aid based on Quilla's checks. It doesn't replace your compliance officer's review.</p>`;
  bindTabs($("#content"), (k) => { cTab = k; shown = ""; paint(ctx, recs, vers); });
  $("#cpSearch").addEventListener("input", (e) => { cQuery = e.target.value; drawTable(ctx, m); });
  drawTable(ctx, m);
}

function drawTable(ctx, m) {
  const { $, esc } = ctx, wrap = $("#cpTable"), q = cQuery.trim().toLowerCase();
  const hit = (r) => !q || `${r.client_name} ${r.advice_area}`.toLowerCase().includes(q);
  const who = (r) => `<td><div class="who"><span class="wav" aria-hidden="true">${esc(initials(r.client_name))}</span><div class="who-t"><span class="who-n">${esc(r.client_name || "Unnamed client")}</span><span class="who-none">${esc(r.advice_area || "")}</span></div></div></td>`;
  const row = (r, cells) => `<tr data-open="${esc(r.id)}" tabindex="0">${who(r)}${cells}<td class="act"><button class="who-link" data-open-btn="${esc(r.id)}" tabindex="-1">Open${IC.arrow}</button></td></tr>`;
  const date = (iso) => `<span class="icell">${IC.cal}${esc(iso ? ctx.fmtDate(iso.slice(0, 10)) : "—")}</span>`;
  let head = "", body = "", empty = "";
  $("#cpNote").innerHTML = cTab === "overrides" ? `<p class="cp-note">Your compliance officer is most likely to ask about these. Each was signed with a written reason.</p>`
    : cTab === "retention" ? `<p class="cp-note">FAIS requires records of advice to be kept for at least ${KEEP_YEARS} years. "Keep until" counts from the first sign-off; check your own retention policy for longer periods.${m.unsealed.length ? ` "Not sealed" records were signed before version sealing existed: reopen and sign them again to seal a copy.` : ""}</p>` : "";
  if (cTab === "attention") {
    const rows = m.attention.filter(({ r }) => hit(r));
    head = `<th>Client</th><th>Why</th><th class="hide-sm">Last change</th>`;
    body = rows.map(({ r, why }) => row(r, `<td><div class="whys">${why.length ? why.map(([w, t]) => `<span class="pill ${t} sm">${t === "bad" ? IC.bad : t === "draft" ? IC.pen : IC.note}${esc(w)}</span>`).join("") : `<span class="pill signed sm">${IC.check}Ready to sign</span>`}</div></td><td class="hide-sm">${date(r.updated_at)}</td>`)).join("");
    empty = q ? "No records match." : "Nothing waiting. Every record is signed off.";
  } else if (cTab === "overrides") {
    const rows = m.overrides.filter(hit);
    head = `<th>Client</th><th>Reason given</th><th class="hide-sm">Signed</th>`;
    body = rows.map((r) => row(r, `<td class="reason">${esc(r.signoff?.override || "—")}</td><td class="hide-sm">${date(r.signoff?.signedAt)}</td>`)).join("");
    empty = q ? "No records match." : "No records were signed with critical items open.";
  } else {
    const rows = m.retention.filter(({ r }) => hit(r));
    head = `<th>Client</th><th>Version</th><th class="hide-sm">Sealed</th><th>Keep until at least</th>`;
    body = rows.map(({ r, v, keep }) => row(r, `<td>${v ? `<span class="pill signed sm">${IC.check}v${v.version}</span>` : `<span class="pill draft sm">${IC.pen}Not sealed</span>`}</td><td class="hide-sm">${v ? date(v.signed_at) : "—"}</td><td>${keep ? `<span class="icell">${IC.lock}${esc(ctx.fmtDate(keep))}</span>` : "—"}</td>`)).join("");
    empty = q ? "No records match." : "No signed records yet.";
  }
  wrap.innerHTML = body ? `<table class="rtable ltable"><thead><tr>${head}<th class="act"><span class="sr-only">Open</span></th></tr></thead><tbody>${body}</tbody></table>` : `<div class="lempty">${empty}</div>`;
  wrap.querySelectorAll("tr[data-open]").forEach((tr) => {
    tr.addEventListener("click", () => ctx.openRecord(tr.dataset.open));
    tr.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target === tr) ctx.openRecord(tr.dataset.open); });
  });
}
