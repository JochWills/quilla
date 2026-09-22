# CLAUDE.md — working on Quilla

Read this before changing code. Then read `docs/ARCHITECTURE.md` and `docs/PRODUCT.md`.

## What Quilla is
A web app that drafts FAIS **Records of Advice (ROAs)** for South African financial advisors from their own meeting notes, flags compliance gaps, and produces a signed, exportable record with an audit trail. Target users: independent advisors and small practices in South Africa. Owner: Josh (solo founder, React/JS developer).

## Non-negotiable product rules
1. **Quilla documents advice. It never gives advice.** No prompt or feature may recommend products, judge suitability, or suggest what the advisor should have advised.
2. **Never invent facts.** Drafts use only what's in the advisor's notes. Missing information is marked "not captured" and flagged, never filled in. "Improve with AI" may reword, never add facts.
3. **The advisor signs off.** Nothing is final until the advisor signs. Signing with open critical items requires a written reason, which is logged.
4. **Everything is audited.** Drafting, edits, AI rewrites, resolved/reopened items, sign-off and exports are appended to `record.audit`. Never delete or rewrite audit entries.
5. **Client data is sensitive (POPIA).** Never log prompt or response content. Never send data to third parties other than the AI provider. Don't ask for or store ID numbers.
6. **Honest marketing.** No fake testimonials, no customer logos or "trusted by" claims without written permission, no invented statistics. Unbuilt features are labelled "Soon".

## Architecture in one paragraph
Two static sites on Render (`landing/` → quilla.co.za, `app/` → app.quilla.co.za). The app uses Supabase for magic-link auth and a `records` table protected by row level security (each advisor sees only their own rows). All AI calls go to the Supabase Edge Function `supabase/functions/ai`, which checks the user's JWT, rate-limits per user, builds the prompt **server-side** (`prompts.ts`), calls the Anthropic Messages API, logs token usage to `ai_usage`, and returns parsed JSON. The Anthropic key exists only as a Supabase secret.

## Code conventions
- **No build step** right now: plain HTML, CSS and ES modules. `app/js/app.js` imports `@supabase/supabase-js` from jsDelivr. If you introduce a bundler (e.g. Vite), update `render.yaml` (`buildCommand`, `staticPublishPath`) and `docs/DEPLOYMENT.md` in the same change.
- Vanilla JS, render-by-template-string, `esc()` on **every** interpolated user value to prevent XSS.
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
- Change AI behaviour → edit `supabase/functions/ai/prompts.ts`, then `supabase functions deploy ai`. Test on the Sarah Williams example meeting (Source notes → "Load an example meeting").
- Change the schema → add a new file in `supabase/migrations/` (never edit an applied migration), then `supabase db push`.
- Change landing copy → `landing/index.html`. Push to `main`; Render redeploys only the site whose folder changed (`buildFilter`).

## Testing checklist before shipping app changes
- Sign in with a magic link; sign out.
- New record → Load example → Draft → 13 sections + flagged items appear.
- Improve with AI on one section → Undo works.
- Resolve an item, Check again → resolved item stays resolved.
- Sign-off is blocked until declaration, outcome, advisor name and FSP number are filled; critical items require a reason.
- Export .html and .md.
- Records list shows the record; reload the page and reopen it.
- A second test account cannot see the first account's records.

## Don'ts
- Don't call the Anthropic API from the browser. Don't put secrets in `app/js/config.js` (only the Supabase URL and anon key belong there).
- Don't let the `ai` function accept arbitrary prompts from the client.
- Don't add analytics or third-party scripts to the app without updating the privacy policy.
