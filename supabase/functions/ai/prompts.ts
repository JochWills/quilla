// Prompt builders for the Quilla `ai` edge function.
// Prompts live on the server so the endpoint can't be used as a general-purpose AI proxy,
// and so wording changes ship without a frontend deploy.
//
// Non-negotiable rule for every prompt: Quilla DOCUMENTS advice. It never gives advice,
// never recommends products, and never adds facts that are not in the advisor's notes.

export const SECTIONS: [string, string, string][] = [
  ["client_profile", "Client details and circumstances", "Who the client is: age, occupation, family, dependants and relevant personal circumstances."],
  ["financial_situation", "Financial situation", "Income, assets, liabilities, existing savings and cash flow as recorded."],
  ["needs_objectives", "Needs and objectives", "What the client wants to achieve, with amounts and timeframes where stated."],
  ["risk_profile", "Risk profile", "Risk tolerance and capacity, and how it was determined."],
  ["existing_products", "Existing products reviewed", "Current policies and investments considered, with values where stated."],
  ["products_considered", "Products and alternatives considered", "Every product or option discussed, including those not recommended and why."],
  ["recommendation", "Recommendation", "Exactly what the advisor recommended: product, provider, fund and amounts."],
  ["reasons", "Why the recommendation suits the client", "The advisor's reasons linking the recommendation to the client's needs."],
  ["fees", "Fees and charges disclosed", "Initial and ongoing advice fees, platform fees, fund costs and any changes agreed."],
  ["replacement", "Replacement analysis", "If an existing product is replaced: termination penalties, cost comparison, tax impact, benefits lost and reasons."],
  ["risks_disclosures", "Material risks and disclosures", "Risks, material terms and limitations explained to the client."],
  ["conflicts", "Remuneration and conflicts of interest", "Commission or fees received and any conflicts disclosed."],
  ["client_decision", "Client's decision", "Whether the client accepted, declined or deviated from the advice, and any conditions."],
];
export const SECTION_IDS = SECTIONS.map((s) => s[0]);
const TITLE: Record<string, string> = Object.fromEntries(SECTIONS.map((s) => [s[0], s[1]]));

export const LIMITS = { notes: 40000, section: 6000, record: 40000 };

export interface DraftInput { notes: string; meta: { client?: string; area?: string; date?: string } }
export interface RecheckInput {
  sections: Record<string, string>;
  resolved: { section_id: string; issue: string; state: "addressed" | "na"; note: string }[];
  replacement: { is_replacement: boolean; existing_product?: string };
}
export interface ImproveInput { section_id: string; content: string; notes: string }

export function draftPrompt(i: DraftInput): string {
  const m = i.meta || {};
  return `You are drafting a South African FAIS Record of Advice (ROA) for a financial advisor, from the advisor's own meeting notes. You document the advice; you never give advice.

Rules:
- Use ONLY facts stated in the notes and details below. Never invent amounts, products, reasons, disclosures or client statements. Never add your own recommendations or opinions on suitability.
- Write each section in clear, formal third person ("The client…", "The advisor recommended…"), concise and suitable for a compliance file. Use South African conventions (rand amounts as R, "per month", "tax year").
- If the notes do not cover a section, set status "not_captured" and content "". If partly covered, set status "partial" and write only what is there. Use "captured" only when the section is properly covered.
- evidence: up to 2 short verbatim quotes (max 20 words each) copied exactly from the notes that support the section. Empty array if none.
- gaps: what a FAIS compliance officer would flag as missing, unclear or unconfirmed, e.g. alternatives not recorded, fees not fully disclosed, replacement penalties or tax impact unconfirmed, how the risk profile was determined, remuneration or conflicts not disclosed, a conditional or unclear client decision, statements still to be supplied. severity: "critical" (the record is not defensible without it), "important", or "minor". issue: one sentence naming what is missing. fix: one sentence on what the advisor should record or confirm. Do not flag things the notes clearly cover. Link each gap to the most relevant section_id.
- replacement.is_replacement: true if an existing product is being replaced, transferred, surrendered, reduced or made paid-up.

Sections (id: title. what belongs there):
${SECTIONS.map((s) => `- ${s[0]}: ${s[1]}. ${s[2]}`).join("\n")}

Details entered by the advisor:
Client: ${m.client || "not given"}
Advice area: ${m.area || "not given"}
Meeting date: ${m.date || "not given"}

Meeting notes:
"""
${i.notes.slice(0, LIMITS.notes)}
"""

Reply with only JSON in exactly this shape, with all 13 section ids exactly once, in the order listed:
{"summary":"one sentence describing the advice given","replacement":{"is_replacement":true,"existing_product":"short name or empty"},"sections":[{"id":"client_profile","status":"captured","content":"…","evidence":["…"]}],"gaps":[{"section_id":"fees","severity":"important","issue":"…","fix":"…"}]}`;
}

export function recheckPrompt(i: RecheckInput): string {
  const record = SECTIONS.map(([id, t]) => `## ${id} (${t})\n${(i.sections[id] || "").trim() || "[empty]"}`).join("\n\n");
  const resolved = (i.resolved || [])
    .map((g) => `- [${g.section_id}] ${g.issue} → ${g.state === "na" ? "not applicable" : "addressed"}: ${g.note}`)
    .join("\n") || "none";
  const rep = i.replacement?.is_replacement ? `yes (${i.replacement.existing_product || "existing product"})` : "no";
  return `You are checking a South African FAIS Record of Advice drafted by a financial advisor. You do not give advice; you only identify what a compliance officer would flag as missing, unclear or unconfirmed in the record as it now stands.

The advisor has already resolved these items. Do not raise them again unless the record now contradicts the resolution:
${resolved}

Replacement of an existing product: ${rep}.

Record:
${record.slice(0, LIMITS.record)}

Reply with only JSON: {"gaps":[{"section_id":"one of: ${SECTION_IDS.join(", ")}","severity":"critical|important|minor","issue":"one sentence","fix":"one sentence"}]}. Return an empty array if nothing needs flagging.`;
}

export function improvePrompt(i: ImproveInput): string {
  return `You are improving one section of a South African FAIS Record of Advice written by a financial advisor.

Rewrite the section below in clear, formal, compliance-ready wording, in the third person.
Strict rules:
- Keep every fact, amount and name that is in the current text.
- Do NOT add any fact, amount, product, reason or disclosure that is not in the current text or explicitly in the meeting notes.
- Do not give advice or opinions on suitability. Do not add headings.
- If the current text says something the notes contradict, keep the current text.

Section: ${TITLE[i.section_id] || i.section_id}
Current text:
"""
${i.content.slice(0, LIMITS.section)}
"""

Meeting notes (for reference only):
"""
${(i.notes || "").slice(0, 30000)}
"""

Reply with only JSON: {"content":"the improved section text"}`;
}
