-- Fix: disable RLS on tables that should be publicly readable
-- Per AGENTS.md §11, only user-scoped tables need RLS.
-- Global data tables (job_postings, skill_demand_snapshots, etc.) should not be blocked by RLS.

alter table if exists job_postings disable row level security;
alter table if exists skill_mentions disable row level security;
alter table if exists skill_demand_snapshots disable row level security;
alter table if exists ingestion_runs disable row level security;
alter table if exists github_sync_runs disable row level security;
alter table if exists alert_dispatch_log disable row level security;
alter table if exists skill_index_status disable row level security;
alter table if exists tutorial_chapters disable row level security;
alter table if exists tutorial_chunks disable row level security;
alter table if exists job_summaries disable row level security;
