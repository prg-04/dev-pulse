# Jobs Profile Match Fix — Implementation Prompt

**Date:** 2026-09-13
**Author:** Sisyphus
**Status:** Awaiting approval (proceeding per user "proceed" context from profile fix)
**Related:** AGENTS.md §5c, §11, §13, §14

## Goal
Make /jobs stack-match percentage accurate and working. Today sorting by "Profile Match" does nothing and matched counts may diverge from the displayed percentage.

## Skills Read
- `supabase` — server `createClient` + `createServiceRoleClient`, RLS for `user_skills`/`profiles`/`gap_report_events`
- `supabase-postgres-best-practices` — avoid COUNT(*) in request, skill_mentions index
- `vercel-react-best-practices` — server/client boundary, `force-dynamic`, `fetch` with session
- `secure-coding` — no secrets in client

## Code Inspected
- `lib/matching.ts` — `stackMatchPct(jobSkills, userSkills)` distinct lowercased arithmetic, returns undefined for empty jobSkills
- `lib/queries/jobs.ts` — `getJobsWithSkills`, `getUserSkillsAndGaps` (lowercases, fallback to `user_skill_profiles`), `sortJobs` expects `stackMatch` but callers provide `stack_match_pct`
- `app/api/jobs/route.ts` — builds `withMatch` with `stack_match_pct`, calls `sortJobs(withMatch, sort)` with mismatched key → profile_match sort is no-op; `matched_skills` uses raw filter not distinct
- `app/(app)/jobs/page.tsx` — same `stack_match_pct` construction for initialJobs
- `components/jobs/JobsClient.tsx` — sort param triggers fetch, isInitial skips fetch only for latest; `totalLive` + `hasMore` handling
- `components/jobs/JobCard.tsx` / `JobDetail.tsx` — display `stack_match_pct`, `gap_skills` badge, `matched_skills` detail; JobDetail has dead `matchedCount` var
- `lib/skills-dictionary.ts` — 31 skills, aliases, canonical lowercase

## Decisions and Assumptions
- Root cause #1 is property name mismatch: `sortJobs` reads `stackMatch` but API provides `stack_match_pct`, so `sort=profile_match` never sorts. This is why user says "neither is it working".
- Root cause #2 is loose `matched_skills`/`gap_skills` that use raw `j.skills.filter(s=>userSkills.includes(s.toLowerCase()))` without distinct dedupe, so displayed "2/3 Matched" can disagree with `stackMatchPct` which deduplicates. For canonical data they happen to be distinct, but for safety they must align.
- Not changing dictionary or ingestion; job `skills` already come from `skill_mentions` lowercased.
- Keep `monitoredSources` logic: only applied when `source === "all"` (existing correct behavior).
- Keep `force-dynamic` on both page and API.
- Assume "not accurate" is not about dictionary coverage but about the above mismatch + sort no-op. If after fix user still sees many "Not enough data", that indicates `skill_mentions` is empty due to no ingestion run, not a code bug — will note in verification.

## Files You Will Touch
- `lib/queries/jobs.ts` — fix `sortJobs` to read `stack_match_pct` (and fallback `stackMatch` for compat), add secondary sort by `posted_at` for tie-break
- `app/api/jobs/route.ts` — make `matched_skills`/`gap_skills` use distinct lowercased sets consistent with `stackMatchPct`; also attach `stackMatch` alias for sort compatibility or update sortJobs to handle new key; ensure `withMatch` shape matches `sortJobs` expectation
- `app/(app)/jobs/page.tsx` — same distinct fix for `matched_skills`/`gap_skills`
- `components/jobs/JobDetail.tsx` — remove dead `matchedCount`, ensure `matched_skills`/`gap_skills` compare lowercased consistently
- No migration, no env change

## Requirements
1. **Sort actually works:** `sortJobs` must sort descending by `stack_match_pct` when `sort==="profile_match"`, with `undefined`/`null` treated as -1 (bottom), and tie-break by `posted_at` desc.
2. **Counts match percentage:** `matched_skills` must be distinct skills that are in userSkills (case-insensitive), length must equal numerator of `stackMatchPct`. `gap_skills` must be distinct intersection with `gaps` set. Both derived from `distinct` list, not raw array.
3. **API and page stay in sync:** `app/api/jobs/route.ts` and `app/(app)/jobs/page.tsx` must compute `stack_match_pct`, `matched_skills`, `gap_skills` identically (share helper or duplicate same logic).
4. **No client secret leakage:** verify same grep gate.
5. **Types:** no `any`, fix `stackMatch` vs `stack_match_pct` type mismatch.

## Acceptance Criteria
- [ ] `/jobs?sort=profile_match` returns jobs ordered descending by `stack_match_pct` (e.g. 100%, 80%, 60%, 0%, Not enough data)
- [ ] JobCard badge shows e.g. "80% stack match" and detail shows "4/5 Matched" where 4 matches the 80% numerator (4/5=80%)
- [ ] Gap chips (`!gap`) appear only for skills that are in user's `gap_report_events` last 30d and are lowercased matches
- [ ] With no user skills, all jobs show 0% or Not enough data consistently, not random
- [ ] `npx tsc --noEmit` clean on changed files, `npx eslint` clean

## Manual Test Steps
1. Add 3 skills in Profile (e.g. typescript, react, node.js) → Save → go to /jobs
2. Observe stack_match_pct on cards: jobs containing those skills show >0%, others 0% or Not enough data
3. Switch sort to Profile Match → verify order descends by percentage
4. Click a high-match job → detail shows "X/Y Matched" matching badge, gap badges only for gap skills
5. `grep -r "SERVICE_ROLE" app/` etc — verify no new leakage

## Out of Scope
- Dictionary expansion, ingestion backfill, new filters, UI redesign
