-- DevPulse initial schema per AGENTS.md §11
-- Enable pgvector for tutorial embeddings
create extension if not exists "vector";
create extension if not exists "pgcrypto";

-- job_postings
create table if not exists job_postings (
  id uuid primary key default gen_random_uuid(),
  external_id text not null unique,
  source text not null check (source in ('hackernews','himalayas','remotejobs','remotive')),
  company text,
  title text,
  description text,
  comp_min integer,
  comp_max integer,
  comp_currency text default 'USD',
  liquidity_tier text,
  contractor_type text,
  location_text text,
  external_url text,
  posted_at timestamptz,
  ingested_at timestamptz default now()
);

-- skill_mentions
create table if not exists skill_mentions (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references job_postings(id) on delete cascade,
  skill text not null,
  month text not null,
  source text not null
);
create index if not exists idx_skill_mentions_skill_month on skill_mentions(skill, month);
create index if not exists idx_skill_mentions_job_id on skill_mentions(job_id);

-- skill_demand_snapshots
create table if not exists skill_demand_snapshots (
  id uuid primary key default gen_random_uuid(),
  skill text not null,
  month text not null,
  mention_count integer not null default 0,
  source text not null,
  unique(skill, month, source)
);
create index if not exists idx_skill_demand_month on skill_demand_snapshots(month);
create index if not exists idx_skill_demand_skill on skill_demand_snapshots(skill);

-- profiles (one row per auth.users)
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  location_text text,
  timezone text,
  github_username text,
  auto_git_sync boolean not null default false,
  target_role text,
  target_tier text,
  comp_floor integer,
  comp_ceiling integer,
  comp_currency text default 'USD',
  include_equity boolean default false,
  contractor_pref text,
  monitored_sources text[] not null default '{hackernews,himalayas,remotejobs,remotive}',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- user_skills
create table if not exists user_skills (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  skill text not null,
  years numeric,
  depth_tier text check (depth_tier in ('core','familiar','learning')),
  source text not null default 'manual' check (source in ('manual','github_sync')),
  updated_at timestamptz default now(),
  unique(user_id, skill)
);
create index if not exists idx_user_skills_user on user_skills(user_id);

-- user_skill_profiles (point-in-time snapshots)
create table if not exists user_skill_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  target_role text,
  skills text[] not null,
  created_at timestamptz default now()
);
create index if not exists idx_user_skill_profiles_user_created on user_skill_profiles(user_id, created_at desc);

-- saved_jobs
create table if not exists saved_jobs (
  user_id uuid not null references profiles(id) on delete cascade,
  job_id uuid not null references job_postings(id) on delete cascade,
  saved_at timestamptz default now(),
  primary key (user_id, job_id)
);

-- alert_preferences
create table if not exists alert_preferences (
  user_id uuid primary key references profiles(id) on delete cascade,
  instant_match_alert boolean not null default false,
  instant_match_threshold integer not null default 90,
  weekly_digest boolean not null default false,
  learning_gap_dispatch boolean not null default false,
  delivery_method text not null default 'email' check (delivery_method in ('email','webhook')),
  webhook_url text,
  updated_at timestamptz default now()
);

-- alert_dispatch_log
create table if not exists alert_dispatch_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  alert_type text not null check (alert_type in ('instant_match','weekly_digest','learning_gap')),
  reference_id text,
  sent_at timestamptz default now(),
  status text not null check (status in ('sent','failed')),
  error text
);
create index if not exists idx_alert_dispatch_log_user_type_sent on alert_dispatch_log(user_id, alert_type, sent_at desc);

-- api_keys (only hash stored)
create table if not exists api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  key_prefix text not null,
  key_hash text not null,
  created_at timestamptz default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index if not exists idx_api_keys_prefix on api_keys(key_prefix);
create index if not exists idx_api_keys_hash on api_keys(key_hash);

-- github_sync_runs
create table if not exists github_sync_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  github_username text not null,
  started_at timestamptz default now(),
  completed_at timestamptz,
  status text check (status in ('success','failed','skipped_no_username','skipped_sync_off')),
  skills_upserted integer default 0,
  error text
);
create index if not exists idx_github_sync_runs_user_started on github_sync_runs(user_id, started_at desc);

-- ingestion_runs
create table if not exists ingestion_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz default now(),
  completed_at timestamptz,
  status text check (status in ('running','success','failed')),
  jobs_ingested integer default 0,
  error text
);

-- gap_report_events
create table if not exists gap_report_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade,
  skill text not null,
  created_at timestamptz default now()
);
create index if not exists idx_gap_report_events_skill_created on gap_report_events(skill, created_at);
create index if not exists idx_gap_report_events_user_created on gap_report_events(user_id, created_at desc);

-- skill_index_status
create table if not exists skill_index_status (
  skill text primary key,
  last_indexed_at timestamptz,
  gap_mentions_30d integer not null default 0,
  total_chunks integer not null default 0,
  total_chapters integer not null default 0,
  last_run_status text check (last_run_status in ('success','failed','skipped_no_results')),
  last_error text
);

-- tutorial_chapters
create table if not exists tutorial_chapters (
  id uuid primary key default gen_random_uuid(),
  video_id text not null,
  start_seconds integer not null,
  label text not null,
  label_embedding vector(1536) not null,
  indexed_at timestamptz default now(),
  unique(video_id, start_seconds)
);
create index if not exists idx_tutorial_chapters_video on tutorial_chapters(video_id);
create index if not exists idx_tutorial_chapters_embedding on tutorial_chapters using ivfflat (label_embedding vector_cosine_ops) with (lists = 100);

-- tutorial_chunks
create table if not exists tutorial_chunks (
  id uuid primary key default gen_random_uuid(),
  video_id text not null,
  video_title text not null,
  channel_name text not null,
  view_count integer,
  published_at timestamptz,
  skill_tag text not null,
  start_seconds integer not null,
  chunk_text text not null,
  embedding vector(1536) not null,
  indexed_at timestamptz default now(),
  unique(video_id, start_seconds, skill_tag)
);
create index if not exists idx_tutorial_chunks_skill on tutorial_chunks(skill_tag);
create index if not exists idx_tutorial_chunks_video on tutorial_chunks(video_id);
create index if not exists idx_tutorial_chunks_embedding on tutorial_chunks using ivfflat (embedding vector_cosine_ops) with (lists = 100);
