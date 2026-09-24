-- Launch hardening.
-- 1. handle_new_user (auth trigger) and rls_auto_enable (event trigger) are SECURITY DEFINER
--    and were callable through /rest/v1/rpc. Triggers don't need EXECUTE for the caller, so
--    revoke it from the API roles.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

-- 2. FAIS: records of advice must be kept for at least five years. Advisors can't delete a
--    record that is signed off or has a sealed version (archive it instead). Deleting the
--    whole account (delete-account function, service role) still removes everything via the
--    auth.users cascade; that is the advisor's own decision, made after exporting.
drop policy if exists "records: delete own" on public.records;
create policy "records: delete own unsigned" on public.records
  for delete to authenticated
  using (
    auth.uid() = user_id
    and status <> 'signed'
    and not exists (select 1 from public.record_versions v where v.record_id = records.id)
  );
