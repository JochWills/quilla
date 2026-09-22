-- Quilla initial schema
-- Records of Advice are private to the advisor who created them (row level security).

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------
-- records: one Record of Advice per row. The full working state
-- (notes, sections, flagged items, audit trail) lives in `data`.
-- A few fields are copied into columns for listing and searching.
-- ---------------------------------------------------------------
create table if not exists public.records (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  client_name  text not null default '',
  advice_area  text not null default '',
  meeting_date date,
  status       text not null default 'notes' check (status in ('notes','draft','signed')),
  data         jsonb not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists records_user_updated_idx on public.records (user_id, updated_at desc);

alter table public.records enable row level security;

create policy "records: select own" on public.records
  for select using (auth.uid() = user_id);
create policy "records: insert own" on public.records
  for insert with check (auth.uid() = user_id);
create policy "records: update own" on public.records
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "records: delete own" on public.records
  for delete using (auth.uid() = user_id);

create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists records_set_updated_at on public.records;
create trigger records_set_updated_at before update on public.records
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------
-- ai_usage: one row per AI call, written by the `ai` edge function
-- with the service role. Used for rate limiting and cost tracking.
-- No policies: advisors cannot read or write it directly.
-- ---------------------------------------------------------------
create table if not exists public.ai_usage (
  id            bigserial primary key,
  user_id       uuid not null references auth.users(id) on delete cascade,
  kind          text not null check (kind in ('draft','recheck','improve')),
  model         text,
  input_tokens  integer,
  output_tokens integer,
  created_at    timestamptz not null default now()
);

create index if not exists ai_usage_user_created_idx on public.ai_usage (user_id, created_at desc);

alter table public.ai_usage enable row level security;
