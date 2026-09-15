-- Video lessons: AI-synthesized lesson notes per video (Feature 5)
-- One row per video_id, shared across all users (same trust tier as tutorial_chunks/chapters)
-- Generated eagerly in weekly tutorial-index cron after chapters/chunks, cached thereafter
-- Verify that no API keys are exposed to the browser, and that every profile-scoped route validates the Supabase session or API key server-side, before marking complete.

create table if not exists video_lessons (
  video_id     text primary key,
  sections     jsonb not null, -- [{start_seconds: number, heading: string, key_points: string[], code_example?: string}]
  summary      text,
  generated_at timestamptz default now(),
  model        text not null -- AI_MODEL value that produced this, for future re-gen after provider swap
);

create index if not exists idx_video_lessons_generated_at on video_lessons(generated_at);

-- Enable RLS: authenticated users can read, only service_role can write
alter table video_lessons enable row level security;

drop policy if exists "video_lessons_authenticated_read" on video_lessons;
create policy "video_lessons_authenticated_read" on video_lessons
  for select using (auth.role() = 'authenticated');

-- No insert/update/delete policy for authenticated — writes only via service_role (bypasses RLS)
-- Revoking anon access is handled by RLS + no anon policy
