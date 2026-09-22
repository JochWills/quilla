# Architecture

```
Browser (advisor)
   │
   ├── quilla.co.za ──────────── Render static site (landing/)
   │
   └── app.quilla.co.za ──────── Render static site (app/)
          │
          ├── Supabase Auth ─────── magic-link or email/password sign-in, JWT session
          ├── Supabase Postgres ─── tables `records`, `profiles` (RLS: own rows only)
          └── Supabase Edge Function `ai`
                 ├── verifies JWT, rate-limits (table `ai_usage`)
                 ├── builds prompt server-side (prompts.ts)
                 └── Anthropic Messages API (key stored as a Supabase secret)
```

## Data model
- `records` — one row per Record of Advice.
  - Columns for listing: `client_name`, `advice_area`, `meeting_date`, `status` (`notes` | `draft` | `signed`), `updated_at`.
  - `data` (jsonb): the full record state from `blank()` in `app/js/app.js`:
    - `meta` {client, ref, adviser, fsp, date, area}
    - `notes` (source meeting notes)
    - `summary`, `replacement` {is_replacement, existing_product}
    - `sections` {section_id: {content, original, status, evidence[], edited}}
    - `gaps` [{id, section_id, severity, issue, fix, state: open|addressed|na, note, source: ai|rule}]
    - `signoff` {outcome, declared, override, signedAt, signedBy}
    - `audit` [{at, text}]
- `profiles` — one row per advisor (`id` = `auth.users.id`, auto-created on sign-up by a trigger): `full_name`, `fsp_number`, `practice_name`. Edited on the Account screen; prefills `meta.adviser`/`meta.fsp` on new records.
- `ai_usage` — one row per AI call (kind, model, tokens). Service role only.

## AI endpoint contract
`POST {SUPABASE_URL}/functions/v1/ai` with `Authorization: Bearer <user JWT>`.

| kind | input | result |
|---|---|---|
| `draft` | `{notes, meta:{client, area, date}}` | `{summary, replacement, sections:[{id,status,content,evidence}], gaps:[...]}` |
| `recheck` | `{sections:{id: text}, resolved:[{section_id, issue, state, note}], replacement}` | `{gaps:[...]}` |
| `improve` | `{section_id, content, notes}` | `{content}` |

Errors: `{error: "unauthorized" | "rate_limited" | "bad_request" | "invalid_json" | "upstream_error"}`.

The client validates and normalises every AI response (`normalizeDraft`, `normGap`) and adds deterministic "rule" gaps for empty required sections, so a bad AI response can't silently skip required content.

## Security
- Row level security on `records`: select/insert/update/delete only where `auth.uid() = user_id`. Same pattern on `profiles`, keyed on `auth.uid() = id`.
- The Anthropic key never leaves Supabase secrets.
- The `ai` function only accepts the three known kinds and builds prompts itself, so it can't be abused as a general AI proxy.
- The function logs token counts only, never prompt or response text.
- Render sets `X-Frame-Options: DENY`, `nosniff` and a strict referrer policy.

## Known limitations (see ROADMAP.md)
- Signed records can be reopened by the advisor. There's no server-side immutability or versioning yet.
- No practice/team accounts; every advisor is a single user.
- Exports are HTML/Markdown, not PDF/DOCX.
