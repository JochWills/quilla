-- The `transcribe` edge function updates a meeting's transcript and status with the
-- service role. As with ai_usage, this project doesn't grant table access to
-- service_role by default, so grant exactly what the function needs.
grant select, update on public.meetings to service_role;
