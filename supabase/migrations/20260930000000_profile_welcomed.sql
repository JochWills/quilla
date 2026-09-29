-- When the advisor dismissed the one-time "Welcome to Quilla" popup. Null → show it on their
-- next visit. Accounts that existed before the popup are marked as already welcomed.
alter table public.profiles add column if not exists welcomed_at timestamptz;
update public.profiles set welcomed_at = now() where welcomed_at is null;
