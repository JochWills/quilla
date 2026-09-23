# Deployment

Order matters: **Supabase → AI function → app config → GitHub → Render → DNS.**

## 1. Supabase (database, auth, AI endpoint)

1. Create a project at https://supabase.com.
   - **Region:** there's no South African region. Pick the closest one and record it in the privacy policy (POPIA section 72 covers cross-border transfers).
   - Save the database password somewhere safe.
   - **Security checkboxes** (Data API section): leave **Enable Data API** on — the app talks to `records` straight from the browser via `supabase-js`. **Automatically expose new tables** and **Enable automatic RLS** can be left at Supabase's defaults either way; `supabase/migrations/20260923010000_data_api_grants.sql` grants/revokes Data API access to `records` and `ai_usage` explicitly, so the app's access doesn't depend on that project-level toggle.
2. Install the CLI and link the repo:
   ```bash
   npm i -g supabase
   supabase login
   supabase link --project-ref <your-project-ref>
   ```
3. Create the tables and security rules:
   ```bash
   supabase db push
   ```
   This runs the migrations in `supabase/migrations/` (`records` + `ai_usage`, `profiles`, and the explicit Data API grants), all with row level security.
4. **Auth settings** (Dashboard → Authentication):
   - URL Configuration → **Site URL:** `https://app.quilla.co.za`
   - **Redirect URLs:** `https://app.quilla.co.za/**` (add `http://localhost:5501/**` for local testing) — used by sign-up confirmation links and password reset links.
   - Providers → Email: enabled, password sign-in. **Confirm email** on means new sign-ups must click a confirmation link before they can sign in (recommended); off means they're signed in immediately. Optionally turn off "Allow new users to sign up" during the pilot and invite advisors manually.
   - Emails: set up custom SMTP before real users — Supabase's built-in email is heavily rate-limited (a handful an hour) and sends from Supabase's own address, not yours.
     - **Resend** (free tier: 3,000 emails/month, 100/day — plenty for a pilot) is the easiest way to send as `noreply@quilla.co.za` without running a mailbox:
       1. Sign up at https://resend.com, add domain `quilla.co.za` (Domains → Add Domain).
       2. Resend gives you 3–4 DNS records (SPF `TXT`, DKIM `TXT`, and usually a `MX`/`TXT` for the `resend` subdomain used for bounce tracking). Add them at your `.co.za` registrar's DNS, same place as the Render records from step 6. No mailbox is needed — `noreply@` only sends, it never has to receive.
       3. Wait for Resend to show the domain as **Verified** (DNS propagation, usually minutes to a few hours).
       4. Create an API key (Resend → API Keys).
       5. Supabase Dashboard → Authentication → Emails → SMTP Settings → enable custom SMTP:
          - Host: `smtp.resend.com`, Port: `465`, Username: `resend`, Password: `<the API key>`
          - Sender email: `noreply@quilla.co.za`, Sender name: `Quilla`
     - Customise the **Confirm signup** and **Reset password** email templates (Authentication → Emails → Templates) with the Quilla name/wording.

## 2. The `ai` edge function (Anthropic)

1. Create an API key at https://platform.claude.com (Claude Developer Platform) and add prepaid credits.
2. Set secrets and deploy:
   ```bash
   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
   supabase secrets set ALLOWED_ORIGINS=https://app.quilla.co.za,http://localhost:5501
   # optional:
   supabase secrets set ANTHROPIC_MODEL=claude-sonnet-5
   supabase secrets set AI_HOURLY_LIMIT=40
   supabase functions deploy ai
   ```
3. Set a monthly spend limit in the Anthropic console.

## 2b. The `transcribe` edge function (Deepgram)

Optional: without it, Meetings still accept transcript files and pasted text.

1. Create an API key at https://console.deepgram.com.
2. Set secrets and deploy:
   ```bash
   supabase secrets set DEEPGRAM_API_KEY=...
   # optional:
   supabase secrets set TRANSCRIBE_HOURLY_LIMIT=10
   supabase functions deploy transcribe
   ```
3. Before recording real clients: add Deepgram to the privacy policy as a sub-processor (cross-border processing under POPIA) and confirm your consent wording.

## 3. App config

Edit `app/js/config.js` with values from Supabase → Project Settings → API:
```js
export const SUPABASE_URL = "https://<project-ref>.supabase.co";
export const SUPABASE_ANON_KEY = "<anon / publishable key>";
```
The anon key is meant to be public; security comes from row level security. **Never** put the service role key or the Anthropic key in this file.

## 4. GitHub

```bash
git init
git add .
git commit -m "Quilla: landing, app, Supabase schema and AI function"
git branch -M main
git remote add origin https://github.com/<you>/quilla.git
git push -u origin main
```

## 5. Render

You already have a static site on `quilla.co.za`. Two options:

### Option A — Blueprint (recommended, everything in `render.yaml`)
1. **Remove `quilla.co.za` from your existing static site first** (Settings → Custom Domains), otherwise the Blueprint can't claim it. Then delete or suspend that old site.
2. Render Dashboard → **New → Blueprint** → pick the GitHub repo → Render reads `render.yaml` and creates:
   - `quilla-landing` publishing `./landing` on `quilla.co.za` (Render adds `www.quilla.co.za` → redirect automatically)
   - `quilla-app` publishing `./app` on `app.quilla.co.za`, with a rewrite of `/*` to `/index.html`
3. Click **Apply**.

### Option B — Manual (keep your existing site)
1. **Existing site → Settings:**
   - Repository: this repo, branch `main`
   - Build Command: `echo "No build step"`
   - Publish Directory: `landing`
   - Custom domains: `quilla.co.za` (keep)
2. **New → Static Site** from the same repo:
   - Name: `quilla-app`
   - Build Command: `echo "No build step"`
   - Publish Directory: `app`
   - Redirects/Rewrites: Source `/*`, Destination `/index.html`, Action **Rewrite**
   - Custom domain: `app.quilla.co.za`
3. Optional: Settings → Build Filters so each site only rebuilds when its folder changes (`landing/**`, `app/**`).

## 6. DNS (at your .co.za registrar)

Render shows the exact values under each service's Custom Domains. Typically:

| Host | Type | Value |
|---|---|---|
| `@` (quilla.co.za) | A | `216.24.57.1` |
| `www` | CNAME | `quilla-landing.onrender.com` (your landing site's Render subdomain) |
| `app` | CNAME | `quilla-app.onrender.com` (your app site's Render subdomain) |

- Remove any **AAAA** records for these names (Render is IPv4 only).
- Remove conflicting old A/CNAME/redirect records.
- Click **Verify** in Render. HTTPS certificates are issued automatically once DNS resolves.

## 7. Smoke test after deploy
- https://quilla.co.za loads; "Get started" goes to https://app.quilla.co.za.
- Create an account with email + password; confirm (if required) and sign in.
- Sign out, then sign back in both ways: password, and "Email me a link instead".
- Forgot password → reset link → set a new password → lands back in the app.
- Account screen: save a name/FSP number/practice name, then start a new record and confirm the advisor/FSP fields are prefilled.
- Load the example meeting and draft it.
- Supabase → Table Editor → `records` shows your row; `profiles` shows your details; `ai_usage` shows the AI call.
