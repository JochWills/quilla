-- Clients, meetings (with recording + transcription) and per-advisor section templates.
-- Same model as records: every row belongs to one advisor and row level security
-- keeps it private to them. No ID numbers are collected anywhere (POPIA minimisation).

-- ---------------------------------------------------------------
-- clients
-- ---------------------------------------------------------------
create table if not exists public.clients (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 200),
  reference   text not null default '',
  email       text not null default '',
  phone       text not null default '',
  notes       text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists clients_user_name_idx on public.clients (user_id, name);
alter table public.clients enable row level security;
create policy "clients: select own" on public.clients for select using (auth.uid() = user_id);
create policy "clients: insert own" on public.clients for insert with check (auth.uid() = user_id);
create policy "clients: update own" on public.clients for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "clients: delete own" on public.clients for delete using (auth.uid() = user_id);
drop trigger if exists clients_set_updated_at on public.clients;
create trigger clients_set_updated_at before update on public.clients
  for each row execute function public.set_updated_at();
revoke all on public.clients from anon;
grant select, insert, update, delete on public.clients to authenticated;

-- Link records to a client. Deleting a client keeps its records (unlinked).
alter table public.records add column if not exists client_id uuid references public.clients(id) on delete set null;
create index if not exists records_client_idx on public.records (client_id);

-- An advisor may only link their own records to their own clients.
create or replace function public.owns_client(cid uuid) returns boolean
language sql stable security invoker set search_path = public as $$
  select cid is null or exists (select 1 from public.clients c where c.id = cid and c.user_id = auth.uid())
$$;
drop policy if exists "records: insert own" on public.records;
drop policy if exists "records: update own" on public.records;
create policy "records: insert own" on public.records
  for insert with check (auth.uid() = user_id and public.owns_client(client_id));
create policy "records: update own" on public.records
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id and public.owns_client(client_id));

-- ---------------------------------------------------------------
-- meetings
-- Audio is uploaded to the private `meeting-audio` bucket, transcribed by the
-- `transcribe` edge function, then deleted; only the text transcript is kept.
-- ---------------------------------------------------------------
create table if not exists public.meetings (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null default auth.uid() references auth.users(id) on delete cascade,
  client_id             uuid references public.clients(id) on delete set null,
  record_id             uuid references public.records(id) on delete set null,
  title                 text not null default '',
  meeting_date          date not null default current_date,
  kind                  text not null default 'in_person' check (kind in ('in_person','video','phone')),
  attendees             text not null default '',
  consent_recording     boolean not null default false,
  consent_at            timestamptz,
  notes                 text not null default '',
  transcript            text not null default '',
  transcript_source     text not null default '' check (transcript_source in ('','recording','audio_upload','file','pasted')),
  audio_path            text,
  transcription_status  text not null default 'none' check (transcription_status in ('none','uploaded','processing','done','failed')),
  transcription_error   text,
  duration_seconds      integer,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists meetings_user_date_idx on public.meetings (user_id, meeting_date desc);
create index if not exists meetings_client_idx on public.meetings (client_id);
alter table public.meetings enable row level security;
create policy "meetings: select own" on public.meetings for select using (auth.uid() = user_id);
create policy "meetings: insert own" on public.meetings for insert with check (auth.uid() = user_id and public.owns_client(client_id));
create policy "meetings: update own" on public.meetings for update using (auth.uid() = user_id) with check (auth.uid() = user_id and public.owns_client(client_id));
create policy "meetings: delete own" on public.meetings for delete using (auth.uid() = user_id);
drop trigger if exists meetings_set_updated_at on public.meetings;
create trigger meetings_set_updated_at before update on public.meetings
  for each row execute function public.set_updated_at();
revoke all on public.meetings from anon;
grant select, insert, update, delete on public.meetings to authenticated;

-- ---------------------------------------------------------------
-- Templates: per-section guidance for the AI and standard wording, stored on the
-- advisor's profile as {section_id: {guidance, standard}}. Size-capped.
-- ---------------------------------------------------------------
alter table public.profiles add column if not exists template jsonb not null default '{}'::jsonb;
alter table public.profiles drop constraint if exists profiles_template_size;
alter table public.profiles add constraint profiles_template_size check (octet_length(template::text) <= 60000);

-- ---------------------------------------------------------------
-- ai_usage also records transcription calls (for per-user rate limiting and cost).
-- For kind 'transcribe', input_tokens holds the audio duration in seconds.
-- ---------------------------------------------------------------
alter table public.ai_usage drop constraint if exists ai_usage_kind_check;
alter table public.ai_usage add constraint ai_usage_kind_check check (kind in ('draft','recheck','improve','transcribe'));

-- ---------------------------------------------------------------
-- Private audio bucket. Objects live under "<user id>/<meeting id>/...".
-- 50 MB matches the Supabase free-plan upload limit (~3 hours of the app's own recordings).
-- ---------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('meeting-audio', 'meeting-audio', false, 52428800,
        array['audio/webm','audio/ogg','audio/mpeg','audio/mp3','audio/mp4','audio/x-m4a','audio/m4a','audio/aac','audio/wav','audio/x-wav','audio/flac','video/webm'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "meeting-audio: insert own" on storage.objects;
drop policy if exists "meeting-audio: select own" on storage.objects;
drop policy if exists "meeting-audio: delete own" on storage.objects;
create policy "meeting-audio: insert own" on storage.objects for insert to authenticated
  with check (bucket_id = 'meeting-audio' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "meeting-audio: select own" on storage.objects for select to authenticated
  using (bucket_id = 'meeting-audio' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "meeting-audio: delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'meeting-audio' and (storage.foldername(name))[1] = auth.uid()::text);
