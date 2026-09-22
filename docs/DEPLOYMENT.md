# Deployment

Order matters: **Supabase → AI function → app config → GitHub → Render → DNS.**

## 1. Supabase (database, auth, AI endpoint)

1. Create a project at https://supabase.com.
   - **Region:** there's no South African region. Pick the closest one and record it in the privacy policy (POPIA section 72 covers cross-border transfers).
   - Save the database password somewhere safe.
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
   This runs `supabase/migrations/20260923000000_init.sql` (`records` + `ai_usage`, both with row level security).
4. **Auth settings** (Dashboard → Authentication):
   - URL Configuration → **Site URL:** `https://app.quilla.co.za`
   - **Redirect URLs:** `https://app.quilla.co.za/**` (add `http://localhost:5501/**` for local testing)
   - Providers → Email: enabled (magic links). Optionally turn off "Allow new users to sign up" during the pilot and invite advisors manually.
   - Emails: set up custom SMTP (e.g. Resend, Postmark) before real users. Supabase's built-in email is heavily rate-limited.
   - Customise the magic-link email template with the Quilla name.

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
- Sign in with your email; the magic link returns you to the app.
- Load the example meeting and draft it.
- Supabase → Table Editor → `records` shows your row; `ai_usage` shows the call.
