-- Advisor profile: name, FSP number and practice name, stored once per
-- account and reused to prefill new records (previously retyped every time).

create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  full_name     text not null default '',
  fsp_number    text not null default '',
  practice_name text not null default '',
  updated_at    timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles: select own" on public.profiles
  for select using (auth.uid() = id);
create policy "profiles: insert own" on public.profiles
  for insert with check (auth.uid() = id);
create policy "profiles: update own" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- Auto-create a profile row for every new advisor account, whether they
-- signed up with a password or arrived via a first magic-link sign-in.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill for any account created before this migration existed.
insert into public.profiles (id)
select id from auth.users
on conflict (id) do nothing;

-- Explicit Data API privileges (see 20260923010000_data_api_grants.sql for why).
revoke all on public.profiles from anon;
grant select, insert, update on public.profiles to authenticated;
