-- Guard tutorial_chunks.skill_tag against JSON/object corruption.
--
-- In Sep 2026 the weekly tutorial-indexer's ?skill= canary fallback indexed
-- raw strings verbatim, and manual canary runs with pasted Gap objects wrote
-- rows with skill_tag values like '{"skill":"aws","count":66}' (same incident
-- class as the skill_index_status corruption fixed in 015). The application
-- layer now validates the canary against the skill dictionary; this check
-- constraint is the database-level backstop so no future bypass can write a
-- non-text skill_tag again. Mirrors 015's skill_index_status_skill_text_check.
--
-- Note: tutorial_chapters has no skill_tag column (it is keyed by video_id
-- only and chapter lookup is restricted via tutorial_chunks), so no
-- equivalent constraint applies there.

alter table tutorial_chunks
  drop constraint if exists tutorial_chunks_skill_tag_text_check;

alter table tutorial_chunks
  add constraint tutorial_chunks_skill_tag_text_check
  check (
    skill_tag is not null
    and trim(skill_tag) <> ''
    and skill_tag !~ '^\s*[\{\[]'
  );
