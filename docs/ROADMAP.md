# Roadmap

## Done
- Landing site (quilla.co.za): home, How it works, Pricing (free during early access), FAQ, privacy policy and terms.
- App: email/password sign-in with profiles, records list with tabs, search, filters, archive and bulk actions; notes → AI draft (six random example meetings); 13-section document with evidence; Improve with AI (rewords only, checked server-side) + undo; compliance check with resolve/reopen, re-check, sign-off gating, activity log; ⌘K search; Back/forward navigation.
- Supabase schema with row level security; server-side AI function with rate limiting and usage logging.
- Signed-record integrity: each sign-off seals an immutable, versioned snapshot with a server-computed SHA-256 fingerprint; signed records are read-only and reopening creates a new version.
- PDF, Word (.docx) and Markdown export, generated from the sealed version, on the advisor's own letterhead (logo, practice details, footer line, accent colour).
- Your data (POPIA): download everything or one client's data; delete account (`delete-account` function).
- Clients: client list and pages; records and meetings link to a client.
- Meetings: advisor notes, optional transcript files (.vtt/.srt/.txt/.docx) or pasted transcripts, speaker naming, start a record from a meeting. (In-app recording and Deepgram transcription were built, then removed on 29 Sep 2026: transcription errors in figures and names were too risky for a compliance record.)
- Standard wording (account menu): per-section fixed practice text appended to drafts, with optional drafting guidance under "Advanced".
- Compliance dashboard: drafts needing attention, overrides, sealing status and retention dates.

## Before public launch (must do)
- [ ] Fill in the placeholders in `landing/privacy.html` (company name, registration number, address, Information Officer, backup period).
- [ ] Supabase: leaked password protection on; delete the old `transcribe` function (`supabase functions delete transcribe`) and the empty `meeting-audio` bucket.
- [ ] Register CIPC trademark for "Quilla" (classes 9 and 42) and confirm the company/trading name.
- [ ] Attorney review of `landing/privacy.html` and `landing/terms.html` (POPIA, cross-border processing, liability, AI disclaimer). Appoint an Information Officer.
- [ ] Custom SMTP for auth emails (noreply@quilla.co.za); branded confirmation/reset email templates.
- [ ] Compliance officer review of the 13-section structure and the export format.
- [ ] Run 3 pilot practices on real (anonymised) notes; measure draft accuracy and time saved.
- [ ] Anthropic spend limit and alerting; Supabase backups enabled.
- [ ] Replace placeholder pricing once pilots confirm willingness to pay.

## Next features
- **Payments**: Paystack subscriptions (ZAR), plan limits enforced in the `ai` function.
- **Practices**: organisations, multiple advisors, compliance officer read/review role.
- **Practice standard wording**: shared across a practice (today they're per advisor), and custom section order.
- **TrailBook integration**: pull commission data into "Remuneration and conflicts".
- Shared `SECTIONS` definition between app and function (single source of truth).
- Move the app to Vite + TypeScript once it grows beyond one file.
