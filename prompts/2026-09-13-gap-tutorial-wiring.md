# Implementation Prompt — Gap Report → YouTube Tutorial Wiring Fix

## Goal
Fix Gap Report page so YouTube tutorial videos are fetched and displayed based on the user's actual gap report. The indexer already prioritizes `gap_mentions_30d` weekly, but the UI shows `0 timestamps extracted` even when videos are indexed, and chapter-only videos are invisible to search. Close the display gap and the search blind spot without breaking quota or security boundaries.

## Skills Read
- `supabase` — Auth (`createClient`, `auth.getUser()`), RLS, server client via `@supabase/ssr` cookies
- `supabase-postgres-best-practices` — `pgvector` ivfflat, RPC `match_tutorial_chapters/chunks`, `ON CONFLICT` upserts, preserving existing RLS policies
- `vercel-react-best-practices` — client vs server components, `useEffect`/`useCallback` fetch patterns, no async in render
- `secure-coding` — no `NEXT_PUBLIC_` leakage, server-only keys, session validation before inserts
- `ai-sdk` — `embed` via Vercel AI Gateway (`AI_MODEL`), embeddings for both `tutorial_chapters.label_embedding` and `tutorial_chunks.embedding`

## Code Inspected
- `app/api/cron/tutorial-index/route.ts` (530 lines) — weekly cron, `WEEKLY_INDEX_BUDGET=40`, `indexSkill` chapters first then transcript, `gapCounts` Map, `skill_index_status` upsert, `CRON_SECRET` check
- `app/api/gap-report/route.ts` (198) — `normalizeSkills` lowercases only, inserts `user_skill_profiles` + `gap_report_events` for `gaps` (top skills not in user set), `BodySchema` allows any string
- `app/api/tutorial-search/route.ts` (160) — embeds skill, derives `videoIds` only from `tutorial_chunks` where `skill_tag=skill`, then RPCs `match_tutorial_chapters(video_ids)` + `match_tutorial_chunks(p_skill_tag)`, `DISTANCE_THRESHOLD=0.5`, merges capped at 5
- `components/gap-report/GapReportClient.tsx` (111) — passes `gaps` to `SkillsToConsiderCard`
- `components/gap-report/SkillsToConsiderCard.tsx` (113) — `active=gaps[0]` on mount, `fetchTutorials` only on `handleSkillSelect` click, no `useEffect`, shows empty state until click
- `app/(app)/gap-report/page.tsx` (167) — computes gaps server-side from `user_skills`/`user_skill_profiles` + `skill_demand_snapshots` but does NOT insert `gap_report_events`
- `lib/skills-dictionary.ts` (58) — `SKILLS_DICTIONARY`, `normalizeSkill`, `isKnownSkill`, 31 skills
- `supabase/migrations/003_vector_search_rpc.sql` — `match_tutorial_chapters(query_embedding, threshold, count, video_ids)` and `match_tutorial_chunks(query_embedding, threshold, count, p_skill_tag)`
- `supabase/migrations/001_initial_schema.sql`, `005_disable_rls_on_public_tables.sql` — RLS disabled on `tutorial_chapters/chunks/skill_index_status`, enabled on `gap_report_events`/`user_skill_profiles`
- `vercel.json` — `0 2 * * 0` weekly tutorial-index cron

## Decisions & Assumptions
- Do not change weekly cron schedule or `WEEKLY_INDEX_BUDGET`; fix is read-path and display, not ingestion volume. Quota headroom is protected by existing `MAX_VIDEOS_PER_SKILL=5` and `maxResults=10`.
- Prefer minimal on-demand gap indexing later; this slice only fixes determinism of search and eager UI fetch. A later slice can add fire-and-forget indexing for gaps with `last_indexed_at IS NULL` if Evans wants near-real-time.
- `app/(app)/gap-report/page.tsx` gap display stays insert-free to avoid duplicating events on refresh; only `POST /api/gap-report` is the source of truth for `gap_report_events`. This is documented rather than changed, unless Evans prefers page to also write.
- Skill normalization must collapse aliases (`k8s`→`kubernetes`, `nextjs`→`next.js`, `ts`→`typescript`) before insertion and before `gapCounts` lookup, so `Map` keys are canonical lowercases.
- Chapter-only videos must be searchable: do not restrict stage-1 to chunk-derived videoIds. Either query `tutorial_chapters` videoIds independently for this skill or call `match_tutorial_chapters` with videoIds derived from both `tutorial_chunks` (skill_tag) and `tutorial_chapters` that share same videoIds known to be indexed for that skill via `skill_index_status` + distinct videoIds table. Simplest: fetch distinct `tutorial_chapters.video_id` that belong to videos already indexed for this skill (via `tutorial_chunks` videoIds OR via a join on indexed videos). If no shared table, union chunk videoIds and chapter videoIds that were produced during `indexSkill` for that skill (chapter rows don't store skill_tag, but we can store mapping or fetch chapters whose video_id is in chunk videoIds plus any orphan chapter videoIds — easiest: query `tutorial_chapters` videoIds separately and union).
- `BodySchema` for tutorial-search should validate `skill` against dictionary (via `normalizeSkill` or `isKnownSkill`) and reject unknown with 400, per AGENTS §15 Feature 3 Zod validation.
- Keep existing `DISTANCE_THRESHOLD=0.5` and `match_count=20`, capped at 5 merged results, preferring chapters over chunks for same videoId.

## Files You Will Touch
1. `components/gap-report/SkillsToConsiderCard.tsx`
2. `app/api/tutorial-search/route.ts`
3. `app/api/gap-report/route.ts`
4. (Inspect only) `app/(app)/gap-report/page.tsx` — add comment explaining no-insert policy, or lightly add canonical normalization for display consistency; no DB write without approval.
5. `lib/skills-dictionary.ts` — no change expected, just import.

## Requirements
- `SkillsToConsiderCard.tsx`:
  - Add `useEffect` that calls `fetchTutorials(active)` on mount and whenever `gaps` or `active` changes, including first gap skill. Ensure not double-firing infinitely: dependency `[gaps, active, fetchTutorials]`, guard `if (!active) return`.
  - Handle `gaps` empty vs populated: if `gaps` changes length, reset `active` to new `gaps[0].skill` if current `active` no longer in list. Use `useEffect` to sync `active` when `gaps` prop changes.
  - Preserve existing click handler; eager fetch plus click both work.
  - Use `lib/skills-dictionary` normalize for display? Keep chip keys as canonical.

- `app/api/tutorial-search/route.ts`:
  - Validate `skill` canonical lower via `normalizeSkill`; if `null`, return 400 `{error: "Unknown skill"}`. This blocks probing non-dictionary terms.
  - Canonicalize skill before embed (`canonicalSkill`).
  - Fetch `videoIds` as union: `chunkVideoIds` from `tutorial_chunks where skill_tag=canonicalSkill` plus `chapterVideoIds` from `tutorial_chapters` where `video_id` is in that set OR where chapters were created for videos indexed under this skill. Simplest union: fetch both `tutorial_chunks.video_id` and `tutorial_chapters.video_id` separately where chapters' video_ids overlap with chunk videoIds for that skill — but to include chapter-only videos, we need to know which chapter videos belong to this skill. Since `tutorial_chapters` has no `skill_tag`, the intended link is: chapters are indexed per video during `indexSkill(skill)`, so a chapter row's video was indexed for that skill. We can infer by: `select distinct video_id from tutorial_chapters where video_id in (select video_id from tutorial_chunks where skill_tag=canonicalSkill)` covers the common case, plus include any `tutorial_chapters` rows whose video was indexed but chunks missing due to transcript failure — those videos are still in chunk videoIds if chunks were skipped? They would be missing. Better: store skill association for chapters or maintain separate lookup. Minimal fix: fetch all `tutorial_chapters.video_id` that are associated with this skill via `tutorial_chunks` videoIds, plus fetch all `tutorial_chapters` where video_id was most recently indexed under this skill by checking `tutorial_chapters` creation isn't skill-scoped so cannot union. Alternative minimal: call `match_tutorial_chapters` without `video_ids` restriction (search all chapters), or call it twice. Preferred by AGENTS: stage 1 restricted to videoIds already indexed under `skill_tag=skill` via `tutorial_chunks` — so the current restriction is spec-compliant but loses chapter-only. Minimal correct fix: also query `tutorial_chapters` for videos that have chapters but no chunks for this skill by maintaining a separate `skill_tag` mapping for chapters (add column or use a join table). For this slice, add a fallback: if `chapterVideoIds` derived from chunks is empty but `tutorial_chapters` has rows whose `video_id` appears in any chunk for that skill's most recent indexing, also search chapters with an empty restriction meaning search all chapters and filter post-hoc. Simpler: call `match_tutorial_chapters` with existing `videoIds`; if `videoIds` empty, skip stage 1 but still attempt stage 2. Document the chapter-only blind spot and log it; a follow-up migration can add `tutorial_chapters.skill_tag`.
  - Ensure merged result respects chapter preference: `chapterVideoIds` set excludes chunk results for same videoId (already done).
  - Embed call stays via `ai` gateway, no direct provider import. Handle `AI_MODEL` missing → return `{results:[]}` gracefully (already done).

- `app/api/gap-report/route.ts`:
  - Import `normalizeSkill`, `isKnownSkill`.
  - Replace `normalizeSkills` to collapse via `normalizeSkill`, discard unknown skills (or reject request if resulting list empty). Example: `skills.map(s=>normalizeSkill(s.trim())).filter(Boolean)`; if length 0, return 400.
  - Before computing `gaps`, ensure `top50` skill strings are also normalized canonical (they should already be, but call `normalizeSkill` fallback).
  - Insert `gap_report_events` with canonical lowercase `skill` (call `normalizeSkill(g.skill) ?? g.skill.toLowerCase()`), so `gapCounts` later matches.
  - Keep auth check before any write, keep persistence try/catch.

- `app/(app)/gap-report/page.tsx`:
  - Optionally normalize `yourSkills` via `normalizeSkill` before `skillSet` checks for display consistency. No new DB writes.

## Security Checks (must pass before marking complete)
- `grep -r "SERVICE_ROLE" app/` zero matches in components (service role only in `lib/supabase/service-role` used by cron routes).
- `grep -r "YOUTUBE_API_KEY\|RESEND_API_KEY\|GITHUB_TOKEN\|API_KEY_PEPPER\|AI_MODEL" app/components/` zero matches.
- `grep -r "googleapis.com/youtube" app/` only in `app/api/cron/tutorial-index`.
- `grep -r "@anthropic-ai/sdk\|openai\|resend\|octokit" app/components/` zero matches.
- Every profile-scoped route (`/api/gap-report`, `/api/tutorial-search` if it touches `gap_report_events`) calls `supabase.auth.getUser()` server-side and 401 on missing session (search is currently public — confirm if it should require session per AGENTS §3; currently it uses anon client and no auth — leave as is but note).
- No raw API key hashes logged.

## Acceptance Criteria
- On Gap Report page with live `skill_demand_snapshots` + indexed `tutorial_chunks/chapters`, selecting/clicking a gap skill shows up to 5 tutorial cards, chapter-anchored cards show chapter badge (e.g. "Ch 2: Control Plane"), chunk-only cards omit badge.
- Initial render of Gap Report (or after `Re-analyse`) automatically shows tutorials for the first gap skill without an extra user click — verified by loading page with `gaps.length>0` and seeing network `POST /api/tutorial-search` fire on mount.
- A video indexed with chapters but whose transcript fetch failed still appears in tutorial-search results via stage 1 (verify by manually inspecting a chapter-only video's rows in Supabase then calling `/api/tutorial-search` for its skill).
- `gap_report_events` rows inserted by `POST /api/gap-report` are canonical lowercases and `POST` rejects unknown skills with 400.
- Existing cron selection logic still respects `gap_mentions_30d` priority; this slice does not alter `WEEKLY_INDEX_BUDGET` behavior.

## Manual Test Steps
1. Seed `skill_demand_snapshots` for current month (or trigger ingest) and ensure `job_postings` non-zero.
2. Sign in via magic link; set `user_skills` to e.g. `react, tailwindcss`; submit Skills page with `k8s` alias to produce gap `kubernetes`.
3. Call `POST /api/gap-report` with `{"skills":["react"],"include_tutorials":true}` → inspect Supabase `gap_report_events` has row `skill=kubernetes` (canonical lower).
4. Ensure `tutorial_chunks`/`tutorial_chapters` have rows for `kubernetes` (run `curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/tutorial-index` if needed, or wait for weekly run). Also manually verify a chapter-only video exists (insert test row or mock indexer that skips transcript).
5. Visit `/gap-report` while signed in → Skills to consider panel should fire `POST /api/tutorial-search` automatically for first gap skill and render cards; click another gap chip should fetch its tutorials.
6. Check chapter badge: card from chapter-anchored hit shows `Ch 2: ...`, chunk-only card shows no badge. Player iframe expands at correct `start` second.

Verify that no API keys are exposed to the browser, and that every profile-scoped route validates the Supabase session or API key server-side, before marking complete.
