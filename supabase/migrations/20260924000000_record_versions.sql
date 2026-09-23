-- Signed-record integrity.
-- Every sign-off seals an immutable snapshot of the record as a new version.
-- Reopening a signed record never changes a sealed version: signing again
-- creates version N+1. The database, not the browser, decides the version
-- number, the sealing time, the owner and the SHA-256 fingerprint, and no
-- role can update a sealed row. Advisors can't delete versions directly;
-- they go only when the whole record is deleted (foreign key cascade).

create table if not exists public.record_versions (
  id         uuid primary key default gen_random_uuid(),
  record_id  uuid not null references public.records(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  version    integer not null,
  snapshot   jsonb not null,
  sha256     text not null,
  signed_at  timestamptz not null default now(),
  unique (record_id, version)
);

create index if not exists record_versions_record_idx on public.record_versions (record_id, version desc);

alter table public.record_versions enable row level security;

create policy "record_versions: select own" on public.record_versions
  for select using (auth.uid() = user_id);
-- Only for records the advisor owns. No update or delete policies: sealed rows are read-only.
create policy "record_versions: insert own" on public.record_versions
  for insert with check (
    auth.uid() = user_id
    and exists (select 1 from public.records r where r.id = record_id and r.user_id = auth.uid())
  );

-- Server-assigned fields. Anything the client sends for these is overwritten.
-- The fingerprint is SHA-256 over the snapshot's canonical jsonb text (Postgres
-- normalises key order and whitespace), so it can be recomputed from the row.
create or replace function public.seal_record_version() returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.user_id   := auth.uid();
  new.signed_at := now();
  -- Serialise concurrent sign-offs of the same record so version numbers can't collide.
  perform pg_advisory_xact_lock(hashtext(new.record_id::text));
  select coalesce(max(version), 0) + 1 into new.version
    from public.record_versions where record_id = new.record_id;
  new.sha256    := encode(sha256(convert_to(new.snapshot::text, 'UTF8')), 'hex');
  return new;
end $$;

drop trigger if exists record_versions_seal on public.record_versions;
create trigger record_versions_seal before insert on public.record_versions
  for each row execute function public.seal_record_version();

-- Belt and braces: even roles that bypass RLS (service role, dashboard) can't edit a sealed version.
create or replace function public.forbid_record_version_update() returns trigger
language plpgsql as $$
begin
  raise exception 'Sealed record versions cannot be changed';
end $$;

drop trigger if exists record_versions_immutable on public.record_versions;
create trigger record_versions_immutable before update on public.record_versions
  for each row execute function public.forbid_record_version_update();

-- Data API access: signed-in advisors can read and create their own versions, nothing else.
revoke all on public.record_versions from anon, authenticated;
grant select, insert on public.record_versions to authenticated;
