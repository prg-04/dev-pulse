-- Video lessons: incremental generation progress tracking (Fix: resumable lesson generation)
-- Adds columns to video_lessons so a long-running generation can be split across
-- multiple Vercel cron invocations without losing progress on timeout or quota exhaustion.

alter table video_lessons
  add column if not exists windows_total      integer not null default 0,
  add column if not exists next_window_index  integer not null default 0,
  add column if not exists generation_status  text not null default 'pending',
  add column if not exists generation_error   text;

-- Allowed statuses: pending | processing | completed | failed
create index if not exists idx_video_lessons_generation_status
  on video_lessons(generation_status);
