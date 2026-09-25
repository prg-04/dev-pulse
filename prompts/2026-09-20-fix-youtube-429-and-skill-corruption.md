# Implementation Prompt: Fix YouTube 429 Handling and skill_index_status Corruption

## Goal

1. **Fix 500 errors on `/api/cron/tutorial-index/ondemand` when YouTube returns 429**
   - Currently, YouTube rate-limit errors propagate up and cause the endpoint to return 500
   - A 429 from YouTube is an expected transient failure, not a server error
   - The `skill_index_status` row is already upserted with `on_demand_requested_at` before the YouTube call, so even failed runs should update status cleanly

2. **Fix data corruption in `skill_index_status` where `skill` column contains JSON objects**
   - Some rows have `skill` values that are JSON arrays/objects instead of plain text skill names
   - This breaks the primary key and all lookups by skill

## Skills Read

- Next.js App Router (project AGENTS.md, Section 2, 8, 18)
- Supabase Postgres best practices
- YouTube Data API v3 rate limits (Section 10, 17)

## Code Inspected

- `app/api/cron/tutorial-index/ondemand/route.ts` — the user-triggered on-demand endpoint
- `app/api/cron/tutorial-index/ondemand.ts` — the core `indexSkillOnDemand` function and `searchYouTubeVideos`

## Key Findings

### 429 → 500 Bug

In `ondemand.ts`:
- Line 247-255: `skill_index_status` is upserted with `on_demand_requested_at` **before** YouTube search
- Line 258: `searchYouTubeVideos` throws on any non-ok HTTP response (line 120-122)
- Line 121: `throw new Error(\`YouTube search failed: ${searchRes.status}\`)`
- When YouTube returns 429, the error propagates up through `indexSkillOnDemand` uncaught
- The route catch block (line 90-96) catches it and returns 500
- Result: user sees 500, and `skill_index_status` has `on_demand_requested_at` set but no `last_run_status`

### Data Corruption

Some `skill_index_status` rows have `skill` column containing JSON (e.g., `["aws","react"]` or `{"skill":"aws"}`) instead of plain text like `"aws"`. This suggests a prior upsert or migration passed an array/object where a string was expected.

## Decisions and Assumptions

- **YouTube 429 handling**: Add retry with exponential backoff for `searchYouTubeVideos`. If retries exhaust, catch the error in `indexSkillOnDemand`, update `skill_index_status` with `last_run_status: "failed"` and `last_error`, and return `status: "failed"` instead of throwing. The route will then return 200 with the failure details, not 500.
- **Retry policy**: 3 attempts for `searchYouTubeVideos`, with delays of 2s, 4s, 8s. Only retry on 429 and 5xx. Do not retry on 400/403.
- **Data corruption fix**: Write a one-off SQL migration (or Supabase SQL editor statement) that identifies rows where `skill` is not valid plain text and either fixes or deletes them. Also add a check constraint to prevent future corruption.
- **Daily cap increment**: Only increment `on_demand_index_calls` when indexing actually ran (`result.status !== "skipped_recent"`). Currently this is already the case in the route (line 78), but we should also not increment when `result.status === "failed"` since the run didn't complete.

## Files to Touch

1. `app/api/cron/tutorial-index/ondemand.ts` — add retry to `searchYouTubeVideos`, wrap in try-catch in `indexSkillOnDemand`, return failed result instead of throwing
2. `app/api/cron/tutorial-index/ondemand/route.ts` — only increment daily cap on actual success (not `"failed"`)
3. `supabase/migrations/YYYYMMDD_fix_skill_index_status_corruption.sql` — fix existing corrupted rows, add check constraint

## Requirements

- YouTube 429s must not cause 500 responses
- Failed on-demand runs must still update `skill_index_status` with `last_run_status: "failed"` and `last_error`
- Daily on-demand cap must not be incremented for failed runs
- Corrupted `skill_index_status` rows must be cleaned up
- Future corruption must be prevented at the DB level

## Security Checks

- No new env vars or keys introduced
- No client-side changes
- Service role key usage remains confined to cron routes
- SQL migration runs with service role, no RLS concerns

## Acceptance Criteria

1. Triggering on-demand indexing when YouTube returns 429 results in a 200 response with `{ ok: true, result: { status: "failed", error: "..." } }`
2. `skill_index_status.last_run_status` is `"failed"` and `last_error` contains the YouTube error message
3. Daily cap `on_demand_index_calls` is NOT incremented for failed runs
4. Corrupted rows in `skill_index_status` are cleaned up
5. A `CHECK` constraint prevents future non-text `skill` values

## Manual Test Steps

1. Set `ON_DEMAND_INDEX_LIMIT=1` and trigger two on-demand requests for the same skill — second should return 429 (daily cap), not 500
2. Temporarily set an invalid YouTube API key to force 403/404, trigger on-demand — should return 200 with `status: "failed"`, not 500
3. Query `skill_index_status` for any skill that was attempted — verify `last_run_status` and `last_error` are set correctly
4. Query `ai_daily_usage` — verify `on_demand_index_calls` only increments on success
5. Inspect `skill_index_status` — verify no rows have JSON in the `skill` column
