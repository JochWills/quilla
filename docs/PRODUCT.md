# Product: how a Record of Advice is made

## The flow
1. **Source notes** — advisor enters client name, reference (optional, never an ID number), meeting date, advice area, and pastes meeting notes or a transcript. Minimum ~25 words to draft.
2. **Draft** — AI writes all 13 sections from the notes only. Each section gets a status (`captured`, `partial`, `not_captured`) and up to two verbatim evidence quotes from the notes.
3. **Document review** — numbered section cards. Advisor edits text directly; "Improve with AI" rewrites wording without adding facts (undoable).
4. **Compliance check** — flagged items beside the document, ranked:
   - **Critical**: the record isn't defensible without it (e.g. unconfirmed replacement penalty, missing reasons for the recommendation).
   - **Important**: should be recorded (e.g. how the risk profile was determined, conflicts not disclosed).
   - **Minor**: tidy-ups.
   Each item is resolved as **Addressed** or **Not applicable**, with a required note. "Check again" re-reviews the edited record without re-raising resolved items.
5. **Sign-off** — requires: declaration ticked, client decision chosen, advisor name, FSP number, all required sections non-empty. Open critical items need a written reason (≥15 characters), logged in history.
6. **Export** — HTML (opens in Word) or Markdown, including the record, declaration, compliance appendix with resolutions, and full history.

## The 13 sections
1. Client details and circumstances
2. Financial situation
3. Needs and objectives
4. Risk profile
5. Existing products reviewed
6. Products and alternatives considered
7. Recommendation
8. Why the recommendation suits the client
9. Fees and charges disclosed
10. Replacement analysis (not applicable when nothing is replaced)
11. Material risks and disclosures
12. Remuneration and conflicts of interest
13. Client's decision

**Required before sign-off** (and the severity flagged if empty): recommendation, reasons, fees, needs & objectives (critical); products considered, risk profile, financial situation, client decision, conflicts, client details (important). If an existing product is replaced, an incomplete replacement analysis is critical.

## Positioning
- One-liner: *Paste your meeting notes, and Quilla writes your Record of Advice in minutes, flags anything a compliance officer would query, and gives you a signed, defensible record for the file.*
- Audience: South African independent financial advisors and small practices (investment and retirement advice first).
- Competitors: Broker AI (insurance brokers, policy documents), generic note-takers (Fireflies, etc.), overseas tools such as Quill (US RIAs) and Advisly (Australia). Quilla's angle: SA/FAIS-specific, advice documentation rather than note-taking, compliance check + audit trail.

## Pricing (planned, free during pilot)
Solo R490/month · Practice R790/advisor/month · Network on request. AI cost is roughly R2 per record (draft + one re-check); validate with real usage in `ai_usage`.
