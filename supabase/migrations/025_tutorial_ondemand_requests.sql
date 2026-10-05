-- 025_tutorial_ondemand_requests.sql
-- Records the live state of tutorial_ondemand_requests (created outside the
-- migration chain; no earlier migration file defines it).
--
-- Live-confirmed 2026-09-27 (information_schema + pg_class): columns id /
-- user_id / skill / created_at, all not null; id default gen_random_uuid(),
-- created_at default now(); index idx_tutorial_ondemand_requests_user_time on
-- (user_id, created_at desc); FK user_id -> profiles(id) on delete cascade;
-- RLS enabled (relrowsecurity=true, force=false), no policies (writes are
-- service-role-only, matching the 016/017/021 pattern).

create table if not exists public.tutorial_ondemand_requests (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  skill      text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_tutorial_ondemand_requests_user_time
  on public.tutorial_ondemand_requests (user_id, created_at desc);

alter table public.tutorial_ondemand_requests enable row level security;
-- No policies: anon and authenticated have no access; service_role bypasses
-- RLS. The on-demand route calls this table exclusively via the service-role
-- client after validating the user session at the route boundary.
