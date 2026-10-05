-- skill_index_status: support new statuses for on-demand tracking

-- 1. Drop the old check constraint (PostgreSQL requires recreate).
alter table skill_index_status
  drop constraint if exists skill_index_status_last_run_status_check;

-- 2. Recreate with the expanded allowed values.
alter table skill_index_status
  add constraint skill_index_status_last_run_status_check
  check (last_run_status in (
    'success',
    'failed',
    'skipped_no_results',
    'success_empty',
    'partial'
  ));

-- 3. The on_demand_requested_at column was intentionally dropped from this
--    migration: nothing writes it (its idempotency role lives in the
--    enqueue_discovery_request RPC cooldown), and no code selects it.
