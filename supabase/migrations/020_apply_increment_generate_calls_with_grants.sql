-- Re-apply increment_generate_calls with service_role-only grants.
--
-- Migration 012 (supabase/migrations/012_atomic_generate_calls_rpc.sql) defined
-- this function, but a live-project probe on 2026-09-23 showed it was never
-- applied there: POST /rest/v1/rpc/increment_generate_calls returns PGRST202
-- ("Could not find the function ... in the schema cache"), while 016's
-- functions (reserve_youtube_units, enqueue_discovery_request) are present.
-- Every increment_generate_calls RPC call in the cron paths has therefore been
-- failing, which is also why ai_daily_usage has no rows for recent days.
--
-- This migration re-applies 012's insert logic with three additions per project
-- convention (016/017): security definer + search_path, input validation,
-- and a ::date cast on p_usage_date (012's text param mismatches the date
-- column and fails with 42804 — found via live probe on 2026-09-23).
-- It then locks execution down to service_role only, matching the grant
-- pattern from 016 (revoke from public/anon/authenticated, grant to service_role).

create or replace function public.increment_generate_calls(
  p_usage_date text,
  p_delta integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_usage_date is null or trim(p_usage_date) = '' then
    raise exception 'p_usage_date must be a non-empty string';
  end if;
  if p_delta is null or p_delta < 0 then
    raise exception 'p_delta must be a non-negative integer, got: %', p_delta;
  end if;

  insert into public.ai_daily_usage (usage_date, generate_calls, updated_at)
  values (p_usage_date::date, p_delta, now())
  on conflict (usage_date) do update
    set generate_calls = ai_daily_usage.generate_calls + p_delta,
        updated_at = now();
end;
$$;

revoke all on function public.increment_generate_calls(text, integer)
  from public, anon, authenticated;
grant execute on function public.increment_generate_calls(text, integer)
  to service_role;
