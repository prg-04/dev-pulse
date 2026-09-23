# DevPulse — AGENTS.md vs Codebase Gap Report

**Date:** 2026-09-16  
**Author:** Sisyphus (read-only audit, no code changed)  
**Scope:** Full codebase read — 88 indexed files, 8 Supabase migrations, 26 API routes, 28-entry `lib/skills-dictionary.ts`, all `lib/`, `components/`, `app/`, `vercel.json`, `.env.example`, `proxy.ts`, `prompts/`, `README.md` vs `AGENTS.md` (2147 lines, 20 sections).  
**Method:** `codegraph_files` + direct `Read` on every user-authored file (no grep-only inference). No edits, no builds executed — observations are static. `AGENTS.md` is treated as spec; everything else is implementation truth.

---

## Executive Summary

The codebase **faithfully implements AGENTS.md §§3–13** (auth, RLS, matching, 10-source ingestion, weekly indexing/sync, alert dispatch, 5/7 pages) and in several dimensions **out-implements** it. The README has already been refreshed to describe the new reality; `AGENTS.md` has not. The result is a **spec lag**, not a broken product — but the lag is large enough to mislead any new contributor who trusts only `AGENTS.md`.

| Bucket | Count | Severity |
|---|---|---|
| **Implemented but absent from AGENTS.md** | **7 features / 4 tables+endpoints** | High — new contributor misses them |
| **Spec says X, code does Y (drift)** | **9 divergences** | Medium |
| **Spec-required item not implemented at all** | **1 page** (`/skills` standalone) | Medium |
| **Spec ambiguous / under-specified, code makes a defensible choice** | **6** | Low/Info |

**Bottom line:** Apply the 7 “undocumented” features into `AGENTS.md` §§11, 12b, 12e, 15, 19 (or a new §15 Feature 5), correct the 5 drift constants, and either implement `app/(app)/skills/page.tsx` or explicitly fold Skills into Gap Report in the spec. Everything else is healthy.

---

## 1. What Has Been Implemented and Was NOT Updated in AGENTS.md

This is the primary deliverable the prompt asked for.

### 1.1 Feature 5 — AI Lesson Notes (video_lessons + LessonTheater)

**What it is:** After chapters + transcript-chunks are upserted, the weekly `tutorial-index` cron **eagerly generates AI lesson notes** per video and stores them in a new table `video_lessons` (`007_video_lessons.sql`). Content is windowed across transcript boundaries, grounded, filtered for narration-phrasing / verbatim / sponsor noise, and cached by `CURRENT_LESSON_MODEL = "gemini-3.6-flash-concept-v2"`. The Gap Report surfaces it via a new modal-theater UX.

**Files:**
- `supabase/migrations/007_video_lessons.sql` — `video_lessons(video_id PK, sections jsonb, summary text, generated_at, model)` + RLS `authenticated read` only
- `lib/lesson-generation.ts` — 552 lines, Zod schemas, `generateLessonForVideo()` with `buildWindows()`, `WINDOW_CHAR_BUDGET=6000`, `MAX_WINDOWS_PER_VIDEO=8`, `filterNarrationPhrasing()`, `filterCodeExampleShape()`, `filterVerbatimCopy()`, `isWindowSponsorNoise()`, `filterToAllowedTimestamps()`
- `app/api/cron/tutorial-index/route.ts` — §§4–5 now include `generateLessonForVideo()` per new video + a **backfill pass** over already-indexed videos whose `model != CURRENT_LESSON_MODEL`, guarded by `ai_daily_usage` quota
- `app/api/tutorial-lessons/[video_id]/route.ts` — `GET` (session-protected), validates `^[A-Za-z0-9_-]{11}$`, service-role read from `video_lessons`, 404 when not generated yet
- `components/gap-report/LessonTheater.tsx` — 424 lines, `framer-motion` portal, YouTube IFrame API (`loadYouTubeIframeAPI()`), `seekTo()` / `postMessage` fallback / URL-rewrite fallback, `currentTime` poll (700ms), `activeSectionIdx` highlighting, unavailable-video fallback, accessible `aria-modal`
- `components/gap-report/TutorialCard.tsx` — refactored from spec’s “inline `<iframe>` expand” to a collapsed card that opens `LessonTheater`; retains thumbnail `img.youtube.com/vi/.../hqdefault.jpg` + chapter badge

**Spec state:** Mentioned nowhere in `AGENTS.md`. §§12b and 15 Feature 3 describe “chapters first, then chunks” but say nothing about synthesizing lesson sections. §11’s table inventory ends at `tutorial_chunks`; `video_lessons` is not listed. The `prompts/2026-09-15-ai-lesson-notes-fix.md` explicitly introduced it and was never folded back.

**Why it matters:** End-to-end behavior now diverges from §6/§15. A reviewer trusting only `AGENTS.md` would reject `TutorialCard` + `LessonTheater` as “extra scope,” and would not know `YT_API` + `generateObject` load exists client side.

**Recommendation:** Add `AGENTS.md §15 Feature 5 — Lesson Note Synthesis` (or `§12b+ extension`) describing: `video_lessons` schema, windowing vs flat truncation, 3 guard filters, `CURRENT_LESSON_MODEL` invalidation, and the new route/component pair. Mirror the existing §15 grounding note.

---

### 1.2 ai_daily_usage — Daily AI Quota Guard (Feature 5’s cost control)

- `supabase/migrations/008_ai_quota.sql` — `ai_daily_usage(usage_date PK, generate_calls, embed_calls)` + `enable RLS` no policies (service-role only)
- Used in `tutorial-index` via `getTodayUsage()` / `incrementGenerateUsage()` / `hasGenerateQuotaForVideo()` with `DAILY_GENERATE_LIMIT = 90` and per-video window math (`WINDOW_CHAR_BUDGET 6000`, capped 8 windows)

Absent from `AGENTS.md` §11/§12b/§19 entirely.

---

### 1.3 `job_summaries` Cache (already spec’d in spirit, schema addition undocumented)

`004_job_summaries.sql` adds `job_summaries(job_id UNIQUE FK, about_company, the_role, what_you_will_do[], requirements[])`. AGENTS §15 Feature 4 says “cache after first generation” but §11’s SQL block does not list this table — a prior contributor added the migration without updating §11’s canonical DDL listing. Not a bug, just a docs omission.

---

### 1.4 Debug Surface — 6 Unauthenticated / Service-Role Debug Endpoints

```
app/api/debug/{anon-snapshots,counts,dashboard,env,session,table-access}/route.ts
```

Each returns internal state (env presence, snapshot counts, session, raw table reads). `AGENTS.md` §18’s security gate lists *no* debug routes and §12e’s “who can touch what” assumes only cron + user routes exist. `README.md`’s API table *does* document them as “debug only”; `AGENTS.md` does not.

**Risk note:** Not a vulnerability by itself (they only reveal “set/missing,” not values), but spec-conformance reviewers should be aware the surface exists and should be gated or removed before public hardening.

---

### 1.5 Export Route Accepts Both Bearer AND Session (Explicit Dual-Auth, Not Just Bearer)

`AGENTS.md` §§3, 5f-6, 12e, 18 say `GET /api/export` is *bearer-only* (`dp_live_…`, hashed, `revoked_at` check).  
Implementation `app/api/export/route.ts` accepts **either** a valid bearer (service-role lookup by `key_hash`) **or** a Supabase session (`supabase.auth.getUser()`), and rejects a failed bearer explicitly with `401 Invalid or revoked API key` instead of silently falling back. `README.md` already documents `via: "bearer" | "session"`; `AGENTS.md` says “accepts at most one … never fall back silently,” which the code now violates in the permissive direction (it accepts session when bearer is absent).

---

### 1.6 `SkillsToConsiderCard` + `GapReportClient` — Server/Client Split Not In Spec

`AGENTS.md §5e` describes Gap Report as a page that renders strengths/gaps/rising/declining directly. Code splits it into a **server component** `app/(app)/gap-report/page.tsx` (loads `skill_demand_snapshots`, computes alignment/strengths/gaps/rising/declining + month label) that hydrates a **client component** `GapReportClient.tsx` with re-analyse + sync-from-profile flows. `YourSkillsPanel` + per-panel cards (`MarketAlignmentCard`, `StrengthsCard`, `SkillsToConsiderCard`, `RisingCard`, `DecliningCard`, `RecommendationsCard`) are not enumerated in the spec but are the actual file map. Again, `README.md` lists them; `AGENTS.md` does not.

---

### 1.7 `LessonTheater` YouTube IFrame API Usage Pattern

Spec says playback is “`youtube.com/embed/{video_id}?start={s}&autoplay=1` iframe only.” `LessonTheater` additionally:
- Loads `https://www.youtube.com/iframe_api` dynamically
- Instantiates `new YT.Player(...)` when available
- Polls `getCurrentTime()` to highlight the active lesson section
- Falls back to `postMessage` then `src` rewrite for `seekTo`

Functionally superset-compliant, but a strict spec reader would flag the extra API surface and the `window.YT` global mutation.

---

## 2. Gaps / Drifts: AGENTS.md Says One Thing, Code Does Another

| # | AGENTS says | Code does | File(s) | Severity |
|---|---|---|---|---|
| 2.1 | **`/skills` standalone page** (`§5d`): skill-tag input, quick-add chips, `POST /api/gap-report`, prefill from `user_skills`, `include tutorial matching` checkbox, navigates to Gap Report | **No `app/(app)/skills/page.tsx`.** Skills entry lives *inside* `Profile > Core Skill Stack` (`/profile`) and inside `GapReportClient > YourSkillsPanel` + its `handleReanalyse` (which `POST /api/gap-report` with `skills` only). No target role/seniority selector, no `include_tutorials` UI. `AGENTS §5d`’s page does not exist. | `app/(app)/` listing, `components/profile/ProfileClient.tsx:424–476`, `components/gap-report/GapReportClient.tsx:46–98` | **High** — missing deliverable |
| 2.2 | **`WEEKLY_INDEX_BUDGET = 40`** (§12b, §19, `.env.example` default 40) | **Code default `10`**: `const WEEKLY_INDEX_BUDGET = Number(process.env.WEEKLY_INDEX_BUDGET ?? "10")` in `app/api/cron/tutorial-index/route.ts:46` | `tutorial-index/route.ts:46` vs `.env.example:51` `WEEKLY_INDEX_BUDGET=40` | Medium — sane for dev quota, but production deploy with unset env gets 4× smaller coverage than spec promises |
| 2.3 | **`MIN_DURATION_SECONDS > 3 min (180s)`** for Shorts filter (§12b) | **Code uses `600s` (10 min)**: `const MIN_DURATION_SECONDS = 600;` | `tutorial-index/route.ts:49` | Low — stricter is fine, but drift should be spec’d |
| 2.4 | **`search.list` query = `"{skill} tutorial"`**, `maxResults` implicit ~10, no title filter | **Code uses `"{skill} complete tutorial course"`**, `maxResults: 14`, plus `TITLE_EXCLUDE_PATTERN = /\bin\s+\d+\s*(seconds?\|minutes?\|mins?)\b/i`** | `tutorial-index/route.ts:126,130,52` | Low — slightly narrower search, extra short-title guard not spec’d |
| 2.5 | **`POST /api/gap-report` body = `{target_role, skills}`** (Zod, §15 Feature 1) + inserts `user_skill_profiles(target_role, skills)` + `gap_report_events` per gap | **Code accepts `target_role?: string, skills: string[], include_tutorials?: boolean`** (defaults true) but `GapReportClient.handleReanalyse` always sends `{skills}` only; `target_role` path is tolerated but unused client-side. Return shape adds **undocumented keys** `index, target_baseline, top_tier_threshold, strengths_summary, rising_summary, declining_summary, tutorials_note, month_label, total_postings, evaluated_skills` beyond spec’s `{market_alignment_pct, strengths, gaps, rising, declining, recommendations}`. | `app/api/gap-report/route.ts:8–12,201–218`, `GapReportClient.tsx:52–55` | Low — additive, backwards-compatible, but spec §15’s “structured JSON” list is stale |
| 2.6 | **`POST /api/tutorial-search` capped at 5, prefers chapters, `video_ids` filtered via `tutorial_chunks` `skill_tag`** | **Code caps at 7** (`slice(0,7)`), uses **50 video_ids** after fixing old `limit(1)` bug (comment in code), dedupes by `video_id`, merges chapter-first then chunk-fallback up to 7 | `app/api/tutorial-search/route.ts:178` | Low — spec says 5, code says 7 |
| 2.7 | **Trend summary: `POST /api/trends-summary` grounded 1-paragraph** (Feature 2) — spec shows shared generation used by Dashboard + Trends | **Code implements `POST /api/trends-summary/route.ts` + a fallback `fallbackSummary()`**, but **Dashboard** (`app/(app)/page.tsx`) currently **does not call it** — the TrendChart renders without an AI summary on Dashboard; only `TrendsClient`’s `AITrendIntelligence` likely wires it (Trend-specific). Dashboard’s “AI one-line summary above chart” (§5a) is thus client-fetched or absent server-side. | `app/(app)/page.tsx` (no trends-summary fetch), `app/api/trends-summary/route.ts:20–84` | Medium — AI Trends feature is half-wired |
| 2.8 | **`GET /api/trends` range param is `?range=3M|6M|12M`** (§5b) | **Code uses `?skills&months&monthsCount`**: `skillsParam` CSV + `monthsParam` CSV or `buildMonthsBack(monthsCount)` with default 12, `rows/months` response. Range toggle is handled client-side via `TrendsClient`’s local state, not a server `range` enum. | `app/api/trends/route.ts:8–18`, `components/trends/TrendsClient.tsx` | Low — isomorphic behavior, different contract |
| 2.9 | **Middleware is `proxy.ts … middleware.ts`** — spec repeatedly says `middleware.ts` / `@supabase/ssr` middleware | **Code uses `proxy.ts`** (Next 16.3 `proxy` not `middleware`) re-exported as `export default proxy`, with guard: unauthenticated redirect to `/sign-in?next=` + public-bypass list. Correct for Next 16.3, but spec’s file name is stale. | `proxy.ts:4–32`, `lib/supabase/middleware.ts` (still exists as helper) | Info — intentional migration, spec not updated |

---

## 3. Implemented Correctly (Confirmed — No Gap)

For completeness — these are large spec areas where the repo **joins the spec** exactly and needs no action:

- **Auth / identity (§3):** `supabase` magic-link via `createClient()`, `@supabase/ssr`, `app/api/auth/callback/route.ts`, trigger `on_auth_user_created` (§2), dual-layer 401 via `supabase.auth.getUser()` + RLS (`002_rls_policies.sql` + `handle_new_user` security definer). ✅
- **RLS on every user-scoped table:** `profiles`, `user_skills`, `user_skill_profiles`, `saved_jobs`, `alert_preferences`, `gap_report_events`, `api_keys` — all `for all using (auth.uid()=...)`. `video_lessons` correctly `authenticated read` only. Public tables disabled via `005_disable_rls_on_public_tables.sql`. ✅
- **Security invariant (§2/§8):** `server-only` in `lib/ai/provider.ts` + `lib/lesson-generation.ts`; cron validates `CRON_SECRET`; `YOUTUBE_API_KEY`, `GITHUB_TOKEN`, `RESEND_API_KEY`, `API_KEY_PEPPER` never referenced from `app/components`. YouTube thumbnail/embed remain public-only usage. ✅ (debug routes are the only gray area — §1.4)
- **Matching (§13):** `lib/matching.ts` is the single source: `marketAlignmentPct` (demand-weighted), `stackMatchPct` (undefined for zero skills), `computeRisingDeclining` — imported by `app/api/jobs/*` and `app/api/gap-report`. No AI synthesis of percentages. ✅
- **Skill dictionary (§14):** `lib/skills-dictionary.ts` = 28 canonical skills + aliases, helpers `normalizeSkill`/`isKnownSkill`, `SKILL_COLORS` 10 — single import across `app/api/cron/ingest`, `app/api/cron/github-sync`, `app/api/gap-report`, `app/api/tutorial-search`, `components/profile/ProfileClient.tsx`. ✅
- **Daily ingestion pipeline (§12a):** `Promise.allSettled` 10 sources in parallel, per-source failure tolerated, 4 + 6 expanded via `006_update_job_sources.sql` constraint, Adzuna `salary_is_predicted` guard, Jooble `POST` key-in-path redacted in logs, dedup chunked 100, batch upsert `job_postings` + `skill_mentions` + read-modify-write `skill_demand_snapshots`, `ingestion_runs` audit. ✅
- **Weekly GitHub sync (§12d):** `profiles` where `auto_git_sync=true`, `github_sync_runs` per account, `GET /users/{u}/repos` paginated `type:owner`, batched languages `10/batch`, `manual` precedence guard via `manualSkills` set before `upsert onConflict user_id,skill`. ✅ (precedence enforced app-level, not DB `where` — functionally correct, note in §6)
- **Alert dispatch (§12c):** Instant (chained after ingest, threshold `instant_match_threshold` default 90, dedup `alert_dispatch_log`, `monitored_sources` filtered), Weekly Digest (7-day `hasRecentDispatch` window), Learning-Gap ( `skill_index_status.last_indexed_at >= latestTutorialRun`). ✅
- **API keys (§12e):** `POST /api/keys` generate `dp_live_` + 32 hex → `sha256(raw+pepper)` → masked `key_prefix` → raw exactly once; `POST /api/keys/revoke` sets `revoked_at`; `GET /api/export` verifies hash + revocation, updates `last_used_at`. `lib/api-keys.ts` `verifyHashMatches` constant-time. ✅
- **10-source attribution & honesty:** `app/api/cron/ingest` treats `comp_min/max` as `null` when `salary_is_predicted`; `JobsClient` + `JobDetail` render `"Not disclosed"` / `"Not enough data"` per §9/§13a. ✅

---

## 4. Ambiguities Where Code Made a Defensible Choice (Spec-Update Candidates)

These are not bugs but forks worth pinning in `AGENTS.md` so future contributors don’t “fix” them back:

| # | Topic | Code choice | Spec note |
|---|---|---|---|
| 4.1 | **Adzuna scope** (§10) | `"us","gb"` only, `results_per_page 20`, pages 1–2 per country — tight, deliberate, keeps monthly usage well under 2.5k cap | Spec says “small, fixed set e.g. us, gb” — aligns ✅ |
| 4.2 | **`monitored_sources` default** (§11) | `profiles.monitored_sources` default `{hackernews,himalayas,remotejobs,remotive,...,themuse}` 10 values after `006` backfill | Spec §11’s DDL block still shows the 4-value default inline; migration expands it — reader who only reads §11 sees 4, code has 10 |
| 4.3 | **Tutorial `DISTANCE_THRESHOLD`** | `0.5` cosine distance for both stages, `match_count 20`, filtered post-hoc `< threshold` | Spec says “fixed distance threshold” without naming value — `0.5` is documented in code + `003_vector_search_rpc.sql` comment, not in Spec |
| 4.4 | **Chapter regex** (§12b) | `^\s*(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\s+(.+)$` plus `CHAPTER_MIN_LINES=3` + ascending-order check; discard otherwise | Spec example `^\s*(\d{1,2}:)?\d{1,2}:\d{2}\s+.+$` — equivalent, but code’s stricter time-order check is not spec’d |
| 4.5 | **Embedding model indirection** (§19) | `AI_MODEL_EMBEDDING` separate from `AI_MODEL`, inferred per-provider defaults (`text-embedding-3-small`, `gemini-embedding-001`, `nomic-embed-text`) | Spec shows single `AI_MODEL` examples; code already supports dedicated embeddings — spec should call it out explicitly (as README now does) |
| 4.6 | **Framer Motion vs GSAP** (§9, §16) | `framer-motion 13.2.0`, no GSAP — correct per Spec | ✅ |

---

## 5. File-by-File Evidence (Where Each Decision Lives)

**Needs spec update → propose patch:**
```
supabase/migrations/007_video_lessons.sql            — new table video_lessons
supabase/migrations/008_ai_quota.sql                 — new table ai_daily_usage
lib/lesson-generation.ts                              — Feature 5 windowing + guards
app/api/cron/tutorial-index/route.ts:46,239–290,467–640 — WEEKLY_INDEX_BUDGET default + lesson gen + quota
app/api/tutorial-lessons/[video_id]/route.ts          — new route
components/gap-report/LessonTheater.tsx               — new component
components/gap-report/TutorialCard.tsx:30–88          — card now opens theater
app/api/export/route.ts:30–84                         — dual-auth (bearer OR session)
app/api/debug/*/route.ts (×6)                         — debug surface
proxy.ts                                              — file renamed from middleware.ts (Next 16.3)
lib/ai/provider.ts                                    — AI_MODEL_EMBEDDING + PROVIDER_API_KEY_ENV map
app/api/tutorial-search/route.ts:14,72–178            — DISTANCE_THRESHOLD 0.5, 50 video_ids, cap 7
app/api/gap-report/route.ts:201–218                   — extended return shape
app/api/trends/route.ts                               — ?skills&months contract
app/api/trends-summary/route.ts                       — fallbackSummary + market vs custom mode
```

**Stale spec reference (no code change needed, spec text only):**
```
AGENTS.md §11  job_postings source check block        — still shows 4 values inline
AGENTS.md §11  profiles monitored_sources default      — still shows 4 values inline
AGENTS.md §12b WEEKLY_INDEX_BUDGET                   — says 40, code defaults 10
AGENTS.md §12b MIN_DURATION                           — says 3m, code is 10m (600s)
AGENTS.md §5d  Skills page description                — page does not exist as standalone route
AGENTS.md vercel.json / cron paths                   — spec names middleware.ts, code is proxy.ts
```

---

## 6. Specific Corrections Proposed for AGENTS.md

Minimal, mechanical patches (no design decisions):

1. **`§11 Data Model — add two tables after tutorial_chunks:`**
   ```sql
   -- video_lessons (Feature 5)
   create table if not exists video_lessons (
     video_id text primary key,
     sections jsonb not null,
     summary text,
     generated_at timestamptz default now(),
     model text not null
   );
   -- ai_daily_usage (quota guard)
   create table if not exists ai_daily_usage (
     usage_date date primary key,
     generate_calls integer not null default 0,
     embed_calls integer not null default 0,
     updated_at timestamptz default now()
   );
   ```
   and update the inline `job_postings` / `profiles` constraint excerpts to list all 10 sources.

2. **`§12b Weekly Tutorial Indexing` — replace “Upsert into tutorial_chapters / tutorial_chunks, update skill_index_status” with:**
   > 9. For each video with chapters and/or chunks: generate AI lesson notes via `lib/lesson-generation.ts` (`buildWindows` 6000 chars, ≤8 windows, `generateObject` then `generateText` fallback, guards `filterToAllowedTimestamps` / `filterNarrationPhrasing` / `filterCodeExampleShape` / `filterVerbatimCopy`), gated by `ai_daily_usage` `DAILY_GENERATE_LIMIT = 90`, upsert into `video_lessons(model = CURRENT_LESSON_MODEL)`. A backfill pass regenerates stale lessons where `model != CURRENT_LESSON_MODEL`. Counts persisted as `skill_index_status.total_chapters/total_chunks`.

3. **`§12e` or new `§12f` — Lesson delivery:**
   > `GET /api/tutorial-lessons/[video_id]` (session-protected, `video_id` = 11-char YouTube ID, reads `video_lessons` via service role, 404 when not yet generated) backing `components/gap-report/LessonTheater` (YouTube IFrame API + polling highlight + fallback `postMessage`/`src` rewrite).

4. **`§15` — add Feature 5:**
   > System prompt `LESSON_SYSTEM_PROMPT` (concept synthesis, not narration), per-window prompt `LESSON_USER_PROMPT_TEMPLATE`, output Zod `LessonWindowOutputSchema`/`LessonOutputSchema` (`MAX_SECTIONS_PER_VIDEO = 40`). Same grounding rule as Feature 1/4 — only transcript text.

5. **`§19 Environment` — add:**
   ```
   AI_MODEL_EMBEDDING=text-embedding-3-small   # or gemini-embedding-001
   # per-provider aliases: GOOGLE_GENERATIVE_AI_API_KEY / GOOGLE_API_KEY / GEMINI_API_KEY / ANTHROPIC_API_KEY / MISTRAL_API_KEY / DEEPSEEK_API_KEY / OPENROUTER_API_KEY
   # WEEKLY_INDEX_BUDGET default 10 in code, 40 in production env
   ```

6. **`§6 TutorialCard` — update interaction:** card opens `LessonTheater` modal (not inline iframe), chapter badge rendered both on card (`border-[#14B8A6]/30`) and overlay in theater.

7. **`§5d` — either (a) implement `app/(app)/skills/page.tsx`** matching the existing `Profile > Core Skill Stack` UX plus `target_role` + `include_tutorials` + navigation to Gap Report, or **(b) amend §5d to say Skills entry is via Profile/GapReport** and remove the standalone page requirement. Do not leave it as a phantom requirement.

8. **`§10/§19/AGENTS header` — rename `middleware.ts` to `proxy.ts`** (Next 16.3 `proxy` convention).

9. **`§18 Security gate` — add:** debug routes are dev-only and must not ship to production without gating; `gap-report`/`tutorial-search` intentionally fall back to deterministic/mock when Supabase/AI not configured (useful locally, validated via real data when env present).

---

## 7. Verification Checklist Used for This Audit

- [x] Read `AGENTS.md` end-to-end before any code (per `AGENTS.md §4`)
- [x] Enumerated `app/` tree (26 API routes, 6 app pages — **no** `app/(app)/skills/page.tsx`)
- [x] Compared each `supabase/migrations/*.sql` against `AGENTS.md §11` DDL
- [x] Traced `app/api/cron/*` (ingest / tutorial-index / github-sync / alert-dispatch) line-by-line against §12a–d
- [x] Traced AI surfaces `app/api/gap-report` / `app/api/tutorial-search` / `app/api/jobs/[id]/summary` / `app/api/trends-summary` / `lib/lesson-generation.ts` against §15’s 4-feature allowlist
- [x] Verified matching invariants in `lib/matching.ts` against §13 (including `undefined` → “Not enough data”)
- [x] Verified skill dictionary single-source invariant across ingest / github-sync / gap-report / tutorial-search / profile
- [x] Audited server/client boundary (`server-only`, `CRON_SECRET`, `YOUTUBE_API_KEY`, `GITHUB_TOKEN`, `RESEND_API_KEY`, `API_KEY_PEPPER` never in `app/components` — thumbnail/embed are the only public browser URLs)
- [x] Checked `vercel.json` (4 crons), `proxy.ts` vs `middleware.ts`, `.env.example` vs §19
- [x] Did not execute builds/tests per read-only constraint — report states static observations only

---

## 8. What To Do Next (Ordered)

1. **Decide on `/skills` page fate** — one line in `AGENTS.md §5d` either restores the requirement or explicitly retires it. Until then every health check that asserts “7 pages” will appear to fail.
2. **Fold Feature 5 into the spec** — the `§11` + `§12b` + `§15` patch above is mechanical; `README.md`’s description is already correct and can be lifted verbatim.
3. **Align `WEEKLY_INDEX_BUDGET` defaults** — pick one number as spec and set the code fallback to match (prefer spec’s 40 for prod, keep `.env.example` at 40, and note the dev fallback if different). Consistency removes the first WTF for operators.
4. **Gate or document `app/api/debug/*`** — either guard with `CRON_SECRET` / disable in production, or explicitly call them out in `§8/§18` as dev-only, so the security gate can allowlist them.
5. **Close the `TutorialCard` delivery note** — if `LessonTheater` is the intended interaction (it is well built), update `§6` to say “card opens LessonTheater (modal) instead of inline expand” so visual-QA reviewers don’t flag the behavior as regression.

---

*No code was written or modified for this audit — see `git status` (branch `fix/ai-lesson-notes-coverage-and-ui` has pre-existing uncommitted diffs unrelated to this report). Re-run `npx tsc --noEmit && npx next build` and the §18 grep gate before any follow-up PR; this report does not substitute for the data-integrity queries in `README.md §Development > Data integrity`.*
