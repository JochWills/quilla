# CLAUDE.md — working on Quilla

Read this before changing code. Then read `docs/ARCHITECTURE.md` and `docs/PRODUCT.md`.

## What Quilla is
A web app that drafts FAIS **Records of Advice (ROAs)** for South African financial advisors from their own meeting notes, flags compliance gaps, and produces a signed, exportable record with an audit trail. Target users: independent advisors and small practices in South Africa. Owner: Josh (solo founder, React/JS developer).

## Non-negotiable product rules
1. **Quilla documents advice. It never gives advice.** No prompt or feature may recommend products, judge suitability, or suggest what the advisor should have advised.
2. **Never invent facts.** Drafts use only what's in the advisor's notes. Missing information is marked "not captured" and flagged, never filled in. "Improve with AI" may reword, never add facts.
3. **The advisor signs off.** Nothing is final until the advisor signs. Signing with open critical items requires a written reason, which is logged. Each sign-off seals an immutable version in `record_versions`; a signed record is read-only in the UI, and reopening it never alters a sealed version. Signed or sealed records can't be deleted (FAIS five-year retention; enforced by the `records` delete policy), only archived.
4. **Everything is audited.** Drafting, edits, AI rewrites, resolved/reopened items, sign-off and exports are appended to `record.audit`. Never delete or rewrite audit entries.
5. **Client data is sensitive (POPIA).** Never log prompt or response content. Never send data to third parties other than the AI provider (Anthropic) and, for meetings the client agreed to have recorded, the transcription provider (Deepgram, via the `transcribe` function). Meeting audio is deleted once transcribed; only the text is kept. Don't ask for or store ID numbers.
6. **Honest marketing.** No fake testimonials, no customer logos or "trusted by" claims without written permission, no invented statistics. Unbuilt features are labelled "Soon".

## Architecture in one paragraph
Two static sites on Render (`landing/` → quilla.co.za, `app/` → app.quilla.co.za). The app uses Supabase for email/password auth and `records` + `record_versions` + `clients` + `meetings` + `profiles` tables protected by row level security (each advisor sees only their own rows; `profiles` holds the advisor's name/FSP number/practice name, prefills new records, and stores their section `template`). Meeting audio goes to the private `meeting-audio` storage bucket and is transcribed by the `transcribe` edge function (Deepgram), which then deletes it. The Clients, Meetings, Templates and Compliance screens live in `app/js/clients.js`, `meetings.js`, `templates.js` and `compliance.js`, rendered with a shared `ctx` from `app.js`. All AI calls go to the Supabase Edge Function `supabase/functions/ai`, which checks the user's JWT, rate-limits per user, builds the prompt **server-side** (`prompts.ts`), calls the Anthropic Messages API, logs token usage to `ai_usage`, and returns parsed JSON. The Anthropic key exists only as a Supabase secret. The `delete-account` edge function re-checks the password, clears leftover meeting audio and deletes the auth user; every table cascades from `auth.users`.

## Code conventions
- **No build step** right now: plain HTML, CSS and ES modules. `app/js/app.js` imports `@supabase/supabase-js` from jsDelivr. If you introduce a bundler (e.g. Vite), update `render.yaml` (`buildCommand`, `staticPublishPath`) and `docs/DEPLOYMENT.md` in the same change.
- Vanilla JS, render-by-template-string, `esc()` on **every** interpolated user value to prevent XSS.
- List screens (Advice records, Clients, Meetings, Templates, Compliance) share one design built from `app/js/ui.js`: `pageHead`, `tabsBar`/`bindTabs`, `searchBox`, `sortTh`/`sortRows`/`bindSort`, `rowMenu`/`kebab` and the `IC` icon set. Build new list screens from these rather than new markup.
- Use plain `<select>` and `<input type="date">` in markup. `app/js/controls.js` swaps them for the custom dropdown and date picker automatically (the native element stays hidden and holds the value, so read `.value` and listen for `change` as normal). Add `data-native` to opt out.
- The 13 ROA sections are defined twice: `app/js/app.js` (`SECTIONS`) and `supabase/functions/ai/prompts.ts` (`SECTIONS`). Keep them identical. A future refactor should share one source.
- Record state shape lives in `blank()` in `app/js/app.js`. If you change it, keep old records loadable (records are stored as JSON in `records.data`).
- Spelling in UI copy: "advisor" (matches the brand design). Use South African conventions: rand as "R", dates like "21 Sep 2026".
- Accessibility: real buttons and labels, visible focus, `aria-live` for status messages, respect `prefers-reduced-motion`.
- **No `.html` in links.** Every landing page (other than `index.html` and `404.html`, which are served specially) gets a matching rewrite rule in `render.yaml` under `quilla-landing`'s `routes` (e.g. `source: /privacy` → `destination: /privacy.html`), and every internal link, canonical tag, og:url and sitemap entry points at the extension-less path. When adding a new static page, add the file as normal, add its rewrite rule, and link to it without `.html`.

## Design system
- Light theme only (white background). Tokens are CSS variables at the top of `landing/assets/site.css` and `app/styles.css` — keep both in sync.
- Brand colour `--brand: #1D4B48` (deep teal). Text `--ink: #152B2A`.
- Fonts (Google Fonts): **Newsreader** for the wordmark (weight 460, `opsz` 72), **Source Serif 4** for headings, **Inter** for UI/body, **Caveat** only for the handwritten line on the landing page.
- Severity colours: critical = red, important = amber, minor = teal, resolved = green.

## Common tasks
- Change AI behaviour → edit `supabase/functions/ai/prompts.ts`, then `supabase functions deploy ai`. Test on the example meetings (Source notes → "Load an example meeting" picks one of six at random from `EXAMPLES` in `app/js/app.js`; try a few).
- Change the schema → add a new file in `supabase/migrations/` (never edit an applied migration), then `supabase db push`.
- Change landing copy → `landing/index.html`. Push to `main`; Render redeploys only the site whose folder changed (`buildFilter`).

## Testing checklist before shipping app changes
- Sign up with full name, FSP number, email + password → after confirming the email, Account settings shows that name and FSP number and new records are prefilled. Sign out, sign back in with the password.
- Forgot password → reset link → set a new password → lands back in the app.
- Account settings (popup from the account menu): save name/FSP number/practice name → new record's advisor/FSP fields are prefilled.
- New record → Load example → Draft → 13 sections + flagged items appear.
- Improve with AI on one section → Undo works.
- Resolve an item, Check again → resolved item stays resolved.
- Sign-off is blocked until declaration, outcome, advisor name and FSP number are filled; critical items require a reason.
- Sign off → record becomes read-only (banner shown, no editing on Document or Source notes) and "Sealed versions" lists version 1.
- Reopen → edit → sign again → version 2 appears; version 1 still downloads unchanged.
- Export PDF, Word (.docx) and .md for a draft (watermarked DRAFT) and for a sealed version (integrity block with fingerprint).
- Records list shows the record; reload the page and reopen it. Status tabs, search, filter and column sorting narrow the list; ⋯ → Archive moves it to the Archived tab (and Unarchive brings it back); select two rows → bulk Archive/Delete works.
- Open a client, then one of their records → browser Back (or swipe back) returns to the client, then to the list; reloading on a client or record reopens it.
- ⌘K (Ctrl K) focuses the top search; typing a client or record name lists both, Enter opens the first.
- Clients: add a client → New record from their page prefills name/reference; the record appears on the client page.
- Meetings: confirm consent → record 30 seconds (or upload audio) → transcript appears, audio is gone from the bucket → name speakers → Start Record of Advice → the draft uses the transcript. Also import a Teams .vtt file.
- Templates: add guidance and standard wording to Fees → redraft → the standard wording is appended and marked.
- Compliance: drafts with open critical items and records signed with an override are listed.
- Settings → Your data: Download all my data gives one JSON file; a client page's Download client data gives just that client. Delete account needs the tick box and password, then signs out; the account and its rows are gone. A signed record has no Delete in its ⋯ menu.
- A second test account cannot see the first account's records, clients, meetings or profile.

## Don'ts
- Don't call the Anthropic API from the browser. Don't put secrets in `app/js/config.js` (only the Supabase URL and anon key belong there).
- Don't let the `ai` function accept arbitrary prompts from the client.
- Don't add analytics or third-party scripts to the app without updating the privacy policy.
