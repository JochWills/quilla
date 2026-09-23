# Architecture

```
Browser (advisor)
   │
   ├── quilla.co.za ──────────── Render static site (landing/)
   │
   └── app.quilla.co.za ──────── Render static site (app/)
          │
          ├── Supabase Auth ─────── email/password sign-in, JWT session
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
    - `meta.practice` — practice name, stamped from the profile (and fixed at sign-off) for export branding
    - `signoff` {outcome, declared, override, signedAt, signedBy, version, sha256, sealedAt} (the last three mirror the current sealed version; empty while a draft)
    - `audit` [{at, text}]
- `profiles` — one row per advisor (`id` = `auth.users.id`, auto-created on sign-up by a trigger): `full_name`, `fsp_number`, `practice_name`. Edited on the Account screen; prefills `meta.adviser`/`meta.fsp` on new records.
- `record_versions` — one immutable row per sign-off: `record_id`, `version` (1, 2, …), `snapshot` (the full record `data` as signed), `sha256`, `signed_at`. A trigger sets `version`, `signed_at`, `user_id` and `sha256` (SHA-256 of `snapshot::text`) server-side; another rejects every UPDATE. Advisors can select and insert their own rows only; rows are removed only by cascade when the parent record is deleted. Reopening a signed record leaves its versions untouched, and the next sign-off becomes version N+1. Exports of a signed record are always generated from its sealed snapshot, never the editable row.
- `ai_usage` — one row per AI call (kind, model, tokens). Written and read (for rate limiting) by the `ai` function via the service role, which needs explicit table grants.

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

## Export
`app/js/export.js` renders a flattened "doc model" (built by `docModel()` in `app.js`) as PDF (pdfmake 0.2.12 from cdnjs, with SRI) or Word (docx 9.7.2 from jsDelivr); `.md` is built in `app.js`. Both libraries load lazily on the first export. Practice branding comes from `meta.practice`; sealed exports end with a "Record integrity" block showing the version and full SHA-256 fingerprint, and drafts carry a DRAFT watermark.
