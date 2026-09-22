# Quilla

AI-drafted **Records of Advice (ROAs)** for South African financial advisors.

An advisor pastes their meeting notes or a transcript. Quilla drafts all 13 FAIS record sections using only what's in the notes, flags anything a compliance officer would query, and lets the advisor review, sign off and export a defensible record.

| Part | URL | Folder | Hosting |
|---|---|---|---|
| Marketing site | https://quilla.co.za | `landing/` | Render static site |
| Web app | https://app.quilla.co.za | `app/` | Render static site |
| Database + auth | Supabase | `supabase/migrations/` | Supabase |
| AI endpoint | Supabase Edge Function `ai` | `supabase/functions/ai/` | Supabase |

## Repo layout

```
quilla/
├── README.md            ← you are here
├── CLAUDE.md            ← instructions for Claude Code (read first when coding)
├── render.yaml          ← Render Blueprint: both static sites
├── landing/             ← quilla.co.za (plain HTML/CSS/JS, no build)
│   ├── index.html
│   ├── privacy.html     ← DRAFT, needs attorney review
│   ├── terms.html       ← DRAFT, needs attorney review
│   ├── 404.html, robots.txt, sitemap.xml
│   └── assets/          ← site.css, site.js, favicon.svg
├── app/                 ← app.quilla.co.za (plain ES modules, no build)
│   ├── index.html
│   ├── styles.css
│   ├── favicon.svg
│   └── js/
│       ├── config.js    ← Supabase URL + anon key (fill these in)
│       └── app.js       ← all app logic
├── supabase/
│   ├── config.toml
│   ├── migrations/      ← database schema + row level security
│   └── functions/ai/    ← server-side prompts + Anthropic API call
└── docs/
    ├── DEPLOYMENT.md    ← step-by-step: Render, DNS, Supabase, Anthropic
    ├── ARCHITECTURE.md  ← how the pieces fit together
    ├── PRODUCT.md       ← the ROA workflow and its rules
    └── ROADMAP.md       ← what's done, what's next, launch checklist
```

## Run locally

No build step. Any static server works:

```bash
# Landing page → http://localhost:5500
npx serve landing -l 5500

# App → http://localhost:5501
npx serve app -l 5501 -s      # -s = single-page app fallback to index.html
```

The app needs a Supabase project to sign in and draft (see `docs/DEPLOYMENT.md`). For local testing, add `http://localhost:5501` to Supabase Auth redirect URLs and to the `ALLOWED_ORIGINS` secret of the `ai` function.

## Deploy

See **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**.
