// Templates: per-section guidance for the AI and standard wording, saved on the advisor's
// profile as {section_id: {guidance, standard}}. The 13 FAIS sections themselves are fixed.
// guidance: read server-side by the `ai` function when drafting and improving (never a source of facts).
// standard: appended by the app to that section after each draft, visibly marked.

const MAX = { guidance: 500, standard: 2000 };
const EXAMPLES = {
  risk_profile: ["e.g. Always say which risk questionnaire was used and the date it was completed.", ""],
  fees: ["e.g. List each fee on its own line with the rate and whether it's once-off or ongoing.", "e.g. All fees were disclosed to the client in writing before the client agreed to proceed."],
  conflicts: ["", "e.g. I am paid through the advice fees agreed with the client and, where applicable, product commission. I have disclosed any financial interest in the products recommended."],
};

export function renderTemplates(ctx) {
  const { $, esc } = ctx;
  const t = ctx.profile.template || {};
  const filled = Object.values(t).filter((e) => e?.guidance || e?.standard).length;
  $("#content").innerHTML = `
    <div class="list-head"><div><h1>Templates</h1><div class="rec-sub">${filled ? `${filled} of 13 sections customised` : "Make every draft sound like your practice"}</div></div>
      <button class="btn btn-primary btn-sm" id="tplSave">Save templates</button></div>
    <div class="card tpl-intro">
      <p><b>Guidance</b> tells Quilla how you like a section written or what to look for in your notes. It's never treated as a fact about the client.</p>
      <p><b>Standard wording</b> is text you use in every record, such as your fee or remuneration disclosure. It's added to the end of that section after drafting, so you can see and edit it before signing.</p>
    </div>
    <div class="tpl-list">
      ${ctx.SECTIONS.map(([id, title, hint], i) => {
        const e = t[id] || {}, ex = EXAMPLES[id] || ["", ""];
        return `<section class="card tpl" id="tpl-${id}">
          <div class="tpl-h"><span class="num">${i + 1}</span><div><h3>${esc(title)}</h3><p class="note">${esc(hint)}</p></div></div>
          <div class="tpl-grid">
            <label class="f">Guidance for the AI <span class="hint">Optional. Up to ${MAX.guidance} characters.</span>
              <textarea data-tpl="${id}" data-k="guidance" rows="3" maxlength="${MAX.guidance}" placeholder="${esc(ex[0] || "e.g. Keep it to two or three sentences.")}">${esc(e.guidance || "")}</textarea></label>
            <label class="f">Standard wording <span class="hint">Optional. Added to every draft.</span>
              <textarea data-tpl="${id}" data-k="standard" rows="3" maxlength="${MAX.standard}" placeholder="${esc(ex[1] || "Text you include in this section of every record")}">${esc(e.standard || "")}</textarea></label>
          </div>
        </section>`;
      }).join("")}
    </div>
    <div class="cap-foot" style="margin-top:6px"><button class="btn btn-primary" id="tplSave2">Save templates</button></div>`;
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
