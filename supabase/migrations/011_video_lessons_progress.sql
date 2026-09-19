-- Video lessons: incremental generation progress tracking (Fix: resumable lesson generation)
-- Adds columns to video_lessons so a long-running generation can be split across
-- multiple Vercel cron invocations without losing progress on timeout or quota exhaustion.

-- 1. Add columns nullable so existing rows are not affected yet.
alter table video_lessons
  add column if not exists windows_total      integer,
  add column if not exists next_window_index  integer,
  add column if not exists generation_status  text,
  add column if not exists generation_error   text;

-- 2. Backfill: any row that already has content was generated before this migration,
--    so mark it completed rather than pending. New rows will get the default below.
update video_lessons
   set generation_status = 'completed'
 where generation_status is null
   and (sections is not null and coalesce(array_length(sections, 1), 0) > 0);

-- 3. Set NOT NULL + default for all new rows going forward.
alter table video_lessons
  alter column windows_total     set not null,
  alter column windows_total     set default 0,
  alter column next_window_index set not null,
  alter column next_window_index set default 0,
  alter column generation_status set not null,
  alter column generation_status set default 'pending';

-- Allowed statuses: pending | processing | completed | failed
create index if not exists idx_video_lessons_generation_status
  on video_lessons(generation_status);
