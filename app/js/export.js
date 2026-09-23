// PDF and Word (.docx) export for a Record of Advice.
// Both libraries are large, so they load only when an advisor first exports.
// Input is the plain "doc model" built by docModel() in app.js: every value is
// already formatted text, so this file has no knowledge of record state.

const PDFMAKE = [
  ["https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.12/pdfmake.min.js", "sha384-UbICcZf4B6+FB/cmTNLOqZzUc40rHayX14EhEDfAnFhmte7yAAA7s081OeuC8VVT"],
  ["https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.12/vfs_fonts.min.js", "sha384-nXUiXap6sIVQQCtbYdJPsTOTJwv3rZjOdv8Ckh+3udRCVp3YLpdgHnjpPHD/LaC0"],
];
const DOCX = "https://cdn.jsdelivr.net/npm/docx@9.7.2/+esm";

const BRAND = "#1D4B48", INK = "#152B2A", MUTED = "#5A6A68", TINT = "#F0F5F4", RULE = "#E2E8E7";
const DECLARATION = "I confirm this record accurately reflects the information considered, the products considered and the advice I gave, and that I am responsible for its content.";

function loadScript([src, integrity]) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src; s.integrity = integrity; s.crossOrigin = "anonymous";
    s.onload = resolve; s.onerror = () => reject(new Error("script_load"));
    document.head.appendChild(s);
  });
}
let pdfReady = null, docxReady = null;
const loadPdfMake = () => (pdfReady ||= PDFMAKE.reduce((p, src) => p.then(() => loadScript(src)), Promise.resolve())
  .then(() => window.pdfMake).catch((e) => { pdfReady = null; throw e; }));
const loadDocx = () => (docxReady ||= import(DOCX).catch((e) => { docxReady = null; throw e; }));

function integrityText(d) {
  return `This document was generated from version ${d.seal.version} of the record, sealed on ${d.seal.sealedAt}. A sealed version can't be changed: any later edits create a new version. SHA-256 fingerprint of the sealed version:`;
}
function footerLabel(d) { return [d.practice, "Record of Advice", d.client, d.seal ? `Version ${d.seal.version}` : "Draft"].filter(Boolean).join("  ·  "); }

/* ---------------- PDF ---------------- */
export async function buildPdf(d) {
  const pdfMake = await loadPdfMake();
  const h2 = (text) => ({ text, style: "h2" });
  const body = (text, note) => text ? { text, style: "body" } : { text: note, style: "body", italics: true, color: MUTED };
  const content = [
    { columns: [
      { width: "*", stack: [d.practice ? { text: d.practice, style: "practice" } : "", { text: "Record of Advice", style: "h1" }] },
      { width: "auto", text: d.statusLabel, style: d.seal ? "stampSealed" : "stampDraft", margin: [0, 4, 0, 0] },
    ] },
    { canvas: [{ type: "line", x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 1.5, lineColor: BRAND }], margin: [0, 8, 0, 12] },
    { table: { widths: [80, "*", 80, "*"], body: [0, 2, 4].map((i) => [
      { text: d.meta[i][0], style: "label" }, { text: d.meta[i][1] },
      { text: d.meta[i + 1][0], style: "label" }, { text: d.meta[i + 1][1] },
    ]) }, layout: "noBorders", margin: [0, 0, 0, 10] },
  ];
  if (d.summary) content.push({ text: d.summary, italics: true, color: MUTED, margin: [0, 2, 0, 6] });
  d.sections.forEach((s) => content.push(h2(`${s.n}. ${s.title}`), body(s.text, s.note)));

  content.push(h2("Advisor declaration"));
  if (d.signed) {
    content.push({ text: DECLARATION, style: "body" }, { text: [{ text: "Signed off by ", color: MUTED }, d.signedBy, { text: " on ", color: MUTED }, d.signedAt], margin: [0, 8, 0, 0] },
      { text: [{ text: "Client's decision: ", color: MUTED }, d.outcome] });
    if (d.override) content.push({ text: [{ text: "Signed with critical items open. Reason: ", color: MUTED }, d.override], margin: [0, 4, 0, 0] });
  } else content.push({ text: "Draft: not yet signed off.", bold: true, color: "#8A5A00" });
  content.push({ columns: [{ text: "Client signature: ______________________________" }, { text: "Date: ________________", width: "auto" }], margin: [0, 22, 0, 0] });

  content.push(h2("Appendix: compliance review items"));
  content.push(d.gaps.length ? {
    table: { headerRows: 1, widths: [95, 55, "*", "*"], body: [
      ["Section", "Severity", "Item", "Resolution"].map((t) => ({ text: t, style: "th" })),
      ...d.gaps.map((g) => [g.section, g.severity, g.issue, { text: g.resolution, bold: g.open }]),
    ] },
    layout: { hLineColor: () => RULE, vLineColor: () => RULE, fillColor: (row) => (row === 0 ? TINT : null), paddingTop: () => 4, paddingBottom: () => 4 },
    fontSize: 8.5,
  } : { text: "No items were flagged.", color: MUTED });

  content.push(h2("Appendix: record history"));
  content.push({ table: { widths: [95, "*"], body: d.audit.map(([t, x]) => [{ text: t, color: MUTED }, x]) }, layout: "noBorders", fontSize: 8.5 });

  if (d.seal) content.push({
    table: { widths: ["*"], body: [[{ stack: [
      { text: "Record integrity", bold: true, color: BRAND, margin: [0, 0, 0, 3] },
      { text: integrityText(d), fontSize: 8.5, color: MUTED },
      { text: d.seal.sha256, fontSize: 8, margin: [0, 3, 0, 0], characterSpacing: 0.3 },
    ], fillColor: TINT, margin: [8, 8, 8, 8] }]] },
    layout: "noBorders", margin: [0, 18, 0, 0], unbreakable: true,
  });
  content.push({ text: "Drafted with Quilla from the advisor's meeting notes and reviewed by the advisor.", fontSize: 8, color: MUTED, margin: [0, 14, 0, 0] });

  const def = {
    info: { title: `Record of Advice: ${d.client}`, author: d.meta[2][1], creator: "Quilla" },
    pageSize: "A4", pageMargins: [40, 44, 40, 52],
    watermark: d.seal || d.signed ? undefined : { text: "DRAFT", color: BRAND, opacity: 0.06, bold: true },
    footer: (page, pages) => ({ columns: [{ text: footerLabel(d) }, { text: `Page ${page} of ${pages}`, alignment: "right", width: "auto" }], margin: [40, 18, 40, 0], fontSize: 7.5, color: MUTED }),
    content,
    defaultStyle: { font: "Roboto", fontSize: 10, lineHeight: 1.3, color: INK },
    styles: {
      practice: { fontSize: 11, bold: true, color: BRAND, margin: [0, 0, 0, 2] },
      h1: { fontSize: 20, bold: true, color: INK },
      h2: { fontSize: 11.5, bold: true, color: BRAND, margin: [0, 14, 0, 4] },
      body: { fontSize: 10 },
      label: { color: MUTED },
      th: { bold: true, color: INK },
      stampSealed: { fontSize: 9, bold: true, color: "#1F6B47" },
      stampDraft: { fontSize: 9, bold: true, color: "#8A5A00" },
    },
  };
  return new Promise((resolve) => pdfMake.createPdf(def).getBlob(resolve));
}

/* ---------------- Word (.docx) ---------------- */
export async function buildDocx(d) {
  const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType, Footer, PageNumber, AlignmentType } = await loadDocx();
  const hex = (c) => c.slice(1);
  // Multi-line text → one run per line, joined with line breaks.
  const runs = (text, o = {}) => String(text).split("\n").map((line, i) => new TextRun({ text: line, break: i ? 1 : 0, ...o }));
  const p = (text, o = {}, po = {}) => new Paragraph({ children: runs(text, o), spacing: { after: 80 }, ...po });
  const h2 = (text) => new Paragraph({ children: [new TextRun({ text, bold: true, size: 23, color: hex(BRAND) })], spacing: { before: 280, after: 80 }, keepNext: true });
  const none = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
  const noBorders = { top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none };
  const line = { style: BorderStyle.SINGLE, size: 4, color: hex(RULE) };
  const gridBorders = { top: line, bottom: line, left: line, right: line, insideHorizontal: line, insideVertical: line };
  const cell = (children, o = {}) => new TableCell({ children: Array.isArray(children) ? children : [children], margins: { top: 60, bottom: 60, left: 90, right: 90 }, ...o });
  const tint = { type: ShadingType.CLEAR, fill: hex(TINT), color: "auto" };

  const children = [];
  if (d.practice) children.push(p(d.practice, { bold: true, size: 22, color: hex(BRAND) }, { spacing: { after: 20 } }));
  children.push(new Paragraph({
    children: [new TextRun({ text: "Record of Advice", bold: true, size: 40 }), new TextRun({ text: `\t${d.statusLabel}`, bold: true, size: 18, color: d.seal ? "1F6B47" : "8A5A00" })],
    tabStops: [{ type: "right", position: 9026 }],
    border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: hex(BRAND), space: 6 } }, spacing: { after: 200 },
  }));
  children.push(new Table({
    width: { size: 100, type: WidthType.PERCENTAGE }, borders: noBorders,
    rows: [0, 2, 4].map((i) => new TableRow({ children: [
      cell(p(d.meta[i][0], { color: hex(MUTED) }), { width: { size: 16, type: WidthType.PERCENTAGE } }), cell(p(d.meta[i][1])),
      cell(p(d.meta[i + 1][0], { color: hex(MUTED) }), { width: { size: 16, type: WidthType.PERCENTAGE } }), cell(p(d.meta[i + 1][1])),
    ] })),
  }));
  if (d.summary) children.push(p(d.summary, { italics: true, color: hex(MUTED) }, { spacing: { before: 160, after: 80 } }));
  d.sections.forEach((s) => children.push(h2(`${s.n}. ${s.title}`), s.text ? p(s.text) : p(s.note, { italics: true, color: hex(MUTED) })));

  children.push(h2("Advisor declaration"));
  if (d.signed) {
    children.push(p(DECLARATION));
    children.push(new Paragraph({ children: [new TextRun({ text: "Signed off by ", color: hex(MUTED) }), new TextRun(d.signedBy), new TextRun({ text: " on ", color: hex(MUTED) }), new TextRun(d.signedAt)], spacing: { before: 120, after: 40 } }));
    children.push(new Paragraph({ children: [new TextRun({ text: "Client's decision: ", color: hex(MUTED) }), new TextRun(d.outcome)], spacing: { after: 40 } }));
    if (d.override) children.push(new Paragraph({ children: [new TextRun({ text: "Signed with critical items open. Reason: ", color: hex(MUTED) }), new TextRun(d.override)] }));
  } else children.push(p("Draft: not yet signed off.", { bold: true, color: "8A5A00" }));
  children.push(p("Client signature: ______________________________        Date: ________________", {}, { spacing: { before: 360, after: 80 } }));

  children.push(h2("Appendix: compliance review items"));
  children.push(d.gaps.length ? new Table({
    width: { size: 100, type: WidthType.PERCENTAGE }, borders: gridBorders,
    rows: [
      new TableRow({ tableHeader: true, children: ["Section", "Severity", "Item", "Resolution"].map((t) => cell(p(t, { bold: true, size: 18 }), { shading: tint })) }),
      ...d.gaps.map((g) => new TableRow({ children: [g.section, g.severity, g.issue].map((t) => cell(p(t, { size: 18 }))).concat(cell(p(g.resolution, { size: 18, bold: g.open }))) })),
    ],
  }) : p("No items were flagged.", { color: hex(MUTED) }));

  children.push(h2("Appendix: record history"));
  children.push(new Table({
    width: { size: 100, type: WidthType.PERCENTAGE }, borders: noBorders,
    rows: d.audit.map(([t, x]) => new TableRow({ children: [cell(p(t, { size: 17, color: hex(MUTED) }), { width: { size: 24, type: WidthType.PERCENTAGE } }), cell(p(x, { size: 17 }))] })),
  }));

  if (d.seal) children.push(new Paragraph({ text: "", spacing: { after: 200 } }), new Table({
    width: { size: 100, type: WidthType.PERCENTAGE }, borders: noBorders,
    rows: [new TableRow({ cantSplit: true, children: [cell([
      p("Record integrity", { bold: true, color: hex(BRAND) }),
      p(integrityText(d), { size: 17, color: hex(MUTED) }),
      p(d.seal.sha256, { size: 16, font: "Consolas" }),
    ], { shading: tint, margins: { top: 140, bottom: 140, left: 160, right: 160 } })] })],
  }));
  children.push(p("Drafted with Quilla from the advisor's meeting notes and reviewed by the advisor.", { size: 16, color: hex(MUTED) }, { spacing: { before: 240 } }));

  const doc = new Document({
    creator: "Quilla", title: `Record of Advice: ${d.client}`,
    styles: { default: { document: { run: { font: "Calibri", size: 21, color: hex(INK) } } } },
    sections: [{
      properties: { page: { margin: { top: 1000, bottom: 1000, left: 1100, right: 1100 } } },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.LEFT, children: [
        new TextRun({ text: footerLabel(d), size: 15, color: hex(MUTED) }),
        new TextRun({ children: ["   ·   Page ", PageNumber.CURRENT, " of ", PageNumber.TOTAL_PAGES], size: 15, color: hex(MUTED) }),
      ] })] }) },
      children,
    }],
  });
  return Packer.toBlob(doc);
}
