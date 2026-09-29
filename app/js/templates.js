// Standard wording (route "templates", opened from the account menu): per-section fixed text
// and, under "Advanced", drafting guidance for the AI. Saved on the advisor's profile as
// {section_id: {guidance, standard}}. The 13 FAIS sections themselves are fixed.
// standard: appended by the app to that section after each draft, visibly marked. It's meant for
//   practice statements (licence, conflicts policy, complaints), never claims about a meeting.
// guidance: read server-side by the `ai` function when drafting and improving (never a source of facts).

import { IC, pageHead, tabsBar, bindTabs, setTabCounts, searchBox } from "./ui.js";

const MAX = { guidance: 500, standard: 2000 };
const EXAMPLES = {
  risk_profile: ["e.g. Always say which risk questionnaire was used and the date it was completed.", ""],
  fees: ["e.g. List each fee on its own line with the rate and whether it's once-off or ongoing.", "e.g. Fees are quoted excluding VAT unless stated otherwise."],
  risks_disclosures: ["", "e.g. Past performance is not a reliable guide to future returns. The value of investments can go down as well as up."],
  conflicts: ["", "e.g. We are an authorised financial services provider (FSP no. 12345). Our conflict of interest management policy is available on request."],
  client_decision: ["", "e.g. If you are unhappy with our advice, you may complain to us in writing or to the FAIS Ombud (www.faisombud.co.za)."],
};

let tTab = "all", tQuery = "";
const SAVE_IC = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`;

export function renderTemplates(ctx) {
  const { $, esc } = ctx;
  const t = ctx.profile.template || {};
  const filled = Object.values(t).filter((e) => e?.guidance || e?.standard).length;
  $("#content").innerHTML = `
    ${pageHead("Standard wording", "Text your practice includes in every Record of Advice, added to the matching section after each draft.", { id: "tplSave", label: "Save all", icon: SAVE_IC })}
    <div class="ltools">
      ${tabsBar([["all", "All sections", IC.grid, 13], ["custom", "Set", IC.sparkle, filled], ["plain", "Not set", IC.file, 13 - filled]], tTab, "Filter sections")}
      <div class="lsearch-wrap">${searchBox("tplSearch", "Search sections…", esc(tQuery))}</div>
    </div>
    <div class="card tpl-intro">
      <p><b>What belongs here:</b> fixed statements about your practice, such as your FSP licence details, conflict of interest policy, how you're paid, your complaints process and general risk warnings. They're added to the end of the section after drafting, so you can see and edit them before signing.</p>
      <p><b>What doesn't:</b> anything about what happened in a meeting, like "The client confirmed they understood the fees". That's added to every record whether or not it happened, so it must come from your notes instead.</p>
    </div>
    <div class="tpl-list">
      ${ctx.SECTIONS.map(([id, title, hint], i) => {
        const e = t[id] || {}, ex = EXAMPLES[id] || ["", ""];
        const on = !!(e.guidance || e.standard);
        return `<section class="card tpl" id="tpl-${id}" data-title="${esc(title.toLowerCase())}">
          <div class="tpl-h"><span class="num">${i + 1}</span><div><h3>${esc(title)}</h3><p class="note">${esc(hint)}</p></div>${on ? `<span class="pill signed sm tpl-on">${IC.check}Set</span>` : ""}</div>
          <label class="f">Standard wording <span class="hint">Optional. Added to this section of every draft.</span>
            <textarea data-tpl="${id}" data-k="standard" rows="3" maxlength="${MAX.standard}" placeholder="${esc(ex[1] || "Text your practice includes in this section of every record")}">${esc(e.standard || "")}</textarea></label>
          <details class="tpl-adv" ${e.guidance ? "open" : ""}><summary>Advanced: drafting guidance</summary>
            <label class="f">How Quilla should write this section <span class="hint">Optional. Up to ${MAX.guidance} characters. Shapes the wording only; it's never treated as a fact about the client.</span>
              <textarea data-tpl="${id}" data-k="guidance" rows="2" maxlength="${MAX.guidance}" placeholder="${esc(ex[0] || "e.g. Keep it to two or three sentences.")}">${esc(e.guidance || "")}</textarea></label>
          </details>
          <div class="tpl-foot"><span class="tpl-state" aria-live="polite"></span><span class="tpl-acts"><button type="button" class="linkbtn" data-undo="${id}" hidden>Undo changes</button><button type="button" class="btn btn-sm btn-primary" data-save="${id}" hidden>Save section</button></span></div>
        </section>`;
      }).join("")}
    </div>
    <div class="lempty card" id="tplNone" hidden>No sections match.</div>
    <div class="cap-foot" style="margin-top:6px"><button class="btn btn-primary" id="tplSave2">Save all sections</button></div>`;
  // Tabs and search only hide cards, so unsaved text in hidden sections is kept and saved.
  const filter = () => {
    const q = tQuery.trim().toLowerCase(); let shown = 0;
    $("#content").querySelectorAll(".tpl").forEach((card) => {
      const on = [...card.querySelectorAll("textarea")].some((ta) => ta.value.trim());
      const hit = (tTab === "all" || (tTab === "custom") === on) && (!q || card.dataset.title.includes(q));
      card.hidden = !hit; if (hit) shown++;
    });
    $("#tplNone").hidden = !!shown;
  };
  bindTabs($("#content"), (k) => { tTab = k; $("#content").querySelectorAll("[data-ltab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.ltab === k))); filter(); });
  $("#tplSearch").addEventListener("input", (e) => { tQuery = e.target.value; filter(); });
  filter();
  // Per-section saving: each card knows its last-saved text, shows Save / Undo once edited,
  // and saving one section merges just that entry into the stored template, leaving unsaved
  // edits in other cards alone.
  const clean = (v, k) => v.trim().slice(0, MAX[k]);
  const saved = (id) => ctx.profile.template?.[id] || {};
  const cardOf = (id) => $(`#tpl-${id}`);
  const valuesOf = (id) => { const o = {}; cardOf(id).querySelectorAll("[data-tpl]").forEach((ta) => { const v = clean(ta.value, ta.dataset.k); if (v) o[ta.dataset.k] = v; }); return o; };
  const isDirty = (id) => { const v = valuesOf(id), sv = saved(id); return (v.guidance || "") !== (sv.guidance || "") || (v.standard || "") !== (sv.standard || ""); };
  const anyDirty = () => ctx.SECTIONS.some(([id]) => isDirty(id));
  const counts = () => { const n = Object.values(ctx.profile.template || {}).filter((e) => e?.guidance || e?.standard).length; return { all: 13, custom: n, plain: 13 - n }; };
  const refreshCard = (id, justSaved = false) => {
    const card = cardOf(id), d = isDirty(id), on = !!(saved(id).guidance || saved(id).standard);
    card.classList.toggle("dirty", d);
    card.querySelector(`[data-save="${id}"]`).hidden = !d;
    card.querySelector(`[data-undo="${id}"]`).hidden = !d;
    card.querySelector(".tpl-state").innerHTML = d ? `<span class="dot"></span>Unsaved changes` : justSaved ? `${IC.check}Saved` : "";
    card.querySelector(".tpl-state").className = `tpl-state${d ? " unsaved" : justSaved ? " ok" : ""}`;
    const pill = card.querySelector(".tpl-on");
    if (on && !pill) card.querySelector(".tpl-h").insertAdjacentHTML("beforeend", `<span class="pill signed sm tpl-on">${IC.check}Set</span>`);
    if (!on && pill) pill.remove();
    ctx.$("#savestate").textContent = anyDirty() ? "Unsaved" : "";
  };
  $("#content").querySelectorAll("[data-tpl]").forEach((ta) => ta.addEventListener("input", () => refreshCard(ta.dataset.tpl)));
  $("#content").querySelectorAll("[data-undo]").forEach((b) => b.addEventListener("click", () => {
    const id = b.dataset.undo, sv = saved(id);
    cardOf(id).querySelectorAll("[data-tpl]").forEach((ta) => { ta.value = sv[ta.dataset.k] || ""; });
    refreshCard(id); cardOf(id).querySelector("textarea").focus();
  }));
  $("#content").querySelectorAll("[data-save]").forEach((b) => b.addEventListener("click", async () => {
    const id = b.dataset.save, next = { ...(ctx.profile.template || {}) }, v = valuesOf(id);
    if (v.guidance || v.standard) next[id] = v; else delete next[id];
    b.disabled = true; b.textContent = "Saving…";
    const ok = await ctx.saveProfile({ template: next });
    b.disabled = false; b.textContent = "Save section";
    if (!ok) return;
    refreshCard(id, true); setTabCounts($("#content"), counts());
    ctx.toast(`${ctx.SECTIONS.find(([k]) => k === id)[1]} saved`);
  }));
  const save = async (btn) => {
    const next = {};
    $("#content").querySelectorAll("[data-tpl]").forEach((ta) => {
      const v = clean(ta.value, ta.dataset.k); if (!v) return;
      (next[ta.dataset.tpl] ||= {})[ta.dataset.k] = v;
    });
    btn.disabled = true; btn.textContent = "Saving…";
    const ok = await ctx.saveProfile({ template: next });
    btn.disabled = false; btn.textContent = btn.id === "tplSave" ? "Save all" : "Save all sections";
    if (ok) { ctx.$("#savestate").textContent = "Saved"; ctx.toast("Standard wording saved. It applies to your next draft."); renderTemplates(ctx); }
  };
  $("#tplSave").addEventListener("click", (e) => save(e.currentTarget));
  $("#tplSave2").addEventListener("click", (e) => save(e.currentTarget));
  ctx.setLeaveGuard(anyDirty);
}
