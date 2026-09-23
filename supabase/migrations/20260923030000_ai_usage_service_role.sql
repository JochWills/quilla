-- The `ai` edge function reads ai_usage (per-user hourly rate limit) and inserts
-- one row per call (token cost tracking) using the service role. RLS doesn't
-- apply to service_role, but table grants still do, and this project doesn't
-- grant them by default, so both the count and the insert were failing silently.
-- Advisors (anon/authenticated) still get no access.
grant select, insert on public.ai_usage to service_role;
grant usage, select on sequence public.ai_usage_id_seq to service_role;
