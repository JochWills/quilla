-- Explicit Data API privileges, independent of the project's
-- "Automatically expose new tables" default (Project Settings → API → Security).
-- Row level security already restricts access per-row; these grants control
-- which roles can reach each table through the Data API at all.

-- records: signed-in advisors only, scoped to their own rows by the
-- policies in the init migration. Anonymous (signed-out) requests get nothing.
revoke all on public.records from anon;
grant select, insert, update, delete on public.records to authenticated;

-- ai_usage: written only by the `ai` edge function via the service role,
-- which bypasses grants and RLS entirely. Advisors get no access at all,
-- on top of the table already having RLS enabled with no policies.
revoke all on public.ai_usage from anon, authenticated;
