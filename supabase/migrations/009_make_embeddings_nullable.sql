-- Make embeddings nullable to decouple chunk persistence from embedding generation
-- Embedding is best-effort (quota 429); chunk_text persistence must not wait for it
-- Lesson generation uses chunk_text directly and does not need embeddings

alter table tutorial_chunks alter column embedding drop not null;
alter table tutorial_chapters alter column label_embedding drop not null;

-- Ensure existing RPCs skip null embeddings gracefully (WHERE embedding <=> query < threshold with NULL yields NULL, filtered out)
-- No change to RPC needed — NULL <=> vector is NULL, not an error
