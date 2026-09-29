-- Quilla no longer records or transcribes meeting audio. Meetings hold the advisor's notes
-- and, optionally, a transcript file or pasted text. Removes the audio columns, the
-- `meeting-audio` bucket's access policies and the `transcribe` function's table access.
-- (No audio was ever stored.) ai_usage keeps 'transcribe' as an allowed kind for old rows.

revoke select, update on public.meetings from service_role;

drop policy if exists "meeting-audio: insert own" on storage.objects;
drop policy if exists "meeting-audio: select own" on storage.objects;
drop policy if exists "meeting-audio: delete own" on storage.objects;

update public.meetings set transcript_source = 'file' where transcript_source in ('recording', 'audio_upload');
alter table public.meetings drop constraint if exists meetings_transcript_source_check;
alter table public.meetings add constraint meetings_transcript_source_check check (transcript_source in ('', 'file', 'pasted'));

alter table public.meetings
  drop column if exists consent_recording,
  drop column if exists consent_at,
  drop column if exists audio_path,
  drop column if exists transcription_status,
  drop column if exists transcription_error,
  drop column if exists duration_seconds;
