-- Job summaries cache for AI-restructured postings (AGENTS §15 Feature 4)
-- Cached after first generation, never regenerated on subsequent views
create table if not exists job_summaries (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null unique references job_postings(id) on delete cascade,
  about_company text,
  the_role text,
  what_you_will_do text[],
  requirements text[],
  created_at timestamptz default now()
);
create index if not exists idx_job_summaries_job on job_summaries(job_id);
