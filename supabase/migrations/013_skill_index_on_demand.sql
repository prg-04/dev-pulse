-- skill_index_status: support new statuses and on-demand tracking

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

-- 3. Track when an on-demand indexing request was last fired for a skill.
--    Used for idempotency: if requested recently, skip duplicate triggers.
alter table skill_index_status
  add column if not exists on_demand_requested_at timestamptz;

create index if not exists idx_skill_index_on_demand
  on skill_index_status(on_demand_requested_at)
  where on_demand_requested_at is not null;
