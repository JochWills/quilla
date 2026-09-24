// Shared building blocks for the list screens (Advice records, Clients, Meetings, Templates,
// Compliance) so they all share one design: page header, status tabs with counts, search box,
// sortable table headers and the ⋯ row menu. Values passed in are escaped by the caller.

import { openPop } from "./controls.js";

export const IC = {
  file: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4"/></svg>`,
  box: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="5" rx="1.5"/><path d="M5 9v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9M10 13h4"/></svg>`,
  brief: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 12h18M11 12v2h2v-2"/></svg>`,
  cal: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4M8 14h.01M12 14h.01M16 14h.01M8 17.5h.01M12 17.5h.01"/></svg>`,
  sort: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 9l4-4 4 4M8 15l4 4 4-4"/></svg>`,
  up: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 14l4-4 4 4"/></svg>`,
  down: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 10l4 4 4-4"/></svg>`,
  search: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>`,
  filter: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16l-6 7.5V19l-4 2v-8.5z"/></svg>`,
  more: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>`,
  plus: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3v10M3 8h10"/></svg>`,
  arrow: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4"/></svg>`,
  check: `<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8"/><path d="M6.5 10.2l2.4 2.4 4.6-4.8"/></svg>`,
  pen: `<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8"/><path d="M10 6v4.2l2.6 1.6"/></svg>`,
  note: `<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8"/><path d="M6.5 10h7"/></svg>`,
  user: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/></svg>`,
  users: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 4.5a3.5 3.5 0 0 1 0 7M21 20c0-2.6-1.6-4.8-4-5.6"/></svg>`,
  meet: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16"/></svg>`,
  video: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="13" height="12" rx="2"/><path d="M16 10.5l5-3v9l-5-3"/></svg>`,
  phone: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/></svg>`,
  mic: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>`,
  rec: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4M12.5 11v6M9.5 14h6"/></svg>`,
  trash: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>`,
  shield: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/></svg>`,
  warn: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18h.01"/></svg>`,
  clock: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`,
  lock: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>`,
  grid: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 10h16M10 10v10"/></svg>`,
  sparkle: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/></svg>`,
  bad: `<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8"/><path d="M10 6v5M10 13.5v.01"/></svg>`,
};

export const initials = (n) => (n || "?").trim().split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";

// Big page header: title, one-line description, optional primary action button.
export function pageHead(title, sub, action) {
  return `<div class="list-head lh-big"><div><h1>${title}</h1><div class="rec-sub">${sub}</div></div>
    ${action ? `<button class="btn btn-primary" id="${action.id}">${action.icon ?? IC.plus}${action.label}</button>` : ""}</div>`;
}
// Status tabs: [[key, label, iconHtml, count], ...]
export function tabsBar(tabs, current, label) {
  return `<div class="ltabs" role="tablist" aria-label="${label}">${tabs.map(([k, l, icon, n]) => `<button class="ltab" role="tab" data-ltab="${k}" aria-selected="${current === k}">${icon || ""}<span>${l}</span>${n === undefined ? "" : `<span class="lcount">${n}</span>`}</button>`).join("")}</div>`;
}
// Click and arrow-key handling for a tabsBar inside root.
export function bindTabs(root, onPick) {
  const bar = root.querySelector(".ltabs"); if (!bar) return;
  bar.querySelectorAll("[data-ltab]").forEach((b) => b.addEventListener("click", () => onPick(b.dataset.ltab)));
  bar.addEventListener("keydown", (e) => {
    const tabs = [...bar.querySelectorAll("[data-ltab]")], i = tabs.indexOf(document.activeElement);
    const n = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
    if (n === undefined || i < 0) return;
    e.preventDefault(); const k = tabs[(n + tabs.length) % tabs.length].dataset.ltab;
    onPick(k); root.querySelector(`[data-ltab="${k}"]`)?.focus();
  });
}
export function setTabCounts(root, counts) {
  Object.entries(counts).forEach(([k, n]) => { const el = root.querySelector(`[data-ltab="${k}"] .lcount`); if (el) el.textContent = n; });
}
export const searchBox = (id, placeholder, value, label) =>
  `<label class="lsearch">${IC.search}<input type="text" id="${id}" placeholder="${placeholder}" aria-label="${label || placeholder.replace("…", "")}" value="${value}" autocomplete="off"></label>`;

// Sortable column header. sort = { key, dir } (dir 1 = ascending). key "" = default order.
export function sortTh(sort, key, label, cls = "") {
  const on = sort.key === key;
  return `<th class="${cls}" aria-sort="${on ? (sort.dir > 0 ? "ascending" : "descending") : "none"}"><button class="sortbtn${on ? " on" : ""}" data-sort="${key}">${label}${on ? (sort.dir > 0 ? IC.up : IC.down) : IC.sort}</button></th>`;
}
export const nextSort = (sort, key) => (sort.key !== key ? { key, dir: 1 } : sort.dir > 0 ? { key, dir: -1 } : { key: "", dir: 1 });
export function sortRows(rows, sort, getters) {
  const g = getters[sort.key]; if (!g) return rows;
  return [...rows].sort((a, b) => { const x = g(a), y = g(b); return (x > y ? 1 : x < y ? -1 : 0) * sort.dir; });
}
// Wire the sort buttons in root: onSort(newSort) should redraw.
export function bindSort(root, getSort, onSort) {
  root.querySelectorAll("[data-sort]").forEach((b) => b.addEventListener("click", () => { const k = b.dataset.sort; onSort(nextSort(getSort(), k)); root.querySelector(`[data-sort="${k}"]`)?.focus(); }));
}

// The ⋯ row menu. items: [{ a, label, icon, danger }] or "sep". onPick(a) runs after it closes.
export function rowMenu(btn, items, onPick) {
  const { pop, close } = openPop(btn, "cc-menu", (p) => {
    p.setAttribute("role", "menu");
    p.innerHTML = items.filter(Boolean).map((it) => (it === "sep" ? "<hr>" : `<button role="menuitem" data-a="${it.a}"${it.danger ? ' class="danger"' : ""}>${it.icon || ""}${it.label}</button>`)).join("");
  }, { align: "end" });
  const els = [...pop.querySelectorAll("[role=menuitem]")];
  els[0]?.focus();
  pop.addEventListener("keydown", (e) => {
    const i = els.indexOf(document.activeElement);
    const n = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: els.length - 1 }[e.key];
    if (n !== undefined) { e.preventDefault(); els[(n + els.length) % els.length].focus(); }
    if (e.key === "Tab") close(false);
  });
  pop.addEventListener("click", (e) => { const a = e.target.closest("[data-a]")?.dataset.a; if (!a) return; close(false); onPick(a); });
}
export const kebab = (id, name, attr = "data-menu") => `<button class="kebab" ${attr}="${id}" aria-haspopup="menu" aria-expanded="false" aria-label="Actions for ${name}">${IC.more}</button>`;
