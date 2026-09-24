-- Sign-up now asks for full name and FSP number. They arrive as user metadata on
-- auth.users (the account usually has no session until the email is confirmed), so the
-- new-user trigger copies them into the profile. Trimmed and length-limited; the FSP number
-- keeps digits only. Privileges from the launch-hardening migration are kept by
-- CREATE OR REPLACE.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
  insert into public.profiles (id, full_name, fsp_number)
  values (
    new.id,
    left(btrim(coalesce(meta->>'full_name', '')), 120),
    left(regexp_replace(coalesce(meta->>'fsp_number', ''), '\D', '', 'g'), 20)
  )
  on conflict (id) do nothing;
  return new;
end $$;
