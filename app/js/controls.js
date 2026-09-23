// Custom dropdowns and date pickers. Every <select> and <input type="date"> in the app is
// enhanced automatically (a MutationObserver watches for new ones). The native element stays in
// the DOM, visually hidden, and remains the source of truth: code keeps reading .value and
// listening for input/change as before. Picking a value sets the native value and dispatches
// input + change. Setting .value from code updates the custom control.
// Opt out with data-native on the element.

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MON = MONTHS.map((m) => m.slice(0, 3));
const DAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const CHEVRON = `<svg class="cc-ic" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5l3 3 3-3"/></svg>`;
const CAL = `<svg class="cc-ic cc-cal" viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>`;
const ARROW = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d === "prev" ? "M15 6l-6 6 6 6" : "M9 6l6 6-6 6"}"/></svg>`;

let uid = 0;
const nid = (p) => `${p}${++uid}`;
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parse = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ""); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
const pretty = (d) => `${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}`;
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const addMonths = (d, n) => { const t = new Date(d.getFullYear(), d.getMonth() + n, 1); t.setDate(Math.min(d.getDate(), new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate())); return t; };

/* ---------------- Shared popup plumbing ---------------- */
// Open popups form a stack so a popup can hold controls that open their own (e.g. a dropdown
// inside the records filter panel). Opening a popup closes any that aren't its ancestors.
const stack = []; // [{ pop, trigger, close }]

function makePop(cls, owner) {
  const pop = document.createElement("div");
  pop._owner = owner;
  pop.className = `cc-pop ${cls}`;
  if ("popover" in HTMLElement.prototype) pop.popover = "manual"; // top layer: sits above <dialog>s too
  document.body.appendChild(pop);
  return pop;
}
function place(pop, trigger, align = "start") {
  const r = trigger.getBoundingClientRect(), gap = 6, vw = innerWidth, vh = innerHeight;
  pop.style.minWidth = pop.classList.contains("cc-list") || pop.classList.contains("cc-match") ? `${r.width}px` : "";
  const w = pop.offsetWidth, h = pop.offsetHeight;
  const below = vh - r.bottom - gap, above = r.top - gap;
  const top = h <= below || below >= above ? r.bottom + gap : Math.max(8, r.top - gap - h);
  const left = align === "end" ? r.right - w : r.left;
  pop.style.top = `${Math.round(top)}px`;
  pop.style.left = `${Math.round(Math.max(8, Math.min(left, vw - w - 8)))}px`;
  pop.style.maxHeight = `${Math.max(160, (top > r.top ? below : above) - 8)}px`;
}
function show(pop, trigger, onClose, align) {
  while (stack.length && !stack[stack.length - 1].pop.contains(trigger)) stack[stack.length - 1].close(false);
  pop.hidden = false;
  if (pop.popover) pop.showPopover();
  place(pop, trigger, align);
  trigger.setAttribute("aria-expanded", "true");
  const reposition = (e) => { if (!(e?.target instanceof Node) || !pop.contains(e.target)) place(pop, trigger, align); }; // resize targets window
  const entry = { pop, trigger };
  const outside = (e) => {
    const i = stack.indexOf(entry);
    if (pop.contains(e.target) || trigger.contains(e.target)) return;
    if (stack.slice(i + 1).some((s) => s.pop.contains(e.target))) return; // inside a child popup
    close(false);
  };
  const close = (refocus = true) => {
    const i = stack.indexOf(entry);
    if (i < 0) return;
    while (stack.length > i + 1) stack[stack.length - 1].close(false); // children first
    stack.splice(i, 1);
    if (pop.popover) { try { pop.hidePopover(); } catch {} }
    pop.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    removeEventListener("scroll", reposition, true); removeEventListener("resize", reposition);
    document.removeEventListener("pointerdown", outside, true);
    onClose?.();
    if (refocus && trigger.isConnected) trigger.focus();
  };
  entry.close = close;
  addEventListener("scroll", reposition, true); addEventListener("resize", reposition);
  document.addEventListener("pointerdown", outside, true);
  stack.push(entry);
  return close;
}

// A one-off popup anchored to `trigger` (menus, filter panels, search results). `build(pop)`
// fills it before it's shown; it's removed from the page when closed. Esc closes it.
export function openPop(trigger, cls, build, { align = "start", onClose } = {}) {
  const pop = makePop(`cc-panel ${cls || ""}`, trigger);
  build(pop);
  const close = show(pop, trigger, () => { pop.remove(); onClose?.(); }, align);
  pop.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); close(); } });
  return { pop, close, place: () => place(pop, trigger, align) };
}

// Name the custom trigger with the field's label text (labels wrap their control; a bare text
// node before the control is wrapped in a span so it can be referenced).
function labelId(native) {
  const lab = native.closest("label") || (native.id && document.querySelector(`label[for="${CSS.escape(native.id)}"]`));
  if (!lab) return "";
  let span = [...lab.children].find((c) => c.tagName === "SPAN" && !c.classList.contains("hint"));
  if (!span) {
    const t = [...lab.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim());
    if (!t) return "";
    span = document.createElement("span"); t.replaceWith(span); span.appendChild(t);
  }
  return span.id || (span.id = nid("cl"));
}

// Keep the custom control in step when code sets .value / .selectedIndex or changes options.
function watch(native, refresh, props) {
  const proto = Object.getPrototypeOf(native);
  props.forEach((p) => {
    const d = Object.getOwnPropertyDescriptor(proto, p);
    Object.defineProperty(native, p, { configurable: true, get() { return d.get.call(this); }, set(v) { d.set.call(this, v); refresh(); } });
  });
  new MutationObserver(refresh).observe(native, { attributes: true, attributeFilter: ["disabled"], childList: true, subtree: true });
}
function commit(native, value) {
  if (native.value === value) return;
  native.value = value;
  native.dispatchEvent(new Event("input", { bubbles: true }));
  native.dispatchEvent(new Event("change", { bubbles: true }));
}
function hideNative(native, trigger) {
  native.dataset.enh = "";
  native.classList.add("cc-native");
  native.tabIndex = -1;
  native.setAttribute("aria-hidden", "true");
  native.insertAdjacentElement("afterend", trigger);
  native.addEventListener("focus", () => trigger.focus()); // clicking the label text lands here
}

/* ---------------- Dropdown ---------------- */
function enhanceSelect(native) {
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "cc-trigger cc-select";
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");
  const valId = nid("cv"), lid = labelId(native);
  trigger.innerHTML = `<span class="cc-val" id="${valId}"></span>${CHEVRON}`;
  if (lid) trigger.setAttribute("aria-labelledby", `${lid} ${valId}`);
  hideNative(native, trigger);

  const pop = makePop("cc-list", trigger);
  pop.setAttribute("role", "listbox");
  pop.tabIndex = -1;
  pop.hidden = true;
  if (lid) pop.setAttribute("aria-labelledby", lid);
  let active = -1, close = null, typed = "", typedAt = 0;

  const refresh = () => {
    const o = native.options[native.selectedIndex];
    const v = trigger.querySelector(".cc-val");
    v.textContent = o ? o.textContent : "";
    v.classList.toggle("cc-placeholder", !o || o.value === "");
    trigger.disabled = native.disabled;
  };
  const opts = () => [...native.options];
  const setActive = (i) => {
    const items = pop.querySelectorAll(".cc-opt");
    if (!items.length) return;
    active = Math.max(0, Math.min(items.length - 1, i));
    items.forEach((el, j) => el.classList.toggle("active", j === active));
    pop.setAttribute("aria-activedescendant", items[active].id);
    items[active].scrollIntoView({ block: "nearest" });
  };
  const choose = (i) => { const o = opts()[i]; if (!o || o.disabled) return; commit(native, o.value); refresh(); close?.(); };
  const openList = (at) => {
    if (native.disabled) return;
    const sel = native.selectedIndex;
    pop.innerHTML = opts().map((o, i) => `<div class="cc-opt${i === sel ? " selected" : ""}${o.value === "" ? " cc-placeholder" : ""}" role="option" id="${pop.id || (pop.id = nid("cp"))}-${i}" aria-selected="${i === sel}"${o.disabled ? ' aria-disabled="true"' : ""} data-i="${i}"><span></span><svg class="cc-check" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div>`).join("");
    pop.querySelectorAll(".cc-opt > span").forEach((s, i) => { s.textContent = opts()[i].textContent; });
    close = show(pop, trigger, () => { close = null; });
    pop.focus({ preventScroll: true });
    setActive(at ?? (sel < 0 ? 0 : sel));
  };

  trigger.addEventListener("click", () => (close ? close() : openList()));
  trigger.addEventListener("keydown", (e) => {
    if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) { e.preventDefault(); openList(); }
  });
  pop.addEventListener("pointermove", (e) => { const o = e.target.closest(".cc-opt"); if (o && +o.dataset.i !== active) setActive(+o.dataset.i); });
  pop.addEventListener("click", (e) => { const o = e.target.closest(".cc-opt"); if (o) choose(+o.dataset.i); });
  pop.addEventListener("keydown", (e) => {
    const n = native.options.length;
    if (e.key === "ArrowDown") setActive(active + 1);
    else if (e.key === "ArrowUp") setActive(active - 1);
    else if (e.key === "Home") setActive(0);
    else if (e.key === "End") setActive(n - 1);
    else if (e.key === "PageDown") setActive(active + 8);
    else if (e.key === "PageUp") setActive(active - 8);
    else if (e.key === "Enter" || e.key === " ") choose(active);
    else if (e.key === "Escape") { e.stopPropagation(); close?.(); } // don't also close a surrounding dialog
    else if (e.key === "Tab") { close?.(false); return; }
    else if (e.key.length === 1 && /\S/.test(e.key)) { // type to jump
      typed = Date.now() - typedAt > 700 ? e.key.toLowerCase() : typed + e.key.toLowerCase(); typedAt = Date.now();
      const i = opts().findIndex((o) => o.textContent.toLowerCase().startsWith(typed));
      if (i >= 0) setActive(i);
    } else return;
    e.preventDefault();
  });
  watch(native, refresh, ["value", "selectedIndex"]);
  refresh();
}

/* ---------------- Date picker ---------------- */
function enhanceDate(native) {
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "cc-trigger cc-date";
  trigger.setAttribute("aria-haspopup", "dialog");
  trigger.setAttribute("aria-expanded", "false");
  const valId = nid("cv"), lid = labelId(native);
  trigger.innerHTML = `<span class="cc-val" id="${valId}"></span>${CAL}`;
  if (lid) trigger.setAttribute("aria-labelledby", `${lid} ${valId}`);
  hideNative(native, trigger);

  const pop = makePop("cc-cal-pop", trigger);
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-label", "Choose a date");
  pop.hidden = true;
  let view = null, focus = null, close = null;

  const refresh = () => {
    const d = parse(native.value), v = trigger.querySelector(".cc-val");
    v.textContent = d ? pretty(d) : "Choose a date";
    v.classList.toggle("cc-placeholder", !d);
    trigger.disabled = native.disabled;
  };
  const draw = (moveFocus) => {
    const sel = native.value, today = iso(new Date());
    const first = new Date(view.getFullYear(), view.getMonth(), 1);
    const start = addDays(first, -((first.getDay() + 6) % 7)); // weeks start on Monday
    const cells = [];
    for (let i = 0; i < 42; i++) {
      const d = addDays(start, i), k = iso(d), out = d.getMonth() !== view.getMonth();
      cells.push(`<button type="button" class="cc-day${out ? " out" : ""}${k === today ? " today" : ""}${k === sel ? " selected" : ""}" data-d="${k}" tabindex="${k === iso(focus) ? 0 : -1}" aria-label="${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}${k === today ? ", today" : ""}" aria-pressed="${k === sel}">${d.getDate()}</button>`);
    }
    pop.innerHTML = `<div class="cc-cal-head">
        <button type="button" class="cc-nav" data-m="-1" aria-label="Previous month">${ARROW("prev")}</button>
        <div class="cc-month" aria-live="polite">${MONTHS[view.getMonth()]} ${view.getFullYear()}</div>
        <button type="button" class="cc-nav" data-m="1" aria-label="Next month">${ARROW("next")}</button>
      </div>
      <div class="cc-grid" role="group" aria-label="${MONTHS[view.getMonth()]} ${view.getFullYear()}">${DAYS.map((d) => `<span class="cc-dow" aria-hidden="true">${d}</span>`).join("")}${cells.join("")}</div>
      <div class="cc-cal-foot"><button type="button" class="cc-link" data-today>Today</button>${sel ? `<button type="button" class="cc-link muted" data-clear>Clear</button>` : ""}</div>`;
    if (moveFocus) pop.querySelector(`[data-d="${iso(focus)}"]`)?.focus();
  };
  const moveTo = (d) => { focus = d; if (d.getMonth() !== view.getMonth() || d.getFullYear() !== view.getFullYear()) view = new Date(d.getFullYear(), d.getMonth(), 1); draw(true); };
  const pick = (k) => { commit(native, k); refresh(); close?.(); };
  const openCal = () => {
    if (native.disabled) return;
    focus = parse(native.value) || new Date();
    view = new Date(focus.getFullYear(), focus.getMonth(), 1);
    draw(false);
    close = show(pop, trigger, () => { close = null; });
    pop.querySelector(`[data-d="${iso(focus)}"]`)?.focus();
  };

  trigger.addEventListener("click", () => (close ? close() : openCal()));
  trigger.addEventListener("keydown", (e) => { if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); openCal(); } });
  pop.addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.m) { // month arrows: redraw and keep focus on the same arrow
      const m = b.dataset.m;
      view = new Date(view.getFullYear(), view.getMonth() + +m, 1); focus = addMonths(focus, +m);
      draw(false); place(pop, trigger); pop.querySelector(`[data-m="${m}"]`).focus();
    }
    else if (b.dataset.d) pick(b.dataset.d);
    else if ("today" in b.dataset) pick(iso(new Date()));
    else if ("clear" in b.dataset) pick("");
  });
  pop.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); close?.(); return; }
    if (e.key === "Tab") { // keep Tab inside the calendar while it's open
      const f = [...pop.querySelectorAll('button:not([tabindex="-1"])')];
      const i = f.indexOf(document.activeElement);
      e.preventDefault(); f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus(); return;
    }
    if (!e.target.dataset.d) return;
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (step) moveTo(addDays(focus, step));
    else if (e.key === "PageUp") moveTo(addMonths(focus, e.shiftKey ? -12 : -1));
    else if (e.key === "PageDown") moveTo(addMonths(focus, e.shiftKey ? 12 : 1));
    else if (e.key === "Home") moveTo(addDays(focus, -((focus.getDay() + 6) % 7)));
    else if (e.key === "End") moveTo(addDays(focus, 6 - ((focus.getDay() + 6) % 7)));
    else return;
    e.preventDefault();
  });
  watch(native, refresh, ["value"]);
  refresh();
}

/* ---------------- Auto-enhance ---------------- */
function enhance(root) {
  if (!root.querySelectorAll) return;
  const els = root.matches?.("select, input[type=date]") ? [root] : [];
  els.push(...root.querySelectorAll("select, input[type=date]"));
  els.forEach((el) => {
    if ("enh" in el.dataset || "native" in el.dataset || (el.tagName === "SELECT" && (el.multiple || el.size > 1))) return;
    el.tagName === "SELECT" ? enhanceSelect(el) : enhanceDate(el);
  });
}
// Close an open popup whose control was re-rendered away, and drop orphaned popups.
function sweep() {
  [...stack].reverse().forEach((s) => { if (!s.trigger.isConnected) s.close(false); });
  document.querySelectorAll("body > .cc-pop").forEach((p) => { if (p._owner && !p._owner.isConnected) p.remove(); });
}

export function initControls() {
  enhance(document.body);
  new MutationObserver((muts) => {
    for (const m of muts) m.addedNodes.forEach((n) => n.nodeType === 1 && !n.classList.contains("cc-pop") && enhance(n));
    sweep();
  }).observe(document.body, { childList: true, subtree: true });
}
