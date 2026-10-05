-- 026_job_summaries_rls.sql
-- Records the live RLS state of job_summaries, which contradicts migration
-- 005 (that file disables RLS on this table; live pg_class shows
-- relrowsecurity=true, force=false). No earlier migration file enables it,
-- so this file pins the confirmed state: RLS on, one authenticated-select
-- policy, no write policies (cache writes are service-role-only).

alter table public.job_summaries enable row level security;

drop policy if exists "job_summaries_select_authenticated" on public.job_summaries;
create policy "job_summaries_select_authenticated"
  on public.job_summaries
  for select to authenticated using (true);

-- No insert/update/delete policies: authenticated writes are denied (42501,
-- verified live); service_role bypasses RLS. The job summary route reads via
-- the caller session and performs cache insert/delete via the service-role
-- client for exactly this reason.
