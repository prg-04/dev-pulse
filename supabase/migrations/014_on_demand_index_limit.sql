-- on_demand_index_limit: track daily on-demand indexing calls
-- and enforce ON_DEMAND_INDEX_LIMIT to protect the shared AI quota pool.

-- 1. Add tracking column to ai_daily_usage.
alter table ai_daily_usage
  add column if not exists on_demand_index_calls integer not null default 0;

-- 2. Atomic increment RPC for on-demand index calls.
create or replace function public.increment_on_demand_index_calls(
  p_usage_date text,
  p_delta integer
)
returns void
language plpgsql
as $$
begin
  insert into public.ai_daily_usage (usage_date, on_demand_index_calls, updated_at)
  values (p_usage_date, p_delta, now())
  on conflict (usage_date) do update
    set on_demand_index_calls = ai_daily_usage.on_demand_index_calls + p_delta,
        updated_at = now();
end;
$$;
