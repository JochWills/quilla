# Roadmap

## Done
- Landing page (quilla.co.za) from the brand design, with honest trust points and pilot invitation.
- App: magic-link sign-in, records list/search, notes → AI draft, 13-section document with evidence, Improve with AI + undo, compliance check with resolve/reopen, re-check, sign-off gating, activity log, HTML/Markdown export.
- Supabase schema with row level security; server-side AI function with rate limiting and usage logging.

## Before public launch (must do)
- [ ] Register CIPC trademark for "Quilla" (classes 9 and 42) and confirm the company/trading name.
- [ ] Attorney review of `landing/privacy.html` and `landing/terms.html` (POPIA, cross-border processing, liability, AI disclaimer). Appoint an Information Officer.
- [ ] Custom SMTP for auth emails; branded magic-link template.
- [ ] Compliance officer review of the 13-section structure and the export format.
- [ ] Run 3 pilot practices on real (anonymised) notes; measure draft accuracy and time saved.
- [ ] Anthropic spend limit and alerting; Supabase backups enabled.
- [ ] Replace placeholder pricing once pilots confirm willingness to pay.

## Next features
- **Signed-record integrity**: store an immutable snapshot + hash on sign-off; reopening creates a new version instead of editing.
- **PDF and DOCX export** with practice branding.
- **Payments**: Paystack subscriptions (ZAR), plan limits enforced in the `ai` function.
- **Practices**: organisations, multiple advisors, compliance officer read/review role.
- **Practice templates**: custom section order/wording per practice.
- **Transcript upload / recording** with consent capture.
- **Client records**: link multiple ROAs to one client; reuse client details.
- **TrailBook integration**: pull commission data into "Remuneration and conflicts".
- Shared `SECTIONS` definition between app and function (single source of truth).
- Move the app to Vite + TypeScript once it grows beyond one file.
