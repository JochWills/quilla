// Compliance: one screen across all of the advisor's records. What still needs work before
// sign-off, what was signed with critical items open, which signed records were never
// sealed, and how long signed records must be kept.

const STALE_DAYS = 14;
const KEEP_YEARS = 5; // FAIS: keep records of advice for at least five years

export async function renderCompliance(ctx) {
  const { $, esc } = ctx;
  $("#content").innerHTML = `<div class="list-head"><div><h1>Compliance</h1><div class="rec-sub">Loading…</div></div></div>`;
  const [{ data: recs, error }, { data: vers }] = await Promise.all([
    ctx.supabase.from("records").select("id, client_name, advice_area, meeting_date, status, updated_at, gaps:data->gaps, signoff:data->signoff").order("updated_at", { ascending: false }).limit(1000),
    ctx.supabase.from("record_versions").select("record_id, version, signed_at").order("version", { ascending: false }),
  ]);
  if (error) { $("#content").innerHTML = `<div class="err">Couldn't load your records. Refresh to try again.</div>`; return; }

  const latest = {}; (vers || []).forEach((v) => { if (!latest[v.record_id]) latest[v.record_id] = v; });
  const firstSeal = {}; (vers || []).forEach((v) => { if (!firstSeal[v.record_id] || v.signed_at < firstSeal[v.record_id]) firstSeal[v.record_id] = v.signed_at; });
  const openOf = (r, sev) => (r.gaps || []).filter((g) => g.state === "open" && (!sev || g.severity === sev)).length;
  const days = (iso) => Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  const addYears = (iso, n) => { const d = new Date(iso); d.setFullYear(d.getFullYear() + n); return d.toISOString().slice(0, 10); };

  const drafts = (recs || []).filter((r) => r.status !== "signed");
  const signed = (recs || []).filter((r) => r.status === "signed");
  const blocked = drafts.filter((r) => openOf(r, "critical"));
  const stale = drafts.filter((r) => days(r.updated_at) >= STALE_DAYS);
  const overrides = signed.filter((r) => openOf(r, "critical"));
  const unsealed = signed.filter((r) => !latest[r.id]);
  const critTotal = drafts.reduce((n, r) => n + openOf(r, "critical"), 0);

  const attention = drafts.map((r) => {
    const why = [];
    if (openOf(r, "critical")) why.push(`${openOf(r, "critical")} critical`);
    if (openOf(r, "important")) why.push(`${openOf(r, "important")} important`);
    if (days(r.updated_at) >= STALE_DAYS) why.push(`untouched ${days(r.updated_at)} days`);
    if (!r.gaps) why.push("not drafted yet");
    return { r, why, score: openOf(r, "critical") * 100 + openOf(r, "important") * 10 + Math.min(days(r.updated_at), 99) / 100 };
  }).sort((a, b) => b.score - a.score);

  const tile = (n, label, tone, sub) => `<div class="card ctile ${n && tone ? tone : ""}"><b>${n}</b><span>${label}</span>${sub ? `<small>${sub}</small>` : ""}</div>`;
  const recRow = (r, cells) => `<tr data-open="${esc(r.id)}" tabindex="0"><td class="client">${esc(r.client_name || "Unnamed client")}</td>${cells}</tr>`;

  $("#content").innerHTML = `
    <div class="list-head"><div><h1>Compliance</h1><div class="rec-sub">Across your ${(recs || []).length} record${(recs || []).length === 1 ? "" : "s"}</div></div></div>
    <div class="ctiles">
      ${tile(drafts.length, "Awaiting sign-off", "warn", stale.length ? `${stale.length} untouched for ${STALE_DAYS}+ days` : "")}
      ${tile(critTotal, "Open critical items", "bad", blocked.length ? `in ${blocked.length} draft${blocked.length === 1 ? "" : "s"}` : "")}
      ${tile(overrides.length, "Signed with critical items open", "warn", "each has a written reason")}
      ${tile(signed.length - unsealed.length, "Signed and sealed", "", unsealed.length ? `${unsealed.length} signed before sealing existed` : "")}
    </div>

    <section class="card csec">
      <h3 class="sub">Needs attention</h3>
      ${attention.length ? `<table class="rtable"><thead><tr><th>Client</th><th class="hide-sm">Advice area</th><th>Why</th><th class="hide-sm">Last change</th></tr></thead><tbody>
        ${attention.map(({ r, why }) => recRow(r, `<td class="hide-sm">${esc(r.advice_area)}</td><td>${why.length ? why.map((w) => `<span class="why ${/critical/.test(w) ? "bad" : /important|untouched/.test(w) ? "warn" : ""}">${esc(w)}</span>`).join(" ") : `<span class="why ok">Ready to sign</span>`}</td><td class="hide-sm">${esc(ctx.fmtDate(String(r.updated_at).slice(0, 10)))}</td>`)).join("")}
      </tbody></table>` : `<p class="note" style="margin:0">Nothing waiting. Every record is signed off.</p>`}
    </section>

    ${overrides.length ? `<section class="card csec">
      <h3 class="sub">Signed with critical items open</h3>
      <p class="note" style="margin:0 0 10px">Your compliance officer is most likely to ask about these. Each was signed with a written reason.</p>
      <table class="rtable"><thead><tr><th>Client</th><th>Reason given</th><th class="hide-sm">Signed</th></tr></thead><tbody>
        ${overrides.map((r) => recRow(r, `<td>${esc(r.signoff?.override || "—")}</td><td class="hide-sm">${esc(r.signoff?.signedAt ? ctx.fmtDate(r.signoff.signedAt.slice(0, 10)) : "—")}</td>`)).join("")}
      </tbody></table></section>` : ""}

    <section class="card csec">
      <h3 class="sub">Signed records and retention</h3>
      <p class="note" style="margin:0 0 10px">FAIS requires records of advice to be kept for at least ${KEEP_YEARS} years. "Keep until" counts from the first sign-off; check your own retention policy for longer periods.</p>
      ${signed.length ? `<table class="rtable"><thead><tr><th>Client</th><th>Version</th><th class="hide-sm">Sealed</th><th>Keep until at least</th></tr></thead><tbody>
        ${signed.map((r) => { const v = latest[r.id], from = firstSeal[r.id] || r.signoff?.signedAt; return recRow(r, `<td>${v ? `v${v.version}` : `<span class="why warn">Not sealed</span>`}</td><td class="hide-sm">${v ? esc(ctx.fmtDate(v.signed_at.slice(0, 10))) : "—"}</td><td>${from ? esc(ctx.fmtDate(addYears(from, KEEP_YEARS))) : "—"}</td>`); }).join("")}
      </tbody></table>${unsealed.length ? `<p class="note" style="margin:10px 0 0">"Not sealed" records were signed before version sealing existed. Reopen and sign them again to seal a copy.</p>` : ""}` : `<p class="note" style="margin:0">No signed records yet.</p>`}
    </section>
    <p class="disclaimer" style="max-width:720px">This overview is a working aid based on Quilla's checks. It doesn't replace your compliance officer's review.</p>`;
  $("#content").querySelectorAll("[data-open]").forEach((tr) => {
    tr.addEventListener("click", () => ctx.openRecord(tr.dataset.open));
    tr.addEventListener("keydown", (e) => { if (e.key === "Enter") ctx.openRecord(tr.dataset.open); });
  });
}
