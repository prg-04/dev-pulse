-- Fix increment_on_demand_index_calls (from 014): text/date mismatch + grants.
--
-- Migration 014 defined this function with p_usage_date text while
-- ai_daily_usage.usage_date is a date column — the identical 42804 defect
-- found live in increment_generate_calls (012, fixed in 020). The function
-- was additionally never granted (no revoke/grant block in 014), and no
-- caller exists yet (the on-demand cap is currently unenforced), so this
-- corrects the body, validates inputs, and locks execution to service_role
-- following the 016/020 pattern, before any caller is wired up.

create or replace function public.increment_on_demand_index_calls(
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

  insert into public.ai_daily_usage (usage_date, on_demand_index_calls, updated_at)
  values (p_usage_date::date, p_delta, now())
  on conflict (usage_date) do update
    set on_demand_index_calls = ai_daily_usage.on_demand_index_calls + p_delta,
        updated_at = now();
end;
$$;

revoke all on function public.increment_on_demand_index_calls(text, integer)
  from public, anon, authenticated;
grant execute on function public.increment_on_demand_index_calls(text, integer)
  to service_role;
