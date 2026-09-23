-- Archive: advisors can put records away without deleting them (FAIS requires keeping records
-- of advice for at least five years). Archived records are hidden from the main list and shown
-- under the Archived tab. Existing owner-only RLS on records covers this column.
alter table public.records add column if not exists archived_at timestamptz;
create index if not exists records_user_archived_idx on public.records (user_id, archived_at);
