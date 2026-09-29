-- The advisor's letterhead for PDF and Word exports, stored on their profile:
-- {logo (PNG/JPEG data URL, resized in the browser), logo_w, logo_h, address, phone, email,
--  website, reg_no, footer, accent}. Presentation only: it never feeds the AI and isn't part
-- of a sealed version's fingerprint. Size-capped so a profile stays small.
alter table public.profiles add column if not exists letterhead jsonb not null default '{}'::jsonb;
alter table public.profiles drop constraint if exists profiles_letterhead_size;
alter table public.profiles add constraint profiles_letterhead_size check (octet_length(letterhead::text) <= 400000);
