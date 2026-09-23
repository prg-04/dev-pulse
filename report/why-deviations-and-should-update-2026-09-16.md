# DevPulse — Why Deviations Happened & Should AGENTS.md Be Updated?

**Date:** 2026-09-16 (second report)  
**Companion:** `report/gaps-agents-vs-codebase-2026-09-16.md` (the *what*) — this file is the *why* and the *should we canonize it*.  
**Read-only; no code changed.**

---

## How to Read This Report

Each deviation gets three judgments:

| Field | Meaning |
|---|---|
| **Root cause** | What commit / decision / environmental pressure produced it. Git evidence cited. |
| **Deliberate?** | Was it an intentional product/engineering bet that improves DevPulse, or accidental drift / dev-tuning that escaped to `HEAD`? |
| **Recommendation** | **Adopt** (canonize in AGENTS.md) · **Revert/fix in code** (don’t touch spec) · **Amend** (both change a bit) — with the minimal patch direction. |

Decision rule used:

- **Deliberate quality wins** (better grounding, cheaper cost, security-hardening, framework migration) → **Adopt**.
- **Useful but temporary scaffolding** (debug helpers, quota down-tunes for local free tier) → **Gate or revert**, don’t enshrine.
- **Spec debt / missed page** → **Amend** (spec and code meet halfway).

---

## 1. Lesson Summary / Video Lessons — the big deliberate feature

### 1a. `video_lessons` + `ai_daily_usage` + `lib/lesson-generation.ts` + `LessonTheater` + `GET /api/tutorial-lessons/[video_id]`

**Root cause.** Timeline tells the story:

1. `3e0188f` initial scaffold — only 4 sources, no lessons.
2. `d4ea42b` (Sep 12) — AGENTS.md lands in repo (2022 lines), plus Trends. No lesson tables yet.
3. Between `d4ea42b` and `aa576f6` (Sep 12-14), `lib/lesson-generation.ts` was **born untracked** (prompt `2026-09-15-ai-lesson-notes-fix.md §0a` notes file birth `Sep 14 17:43, never committed`) with `CURRENT_LESSON_MODEL = gemini-3.6-flash-concept-v2` alongside `007_video_lessons.sql`. That prompt’s `Step 0 Findings` shows live Supabase already held **39 `video_lessons` rows** under stale models `concept-synthesis-deterministic-v1` (18) and `concept-synthesis-fallback-title-v1` (21) *before* the fix commit — proving the feature was built, shipped to the DB, but never folded into the spec (`AGENTS §15` still said “exactly four places”).
4. `aa576f6` (Sep 15 `fix(ai-lesson-notes): full-length coverage…`, Co-authored-by Sisyphus) then **fixed** the lessons implementation rather than adding it: raised `MAX_WINDOWS_PER_VIDEO 3→8`, `DAILY_GENERATE_LIMIT 20→90`, added `isWindowSponsorNoise` / `filterCodeExampleShape` / `filterVerbatimCopy`, fixed `LessonTheater` overflow/unavailable, added `BATCH=8` embed, 429 retry 35s, canary `?skill/?limit`, and finally tracked `008_ai_quota.sql`. Its commit message says “apply 008 migration (already in repo, now tracked)” — i.e., even quotas existed untracked first.
5. Prompt `2026-09-15-ai-lesson-notes-fix.md` explicitly contains the spec amendment text for AGENTS.md (“Section 15 Feature 5, Section 11 tables, Section 12b Step 12…”) but the `AGENTS.md diff` in that commit **was not applied** — the prompt lists the AGENTS blocks as *Step 3 — apply as part of this fix* with “REQUIRES Evans’s approval”, evidence the team shipped the code while the spec amendment was left gated on Evans.

In short: **feature was intentionally designed, intentionally fixed, intentionally documented in two prompts and README — the only place it wasn’t updated was AGENTS.md.** This is textbook spec lag after a fast-moving feature sprint.

**Deliberate?** **Yes — unambiguously deliberate and product-critical.** It turns Tutorial Search from “a list of jump points” into `Skills to Consider → clickable card → theater with synced study notes` — the “from diagnosis into the start of a learning session” line in AGENTS §1. The `prompts/2026-09-15-ai-lesson-notes-fix.md` audit (DB query showing sponsor-read bullets like `[Music] this video is sponsored by Ed…` rendered as code) proves the investment was grounded-quality-driven, not a side experiment. Cost math in the same prompt (`$0.13/week` on Gemini Flash for 240 calls) shows it was scoped as a first-class feature, not throwaway.

**Should AGENTS.md include it?** **Yes — Adopt.** This is the correct answer to your “deliberate e.g. the lesson summary etc.” question.

**Adopt patch (copy-paste ready, minimal):**

- **§15 — add Feature 5** (after Feature 4’s system-prompt block, before the “AI is not used for…” closing paragraph):
  > explanation, Zod `LessonWindowOutputSchema` (1–8 sections per window) / `LessonOutputSchema` (≤40 per video), model constant `CURRENT_LESSON_MODEL` invalidates `video_lessons.model`, guards `filterNarrationPhrasing` / `filterToAllowedTimestamps` / `filterCodeExampleShape` / `filterVerbatimCopy` / `isWindowSponsorNoise`, windowing `WINDOW_CHAR_BUDGET=6000`, `MAX_WINDOWS_PER_VIDEO=8`, fallback `generateText` when `generateObject` fails, and the invariant: `start_seconds ∈ allowedTimestamps` (no invented timestamps).

- **§11 — add after `tutorial_chunks`:**
  ```sql
  video_lessons(video_id PK, sections jsonb, summary text, generated_at, model) -- RLS authenticated read only
  ai_daily_usage(usage_date PK, generate_calls, embed_calls) -- service_role only
  ```

- **§12b — add Step 12** “Lesson generation (same run, chained after chunks)” with the 90/day quota guard, `hasGenerateQuotaForVideo`, and backfill pass that regenerates where `video_lessons.model != CURRENT_LESSON_MODEL`.

- **§16 Decisions Already Made — add a bullet:** “Tutorial videos produce AI lesson notes eagerly in the weekly indexing run via windowed, grounded generation; `video_lessons.model` tracks the generation; re-index regenerates stale lessons.”

- **§16 closing line:** `AI is used in exactly five places…` (was four) + the cost note that Google Gemini Flash embedding path is the priced default.

Leaving this out makes AGENTS.md actively misleading: a new contributor reading only the spec will correct `LessonTheater` back to “inline iframe expand” and delete `lesson-generation.ts` as “out of scope.”

---

### 1b. `job_summaries` cache (004)

**Root cause.** Added alongside the 10-source expansion sprint (`aa576f6`) without a matching Prompt entry — a small additive step to honor AGENTS §15 Feature 4’s “cache after first generation” sentence that previously had no table backing. No controversy; the DDL just didn’t get mirrored to the §11 canonical listing.

**Deliberate?** Yes.

**Adopt?** **Yes — one-line §11 add.** Tiny, correct.

---

## 2. Deviations Inside Tutorial Indexing — tuned under quota pressure

### 2a. `WEEKLY_INDEX_BUDGET` code default `10` vs spec/.env `40`

**Root cause.** Prompt `2026-09-15-ai-lesson-notes-fix.md §Decisions` table literally frames this as `WEEKLY_INDEX_BUDGET and MAX_VIDEOS_PER_SKILL remain 10 and 3 (no change)` — i.e., the constant was **kept at 10 code-side while the env/specs still say 40**. The prompt’s earlier audit queries show `skill_index_status` total_chunks=0 everywhere (DB had just been wiped, `tutorial_chunks` count 0) and only ~39 lessons existed — a tiny local dataset. In that context 10 is a safe free-tier default; 40 would have burned YouTube quota before the guard was proven. The `.env.example` kept `WEEKLY_INDEX_BUDGET=40` because that’s the production affordance (10k quota / 100 per `search.list` ≈ 90–100 skills ceiling, 40 leaves headroom).

**Deliberate?** **Semi-deliberate dev tuning.** Useful locally, wrong for prod if env is unset.

**Amend:** Do not pick one number blindly. Update AGENTS §19 to state: **default `10` in code (safe for local/free tier), `40` in `production .env`/`vercel.json`** — i.e., document the two tiers explicitly:
```
WEEKLY_INDEX_BUDGET 40  # prod — well under ~90–100 daily quota ceiling
# code fallback 10 when env unset (dev-safe)
```
And make `app/api/cron/tutorial-index/route.ts:46` match the spec comment (`Number(process.env.WEEKLY_INDEX_BUDGET ?? "40")` in prod, or at minimum a comment `// default 10 dev, prod .env sets 40 per AGENTS §19`).

### 2b. `MIN_DURATION_SECONDS 600` (10 min) vs spec “>3 minutes (skip Shorts)”

**Root cause.** Same quota/quality pressure as 2a. Filtering to 10 min is a **quality bet**: longer videos are more likely to contain real chapters, full courses, fewer Shorts/false-positives, and their transcripts amortize better across windows. The 6h39m / 3h24m samples under fix prove 10 min is where the feature was validated.

**Deliberate?** Yes, but not justified in spec text.

**Adopt (amended wording):** Update §12b to `duration > 10 minutes (600s) — skips Shorts and thin clips; was 3 min in early spec, raised to 10 min after quality audit (see prompts/2026-09-15-ai-lesson-notes-fix.md)`.

### 2c. Search query `"${skill} complete tutorial course"` + `maxResults 14` + `TITLE_EXCLUDE_PATTERN /\bin\s+\d+\s*(seconds?|minutes?|mins?)\b/i`

**Root cause.** Observations from the `sponsor/verbatim` audit: `getMockTutorials` / raw transcript pulls were trapping `"Learn TypeScript in 60 seconds"` etc. as false positives. The suffix `complete tutorial course` pulls fewer “X in 30 seconds” hits, and the title regex drops them post-fetch before embedding/chunking.

**Deliberate?** Yes — defensive quality filter.

**Adopt?** **Yes, as a §12b footnote** (one sentence + the regex). Cost-free, reduces YouTube search noise without touching quota. Mention that `titleExclude` is best-effort, not a substitute for `viewCount>10k`/`duration` gates.

---

## 3. Standalone `/skills` Page Missing — spec debt

**Root cause.** This is the mirror image of the lesson feature: AGENTS §5d **over-specified** vs reality. Git diff shows `app/(app)/page.tsx`, `jobs/page.tsx`, `gap-report/page.tsx`, `trends/page.tsx`, `profile/page.tsx` landed in `aa576f6`, but no `app/(app)/skills/page.tsx` was ever created. Instead the “Skills page” became two thinner entry points:

- `Profile > Core Skill Stack` (`ProfileClient.tsx:424–476`) — persistent baseline (`user_skills` `manual` + `github_sync` + file-level gap expansion badges), dictionary-validated, with years/depth_tier.
- `Gap Report > YourSkillsPanel` + `handleReanalyse` (`GapReportClient.tsx:46–98`) — `POST /api/gap-report {skills}` in-place re-analyse + `handleSyncFromProfile` (`GET /api/profile/skills` then re-analyse).

The audit `prompts/audit-2026-09-12.md` already flagged **Jobs and Skills as missing pages** before the pipelines existed. Jobs was built; Skills was intentionally folded rather than shipped standalone — likely because the target-role/seniority selector and `include tutorial matching` checkbox (§5d) had no downstream consumer beyond Gap Report, and `user_skills` was a cleaner persistent baseline than a throwaway point-in-time Skills page that “does not silently overwrite baseline” (§5d last sentence).

**Deliberate?** **Yes — deliberate UX consolidation.** Less navigation chrome, fewer stale state branches (`user_skill_profiles` vs `user_skills` already covers the snapshot vs baseline distinction §5d requires).

**Amend (don’t revert):** Either (preferred, minimal) **update AGENTS §5d to match what shipped**: “Skills entry is via Profile’s Core Skill Stack (persistent) and Gap Report’s YourSkillsPanel (snapshot re-analyse); no standalone `/skills` route; `POST /api/gap-report {target_role?, skills, include_tutorials?}`; the page pre-fills from `user_skills` but submission is snapshot-only (inserts `user_skill_profiles` + `gap_report_events`).”

Or, if the product direction truly wants the §5d standalone selector, implement `app/(app)/skills/page.tsx` as a thin wrapper around `YourSkillsPanel` with the target_role/seniority fields wired through. Don’t leave a phantom requirement — every future QA pass reading only AGENTS will mark “Skills page missing” as a failure.

---

## 4. Tutorial Card Delivery — `LessonTheater` theater instead of inline expand

**Root cause.** Spec §6 says “On click, expands an inline `<iframe>` embed in place.” Shipped: collapsed `TutorialCard` opens a `createPortal` **fullscreen theater** (`LessonTheater.tsx`) with body-scroll lock, `lessonCache`/`lessonErrorCache`, YouTube IFrame API dynamic loader, `pollRef` 700 ms highlight, chapter overlay, mini footer metadata, and the `AI Lesson Notes` rail that auto-sync-seeks. Prompt `2026-09-15-readme-refresh.md`’s *Code Inspected* block explicitly inventories `LessonTheater` as `33 symbols, theater with createPortal, pollRef 700ms` — evidence it was known as the implemented pattern. The inline-expand language was just never edited after the theater proved superior for long videos (6h39m with 8 window sections — inline would have overflowed the card).

**Deliberate?** **Yes — deliberate UX elevation.** Handles horizontal overflow (`min-w-0, overflow-x-hidden, break-words, whitespace-pre-wrap` added in aa576f6), unavailable video fallback (“Video unavailable” + thumb + open-on-YouTube link), and the notes rail that follows `currentTime`.

**Adopt:** Update §6 to “On click opens `LessonTheater` portal — theater shows the embed plus chapter badge overlay and the AI Lesson Notes rail; thumbnail remains `img.youtube.com/vi/{video_id}/hqdefault.jpg` (public).” One sentence, no redesign.

---

## 5. Small Numbers That Drifted — harmless, but sync them

### 5a. `POST /api/tutorial-search` cap `7` not spec `5`

**Root cause.** After fixing the prior `limit(1)` bug that capped chapter search to one video (comment in `route.ts:72` “fixes prior limit(1) bug that capped results to 1 video”), the merged/deduped pass was relaxed to `slice(0,7)` (`route.ts:178`) to surface 2 more fallback chunks without blowing above-the-fold cost. Mixed chapter+chunk hits sort by distance, so 7 is still cheap (two RPCs `match_count: 20` already fetched more; final slice is just client payload shape).

**Adopt:** Update §15 Feature 3 “capped at 5 total” → **“capped at 7 total”** (and keep the `Distance 0.5` note from `route.ts:14`). Cost impact negligible, correctness gain small; no reason to revert.

### 5b. `POST /api/gap-report` return shape extended (`index, target_baseline, top_tier_threshold, strengths_summary…`)

**Root cause.** `components/gap-report/GapReportClient.tsx` consumes richer panels (`MarketAlignmentCard`, `StrengthsCard`, etc.) than the spec’s six JSON keys. The server now blends deterministic gaps/rising/declining with mock-baseline fallbacks (`mockGapReport.targetBaseline 60`, `topTierThreshold 80`, etc.) when live snapshots are absent, preserving demo-mode render even pre-ingestion.

**Adopt:** Extend §15’s “structured JSON” example to include the new keys as **optional presentation fields** (they’re backwards-compatible; consumers that only need the 6 keys can ignore the rest). Document fallback: when `skill_demand_snapshots` empty, response falls back to `lib/mock/gap-report.ts` with mock deltas and `tutorials_note`.

### 5c. `GET /api/trends` contract `?skills&months&monthsCount` vs spec `?range=3M|6M|12M`

**Root cause.** `TrendsClient`’s `SkillSelector` (max 5) + `TrendChartArea` 3M/6M/12M toggle are wired as a *client-side window over a server rowset*: server returns `rows/months` for an explicit month list (`buildMonthsBack(monthsCount)`), client slices by range. More testable (canonical URL `?skills=ts,react&months=2025-09,2025-10`) than an enum that forces server-side month math divergence for Dashboard vs Trends.

**Adopt:** Update §5b/§5e to “Trends and Dashboard share `lib/queries/trends.ts` → `getTrendsData`; query is `?skills&months&monthsCount` (comma CSVs) or `?skills&range` synonym resolved client-side; server never runs two divergent trend endpoints.” One line; preserves §5b’s “must read from same underlying query” invariant.

### 5d. Provider indirection `AI_MODEL_EMBEDDING` + per-provider keys (openrouter/ollama/generic)

**Root cause.** `lib/ai/provider.ts` resolves `AI_PROVIDER` from explicit env → `AI_MODEL` prefix → available keys → defaults; embedding model is independently resolved via `AI_MODEL_EMBEDDING` / `${PROVIDER}_EMBEDDING_MODEL` / `DEFAULT_EMBEDDING_MODEL` (8 providers). Prompt `2026-09-15-readme-refresh.md` already inventoried `package.json` provider packages (`@ai-sdk/openai, anthropic, google, mistral, deepseek`) and documented the `AI_PROVIDER=openrouter … gpt-4o-mini` pattern; README’s env table captures it. AGENTS §19 still shows single `AI_MODEL` examples (`ollama:llama3.1`, `groq:llama-3.3-70b`, `anthropic:claude-sonnet-4-6`) without naming the embedding companion.

**Adopt:** Extend §19’s `AI provider configuration` box and `§19 Environment Variables` table: add `AI_MODEL_EMBEDDING` (required when `tutorial-search` or lesson-generation embeddings are used), add `OPENROUTER_API_KEY` / `AI_API_KEY` as aliases, and note `lib/ai/provider.ts` fallback `openai-compatible path` for `deepseek/openrouter/ollama/generic`. This is already in `README` + `.env.example` — copying one paragraph from there into AGENTS prevents future “AI_MODEL switch broke embeddings” confusion.

---

## 6. Things That Look Like Drift But Are Migrations or Environment Differences

These deserve **no revert** — just spec clarity:

| Drift | Why it happened | Patch |
|---|---|---|
| **`proxy.ts` vs `middleware.ts`** | Next 16.3 renamed the convention to `proxy` (`createClient` `updateSession` helper still lives in `lib/supabase/middleware.ts`). The aa576f6 gap-report/trends/dashboard pages all assume proxy auth. | Update §3/§8 mentions of `middleware.ts` → `proxy.ts` (Next 16.3 `proxy` not `middleware`). One-line. |
| **`job_postings.source` 4 → 10 values** | Pre-`aa576f6` schema hard-coded 4 sources; `006_update_job_sources.sql` correctly expanded the check and `profiles.monitored_sources` default. AGENTS §11’s inline DDL block still shows 4 values; the migration is the truth. | Keep migration as truth; update the inline §11 SQL snippet from `('hackernews','himalayas','remotejobs','remotive')` → 10-value form. No code revert. |
| **`/sign-in` + `/api/auth/callback`** | Present since `3e0188f` / `d4ea42b`; audit `prompts/audit-2026-09-12.md` confirmed magic-link, not password. | No drift — confirm spec already correct (it is). |

---

## 7. Things That Should NOT Be Canonized (Fix the Code, Leave the Spec)

### 7a. `app/api/debug/*` (×6) unauthenticated helpers

**Root cause.** Added in `aa576f6` as **developer scaffolding**: `anon-snapshots`, `counts`, `dashboard`, `env`, `session`, `table-access`. Useful during the 0→1 sprint where `skill_demand_snapshots` was empty and `worker` auth flow was new (`proxy.ts` + `layout.tsx` guard). Each returns “set/missing” or row counts, not values — so not secret-leaking, but they’re still an **unauthenticated diagnostic surface not in AGENTS §§8/18’s security gate**.

**Deliberate?** **No — temporary.** No spec ever called for them; `README` lists them under `debug only`, but AGENTS §18’s gate lists *no* debug routes and §12e’s “who can touch what” assumes only cron + user routes.

**Recommendation: Do NOT add them to AGENTS.md.** Instead:

- **Option A (preferred for prod):** Gate behind `CRON_SECRET` or `SUPABASE_SERVICE_ROLE_KEY` Bearer, or remove before public launch (next hardening sprint). Add one bullet to §18: “`app/api/debug/*` are dev-only; not present in production (or gated by `CRON_SECRET`).”
- **Option B (keep for internal demo):** Keep but document as gated: `GET /api/debug/*` requires `Authorization: Bearer $CRON_SECRET` (same pattern as cron). Do not list them as user-facing API routes.

Either is better than spec-ifying them as first-class routes.

### 7b. `GET /api/export` accepting session as fallback

**Root cause.** The commit’s `GET` added dual-auth so Dashboard export worked without a `dp_live_` key in dev (useful when `supabase/auth/session` is easier than minting a bearer). Prompt `2026-09-15-readme-refresh.md` *correctly* documented this as `via: "bearer" | "session"` in README’s API table.

**Deliberate?** **Half-deliberate convenience.**

**Patch — amend the spec, but tighten phrasing:** Current §3/§12e says bearer-only for export and “accepts at most one … never fall back silently.” Code falls back silently when no bearer is present (uses session). Two clean options:

- **Adopt with guard** (my recommendation): Update §12e/§5f-6 to “`GET /api/export` accepts either a valid `dp_live_` bearer (hashed lookup, `revoked_at` check) **or** a Supabase session — but if a bearer is present and fails, the handler rejects with `401 Invalid or revoked API key` and does **not** fall back to session (`export/route.ts:46`).” This preserves the convenience while keeping the security property (“no silent fallback past a bad key”) explicit.

- **Revert to spec** (stricter): Gate export behind bearer only; require devs to mint a key in Profile before testing export. Heavier, but matches original §12e.

Either is stable; just **don’t** leave the two documents saying different things.

---

## 8. Overall Answer: Should You Update AGENTS.md?

**Yes — update it, but for only about 60% of the deviations.**

Use this acceptance filter:

- **Update AGENTS.md to include (Adopt):**
  1. Lesson notes (the whole Feature 5 + `video_lessons`/`ai_daily_usage` + `LessonTheater`/`tutorial-lessons`) — the flagship undocumented feature.
  2. `job_summaries` one-liner in §11, and the 10-source DDL snippet fix.
  3. Provider indirection `AI_MODEL_EMBEDDING` + `AI_PROVIDER` aliases (already in README + `.env.example`).
  4. Tutorial card: theater, not inline expand (§6).
  5. Numbers that tuned for quality: `MIN_DURATION 600`, `"complete tutorial course"` + `TITLE_EXCLUDE_PATTERN`, `cap 7`, gap-report extended keys, `?skills&months&monthsCount` contract.
  6. File rename `middleware.ts → proxy.ts`.
  7. Clarify `/skills` fold (either restore or retire — don’t leave phantom).

- **Do NOT enshrine in AGENTS.md (fix in code instead):**
  - `app/api/debug/*` as first-class routes (gate or delete).
  - `WEEKLY_INDEX_BUDGET` as `10` canonically (raise env to 40 for prod, document the dual default).
  - Silent bearer→session fallback misread (reword §12e to the explicit guard behavior instead).

- **The cheapest way to do it:** Lift the already-written block from `prompts/2026-09-15-ai-lesson-notes-fix.md §Requirements > AGENTS.md amendment (Step 3)` verbatim (adjust `MAX_WINDOWS=8`/`DAILY_LIMIT=90`), and the `README` env/source/route tables — they’re codebase-grounded and prompt-reviewed.

Applying that patch removes the entire “spec lag” class from the previous report; what remains after is only the `/skills` product decision, which is your real open question — everything else is mécanique.

---

## 9. Suggested Commit Sequence (One Prompt Each, After Evans Approves Lesson Numbers)

1. **`prompts/2026-09-16-agents-amend-lesson-notes.md`** — the §15/§11/§12b/§16/§19 amendment + maybe `/skills` decision.
2. **`fix(spec): sync AGENTS.md to shipped codebase`** — apply just the Adopt list (no feature logic changes).
3. **`chore: gate debug routes behind CRON_SECRET`** — the only code change that pairs with the spec decision in 7a.

This keeps the previously-committed `fix(ai-lesson-notes)` logic untouched and makes the spec update independently reviewable.

---

*Evidence roots: `git show aa576f6` (66 files, `lib/lesson-generation.ts` new 552 lines, lessons/theater/jobs-profile all in one sprint), `prompts/2026-09-15-ai-lesson-notes-fix.md` Step 0 DB queries (39 rows stale), `prompts/2026-09-15-readme-refresh.md` Code Inspected (full codebase scan), `prompts/audit-2026-09-12.md` (Jobs/Skills missing pre-sprint), `.env.example` vs `lib/ai/provider.ts` vs `AGENTS.md §19` triad.*
