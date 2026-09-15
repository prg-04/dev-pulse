-- Daily AI quota guard for free-tier limits (Fix 2, option 1)
-- 20/day generate_content, 100/min embed — persisted so retries don't burn quota invisibly.

create table if not exists ai_daily_usage (
  usage_date date primary key,
  generate_calls integer not null default 0,
  embed_calls integer not null default 0,
  updated_at timestamptz default now()
);

-- No RLS needed — only service_role writes/reads; anon has no access.
alter table ai_daily_usage enable row level security;
-- service_role bypasses RLS, no policies needed for anon.
