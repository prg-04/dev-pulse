-- RLS + handle_new_user per AGENTS.md §11 + supabase skill security checklist

alter table profiles enable row level security;
alter table user_skills enable row level security;
alter table user_skill_profiles enable row level security;
alter table saved_jobs enable row level security;
alter table alert_preferences enable row level security;
alter table gap_report_events enable row level security;
alter table api_keys enable row level security;

drop policy if exists "profiles_self_access" on profiles;
create policy "profiles_self_access" on profiles
  for all
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);
grant select, insert, update, delete on profiles to authenticated;

drop policy if exists "user_skills_self_access" on user_skills;
create policy "user_skills_self_access" on user_skills
  for all
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on user_skills to authenticated;

drop policy if exists "user_skill_profiles_self_access" on user_skill_profiles;
create policy "user_skill_profiles_self_access" on user_skill_profiles
  for all
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on user_skill_profiles to authenticated;

drop policy if exists "saved_jobs_self_access" on saved_jobs;
create policy "saved_jobs_self_access" on saved_jobs
  for all
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on saved_jobs to authenticated;

drop policy if exists "alert_preferences_self_access" on alert_preferences;
create policy "alert_preferences_self_access" on alert_preferences
  for all
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on alert_preferences to authenticated;

drop policy if exists "gap_report_events_self_access" on gap_report_events;
create policy "gap_report_events_self_access" on gap_report_events
  for all
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on gap_report_events to authenticated;

drop policy if exists "api_keys_self_access" on api_keys;
create policy "api_keys_self_access" on api_keys
  for all
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
grant select, insert, update, delete on api_keys to authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on profiles;
create trigger profiles_set_updated_at
  before update on profiles
  for each row execute function public.set_updated_at();

drop trigger if exists alert_preferences_set_updated_at on alert_preferences;
create trigger alert_preferences_set_updated_at
  before update on alert_preferences
  for each row execute function public.set_updated_at();
