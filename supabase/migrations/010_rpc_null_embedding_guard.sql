-- Ensure pgvector RPCs skip rows with null embeddings gracefully (embedding 429 case)
-- Existing WHERE already filters via `embedding <=> query < threshold` where NULL yields NULL (false),
-- but add explicit IS NOT NULL for clarity and to avoid any pgvector null-handling edge case

create or replace function match_tutorial_chapters(
  query_embedding vector(1536),
  match_threshold float,
  match_count int,
  video_ids text[]
)
returns table (
  id uuid,
  video_id text,
  start_seconds integer,
  label text,
  label_embedding vector(1536),
  indexed_at timestamptz,
  distance float
)
language sql stable
as $$
  select
    id,
    video_id,
    start_seconds,
    label,
    label_embedding,
    indexed_at,
    label_embedding <=> query_embedding as distance
  from tutorial_chapters
  where video_id = any(video_ids)
    and label_embedding is not null
    and label_embedding <=> query_embedding < match_threshold
  order by label_embedding <=> query_embedding
  limit match_count;
$$;

create or replace function match_tutorial_chunks(
  query_embedding vector(1536),
  match_threshold float,
  match_count int,
  p_skill_tag text
)
returns table (
  id uuid,
  video_id text,
  video_title text,
  channel_name text,
  view_count integer,
  published_at timestamptz,
  skill_tag text,
  start_seconds integer,
  chunk_text text,
  embedding vector(1536),
  indexed_at timestamptz,
  distance float
)
language sql stable
as $$
  select
    id,
    video_id,
    video_title,
    channel_name,
    view_count,
    published_at,
    skill_tag,
    start_seconds,
    chunk_text,
    embedding,
    indexed_at,
    embedding <=> query_embedding as distance
  from tutorial_chunks
  where skill_tag = p_skill_tag
    and embedding is not null
    and embedding <=> query_embedding < match_threshold
  order by embedding <=> query_embedding
  limit match_count;
$$;
