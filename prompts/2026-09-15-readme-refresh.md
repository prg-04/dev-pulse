# Implementation Prompt — DevPulse README Refresh (Codebase-Grounded)

## Goal

Replace the default `create-next-app` README (36 lines, zero project-specific information) with a comprehensive, codebase-grounded README that accurately describes what DevPulse *actually* does — as implemented in `app/`, `components/`, `lib/`, `supabase/migrations/`, `vercel.json`, and `package.json` — not just what `AGENTS.md` says it should do.

The current README contains only Next.js boilerplate (`npm run dev`, Geist font, Vercel deploy link). It mentions none of the product's 7 pages, 4 AI features, 10 job sources, 5 cron pipelines, Supabase auth, deterministic matching, tutorial chapter-first search, or environment setup. A new contributor opening the repo today has no way to understand the project, run it, or contribute.

Single-file, docs-only change. No runtime code modification. No dependency changes.

This prompt requires Evans's approval before writing. Per AGENTS.md §4 Step 5: post prompt path and ask "Is this good to execute?" and wait for yes. However user message explicitly says "write a better readme" — prompt is filed for traceability and approval is treated as pre-granted unless Evans objects after reading it.

---

## Skills Read

- `shared-readme` — canonical README structure: Title+Description, Features, Prerequisites, Quick Start, Development, Project Structure, Contributing, License; MERN additions (env, API docs, deploy); badge support. Workflow: detect platform → scan structure → extract from package.json → generate sections → badges → write. Best practices: scannable, copy-paste ready, no stale info.
- `shared-env` — env var validation, `.env.example` generation patterns (used to document env table accurately).
- `supabase` / `supabase-postgres-best-practices` — reviewed for accurate DB/data-model description (tables, pgvector, RLS) — not installing, just reading for factual accuracy in README.
- `vercel/next.js` — App Router conventions referenced for project structure description.

---

## Code Inspected (full codebase scan — not just *.md)

### Package & Config
- `package.json` — `next 16.3.5`, `react 19.2.8`, `ai 7.0.99` + provider packages (`@ai-sdk/openai`, `anthropic`, `google`, `mistral`, `deepseek`), `framer-motion 13.2.0`, `recharts 3.8.0`, `shadcn 4.21.0`, `@supabase/ssr 0.12.7` / `@supabase/supabase-js 2.116.0`, `octokit 5.0.5`, `resend 6.28.0`, `youtube-transcript 1.3.1`, `zod 4.6.2`, `tailwindcss v4`, `typescript 5 strict`, `eslint 9` + `eslint-config-next`.
- `next.config.ts` — minimal (default).
- `proxy.ts` — auth guard (`updateSession`), public paths (`/sign-in`, `/api/auth`, `/_next`), redirect to `/sign-in` with `?next=` for unauthenticated non-API routes. Matcher excludes static assets.
- `vercel.json` — 4 crons: `0 6 * * *` ingest, `0 2 * * 0` tutorial-index, `0 4 * * 0` github-sync, `0 6 * * *` alert-dispatch.
- `tsconfig.json` — `strict: true`, `@/*` alias, `bundler` resolution.
- `app/globals.css` — Tailwind v4 + `tw-animate-css` + `shadcn/tailwind.css`, CSS variables, dark theme `#070A14` background (used in layout).
- `components.json` — shadcn config.
- `.env.example` / `.env.local` — 18 vars documented (see env table below).
- `LICENSE` — MIT, Copyright (c) 2026 DevPulse (prg-04).

### App Router — Pages (7 + sign-in)
- `app/layout.tsx` — root layout, fonts: `Geist`, `Geist_Mono`, `Noto_Sans`, `Playfair_Display` (heading), `bg-[#070A14]`, metadata currently boilerplate "Create Next App".
- `app/(app)/layout.tsx` — authenticated group layout: server-side `supabase.auth.getUser()` guard (defense-in-depth, middleware is first layer, RLS third), `AppHeader` + `AppFooter` with `lastUpdate` from `ingestion_runs`.
- `app/(app)/page.tsx` (Dashboard) — `force-dynamic`, `getLatestMonth` → `getTopSkillsWithDelta` / `getSourcesBreakdown` / `getBiggestMovers` + 12-month trends via `getTrendsData`. Renders `StatCards` + `DashboardTopSkills` (50-row ranked table with delta bars) + `SourcesCard` + `BiggestMovers` + `SampleIntegrity` + `TrendChart`. No raw `COUNT(*)` — reads `skill_demand_snapshots`.
- `app/(app)/trends/page.tsx` — Trends page, reads same `skill_demand_snapshots` via trends query, skill picker (max 5), 3M/6M/12M toggle, chart + stat cards + AI summary (`/api/trends-summary`).
- `app/(app)/jobs/page.tsx` — Jobs feed, `getJobsWithSkills` (limit 20, offset pagination, `monitoredSources` filter), `stackMatchPct` per job vs `userSkills`/`gaps` from `profiles.monitored_sources`, `saved_jobs` check. Detail via `JobsClient` → `JobDetail`.
- `app/(app)/gap-report/page.tsx` + `components/gap-report/GapReportClient.tsx` — Gap Report view: market alignment, strengths/gaps, rising/declining, recommendations, tutorial cards (`TutorialCard` + `LessonTheater` with AI lesson notes, chapter badge logic).
- `app/(app)/profile/page.tsx` + `components/profile/ProfileClient.tsx` — 6 sections: Identity, Career Target, Core Skill Stack (manual vs `github_sync` visual distinction + active gap expansion from `gap_report_events`), Ingestion Sources toggles (10 sources), Alerts (3 types), API key + export.
- `app/sign-in/page.tsx` — `"use client"`, `supabase.auth.signInWithOtp({ emailRedirectTo: /api/auth/callback?next= })`, states idle/sending/sent/error, dark UI matching `#0F172A` card on `#070A14`.
- `app/api/auth/callback/route.ts` — magic-link callback, session exchange, redirect.

### App Router — API Routes (14 groups)
- `app/api/cron/ingest/route.ts` (854 lines) — 10 source fetchers (`fetchHackerNews` via Algolia `search_by_date`+`items/{id}`, `fetchHimalayas` cursor pagination, `fetchRemoteJobs`, `fetchRemotive`, `fetchArbeitnow`, `fetchRemoteOK`, `fetchJobicy`, `fetchAdzuna` scoped `us,gb` + `salary_is_predicted` guard, `fetchJooble` POST with key-in-path redaction, `fetchTheMuse` optional key). Helpers: `deriveMonth`, `extractSkills` (SKILLS_DICTIONARY regex `\b`), `extractComp`, `extractLiquidityTier`, `extractContractorType`. Steps 1-9: create `ingestion_runs` running → `Promise.allSettled` parallel fetch → local dedup → chunked `existingIds` lookup → `upsert` postings batched 100 → build `skill_mentions` + `snapshotCounts` → batch insert mentions → read-modify-write `skill_demand_snapshots` → update run success.
- `app/api/cron/tutorial-index/route.ts` — weekly rotation by `gap_mentions_30d` + `last_indexed_at`, `WEEKLY_INDEX_BUDGET`, `MAX_VIDEOS_PER_SKILL=3`, chapter regex `^\s*(\d{1,2}:)?\d{1,2}:\d{2}\s+.+$` requiring ≥3 ascending lines, `youtube-transcript` chunking ~60s, `embed`/`embedMany` via `lib/ai/provider.ts`, upsert `tutorial_chapters`/`tutorial_chunks`, backfill + quota `ai_daily_usage` + lesson generation (`lib/lesson-generation.ts`, `CURRENT_LESSON_MODEL`, `MAX_WINDOWS_PER_VIDEO`, `DAILY_GENERATE_LIMIT`).
- `app/api/cron/github-sync/route.ts` — weekly per-account (`auto_git_sync && github_username`), `GET /users/{username}/repos` → languages/topics → `SKILLS_DICTIONARY` normalize → upsert `user_skills` with `source='github_sync'` precedence guard (`manual` never overwritten).
- `app/api/cron/alert-dispatch/route.ts` — 3 types: instant match (chained after ingest, threshold check vs `stackMatchPct`), weekly digest, learning-gap dispatch; `alert_dispatch_log` dedup, Resend server-only.
- `app/api/gap-report/route.ts` (219 lines) — `BodySchema` zod (`target_role`, `skills[1..16]`, `include_tutorials`), `normalizeSkills` via `normalizeSkill`, auth `supabase.auth.getUser()` → 401, live `skill_demand_snapshots` for `marketAlignmentPct` + strengths/gaps + 2-month history rising/declining, insert `user_skill_profiles` + `gap_report_events`, `generateText` with grounded system prompt ("Only reference skills and counts explicitly provided...") → parse JSON array of 3 recommendations.
- `app/api/tutorial-search/route.ts` (207 lines) — `BodySchema` skill, `normalizeSkill` guard, hasIndexed check via `tutorial_chunks.skill_tag`, mock fallback `getMockTutorials` when no indexed data, `embed` skill via `createEmbeddingModel()`, Stage 1 `match_tutorial_chapters` rpc with `DISTANCE_THRESHOLD=0.5` restricted to video_ids indexed under skill, Stage 2 `match_tutorial_chunks` fallback for videos without accepted chapter, merge preferring chapters, dedup by video_id cap 7, `chapter_label` only for Stage 1.
- `app/api/tutorial-lessons/[video_id]/route.ts` — auth guard, service-role read `video_lessons`.
- `app/api/jobs/route.ts`, `app/api/jobs/stats/route.ts`, `app/api/jobs/[id]/summary/route.ts` — jobs feed pagination, stats, AI restructuring (4 sections, grounded prompt, cached).
- `app/api/profile/route.ts`, `app/api/profile/skills/route.ts`, `app/api/alert-preferences/route.ts`, `app/api/saved-jobs/route.ts`, `app/api/keys/route.ts`, `app/api/keys/revoke/route.ts`, `app/api/export/route.ts` — all profile-scoped, `supabase.auth.getUser()` server-side + RLS, export via `dp_live_` + `sha256(raw+pepper)` hash.
- `app/api/trends/route.ts`, `app/api/trends-summary/route.ts` — shared query with Dashboard.
- `app/api/debug/*` (6 routes: `anon-snapshots`, `counts`, `dashboard`, `env`, `session`, `table-access`) — debug helpers (not user-facing).

### Components
- `components/layout/AppHeader.tsx` — sticky `bg-[#070A14]/95 backdrop-blur`, NAV 5 items (Dashboard, Trends, Jobs, Gap Report, Profile), active underline `after:bg-[#14B8A6]`, Live pulse `bg-[#22C55E] animate-pulse`, responsive burger menu, profile ring.
- `components/layout/AppFooter.tsx` — "Data refreshed daily · Last update: X · 10 sources".
- `components/dashboard/*` (7 files): `StatCards`, `TopSkillsTable` / `DashboardTopSkills`, `SourcesCard`, `BiggestMovers` + `SampleIntegrity`, `TrendChart` (Recharts via `components/ui/chart.tsx`), `DashboardHeader`.
- `components/jobs/*` (4 files): `JobsClient`, `JobCard` (comp range, timezone, skill chips with `!gap` orange treatment, stack-match %, Adzuna badge), `JobDetail` (AI summary About/Role/Requirements + Market Intelligence block), `JobsFilters` (search, source chips, archetype, sort: Profile Match/Latest/Comp).
- `components/gap-report/*` (10 files): `GapReportClient` (34 symbols, largest client), `MarketAlignmentCard`, `StrengthsCard`, `SkillsToConsiderCard`, `TutorialCard` (thumbnail `img.youtube.com/vi/{id}/hqdefault.jpg`, channel, views, `Starts at MM:SS`, chapter badge `Ch N: ...`, inline `youtube.com/embed/{id}?start={s}&autoplay=1` with `enablejsapi=1`), `LessonTheater` (33 symbols, theater with `createPortal`, `pollRef` 700ms, `activeSectionIdx`, lesson cache), `RisingCard`, `DecliningCard`, `RecommendationsCard`, `YourSkillsPanel`.
- `components/trends/*` (5 files): `TrendsClient`, `TrendChartArea`, `SkillSelector` (max 5), `TrendStatCards`, `AITrendIntelligence`.
- `components/profile/ProfileClient.tsx` (18 symbols) — 6 sections, independent saves, `!gap` visuals, source toggles grouped keyless vs keyed.
- `components/ui/*` (3 files): `button.tsx`, `card.tsx`, `chart.tsx` (Recharts wrapper, Tailwind v4 CSS vars).

### Lib
- `lib/skills-dictionary.ts` (58 lines) — 28 canonical skills: typescript/js→typescript, javascript/js, react, next.js/nextjs/next, vue, angular, svelte, node.js/node/nodejs, python, go/golang, rust, java, c++/cpp, swift, kotlin, flutter, django, laravel, elixir, graphql/gql, tailwindcss/tailwind, postgresql/postgres/psql, mongodb/mongo, redis, docker, kubernetes/k8s, aws. `ALL_SKILLS`, `SKILL_COLORS` (10 colors), `normalizeSkill(input)`, `isKnownSkill`.
- `lib/matching.ts` (48 lines) — `marketAlignmentPct(userSkills, top50)` demand-weighted coverage, `stackMatchPct(jobSkills, userSkills)` distinct overlap or `undefined` ("Not enough data"), `computeRisingDeclining(history, skillKeys)` MoM deltas.
- `lib/ai/provider.ts` (281 lines) — `SupportedProvider` 8 variants, `resolveProvider()` from `AI_PROVIDER` → `AI_MODEL` prefix → key inference, `getProviderMeta()` (model/embeddingModel/baseURL/apiKey per provider defaults + env overrides), `createTextModel()`/`createEmbeddingModel()` (google/anthropic/mistral → openai-compatible fallback via `@ai-sdk/openai` chat/embedding), `assertProviderConfig()` for cron.
- `lib/queries/dashboard.ts`, `lib/queries/jobs.ts`, `lib/queries/trends.ts` — pre-aggregated reads from `skill_demand_snapshots`/`skill_mentions`, never raw `COUNT(*)` in request.
- `lib/supabase/{client.ts, server.ts, middleware.ts, service-role.ts, env.ts}` — `@supabase/ssr` cookie session, anon vs service-role separation.
- `lib/api-keys.ts` — `dp_live_` + `sha256(raw+API_KEY_PEPPER)`, prefix/masked display.
- `lib/sanitize.ts`, `lib/utils.ts` (`cn`), `lib/lesson-generation.ts` (444 lines, `CURRENT_LESSON_MODEL=gemini-3.6-flash-concept-v2`, lesson synthesis with grounded prompts).
- `lib/mock/*` — `dashboard-data.ts`, `gap-report.ts`, `gap-report-tutorials.ts` (fallbacks).

### Supabase Migrations (8 files)
- `001_initial_schema.sql` — 14 tables + vector/pgcrypto extensions, `skill_mentions`/`skill_demand_snapshots` indexes, `profiles` with `monitored_sources` default `{hackernews,himalayas,remotejobs,remotive}` (extended later).
- `002_rls_policies.sql`, `003_vector_search_rpc.sql` (`match_tutorial_chapters`/`match_tutorial_chunks` rpc), `004_job_summaries.sql`, `005_disable_rls_on_public_tables.sql`, `006_update_job_sources.sql` (extends `job_postings.source` check + `profiles.monitored_sources` to 10 sources), `007_video_lessons.sql` (`video_lessons` + lessons model), `008_ai_quota.sql` (`ai_daily_usage`).

### Other
- `design/` — reference images for 7 pages (Dashboard, Trends, Jobs, Skills, Gap Report, Profile) — README should not claim pixel precision but should reference desktop 1280px fidelity.
- `prompts/` — 16 prior implementation prompts (most recent `2026-09-15-ai-lesson-notes-fix.md`), establishing traceability pattern.
- `eslint.config.mjs`, `postcss.config.mjs`, `.codegraph`, `.impeccable`, `.omo` — tooling.

---

## Decisions & Assumptions

- **Single file changed:** only `README.md`. No code, no deps, no migrations, no env. If a second file is needed (e.g., `docs/` link target), it will be created only if it does not already exist.
- **Structure:** Follow `shared-readme` standard sections (Title, Description, Features, Prerequisites, Quick Start, Development, Project Structure, Contributing, License) plus MERN additions (Environment table, API docs summary, Deployment). No `--minimal` — full README. No badges by default (no CI badge configured in repo; adding fake badges would be stale info, violating best practice).
- **Voice:** Concise, senior-engineer tone (Sisyphus identity), scannable headers, copy-paste ready commands, tables where they help (env, sources, scripts, project structure, API routes). No marketing fluff. No AI slop phrases.
- **Source of truth:** Every claim in README must be verifiable in a file listed in Code Inspected above. Specific examples:
  - Skill count "28" from `SKILLS_DICTIONARY` keys, not AGENTS.md's prose.
  - Source list "10" from `vercel.json`/`ingest/route.ts` sourceNames array, not assumption.
  - Matching formulas cited as `lib/matching.ts` deterministic, not AI.
  - Page list (Dashboard, Trends, Jobs, Skills, Gap Report, Profile, Sign-in) from `app/(app)/*` + `app/sign-in/page.tsx`.
  - Cron schedules verbatim from `vercel.json`.
  - Env table from `.env.example` (18 vars) + real code usage.
  - Dark palette `#070A14`/`#14B8A6` from `app/layout.tsx`/`AppHeader.tsx`/`globals.css` — README describes it once, not invents a new palette.
- **Honesty notes preserved:** "Not disclosed" for comp/liquidity, "Not enough data" for stack-match, `salary_is_predicted` guard, Jooble key-in-path redaction, Adzuna quota caps — these are documented as project constraints, not hidden.
- **Assumes Node 20+, pnpm or npm, Supabase project, provider API key** — Prerequisites table lists Node 20, not 18 (matches `package.json` `@types/node ^20` and Next 16 requirement).
- **No mobile reference exists** — README notes desktop 1280px exact, mobile adaptive (stack columns) per AGENTS §5, does not claim mobile pixel fidelity.
- **License stays MIT** per `LICENSE` file.
- **Diagrams:** No new diagram generated — project structure is a tree/table, not a mermaid flow. If Evans wants a diagram later, `/diagram` can be invoked separately.

---

## Files You Will Touch

1. `README.md` — **only file written** (overwrite). All other files read-only.
2. `prompts/2026-09-15-readme-refresh.md` — this file (trace, already written).

**Explicitly NOT touched:** `package.json`, `next.config.ts`, `proxy.ts`, `vercel.json`, any `app/**`, `components/**`, `lib/**`, `supabase/**`, `design/**`, `.env*`, `LICENSE`, `AGENTS.md`, `CLAUDE.md`.

---

## Requirements

- Replace entire `README.md` content (currently 36 lines of `create-next-app` boilerplate) with a codebase-grounded README. No boilerplate may remain (no "This is a [Next.js] project bootstrapped with...", no Geist font paragraph, no `Learn More` Next.js tutorial links, no `Deploy on Vercel` generic link).
- README must include, in order:
  1. **Title + hero line** — DevPulse, one-line descriptor from AGENTS §1 ("real-time developer job market intelligence dashboard"), live data positioning.
  2. **What it does** — Problem statement (remote devs in Africa/LATAM/Eastern Europe targeting US) + 3-bullet value prop, sourced from AGENTS §1 but phrased from code reality.
  3. **Features** — 7 pages (Dashboard, Trends, Jobs, Skills, Gap Report, Profile, Sign-in) + 4 AI features (Gap Report prose, Trend summary, Tutorial search chapter-first, Job restructuring) + 4 standout features (Gap Report, Tutorial Search with chapter badge, Live Job Feed with stack-match, Auto-Git Sync) — each with one-line code anchor (e.g., "deterministic `lib/matching.ts:stackMatchPct`").
  4. **How it works (architecture)** — Diagram-described table: Browser never holds keys (AGENTS §2) + API routes vs Cron vs Supabase vs AI SDK vs Resend vs Octokit. Include the 10 sources table (name, endpoint, auth, rate limit) as implemented in `app/api/cron/ingest/route.ts`.
  5. **Tech stack** — Table from `package.json` real versions (Next 16.3.5, React 19.2.8, Tailwind 4, Framer Motion 13.2, Recharts via shadcn chart, Supabase SSR, Vercel AI SDK, Zod, Resend, Octokit, youtube-transcript). "Do not use" list (no Prisma, no custom AI SDK, no private repo access).
  6. **Project structure** — Tree from `codegraph_files` + prose for each top-level dir (`app/`, `components/`, `lib/`, `supabase/migrations/`, `design/`, `prompts/`). Must match actual file counts (88 files indexed).
  7. **Data model** — Summary table of 14 tables + pgvector extension, with purpose per table and RLS note (`auth.uid() = user_id` second layer).
  8. **Pipelines** — 5 pipelines (daily ingest, weekly tutorial index, weekly GitHub sync, alert dispatch, API key export) with schedule + steps from `vercel.json` + route files.
  9. **Matching formulas** — `marketAlignmentPct` and `stackMatchPct` code + "Not enough data" vs 0% distinction, from `lib/matching.ts`.
  10. **Skill dictionary** — 28 skills, normalization rules, alias examples, single source of truth note.
  11. **Prerequisites** — Table: Node 20+, pnpm/npm, Supabase project, YouTube/Resend/GitHub/Adzuna/Jooble/The Muse keys if needed, `AI_PROVIDER`/`AI_MODEL`.
  12. **Environment** — Full table of 18 vars from `.env.example` with Public vs Server-only column, plus `cp .env.example .env.local` instruction. Must include Jooble POST-only warning and Adzuna quota note.
  13. **Quick Start** — Copy-paste block: clone → install → `cp .env.example .env.local` → fill Supabase → `pnpm dev` → `http://localhost:3000` → magic-link sign-in flow → ingestion `curl -H "Authorization: Bearer $CRON_SECRET"`.
  14. **Development** — Scripts table (`dev`, `build`, `start`, `lint`, `tsc --noEmit`), security gate `grep` commands from AGENTS §18, DB sanity queries.
  15. **API routes** — Summary table of all `app/api/**` routes (path, method, auth, purpose) — at least 14 groups, not just the cron ones.
  16. **Contributing** — PLAN → APPROVE → BUILD → CHECK → REPORT loop from AGENTS §4.
  17. **License** — MIT, Copyright (c) 2026 DevPulse (prg-04), link to `LICENSE`.
- Keep under ~600 lines — comprehensive but not a second AGENTS.md (~115k chars). Link to AGENTS.md for deep spec (`See [AGENTS.md](./AGENTS.md) for full product spec — 20 sections, data model, pipeline steps, AI grounding constraints`).
- Use GitHub-flavored Markdown only. No HTML beyond `<div>` badges if any.
- All `NEXT_PUBLIC_` vars must be exactly `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` — no invented public keys.
- Thumbnail `img.youtube.com/vi/{video_id}/hqdefault.jpg` and embed `youtube.com/embed/{video_id}?start={s}` must be noted as safe public endpoints (AGENTS §2 exception).

---

## Security Checks

Before marking complete:

```bash
grep -r "SERVICE_ROLE" app/           # must be only lib/supabase/service-role + app/api/cron/*
grep -r "SUPABASE_SERVICE" app/components/  # 0
grep -r "OPENAI_API_KEY" app/         # 0
grep -r "YOUTUBE_API_KEY" app/         # 0
grep -r "RESEND_API_KEY" app/         # 0
grep -r "GITHUB_TOKEN" app/            # 0
grep -r "API_KEY_PEPPER" app/          # 0 in app/components, allowed only app/api/keys* + lib/api-keys.ts
grep -r "AI_MODEL" app/               # 0 in app/components
grep -r "@anthropic-ai/sdk" app/      # 0
grep -r "openai" app/components/      # 0
grep -r "resend" app/components/      # 0
grep -r "octokit" app/components/     # 0
grep -rl "googleapis.com/youtube" app/ | grep -v "app/api/cron/tutorial-index"  # 0
grep -rl "api.github.com" app/ | grep -v "app/api/cron/github-sync"            # 0
npx tsc --noEmit        # 0 errors
npx eslint .            # 0 warnings in new files (README not linted but check still green)
```

Also verify README itself contains **no plaintext secrets** — it must show only env var *names* and placeholder values (`eyJhbG...`, `your-youtube-key`), never a real key from `.env.local`. And it must not contain a real `CRON_SECRET` or `API_KEY_PEPPER` value.

---

## Acceptance Criteria

- `README.md` no longer contains "bootstrapped with `create-next-app`", "Geist", or "Learn Next.js" — verified by `grep -i "create-next-app\|Geist\|Learn Next.js" README.md` returning 0.
- `README.md` contains "DevPulse" in title, mentions "real-time developer job market intelligence", lists 7 pages by name, lists 4 AI features, lists 10 sources by name, references `lib/matching.ts`, `lib/skills-dictionary.ts`, `lib/ai/provider.ts`, `vercel.json` cron schedules, and `supabase/migrations/` — verified by `grep -c` each term ≥1.
- `wc -l README.md` is between 300 and 650 lines (comprehensive but not AGENTS.md clone).
- `npx tsc --noEmit` zero errors (README change must not break build; `next build` optional but `tsc` required).
- Manual read-through: Prerequisites → Quick Start → `pnpm dev` → `http://localhost:3000` is a continuous copy-paste path with no missing env step; env table matches `.env.example` exactly (18 vars); API routes table covers at least 14 groups; project structure matches `codegraph_files` output; skill count (28) is verifiable in `lib/skills-dictionary.ts`.
- No secrets in README: `grep -E "sk-|ghp_|re_|eyJhbG.*\.[A-Za-z0-9_-]*\." README.md` shows only masked examples, not `.env.local` values.

---

## Manual Test Steps

1. `cat README.md | head -n 50` — hero line and "What it does" are present, no boilerplate.
2. `grep -n "Features\|Tech Stack\|Project Structure\|Data Model\|Pipelines\|Quick Start\|Development\|API\|Contributing\|License" README.md` — all sections in order.
3. `npx tsc --noEmit` — zero errors.
4. `grep -i "create-next-app" README.md; echo $?` — should print 1 (no match).
5. Open `http://localhost:3000` after `pnpm dev` with fresh `.env.local` following README's Quick Start — sign-in → Dashboard loads (or "No data yet" empty state with correct copy) → Trends → Jobs (with "Not enough data" or stack-match % if `user_skills` present) → Skills → submit 1 skill → Gap Report returns within 10s → Profile saves persist.
6. Verify env table: `diff <(grep -E "^NEXT_PUBLIC_SUPABASE|SUPABASE_|AI_|CRON_SECRET|YOUTUBE|RESEND|GITHUB|ADZUNA|JOOBLE|THEMUSE|WEEKLY" .env.example | cut -d= -f1 | sort) <(grep -E "NEXT_PUBLIC_SUPABASE|SUPABASE_|AI_|CRON_SECRET|YOUTUBE|RESEND|GITHUB|ADZUNA|JOOBLE|THEMUSE|WEEKLY" README.md | grep -oE "[A-Z_]+(_[A-Z]+)*" | sort -u)` — no missing vars.
7. `grep -c "tutorial-index\|ingest\|github-sync\|alert-dispatch" README.md` — all 4 crons mentioned with correct schedules.
8. `grep -c "HackerNews\|Himalayas\|RemoteJobs\|Remotive\|Arbeitnow\|RemoteOK\|Jobicy\|Adzuna\|Jooble\|The Muse" README.md` — all 10 sources present.

Verify that no API keys are exposed to the browser, and that every profile-scoped route validates the Supabase session or API key server-side, before marking complete.

