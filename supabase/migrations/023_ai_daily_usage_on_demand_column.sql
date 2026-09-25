-- Add the on_demand_index_calls tracking column required by
-- increment_on_demand_index_calls (014 defined the function but the column
-- was never applied live either — 022's function fails with 42703 without
-- it). Idempotent: safe to run even if 014 is ever applied retroactively.

alter table ai_daily_usage
  add column if not exists on_demand_index_calls integer not null default 0;
