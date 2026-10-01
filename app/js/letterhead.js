// Letterhead: the advisor's logo, practice details, footer line and accent colour, used at the
// top and bottom of PDF and Word exports. Stored on the profile as `letterhead` (jsonb, capped
// at 400 KB by the database). Presentation only: it never goes to the AI and isn't part of a
// sealed version's fingerprint, so changing it restyles old exports without altering records.

export const LH_FIELDS = ["address", "phone", "email", "website", "reg_no", "footer"];
const MAX = { address: 300, phone: 40, email: 120, website: 120, reg_no: 80, footer: 300 };
const LOGO_MAX_W = 900, LOGO_MAX_H = 300, LOGO_MAX_CHARS = 300000;
export const DEFAULT_ACCENT = "#1D4B48";

// Only known fields, trimmed and capped; a logo must be a PNG or JPEG data URL.
export function cleanLetterhead(lh) {
  const out = {};
  if (!lh || typeof lh !== "object") return out;
  for (const k of LH_FIELDS) if (typeof lh[k] === "string" && lh[k].trim()) out[k] = lh[k].trim().slice(0, MAX[k]);
  if (typeof lh.accent === "string" && /^#[0-9a-f]{6}$/i.test(lh.accent)) out.accent = lh.accent;
  if (typeof lh.logo === "string" && /^data:image\/(png|jpeg);base64,/.test(lh.logo) && lh.logo.length <= LOGO_MAX_CHARS && lh.logo_w > 0 && lh.logo_h > 0) {
    Object.assign(out, { logo: lh.logo, logo_w: Math.round(lh.logo_w), logo_h: Math.round(lh.logo_h) });
  }
  return out;
}
export const hasLetterhead = (lh) => !!(lh && (lh.logo || LH_FIELDS.some((k) => lh[k])));

// Any image the browser can open (PNG, JPEG, WebP, SVG) → a resized PNG, or a JPEG on white if
// the PNG is too large. Returns {logo, logo_w, logo_h} or throws with a user-facing message.
export async function processLogo(file) {
  if (!/^image\/(png|jpeg|webp|svg\+xml)$/.test(file.type)) throw new Error("Use a PNG, JPG, WebP or SVG image.");
  if (file.size > 5 * 1024 * 1024) throw new Error("That image is over 5 MB. Use a smaller file.");
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = () => reject(new Error("Couldn't open that image.")); i.src = url; });
    let w = img.naturalWidth || 600, h = img.naturalHeight || 200;
    const scale = Math.min(1, LOGO_MAX_W / w, LOGO_MAX_H / h); w = Math.max(1, Math.round(w * scale)); h = Math.max(1, Math.round(h * scale));
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const g = c.getContext("2d"); g.drawImage(img, 0, 0, w, h);
    let logo = c.toDataURL("image/png");
    if (logo.length > LOGO_MAX_CHARS) {
      const j = document.createElement("canvas"); j.width = w; j.height = h;
      const jg = j.getContext("2d"); jg.fillStyle = "#fff"; jg.fillRect(0, 0, w, h); jg.drawImage(img, 0, 0, w, h);
      logo = j.toDataURL("image/jpeg", 0.85);
    }
    if (logo.length > LOGO_MAX_CHARS) throw new Error("That image is too detailed to use as a logo. Try a simpler or smaller version.");
    return { logo, logo_w: w, logo_h: h };
  } finally { URL.revokeObjectURL(url); }
}

// Settings → Letterhead. deps: {profile, saveProfile, toast, esc, samplePdf}
export function renderLetterheadPane(pane, deps) {
  const { esc } = deps;
  let lh = { ...cleanLetterhead(deps.profile.letterhead) };
  const practice = () => (deps.profile.practice_name || "").trim();
  pane.innerHTML = `<h3>Letterhead</h3><p class="note st-sub">Your logo and practice details at the top of every PDF and Word export, and a footer line on every page.</p>
    <div class="lh-preview" id="lhPreview" aria-label="Preview"></div>
    <div class="st-block">
      <h4>Logo</h4>
      <div class="lh-logo-row">
        <label class="btn btn-sm"><input type="file" id="lhLogo" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden><span id="lhLogoLbl"></span></label>
        <button type="button" class="linkbtn" id="lhLogoDel">Remove logo</button>
      </div>
      <p class="note" style="margin:8px 0 0">PNG, JPG, WebP or SVG. A wide logo on a transparent or white background works best.</p>
      <div id="lhLogoMsg" aria-live="polite"></div>
    </div>
    <div class="form-grid" style="margin-top:14px">
      <label class="f span2"><span>Practice name <span class="opt">(from your profile)</span></span><input type="text" id="lh_practice" value="${esc(practice())}"></label>
      <label class="f span2"><span>Address <span class="opt">(optional)</span></span><textarea id="lh_address" rows="2" maxlength="${MAX.address}" placeholder="e.g. 12 Oak Avenue, Rosebank, Johannesburg, 2196">${esc(lh.address || "")}</textarea></label>
      <label class="f"><span>Phone <span class="opt">(optional)</span></span><input type="tel" id="lh_phone" maxlength="${MAX.phone}" value="${esc(lh.phone || "")}"></label>
      <label class="f"><span>Email <span class="opt">(optional)</span></span><input type="email" id="lh_email" maxlength="${MAX.email}" value="${esc(lh.email || "")}"></label>
      <label class="f"><span>Website <span class="opt">(optional)</span></span><input type="text" id="lh_website" maxlength="${MAX.website}" value="${esc(lh.website || "")}" placeholder="e.g. www.yourpractice.co.za"></label>
      <label class="f"><span>Company registration <span class="opt">(optional)</span></span><input type="text" id="lh_reg_no" maxlength="${MAX.reg_no}" value="${esc(lh.reg_no || "")}" placeholder="e.g. Reg. 2015/123456/07"></label>
      <label class="f span2"><span>Footer line <span class="opt">(optional, on every page)</span></span><input type="text" id="lh_footer" maxlength="${MAX.footer}" value="${esc(lh.footer || "")}" placeholder="e.g. An authorised financial services provider, FSP 12345"></label>
      <label class="f"><span>Accent colour</span><span class="lh-colour"><input type="color" id="lh_accent" value="${esc(lh.accent || DEFAULT_ACCENT)}" data-native><button type="button" class="linkbtn" id="lhAccentReset">Reset</button></span></label>
    </div>
    <div class="cap-foot"><button type="button" class="btn btn-sm" id="lhSample">Download a sample PDF</button><button class="btn btn-primary btn-sm" id="lhSave">Save letterhead</button></div>`;
  const $ = (s) => pane.querySelector(s);
  const read = () => {
    const next = { ...lh };
    for (const k of LH_FIELDS) next[k] = $("#lh_" + k).value;
    next.accent = $("#lh_accent").value.toLowerCase() === DEFAULT_ACCENT.toLowerCase() ? "" : $("#lh_accent").value;
    return cleanLetterhead(next);
  };
  const preview = () => {
    const v = read(), accent = v.accent || DEFAULT_ACCENT, name = $("#lh_practice").value.trim();
    const contact = [v.phone, v.email, v.website].filter(Boolean).join("  ·  ");
    $("#lhPreview").innerHTML = `<div class="lh-page">
        <div class="lh-top">
          <div class="lh-mark">${v.logo ? `<img src="${esc(v.logo)}" alt="">` : name ? `<b style="color:${esc(accent)}">${esc(name)}</b>` : `<span class="note">Your logo</span>`}</div>
          <div class="lh-det">${v.logo && name ? `<b>${esc(name)}</b>` : ""}${v.address ? `<span>${esc(v.address)}</span>` : ""}${contact ? `<span>${esc(contact)}</span>` : ""}${v.reg_no ? `<span>${esc(v.reg_no)}</span>` : ""}</div>
        </div>
        <div class="lh-rule" style="background:${esc(accent)}"></div>
        <div class="lh-title">Record of Advice</div>
        <div class="lh-h" style="color:${esc(accent)}">1. Client details and circumstances</div><i></i><i class="s"></i>
        <div class="lh-foot">${v.footer ? esc(v.footer) : "&nbsp;"}</div>
      </div>`;
    $("#lhLogoLbl").textContent = v.logo ? "Replace logo" : "Upload logo";
    $("#lhLogoDel").hidden = !v.logo;
  };
  pane.querySelectorAll("input:not([type=file]), textarea").forEach((el) => el.addEventListener("input", preview));
  $("#lhAccentReset").addEventListener("click", () => { $("#lh_accent").value = DEFAULT_ACCENT; preview(); });
  $("#lhLogo").addEventListener("change", async (e) => {
    const f = e.target.files[0]; e.target.value = ""; if (!f) return;
    const msg = $("#lhLogoMsg"); msg.innerHTML = "";
    try { Object.assign(lh, await processLogo(f)); preview(); }
    catch (err) { msg.innerHTML = `<div class="err" style="margin-top:8px">${esc(err.message || "Couldn't use that image.")}</div>`; }
  });
  $("#lhLogoDel").addEventListener("click", () => { delete lh.logo; delete lh.logo_w; delete lh.logo_h; preview(); });
  $("#lhSample").addEventListener("click", async (e) => {
    const b = e.currentTarget; b.disabled = true; b.dataset.busy = ""; b.textContent = "Preparing…";
    try { await deps.samplePdf({ ...read() }, $("#lh_practice").value.trim()); } catch { deps.toast("Couldn't create the sample. Check your connection and try again."); }
    b.disabled = false; delete b.dataset.busy; b.textContent = "Download a sample PDF";
  });
  $("#lhSave").addEventListener("click", async (e) => {
    const b = e.currentTarget; b.disabled = true; b.dataset.busy = ""; b.textContent = "Saving…";
    const next = read(), ok = await deps.saveProfile({ letterhead: next, practice_name: $("#lh_practice").value.trim() });
    b.disabled = false; delete b.dataset.busy; b.textContent = "Save letterhead";
    if (ok) { lh = { ...next }; deps.toast("Letterhead saved. It's used on your next export."); }
  });
  preview();
}
