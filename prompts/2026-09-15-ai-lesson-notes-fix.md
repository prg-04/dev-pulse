# Implementation Prompt — AI Lesson Notes: Coverage, Content Guarding, AGENTS.md Amendment

## Goal

Fix two production symptoms in the undocumented **AI Lesson Notes** panel (synced notes next to the video player in `LessonTheater.tsx`): (1) coverage stops early relative to playback (1 block at 0:00 on 3h24m/1h38m videos, 4 blocks only up to 3:09 on 6h39m), (2) content quality collapses in the broken cases — verbatim transcript (including sponsor reads) in bullets and the same prose duplicated in the "code block" slot. Also fold the feature back into `AGENTS.md` as the fifth AI feature (the audit found no prompt ever spec'd it, Section 15 still says "exactly four places").

Scope is strictly additive, no breaking changes: `lib/lesson-generation.ts`, the lesson-generation portion of `app/api/cron/tutorial-index/route.ts`, migrations `007_video_lessons.sql` / `008_ai_quota.sql` (new columns only), `LessonTheater.tsx`'s render guard only if needed, and `AGENTS.md`. Do NOT touch `tutorial_chunks`, `tutorial_chapters`, `TutorialCard`, `POST /api/tutorial-search`, or any of the four existing AI features.

This prompt requires Evans's explicit approval of the numeric constants in *Decisions & Assumptions* before any build — per the Fix Prompt's approval gate.

---

## Step 0 Findings — Root Cause Confirmation (Evans's explicit condition, done before writing this prompt)

### 0a. Supabase lookup — all `video_lessons` rows are stale vs current model

- `CURRENT_LESSON_MODEL` in `lib/lesson-generation.ts:10` = `"gemini-3.6-flash-concept-v2"` (file birth Sep 14 17:43, never committed — `git ls-files` shows it as untracked `?? lib/lesson-generation.ts`, no history in `git log --follow`).
- Live DB query (service-role) on `2026-09-15T04:xx UTC`:
  - `video_lessons` count = **39 rows**.
  - Model distribution: `concept-synthesis-deterministic-v1` = 18 rows, `concept-synthesis-fallback-title-v1` = 21 rows. **Zero rows match `gemini-3.6-flash-concept-v2`.**
  - `tutorial_chunks` count = **0**, `tutorial_chapters` count = **0** (both empty — suggests a recent wipe/re-seed; `skill_index_status` for `typescript`/`react`/etc. still says `total_chunks=0, total_chapters=0` even though `last_indexed_at` is Sep 14-15).
  - `video_lessons` sample: `YS4e4q9oBaU` (the 4-block example's shape — headings "Why Go Was Created" 0:02, "Static Typing..." 1:06, "Concurrency..." 2:09, "Memory..." 3:09 with `go func() { // goroutine }` at 2:09) exists as `concept-synthesis-deterministic-v1`, 4 sections — this is the "good" case from the screenshots and is still stale vs current constant.
  - Sponsor-read / prose-as-code **is reproduced** in current DB, confirming the symptom is not just a screenshot anecdote:
    - `zF34dRivLOw` and `SqrbIlUwR0U` (deterministic model) — single section at 0:00, `heading: "Music this video is sponsored by"`, `key_points: ["[Music] this video is sponsored by Ed you onyx ..."]`, `code_example: "[Music] this video is sponsored by ..."` — transcript verbatim in both slots.
    - `dQw4w9WgXcQ` — single section at 0:01, `key_points` and `code_example` both contain `"We're no strangers to love ... Never gonna give you up ..."` (Rickroll transcript verbatim, prose in code block).
  - Fallback-title rows (21 rows, e.g. `X48VuDVvork` → `heading: "PODS & DEPLOYMENTS", key_points: ["Kubernetes Tutorial for Beginners — Full Course — TechWorld with Nana. CH 3: PODS & DEPLOYMENTS"]`, `start_seconds: 340`) — single section per video derived from chapter title alone, not transcript. This is the "1 block at 0:00" shape's second variant.

### 0b. Git log/blame — no prior transcript-passthrough fallback in version control

- `lib/lesson-generation.ts` is untracked, birth Sep 14, not in any commit (`git log --all --oneline --follow -- lib/lesson-generation.ts` returns empty, `git blame` fails with `no such path in HEAD`). There is therefore **no historical commit to inspect for a removed transcript-passthrough branch** in tracked history.
- However, the existence of `concept-synthesis-fallback-title-v1` (21 rows) proves a *prior* model path that generated title-only lessons when transcript was absent — that path is not in HEAD's code (HEAD's fallback when `chunks.length===0 && chapters.length>0` uses `chapters.map(label)` as chunk_text, not a bare title). This suggests the fallback-title generation was either in a prior uncommitted iteration or in a DB migration path that has since been replaced. The current `lib/lesson-generation.ts:341-342` already returns `null` when `chunks.length===0 && allowedTimestamps===0`, which should have produced `404` not a fallback row — so those 21 rows must predate the current guard logic.

### 0c. Interpretation for scoping Steps 2–3

- **If the three screenshot video_ids are among the stale 39, backfill alone will cause regeneration on the next weekly `tutorial-index` run** (because `video_lessons.model != CURRENT_LESSON_MODEL` triggers `needsRegen` in both the new-video path `app/api/cron/tutorial-index/route.ts:454-456` and the backfill pass `534-536`), *provided quota allows it*.
- However, the sponsor-read prose-as-code rows prove that **even the deterministic model (`concept-synthesis-deterministic-v1`) — which has the current system prompt and narration guard — still produced prose in both bullet and code_example**. This means **backfill alone will re-run the same model with the same prompt and likely reproduce the same defect** on those transcripts. The working theory that "stale model = already fixed" is therefore **false** for the guard gap.
- **Conclusion for Step 2:** The prose-as-code and verbatim-copy guards are needed **regardless** of Step 0. They must not be scoped down.
- **LessonTheater render does NOT need a second defensive patch** if Step 2 guarantees `code_example` is nulled when not code — but that must be verified (see Requirements).

---

## Skills Read

- `supabase` — Auth (`@supabase/ssr`, `supabase.auth.getUser()`), RLS `auth.role() = 'authenticated'` for `video_lessons`, service-role only in `lib/supabase/service-role` / `app/api/cron/*`, `security_invoker` views.
- `supabase-postgres-best-practices` — `pgvector` cosine distance, `ON CONFLICT (video_id) DO UPDATE` for `video_lessons`, `ivfflat` not needed for lessons (no vector), but index `video_lessons_generated_at` exists.
- `vercel/next.js` — App Router `vercel.json` cron auth `CRON_SECRET`, `runtime = "nodejs"`, `dynamic = "force-dynamic"`.
- `ai-sdk` — `generateObject` / `generateText` / `embed` / `embedMany` via `lib/ai/provider.ts` (`createTextModel()`, `getProviderMeta()`), provider-agnostic model string, fallback `generateText` + JSON parse.
- `vercel-react-best-practices` — client vs server (`LessonTheater.tsx` is `"use client"`), `useEffect`/`useCallback` fetch patterns, `createPortal` theater.
- `secure-coding` — no `NEXT_PUBLIC_` leakage for `YOUTUBE_API_KEY`, `API_KEY_PEPPER`, `CRON_SECRET`, `AI_MODEL`; `googleapis.com/youtube` only in `app/api/cron/tutorial-index`.
- `impeccable` + `shadcn/ui` — dark palette `#020617`/`#0F172A`/`#1E293B`/`#14B8A6`, `Card`/`Badge`/`Progress` for AGENTS edits verification.

---

## Code Inspected

- `lib/lesson-generation.ts` (444 lines, untracked, birth Sep 14) — `CURRENT_LESSON_MODEL`, `LessonSectionSchema` (code_example optional max 800), `LessonWindowOutputSchema` (1-8 sections per window), `LessonOutputSchema` (max 40 per video), `LESSON_SYSTEM_PROMPT` + `LESSON_USER_PROMPT_TEMPLATE`, `filterNarrationPhrasing`, `filterToAllowedTimestamps`, `WINDOW_CHAR_BUDGET=6000`, `MAX_WINDOWS_PER_VIDEO=3` (was 8, now 3 per comment), `buildWindows()` with tail-merge, `generateForWindow()` (generateObject→fallback generateText, maxOutputTokens 1200), `generateLessonForVideo()` (per-window loop, merge, dedupe, slice 40).
- `app/api/cron/tutorial-index/route.ts` (794 lines) — `WEEKLY_INDEX_BUDGET = Number(env) ?? 10`, `MAX_VIDEOS_PER_SKILL=3`, `CHAPTER_MIN_LINES=3`, `CHUNK_DURATION_SECONDS=60`, `DAILY_GENERATE_LIMIT=20`, `ai_daily_usage` table + `inMemoryGenerateCount` fallback, `getTodayUsage` / `incrementGenerateUsage` / `hasGenerateQuotaForVideo` (recomputes windows, caps to 3, checks `generate_calls + windows <= 20`), `indexSkill()` new-video loop (chapters→transcript chunks→embed→upsert→lesson generation gated by quota) and backfill loop (same quota gate), per-skill `for (const skill of selectedSkills)` outer loop with per-skill try/catch.
- `app/api/tutorial-lessons/[video_id]/route.ts` (72 lines) — auth `createClient().auth.getUser()` → 401, service-role read `video_lessons` select, 404 on missing.
- `components/gap-report/LessonTheater.tsx` (412 lines) — `lessonCache`/`lessonErrorCache` Maps, `fetchLesson()` GET, `pollRef` 700ms `getCurrentTime` for highlight only, `activeSectionIdx` derivation, `embedSrc` with `enablejsapi=1`, render `lesson.sections.map` with `{sec.code_example && <pre>}` (no shape check).
- `supabase/migrations/007_video_lessons.sql` (24 lines) + `008_ai_quota.sql` (13 lines) — `video_lessons` + `ai_daily_usage` definitions, RLS.
- `lib/ai/provider.ts` (281 lines) — `AI_PROVIDER` inference, `getProviderMeta()` (model/embeddingModel/baseURL/apiKey), `createTextModel()`/`createEmbeddingModel()` (google/anthropic/mistral → openai-compatible fallback).
- `.env.local` — `AI_PROVIDER=google`, `AI_MODEL=gemini-3.6-flash`, `AI_MODEL_EMBEDDING=gemini-embedding-001`, `GOOGLE_GENERATIVE_AI_API_KEY=...`, `WEEKLY_INDEX_BUDGET=10`, `CRON_SECRET`, `YOUTUBE_API_KEY`, `GITHUB_TOKEN`.
- `vercel.json` — single weekly cron `0 2 * * 0` for tutorial-index (no daily quota consumer).
- `AGENTS.md` — Sections 8, 11, 12b, 15, 16, 18 current text (see diff below).
- `prompts/` (14 files, latest `2026-09-14-profile-gap-tutorial-refresh.md`) — none mention lesson notes (audit confirmed).

---

## Decisions & Assumptions — Proposed Constants (REQUIRES EVANS'S APPROVAL — DO NOT BUILD UNTIL APPROVED)

### Design gap flagged

- `tutorial-index` runs **once weekly** (Sunday 02:00 UTC), but `DAILY_GENERATE_LIMIT` resets **daily**. The other 6 days' quota is currently **unused**. This is a design gap: the weekly run's worst case must fit inside one day's limit, or some videos are left without lessons until the next week. The audit's 39 video_lessons vs `WEEKLY_INDEX_BUDGET=10` suggests we already under-fill because `tutorial_chunks` is 0 — but with 9 free days later, no catch-up runs.

**Two options, presented with cost/complexity comparison:**

| Option | What changes | Complexity | Cost | Headroom |
|---|---|---|---|---|
| **(a) Single-day limit raise** — raise `DAILY_GENERATE_LIMIT` high enough to cover one full weekly run's worst case + backfill, keep weekly schedule | One constant change in `app/api/cron/tutorial-index/route.ts` (and matching `lib/lesson-generation.ts` comment if any). No new routes/crons. | Minimal (1-line + migration comment) | One-time higher day-of-run cost, but quota is per-day not monthly so average cost is still weekly worst / 7 ≈ 13-34 calls/day | Requires picking a limit that survives `MAX_WINDOWS` raise |
| **(b) Multi-day catch-up** — keep daily limit modest, but add a lightweight mechanism to consume remaining quota on subsequent days for videos skipped on Sunday | New: either a second daily cron entry for catch-up (e.g. `0 2 * * 1-6` hitting a `?mode=backfill-only` branch), or a "spillover" where `GET /api/cron/tutorial-index` when called on non-Sunday only processes videos with missing/stale lessons (no new YouTube search). Or simplest: keep existing weekly cron but also run the same handler via Vercel's daily ingest dispatch (chain after ingest). | Moderate (new `vercel.json` entry or branching logic + `mode` param, must ensure not to double-search YouTube and burn search quota) | Spreads cost across days, lower peak; but adds scheduling complexity and requires idempotency guard | Better for free-tier, but more code to maintain |

**Recommendation: (a) for now.**

- The production provider is **Google Gemini** (`gemini-3.6-flash` + `gemini-embedding-001`). Gemini free tier is `60 requests/min` but paid is ~$0.075 / 1M input, $0.30 / 1M output for Flash (verify against `https://ai.google.dev/pricing` — this prompt used the spec's instruction to check `lib/ai/provider.ts` not assume free-tier). A full weekly run of 30 videos × 8 windows = 240 calls, each ~1500 input + 1200 output ≈ 2700 tokens → ~648k tokens → ~$0.12-0.20 per week. This is negligible — the free-tier daily-limit paranoia (20/day) is over-fitted to a legacy constraint.
- Option (b) is the right follow-up if Evans ever moves to a paid Anthropic/Claude model where per-call cost is 10-20× higher, but it is not needed to fix coverage today.
- If Evans prefers (b) for philosophical reasons (keep per-day burn low), implement (b) with a `mode=backfill` query param that skips `searchYouTubeVideos` and only processes `video_lessons.model != CURRENT` rows — that detail is left to approval discussion.

### Proposed constants (explicit numbers for approval)

| Constant | Current | Proposed | Rationale |
|---|---|---|---|
| `MAX_WINDOWS_PER_VIDEO` (`lib/lesson-generation.ts:171`) | 3 (was 8) | **8** | Matches the pre-reduction history ("was 8, now 3" comment) and is the point where the 6h39m test case needs no merging (399 chunks ≈ 48k chars → 8 windows exact). At 6, the tail still merges (8→6) and still truncates. At 8, the merged tail vanishes and `tail-truncation` is resolved without changing merge logic. |
| `DAILY_GENERATE_LIMIT` (`app/api/cron/tutorial-index/route.ts:225`) | 20 | **90** (if option a) or **30** (if option b) | 90 covers worst case at `MAX_WINDOWS=3` already (10×3×3=90). Proposing **90** even with `MAX_WINDOWS=8` is insufficient (would need 240), so if Evans approves `MAX_WINDOWS=8`, the paired limit must be **240** for option (a). Present both: `MAX_WINDOWS=8 + LIMIT=240` as the honest worst-case pair, or `MAX_WINDOWS=8 + LIMIT=90 + multi-day catch-up` as the hybrid. This prompt recommends **MAX_WINDOWS=6 + LIMIT=100** as a balanced middle if Evans worries about 8 being too high (6 still needs merging but less severe, 100 covers 10×3×6=180 only with one day's headroom, but catch-up covers remainder). **Evans must pick one row in the table below.** |
| Premium row | — | `MAX_WINDOWS=8 + DAILY_LIMIT=240` (a) | Full coverage, tail never merged, one Sunday run covers worst case. Cost ~$0.15/week on Gemini Flash. |
| Balanced row | — | `MAX_WINDOWS=6 + DAILY_LIMIT=100` (a) or `MAX_WINDOWS=6 + DAILY_LIMIT=30` (b with catch-up) | Tail merged once (8→6), but truncation is smaller (tail contains ~12k → 6k truncated to half, still better than current 12k→6k starved). |
| Minimal row | — | `MAX_WINDOWS=3 + DAILY_LIMIT=90` (a) | Only raises daily limit, no tail fix — leaves 6h39m video still merged + truncated, not recommended; included to show why 3 is insufficient |

> **Evans to approve exactly one of the three rows above.** This prompt does not invent a silent choice — it presents the table and waits.

### Tail-truncation — does more windows alone resolve it?

- At `MAX_WINDOWS=8`, a 6h39m video's 8 natural windows fit without merging, so no tail merge and the only truncation is the per-window `.slice(0, 6000)` (already sized to leave headroom vs 8000). More windows alone **does** resolve it for this test case.
- At `MAX_WINDOWS=6`, tail still merges (8→6) but tail chunk count drops from ~12k chars to ~8k, so truncated loss is smaller — still a compromise.
- Therefore: if Evans approves 8, no merge-logic change is needed. If Evans approves 6 or 3, also change the merged-tail's transcript slicing to split the tail into proper sub-windows rather than `.slice(0, 6000)` on a bloated merged chunk — but that is already the window logic itself; the simpler fix is just raising to 8. Recommend 8.

### Cost estimate (checked against current provider)

- Provider from `.env.local` / `lib/ai/provider.ts`: `AI_PROVIDER=google`, `AI_MODEL=gemini-3.6-flash`, `AI_MODEL_EMBEDDING=gemini-embedding-001`.
- Pricing assumption (verify live before build — `ai.google.dev/pricing`): Flash input $0.075/1M, output $0.30/1M. Embedding `gemini-embedding-001` is free-tied or negligible. Worst-case weekly run: 30 videos × 8 windows = 240 generation calls. Avg input ~1500 tokens (6000 chars ≈ 1500 tokens) + output max 1200 = 2700 tokens/call → 648k tokens/week → ~$0.05 input + $0.08 output ≈ **$0.13/week**. Even at 2× due to fallback `generateText` retries, < $0.30/week.
- If production ever switches to `anthropic:claude-sonnet-4-6` (example in AGENTS §9), per-call cost is ~10× — then option (b) becomes preferable. Evans's sign-off on provider-specific cost is part of approval.

### Guard scope decision

- `filterNarrationPhrasing` and `filterToAllowedTimestamps` remain untouched — new guards are composable siblings (`filterCodeExampleShape`, `filterVerbatimCopy`), following the same `sections → filtered sections` lodash pattern.
- `LessonTheater.tsx` render guard (`{sec.code_example && <pre>}`) is verified as-is — if Step 2 nulls prose `code_example`, no second render patch is needed. Defensive rendering (e.g., hiding `<pre>` when `code_example` looks like prose) is deferred; single source of truth is generation-side.

---

## Files You Will Touch

1. `lib/lesson-generation.ts` — add two guard functions, wire them into `generateLessonForVideo()` after existing filters; update `MAX_WINDOWS_PER_VIDEO` to approved value; keep `WINDOW_CHAR_BUDGET=6000` unless tail logic needs changing for approved constant.
2. `app/api/cron/tutorial-index/route.ts` — raise `DAILY_GENERATE_LIMIT` to approved value; update `hasGenerateQuotaForVideo` cap `Math.min(windows, MAX_WINDOWS)` to match; add comment about weekly-vs-daily quota gap and, if option (b) approved, add `mode` / `backfill-only` branching or second `vercel.json` cron entry that only processes stale/missing lessons.
3. `supabase/migrations/007_video_lessons.sql` — additive only: no drops/renames; if any new column is needed for quota tracking it goes in `008` or a new `009` migration (e.g., `generation_attempts` if needed for catch-up — but not required for option (a)).
4. `supabase/migrations/008_ai_quota.sql` — additive only; optionally add comment referencing `DAILY_GENERATE_LIMIT` and weekly-vs-daily gap.
5. `components/gap-report/LessonTheater.tsx` — **inspect only**; confirm `sec.code_example && <pre>` is sufficient after generation-side guard, no edit expected unless guard review finds edge case.
6. `AGENTS.md` — insert the five amendment blocks verbatim from the Fix Prompt's Step 3 (adjust only approved numbers — use the final approved `MAX_WINDOWS`/`DAILY_LIMIT` values, not placeholders).
7. `vercel.json` — only if option (b) approved (add catch-up schedule); otherwise no change.
8. `prompts/2026-09-15-ai-lesson-notes-fix.md` (this file) — trace file.

**Explicitly NOT touched:** `tutorial_chunks`, `tutorial_chapters` tables/migrations, `TutorialCard`, `POST /api/tutorial-search`, any of the four existing AI features (Gap Report, Trend summary, Tutorial matching, Job posting restructuring).

---

## Requirements

### Coverage fix (Step 1 — after Evans approves constants)

- In `lib/lesson-generation.ts`:
  - `MAX_WINDOWS_PER_VIDEO` — change 3 → approved value (6 or 8). Update trailing comment to preserve history: `// was 8, now 3 → now <approved> (see prompts/2026-09-15-ai-lesson-notes-fix.md § Decisions)`.
  - If approved is 8, `buildWindows()` tail-merge will naturally not fire for the 6h39m test case (8 natural windows == cap), resolving tail-truncation without logic change. If approved is 6, tail still merges 8→6 — document that residual truncation is acceptable or add a sub-split for the tail (Evans to confirm whether sub-split is wanted; prompt recommends avoiding it by approving 8).
  - Keep `WINDOW_CHAR_BUDGET=6000` (headroom vs flat 8000) — do not revert to 8000.
- In `app/api/cron/tutorial-index/route.ts`:
  - `WEEKLY_INDEX_BUDGET` and `MAX_VIDEOS_PER_SKILL` remain 10 and 3 (no change).
  - `DAILY_GENERATE_LIMIT` → approved value (90/100/240 per table). Update comment to explain weekly-vs-daily gap and why the chosen value covers worst case or why catch-up exists.
  - `hasGenerateQuotaForVideo` — its internal `Math.min(windows, 3)` must track `MAX_WINDOWS_PER_VIDEO` (use imported constant or duplicate with same value + comment `// matches MAX_WINDOWS_PER_VIDEO`).
  - If option (b) approved: add a `mode` query param (`?mode=full` default weekly, `?mode=backfill`) — weekly Sunday run does full indexing + lesson generation; daily 1-6 runs skip `searchYouTubeVideos`/`videos.list`/`chunk upsert` and only process `video_lessons WHERE model != CURRENT_LESSON_MODEL OR missing` via the existing backfill loop, still gated by daily limit. Gate YouTube search quota separately (already weekly-limited). Document in `AGENTS.md` Section 12b Step 12.

### Guards (Step 2 — needed regardless of Step 0 staleness)

- **`code_example` shape validation** — new function `filterCodeExampleShape(sections: LessonSection[]): LessonSection[]` in `lib/lesson-generation.ts`, alongside `filterToAllowedTimestamps`/`filterNarrationPhrasing`:
  - Heuristic: reject / null out `code_example` if it doesn't look like code. Checks: contains at least one of `{}`, `[]`, `()`, `;`, `=>`, `->`, `=`, `.`, `/`, `:` followed by typical code patterns, or indented lines, or keywords like `func `, `def `, `import `, `kubectl `, `go func`, `const `, etc. Length > 10, not purely prose sentence. If fails, set `code_example = undefined` (strip) not drop whole section — unless both `code_example` and `key_points` are bad then section may be dropped by next guard.
  - Log: `console.warn("[lesson-generation] Dropping prose code_example at ${s.start_seconds}s: ...")` matching existing warning style.
  - Must not over-engineer a parser — simple punctuation/structure heuristic, allowlist-based.
- **Verbatim-copy detection** — new function `filterVerbatimCopy(sections: LessonSection[], transcriptWindows: Map<number, string>): LessonSection[]` (or simpler: compare each `key_points` entry and `code_example` against the concatenated window transcript for that window — the same `transcript` string passed to that window's generation call):
  - Normalize both (lowercase, collapse whitespace, strip punctuation) and check for near-exact substring match of length ≥40 (the existing `transcript.trim().length < 40` threshold) with overlap >80%. Alternatively use a sliding 60-char window: if any 60-char slice of the bullet appears verbatim in transcript (case-insensitive), it's a copy, not synthesis.
  - On match: drop that bullet (for `key_points`) or null out `code_example`. If a section loses all bullets, drop the whole section (same as narration filter).
  - Log similarly: `console.warn("[lesson-generation] Dropping verbatim bullet at ${s.start_seconds}s: ...")`.
  - Directly targets `dQw4w9WgXcQ` (Rickroll lyrics verbatim) and `zF34dRivLOw`/`SqrbIlUwR0U` (sponsor reads).
- Wire both new filters into `generateLessonForVideo()` after the two existing filters, in order: `filterToAllowedTimestamps → filterNarrationPhrasing → filterCodeExampleShape → filterVerbatimCopy → dedupe/sort`. Keep them small, composable, testable.
- Do NOT modify `filterNarrationPhrasing` / `filterToAllowedTimestamps` bodies.
- Verify `LessonTheater.tsx` line 392 `sec.code_example && <pre>` is sufficient — no second render-side prose check needed if generation guarantees code-only `code_example`.

### AGENTS.md amendment (Step 3 — apply as part of this fix, factual corrections only)

Insert verbatim (adjust only approved numbers where `MAX_WINDOWS`/`DAILY_LIMIT` appear):

- **Section 15 new Feature 5** after Feature 4 (see Fix Prompt's Step 3 block for exact text — starts `### Feature 5 — AI Lesson Notes`).
- **Section 11 new tables** `video_lessons` + `ai_daily_usage` after `skill_index_status` (SQL as in migration `007`/`008`).
- **Section 12b Step 12** after step 11's `skill_index_status` update (starts `**Step 12 — Lesson generation (chained, same run).**`).
- **Section 16** — no, find and update the line `AI is used in exactly four places. Nowhere else.` → `AI is used in exactly five places. Nowhere else.` and add Feature 5 to the enumerated list at top of Section 15.
- **Section 8** responsibilities table — Vercel Cron row mentions lesson-note generation.
- **Section 18** tutorial indexing pipeline checks — add the three new check bullets.

Keep `AGENTS.md`'s ` <!-- BEGIN:nextjs-agent-rules -->` block untouched.

---

## Security Checks (must pass before marking complete)

```bash
grep -r "SERVICE_ROLE" app/           # 0 outside lib/supabase/service-role + app/api/cron/*
grep -r "SUPABASE_SERVICE" app/components/  # 0
grep -r "OPENAI_API_KEY" app/         # 0
grep -r "YOUTUBE_API_KEY" app/         # 0
grep -r "RESEND_API_KEY" app/         # 0
grep -r "GITHUB_TOKEN" app/            # 0
grep -r "API_KEY_PEPPER" app/          # 0 in app/components, allowed only app/api/keys* + lib/api-keys.ts
grep -r "AI_MODEL" app/               # 0 in app/components, allowed only app/api/* + lib/ai/*
grep -r "@anthropic-ai/sdk" app/      # 0
grep -r "openai" app/components/      # 0
grep -r "resend" app/components/      # 0
grep -r "octokit" app/components/     # 0
grep -rl "googleapis.com/youtube" app/ | grep -v "app/api/cron/tutorial-index"  # 0
grep -rl "api.github.com" app/ | grep -v "app/api/cron/github-sync"            # 0
grep -rn "console.log.*apiKey\|console.log.*rawKey" app/  # 0
# Verify every profile-scoped route touched still calls supabase.auth.getUser() server-side and 401s before Supabase (or hashed bearer for /api/export only)
# Verify no NEXT_PUBLIC_ leakage — curl Network tab + window.__ + source map search for pepper/tokens returns 0
npx tsc --noEmit        # 0 errors
npx eslint .            # 0 warnings in new files
npx next build          # 0 errors
```

---

## Acceptance Criteria

- **Coverage:** For the 6h39m video test case (the audit's 4-block at 0:02/1:06/2:09/3:09, currently tail-starved), after fix the generated `video_lessons.sections` must include sections with `start_seconds` > 20000 (i.e. beyond 3:09) — proving tail windows are no longer starved. The two shorter broken cases (3h24m/1h38m, currently 1 block at 0:00) must produce ≥3 sections each, not 1. Verify via `select video_id, jsonb_array_length(sections), sections->0->>'start_seconds' from video_lessons where video_id in (...)`.
- **Quota mismatch flagged:** This prompt's Decisions section explicitly calls out the weekly-vs-daily gap and presents both (a) and (b); the approved choice is reflected in the built constants.
- **Verbatim sponsor / Rickroll regression:** After fix, `zF34dRivLOw`, `SqrbIlUwR0U`, `dQw4w9WgXcQ` when regenerated (backfill) must NOT contain a `key_points` entry that is a near-verbatim copy of sponsor/Rickroll transcript, and must NOT have a `code_example` that is the same prose. Verify: `select sections from video_lessons where video_id in ('zF34dRivLOw','SqrbIlUwR0U','dQw4w9WgXcQ')` → bullets are synthesized or section is dropped (404/fewer sections is acceptable), code_example is null or real code.
- **Code shape:** A good 4-block example `YS4e4q9oBaU` still has exactly one real code block `go func() { // goroutine }` at 2:09, not prose; no section has a prose code_example.
- **Backfill idempotency:** Re-running `GET /api/cron/tutorial-index` with `Authorization: Bearer $CRON_SECRET` does not exceed `DAILY_GENERATE_LIMIT` (check `ai_daily_usage.generate_calls` ≤ limit) and does not duplicate `video_lessons` rows (`ON CONFLICT (video_id) DO UPDATE` holds).
- **Quota non-blocking of chunks:** A video skipped for quota still has its `tutorial_chunks`/`tutorial_chapters` rows intact (verify count before/after).
- **AGENTS.md:** Section 15 says "exactly five places", Feature 5 block present; Section 11 has `video_lessons` + `ai_daily_usage`; Section 12b has Step 12; Section 8 Vercel Cron row mentions lessons; Section 16 line updated.
- **No regression in existing features:** `npx tsc --noEmit` zero, `npx next build` succeeds, `POST /api/tutorial-search` chapter-first badge logic unchanged, Gap Report market alignment still deterministic, no `any`.
- **Browser check:** Gap Report → click a gap skill → TutorialCard → LessonTheater → AI Lesson Notes panel shows synthesized bullets (not sponsor text), code blocks only when real code, and active highlight follows playhead past 10:01 on a long video without coverage gap.

---

## Manual Test Steps

1. **Pre-check:** `npx tsc --noEmit` and the six `grep -r` gates above. Inspect `.env.local` that `AI_PROVIDER`/`AI_MODEL` are as expected (`google`/`gemini-3.6-flash`).
2. **Step 0 confirm:** Re-run the service-role queries in *Step 0 Findings* to show `video_lessons` stale distribution (`concept-synthesis-deterministic-v1` vs `gemini-3.6-flash-concept-v2`) and sponsor rows. Capture output as evidence for Evans.
3. **Seed long video:** Find a `video_lessons` video with duration >6h (the 6h39m one is `YS4e4q9oBaU` type — but need a 6h video's `video_id` from `tutorial_chunks` if chunks were wiped, use `YS4e4q9oBaU` as proxy or re-index a known long video via `curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/tutorial-index` and observe `skill_index_status` for the long-video skill.
4. **Quota test:** With `ai_daily_usage` cleared (`delete from ai_daily_usage where usage_date = current_date`), trigger `GET /api/cron/tutorial-index` and watch logs for `Generated lesson for ... via ...` counts and `Skipping lesson ... quota exhausted` warnings. Verify `ai_daily_usage.generate_calls` after run ≤ approved limit.
5. **Content guard test (unit):** In a node REPL, import `filterCodeExampleShape` and `filterVerbatimCopy` from `lib/lesson-generation.ts` — feed a section with `code_example: "[Music] this video is sponsored by ..."` and a transcript window containing that exact string → expect `code_example` nulled. Feed a section with `code_example: "go func() { // goroutine }"` → expect kept. Feed a `key_points` entry that is verbatim Rickroll lyrics → expect that bullet dropped.
6. **End-to-end regeneration:** After building, call `curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/tutorial-index` (or wait for next weekly run) — verify `video_lessons` for `zF34dRivLOw`/`SqrbIlUwR0U`/`dQw4w9WgXcQ` are now either absent (0 sections → null → no row) or regenerated with null `code_example` and without sponsor verbatim.
7. **Browser:** Sign in via magic link, visit `/gap-report`, click a gap skill's first `TutorialCard` → theater opens → AI Lesson Notes panel shows ≥3 note blocks on a previously-broken video, playhead at 10:01 highlights the correct block (not stuck at 0:00), code blocks appear only on real code sections.
8. **AGENTS.md:** Diff `AGENTS.md` against Fix Prompt's Step 3 blocks — verify Feature 5 text is verbatim (except approved numbers), Section 11 tables added, Section 12b Step 12 present.
9. **Build & lint:** `npx tsc --noEmit && npx next build && npx eslint .` — all green, zero warnings on new guards.
10. **Security re-verify:** Re-run the six grep gates plus `grep -rn "googleapis.com/youtube" app/ | grep -v "app/api/cron/tutorial-index"` and check browser Network — no `GOOGLE_GENERATIVE_AI_API_KEY` in responses.

Verify that no API keys are exposed to the browser, and that every profile-scoped route validates the Supabase session or API key server-side, before marking complete.
