// Templates: per-section guidance for the AI and standard wording, saved on the advisor's
// profile as {section_id: {guidance, standard}}. The 13 FAIS sections themselves are fixed.
// guidance: read server-side by the `ai` function when drafting and improving (never a source of facts).
// standard: appended by the app to that section after each draft, visibly marked.

import { IC, pageHead, tabsBar, bindTabs, searchBox } from "./ui.js";

const MAX = { guidance: 500, standard: 2000 };
const EXAMPLES = {
  risk_profile: ["e.g. Always say which risk questionnaire was used and the date it was completed.", ""],
  fees: ["e.g. List each fee on its own line with the rate and whether it's once-off or ongoing.", "e.g. All fees were disclosed to the client in writing before the client agreed to proceed."],
  conflicts: ["", "e.g. I am paid through the advice fees agreed with the client and, where applicable, product commission. I have disclosed any financial interest in the products recommended."],
};

let tTab = "all", tQuery = "";
const SAVE_IC = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`;

export function renderTemplates(ctx) {
  const { $, esc } = ctx;
  const t = ctx.profile.template || {};
  const filled = Object.values(t).filter((e) => e?.guidance || e?.standard).length;
  $("#content").innerHTML = `
    ${pageHead("Templates", "Make every draft sound like your practice: guidance for the AI and standard wording, section by section.", { id: "tplSave", label: "Save templates", icon: SAVE_IC })}
    <div class="ltools">
      ${tabsBar([["all", "All sections", IC.grid, 13], ["custom", "Customised", IC.sparkle, filled], ["plain", "Not customised", IC.file, 13 - filled]], tTab, "Filter sections")}
      <div class="lsearch-wrap">${searchBox("tplSearch", "Search sections…", esc(tQuery))}</div>
    </div>
    <div class="card tpl-intro">
      <p><b>Guidance</b> tells Quilla how you like a section written or what to look for in your notes. It's never treated as a fact about the client.</p>
      <p><b>Standard wording</b> is text you use in every record, such as your fee or remuneration disclosure. It's added to the end of that section after drafting, so you can see and edit it before signing.</p>
    </div>
    <div class="tpl-list">
      ${ctx.SECTIONS.map(([id, title, hint], i) => {
        const e = t[id] || {}, ex = EXAMPLES[id] || ["", ""];
        const on = !!(e.guidance || e.standard);
        return `<section class="card tpl" id="tpl-${id}" data-title="${esc(title.toLowerCase())}">
          <div class="tpl-h"><span class="num">${i + 1}</span><div><h3>${esc(title)}</h3><p class="note">${esc(hint)}</p></div>${on ? `<span class="pill signed sm tpl-on">${IC.check}Customised</span>` : ""}</div>
          <div class="tpl-grid">
            <label class="f">Guidance for the AI <span class="hint">Optional. Up to ${MAX.guidance} characters.</span>
              <textarea data-tpl="${id}" data-k="guidance" rows="3" maxlength="${MAX.guidance}" placeholder="${esc(ex[0] || "e.g. Keep it to two or three sentences.")}">${esc(e.guidance || "")}</textarea></label>
            <label class="f">Standard wording <span class="hint">Optional. Added to every draft.</span>
              <textarea data-tpl="${id}" data-k="standard" rows="3" maxlength="${MAX.standard}" placeholder="${esc(ex[1] || "Text you include in this section of every record")}">${esc(e.standard || "")}</textarea></label>
          </div>
        </section>`;
      }).join("")}
    </div>
    <div class="lempty card" id="tplNone" hidden>No sections match.</div>
    <div class="cap-foot" style="margin-top:6px"><button class="btn btn-primary" id="tplSave2">Save templates</button></div>`;
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
  let dirty = false;
  $("#content").querySelectorAll("[data-tpl]").forEach((ta) => ta.addEventListener("input", () => { dirty = true; ctx.$("#savestate").textContent = "Unsaved"; }));
  const save = async (btn) => {
    const next = {};
    $("#content").querySelectorAll("[data-tpl]").forEach((ta) => {
      const v = ta.value.trim().slice(0, MAX[ta.dataset.k]); if (!v) return;
      (next[ta.dataset.tpl] ||= {})[ta.dataset.k] = v;
    });
    btn.disabled = true; btn.textContent = "Saving…";
    const ok = await ctx.saveProfile({ template: next });
    btn.disabled = false; btn.textContent = "Save templates";
    if (ok) { dirty = false; ctx.$("#savestate").textContent = "Saved"; ctx.toast("Templates saved. They apply to your next draft."); renderTemplates(ctx); }
  };
  $("#tplSave").addEventListener("click", (e) => save(e.currentTarget));
  $("#tplSave2").addEventListener("click", (e) => save(e.currentTarget));
  ctx.setLeaveGuard(() => dirty);
}
