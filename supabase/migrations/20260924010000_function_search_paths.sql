-- Pin search_path on trigger functions (Supabase security advisor: function_search_path_mutable).
alter function public.forbid_record_version_update() set search_path = public;
alter function public.set_updated_at() set search_path = public;
