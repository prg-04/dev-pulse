# DevPulse — Real-time Developer Job Market Intelligence

> Live skill demand, gap analysis, and personalized job matching for remote developers targeting US companies. Ingests 10 job sources daily, scores every posting against your own skills, and turns a gap report into the start of a learning session — with timestamped YouTube chapters.

DevPulse answers questions most developers answer on gut feel — *"Is TypeScript demand actually rising?"*, *"Which of these 40 postings actually fit what I know?"*, *"What should I learn next?"* — with **live data, deterministic scoring, and grounded AI prose**. No opinions. Every number traces back to a real Supabase row.

See [`AGENTS.md`](./AGENTS.md) for the full 20-section product spec (data model, pipeline steps, AI grounding constraints, security rules).

---

## Table of Contents

- [What It Does](#what-it-does)
- [Features](#features)
- [How It Works](#how-it-works)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Data Model](#data-model)
- [Pipelines](#pipelines)
- [Matching Formulas](#matching-formulas)
- [Skill Dictionary](#skill-dictionary)
- [Prerequisites](#prerequisites)
- [Environment](#environment)
- [Quick Start](#quick-start)
- [Development](#development)
- [API Routes](#api-routes)
- [Contributing](#contributing)
- [License](#license)

---

## What It Does

Remote developers — especially in Africa, LATAM, and Eastern Europe targeting US-remote roles — make skill and CV decisions on outdated signals. DevPulse replaces that with:

- **Live ingestion** of real job postings from 10 sources every day, with skill mentions extracted and tracked month-over-month.
- **Persistent, verifiable profile** — Supabase Auth (magic-link), not a throwaway anonymous token — so market data, gap history, and GitHub-synced skills compound over time.
- **Demand-weighted scoring** — `marketAlignmentPct` and `stackMatchPct` in `lib/matching.ts` are pure arithmetic over `skill_demand_snapshots`, never AI-generated.
- **Grounded AI synthesis** — AI only narrates numbers already computed; it never invents a statistic (see `app/api/gap-report/route.ts` system prompt + Zod validation).

---

## Features

### 7 Pages (shared `AppHeader` + `AppFooter`, dark `#070A14` shell)

| Page | Route | What it shows | Data source |
|------|-------|---------------|-------------|
| **Dashboard** | `/` | Stat cards (jobs ingested, skills tracked, top skill, last update), Top 50 ranked table with relative-volume bars + MoM delta, sources breakdown, biggest movers, 12-month multi-skill trend chart + AI one-line summary | `skill_demand_snapshots`, `ingestion_runs` via `lib/queries/dashboard.ts` |
| **Trends** | `/trends` | Skill picker (max 5), 3M/6M/12M toggle, hover tooltip, per-skill stat cards (current count, MoM delta, peak month, volume), shared AI Trend Intelligence block | Same snapshots query as Dashboard (`lib/queries/trends.ts`) — no divergent endpoint |
| **Jobs** | `/jobs` | Search + source/archetype filters + sort (Profile Match / Latest / Comp High→Low), left scrollable `JobCard` list, right `JobDetail` panel with AI-restructured About / The Role / Requirements | `job_postings` + `skill_mentions` via `lib/queries/jobs.ts`, `stackMatchPct` per card |
| **Skills** | `/skills` | Target role/seniority selector, skill-tag input (dictionary-validated, comma/type-and-enter), quick-add chips from live demand, `include tutorial matching` checkbox | Pre-fills from `user_skills` + `profiles.target_role`; submits to `POST /api/gap-report` |
| **Gap Report** | `/gap-report` | Market Alignment score + progress bar, Strengths, Skills to Consider (with `TutorialCard` + `LessonTheater`), Rising / Declining, numbered Recommendations | Deterministic sections + AI prose (`app/api/gap-report/route.ts`) |
| **Profile** | `/profile` | 6 independently-saved sections: Identity & GitHub handle, Career Target & comp filter, Core Skill Stack (manual vs `github_sync` visual), Ingestion Sources (10 toggles), Alerts (3 types), API key & JSON export | `profiles`, `user_skills`, `gap_report_events`, `alert_preferences`, `api_keys` |
| **Sign-in** | `/sign-in` | Passwordless magic link (no password field — intentional), `supabase.auth.signInWithOtp`, idle→sending→sent→error states | Supabase Auth via `@supabase/ssr` (`proxy.ts` + `lib/supabase/*`) |

Desktop is exact at 1280px (reference images in `design/`). No mobile reference — columns stack, nav collapses to burger.

### 4 Standout Product Features

1. **Skill Gap Report** — enter role + skills on Skills page → `POST /api/gap-report` computes `marketAlignmentPct` against this month's Top 50, splits strengths/gaps, derives rising/declining from 2-month history, inserts `gap_report_events` per gap skill, asks AI only for 3 numbered recommendations. All numbers are query results; AI only narrates them.

2. **Tutorial Search (chapter-first)** — each gap skill expands into ranked `TutorialCard`s with precise jump points. `POST /api/tutorial-search` does **Stage 1: chapter-label pgvector cosine** (`tutorial_chapters.label_embedding`, `DISTANCE_THRESHOLD=0.5`) restricted to video_ids indexed under that skill → **Stage 2: transcript-chunk fallback** (`tutorial_chunks.embedding`) only for videos without an accepted chapter. Chapter hits show a badge (`Ch 2: Control Plane`); chunk-only hits show no badge. Click expands inline `youtube.com/embed/{video_id}?start={s}&autoplay=1` with `enablejsapi=1`; thumbnail is public `img.youtube.com/vi/{id}/hqdefault.jpg` (safe in client, no API key).

3. **Live Job Feed with Stack Match** — every card shows `stackMatchPct(jobSkills, userSkills)` (see [Matching Formulas](#matching-formulas)) and an orange `!gap` chip for skills that are a declared gap. Detail panel adds AI-restructured summary (4 sections) + Market Intelligence extraction (which skills matched). Honest gaps: comp/liquidity/contractor render `"Not disclosed"` when extraction found `null`; a job with zero `skill_mentions` shows `"Not enough data"` not `0%`.

4. **Auto-Git Sync** — weekly cron reads a connected `profiles.github_username`'s public repos via server-owned `GITHUB_TOKEN` (Octokit, `GET /users/{u}/repos` + `GET /repos/{o}/{r}/languages` + topics), normalizes through `lib/skills-dictionary.ts`, upserts into `user_skills` with `source='github_sync'`. Manual skills always win: `filter(manual).has(skill)` skips the upsert for that skill.

---

## How It Works

### Security invariant

> **The browser never holds API keys. The browser never calls the AI provider, ingestion/indexing/sync/dispatch, the YouTube Data API, the GitHub API, or Resend directly.** All those calls live in Next.js API routes (serverless) or Vercel Cron. Only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are public. Thumbnail + embed URLs are the only safe direct browser references (public YouTube endpoints, no key).

### Architecture

| Layer | Responsibility |
|-------|----------------|
| **Browser (client components)** | Render UI, rely on Supabase session cookie, call safe `app/api/*` routes, embed YouTube iframe + thumbnails directly |
| **Next.js API routes** | Validate Supabase session (`supabase.auth.getUser()` server-side, 401 on miss) or hashed bearer `dp_live_…` for `/api/export`, call Vercel AI SDK, query Supabase, return safe JSON |
| **Vercel Cron** | Daily ingest, weekly tutorial index, weekly GitHub sync, alert dispatch — all server-side with `CRON_SECRET` bearer check, writing to Supabase / sending via Resend |
| **Supabase** | Auth (magic-link), Postgres + `pgvector` (chapters + chunks), all 14 tables, RLS (`auth.uid() = user_id` second layer) |
| **Vercel AI SDK (`ai` + `lib/ai/provider.ts`)** | Provider-agnostic `generateText` / `generateObject` / `embed` / `embedMany` — `AI_PROVIDER` + `AI_MODEL` + `AI_MODEL_EMBEDDING` |
| **Resend** | 3 product alert emails (instant match, weekly digest, learning-gap) — server-only, distinct from Supabase Auth's own magic-link email |
| **Octokit** | Public repo read for GitHub sync — server-only, single PAT |

Auth flow: email → Supabase sends magic link → click → `@supabase/ssr` cookie session → `proxy.ts` + `app/(app)/layout.tsx` guard → Postgres trigger `on_auth_user_created` creates `profiles` row with `id = auth.users.id` → every profile-scoped route validates session server-side, RLS enforces the same boundary in the DB.

### Data sources (10 job sources + YouTube + GitHub)

| Source | Endpoint | Auth | Rate limit | Notes |
|--------|----------|------|-----------|-------|
| HackerNews Algolia | `hn.algolia.com/api/v1/search_by_date` + `items/{id}` | None | 10k req/hr | Monthly "Who is Hiring" threads (400–900 comments each) — only source with multi-year archive → trend history |
| Himalayas | `himalayas.app/jobs/api` | None | 20/req, cursor pagination | Filterable by skill/seniority/timezone |
| RemoteJobs.org | `remotejobs.org/api/v1/jobs` | None | Public | By category, salary fields when present |
| Remotive | `remotive.com/api/remote-jobs` | None | Public | Remote tech by category |
| Arbeitnow | `www.arbeitnow.com/api/job-board-api` | None | Daily polite | ATS-sourced (Greenhouse, Join.com, …), `remote` + `visa_sponsorship` |
| RemoteOK | `remoteok.com/api` | None | Daily polite (`User-Agent: DevPulse/1.0`) | `tags` ≈ pre-extracted skills; first element may be legal notice |
| Jobicy | `jobicy.com/api/v2/remote-jobs` | None | ≤1/hr (we do 1/day) | `industry=engineering`, `geo` filter, 200/req |
| Adzuna | `api.adzuna.com/v1/api/jobs/{country}/search/{page}` | `ADZUNA_APP_ID` + `ADZUNA_APP_KEY` (free) | 25/min, 250/day, 1k/wk, 2.5k/mo | Scope to `us, gb` only (quota-tight); `salary_is_predicted` → treat as `null`; UI badge "Jobs by Adzuna" required by ToS |
| Jooble | `POST jooble.org/api/{api_key}` | Key in URL path (free) | Undocumented — watch 429s | Never log full URL; body `{keywords:"developer", location:"remote"}` |
| The Muse | `www.themuse.com/api/public/jobs` | Optional `THEMUSE_API_KEY` | 500/hr keyless, 3600/hr with key | `category="Software Engineer"`; register a free key even though it works keyless |
| YouTube Data API v3 | `googleapis.com/youtube/v3` (`search.list` 100 units, `videos.list` 1/req) | `YOUTUBE_API_KEY` | 10k units/day | Tutorial indexer only (`app/api/cron/tutorial-index`); search `"{skill} tutorial"` `publishedAfter: 2y`, filter `views>10k` `duration>3m` |
| GitHub REST API | `api.github.com` | `GITHUB_TOKEN` PAT public-read | 5k/hr auth (vs 60/hr anon) | Sync only (`app/api/cron/github-sync`): `GET /users/{u}/repos` + languages + topics |

---

## Tech Stack

| Layer | Package | Version | Notes |
|-------|---------|---------|-------|
| Framework | `next` | 16.3.5 | App Router, `proxy.ts` auth, `vercel.json` cron |
| UI | `react` / `react-dom` | 19.2.8 | Server vs client split per `vercel-react-best-practices` |
| Styling | `tailwindcss` + `@tailwindcss/postcss` + `tw-animate-css` | v4 | CSS vars in `app/globals.css`, `shadcn/tailwind.css` |
| Components | `shadcn` + `components/ui/{button,card,chart}.tsx` | 4.21.0 | Chart via shadcn wrapper over `recharts 3.8.0` — never raw Recharts, never Tremor |
| Animation | `framer-motion` | 13.2.0 | All motion (not GSAP) — respects `prefers-reduced-motion` |
| Icons | `lucide-react` | 1.45.0 | `Activity`, `Mail`, etc. in `AppHeader`, `Sign-in` |
| Fonts | `next/font` (`Geist`, `Geist_Mono`, `Noto_Sans`, `Playfair_Display`) | — | Heading var `--font-heading` |
| AI | `ai` + `@ai-sdk/openai` `anthropic` `google` `mistral` `deepseek` | 7.0.99 | `lib/ai/provider.ts` resolves provider from `AI_PROVIDER` / `AI_MODEL` prefix / available keys |
| Validation | `zod` | 4.6.2 | Every API input + AI structured output |
| DB + Auth | `@supabase/supabase-js` + `@supabase/ssr` | 2.116.0 / 0.12.7 | Cookie sessions, RLS on every user table |
| Email | `resend` | 6.28.0 | Server-only (`app/api/cron/alert-dispatch`) |
| GitHub | `octokit` | 5.0.5 | Server-only (`app/api/cron/github-sync`) |
| YouTube | `youtube-transcript` | 1.3.1 | Public captions, no OAuth, indexer only |
| Utils | `class-variance-authority`, `cn` (`lib/utils.ts`) | 0.7.1 | `cn` = `clsx` + `tailwind-merge` |
| Tooling | `typescript` strict, `eslint` + `eslint-config-next` | 5 / 9 | `strict:true`, no `any`, `paths @/*` |

**Provider switching is one env var** — `AI_PROVIDER=openrouter AI_MODEL=openai/gpt-4o-mini` → `AI_PROVIDER=google AI_MODEL=gemini-2.5-flash` etc. Same config serves generation + embeddings (confirm embedding support for the chosen model).

**Not used:** Prisma (Supabase client directly), custom AI SDKs in components, per-user GitHub OAuth, password auth / NextAuth / Clerk, scraping behind login walls.

---

## Project Structure

88 files indexed (`codegraph`):

```
.
├── app/
│   ├── layout.tsx                          # root layout (fonts, bg #070A14, metadata)
│   ├── globals.css                         # Tailwind v4 + shadcn vars + dark palette
│   ├── (app)/                              # authenticated group (proxy.ts + layout guard)
│   │   ├── layout.tsx                      # AppHeader + AppFooter + lastUpdate fetch
│   │   ├── page.tsx                        # Dashboard (Top 50 + trends + movers)
│   │   ├── trends/page.tsx
│   │   ├── jobs/page.tsx
│   │   ├── gap-report/page.tsx
│   │   └── profile/page.tsx
│   ├── sign-in/page.tsx                    # "use client" magic-link form
│   └── api/
│       ├── auth/callback/route.ts          # magic-link exchange
│       ├── cron/
│       │   ├── ingest/route.ts             # daily — 10 sources → job_postings + skill_mentions + snapshots
│       │   ├── tutorial-index/route.ts     # weekly — chapters + chunks + lesson generation
│       │   ├── github-sync/route.ts        # weekly — public repos → user_skills
│       │   └── alert-dispatch/route.ts     # chained after ingest/index — Resend
│       ├── gap-report/route.ts             # Feature 1 — deterministic + AI recommendations
│       ├── tutorial-search/route.ts        # Feature 3 — chapter-first pgvector retrieval
│       ├── tutorial-lessons/[video_id]/route.ts  # lesson notes fetch
│       ├── jobs/{route,stats/route,[id]/summary/route}  # feed + stats + Feature 4 (AI restructure)
│       ├── profile/{route,skills/route}    # identity + Core Skill Stack
│       ├── alert-preferences/route.ts      # 3 toggles
│       ├── saved-jobs/route.ts
│       ├── keys/{route,revoke/route} + export/route.ts  # dp_live_ hashed bearer
│       ├── trends{/, -summary}/route.ts
│       └── debug/{anon-snapshots,counts,dashboard,env,session,table-access}/route.ts
├── components/
│   ├── layout/{AppHeader,AppFooter}.tsx
│   ├── dashboard/{StatCards,DashboardTopSkills,TopSkillsTable,SourcesCard,BiggestMovers,TrendChart,DashboardHeader}.tsx
│   ├── jobs/{JobsClient,JobCard,JobDetail,JobsFilters}.tsx
│   ├── gap-report/{GapReportClient,MarketAlignmentCard,StrengthsCard,SkillsToConsiderCard,TutorialCard,LessonTheater,RisingCard,DecliningCard,RecommendationsCard,YourSkillsPanel}.tsx
│   ├── trends/{TrendsClient,TrendChartArea,SkillSelector,TrendStatCards,AITrendIntelligence}.tsx
│   ├── profile/ProfileClient.tsx
│   └── ui/{button,card,chart}.tsx
├── lib/
│   ├── skills-dictionary.ts  # 28 skills + aliases — single source of truth
│   ├── matching.ts           # marketAlignmentPct + stackMatchPct + computeRisingDeclining
│   ├── ai/provider.ts        # provider resolution + createTextModel/createEmbeddingModel
│   ├── queries/{dashboard,jobs,trends}.ts  # pre-aggregated reads only
│   ├── supabase/{client,server,middleware,service-role,env}.ts
│   ├── api-keys.ts + sanitize.ts + utils.ts + lesson-generation.ts
│   └── mock/{dashboard-data,gap-report,gap-report-tutorials}.ts
├── supabase/migrations/
│   ├── 001_initial_schema.sql
│   ├── 002_rls_policies.sql
│   ├── 003_vector_search_rpc.sql    # match_tutorial_chapters / match_tutorial_chunks
│   ├── 004_job_summaries.sql
│   ├── 005_disable_rls_on_public_tables.sql
│   ├── 006_update_job_sources.sql   # 4 → 10 sources
│   ├── 007_video_lessons.sql + 008_ai_quota.sql  # lessons + ai_daily_usage
├── design/                           # desktop reference images (7 pages)
├── prompts/                          # 16+ implementation prompts (traceability)
├── proxy.ts                          # auth gate + redirect with ?next=
├── vercel.json                       # 4 crons
├── components.json + eslint.config.mjs + postcss.config.mjs + next.config.ts
├── package.json + tsconfig.json
└── AGENTS.md                         # 20-section source of truth
```

---

## Data Model

Postgres + `pgvector` (`vector` + `pgcrypto` extensions). 14 tables in `supabase/migrations/001_initial_schema.sql` + deltas:

| Table | Purpose | Key columns | RLS |
|-------|---------|-------------|-----|
| `job_postings` | Every ingested posting, deduped by `external_id` | `external_id` unique, `source` check (10 values), `comp_*`, `liquidity_tier`/`contractor_type` (keyword-extracted), `external_url` | none (public read) |
| `skill_mentions` | One row per skill per job | `job_id→job_postings`, `skill` lowercase, `month YYYY-MM`, `source`; indexes `(skill,month)`, `(job_id)` | none |
| `skill_demand_snapshots` | Pre-aggregated monthly counts (dashboards/trends/alignment read this, never raw aggregation) | `skill, month, source` unique, `mention_count` | none |
| `profiles` | One row per `auth.users` (trigger `on_auth_user_created`) | `id→auth.users`, `github_username`, `auto_git_sync`, `monitored_sources text[]` default 10 sources | `auth.uid()=id` |
| `user_skills` | Persistent baseline for job matching + alerts | `user_id→profiles`, `skill`, `source manual|github_sync` | `auth.uid()=user_id` |
| `user_skill_profiles` | Point-in-time Skills page submissions (snapshots, not baseline) | `user_id`, `skills text[]`, `target_role` | `auth.uid()=user_id` |
| `saved_jobs` | "Save Role" | `(user_id, job_id)` pk | `auth.uid()=user_id` |
| `alert_preferences` | 3 toggles per account | `instant_match_alert`+`threshold`, `weekly_digest`, `learning_gap_dispatch`, `delivery_method email|webhook` | `auth.uid()=user_id` |
| `alert_dispatch_log` | Audit — prevents duplicates, verifies sends | `user_id`, `alert_type`, `reference_id`, `status sent|failed` | service-role only |
| `api_keys` | Hashed bearer keys for `GET /api/export` | `key_prefix` (masked display), `key_hash = sha256(raw+pepper)` | `auth.uid()=user_id` |
| `github_sync_runs` | Audit per weekly sync run | `github_username`, `status success|failed|skipped_no_username|skipped_sync_off`, `skills_upserted` | service-role |
| `ingestion_runs` | Audit per daily ingest | `status running|success|failed`, `jobs_ingested`, `error` | service-role |
| `gap_report_events` | One row per gap skill per report (feeds indexer priority + Profile "active gaps") | `user_id`, `skill`, index `(skill,created_at)` | `auth.uid()=user_id` |
| `skill_index_status` | Tutorial rotation state per skill | `skill pk`, `last_indexed_at`, `gap_mentions_30d`, `total_chunks`, `total_chapters` | service-role |
| `tutorial_chapters` | Video table-of-contents (human-authored) | `video_id`, `start_seconds`, `label`, `label_embedding vector(1536)`, ivfflat cosine index | service-role |
| `tutorial_chunks` | ~60s transcript windows (fallback) | `video_id`, `skill_tag`, `start_seconds`, `chunk_text`, `embedding vector(1536)`, ivfflat | service-role |
| `video_lessons` + `ai_daily_usage` | AI lesson notes + daily quota (`007`/`008`) | `video_id`, `sections jsonb`, `model CURRENT_LESSON_MODEL`, `usage_date`, `generate_calls` | `authenticated` read |

Every user-scoped table enforces `auth.uid() = user_id` (or `= id` for `profiles`) as a second layer beneath the API route's own `auth.getUser()` check. Service-role key is restricted to `app/api/cron/*` + `lib/supabase/service-role.ts`.

---

## Pipelines

All offline — never triggered by user requests. Dashboard/Trends/Jobs/Gap Report read precomputed Supabase rows.

### Daily Job Ingestion — `GET /api/cron/ingest` — `0 6 * * *`

1. Insert `ingestion_runs` `running`
2. `Promise.allSettled` 10 sources in parallel (single-source failure logged, never blocks others)
3. Local dedup on `external_id` → chunked `existingIds` lookup (100/batch) → `newJobs`
4. `stripHtml` + `extractSkills` (dictionary `\b` regex) + `extractComp`/`extractLiquidityTier`/`extractContractorType` (best-effort substrings; Adzuna only when `salary_is_predicted` is false)
5. Batch upsert `job_postings` (100/batch, `onConflict: external_id`) → collect ids
6. Build `skill_mentions` + `snapshotCounts` (`skill|month|source` map)
7. Batch insert `skill_mentions`, read-modify-write upsert `skill_demand_snapshots` (`ON CONFLICT (skill,month,source) DO UPDATE`)
8. Update `ingestion_runs` `success` + `jobs_ingested`; 401 without `Authorization: Bearer $CRON_SECRET`

### Weekly Tutorial Indexing — `GET /api/cron/tutorial-index` — `0 2 * * 0`

1. Refresh `skill_index_status.gap_mentions_30d` from `gap_report_events` last 30 days
2. Rank skills by `gap_mentions_30d` desc → `last_indexed_at` asc (never-indexed + floor for zero-gap skills)
3. Take top `WEEKLY_INDEX_BUDGET` (default 40 — well under ~90–100 daily quota ceiling; `search.list` = 100 units)
4. Per skill: `search.list(q:"{skill} tutorial", type:video, order:relevance, publishedAfter: 2y)` → `videos.list` (views/duration/description) → filter `views>10k` `duration>3m` → **extract chapters first** (regex `^\s*(\d{1,2}:)?\d{1,2}:\d{2}\s+.+$`, require ≥3 ascending lines — fewer is stray timestamps, discard) → `embed` labels → upsert `tutorial_chapters` → `youtube-transcript` → chunk ~60s → `embedMany` → upsert `tutorial_chunks` → update `skill_index_status`

### Weekly GitHub Sync — `GET /api/cron/github-sync` — `0 4 * * 0` (offset from indexer)

1. Select `profiles` where `auto_git_sync=true` and `github_username` not null
2. Per account: insert `github_sync_runs` running → `GET /users/{u}/repos` (paginated, `type:owner`, `per_page:100`) → 404 → `skipped_no_username` (never fails whole run) → batched `GET /repos/{o}/{r}/languages` + topics (10/batch) → `normalizeSkill` via dictionary (unknown dropped, e.g. "Jupyter Notebook") → aggregate set → fetch existing `user_skills` to find `manual` entries → filter those out → `upsert` with `onConflict: user_id,skill` + `source='github_sync'` → update `github_sync_runs` `success` + `skills_upserted`

### Alert Dispatch — `GET /api/cron/alert-dispatch` — `0 6 * * *` (chained after ingest)

- **Instant Match** — for `instant_match_alert=true`: score this run's jobs via `stackMatchPct` against `user_skills`, filtered to `profiles.monitored_sources`, threshold `instant_match_threshold` (default 90); dedup `(user, instant_match, job_id)` via `alert_dispatch_log`; send via Resend to verified auth email.
- **Weekly Digest** — for `weekly_digest=true`: biggest movers as Dashboard does, filtered to `monitored_sources`, once per 7 days (check `alert_dispatch_log`).
- **Learning-Gap Dispatch** — after tutorial index, for `learning_gap_dispatch=true`: skills in `gap_report_events` last 30d that were indexed this run (`skill_index_status.last_indexed_at` matches) → email with new `TutorialCard`s.

### API Key + Export

- `POST /api/keys` (session) → generate `dp_live_` + 32 hex → `sha256(raw+API_KEY_PEPPER)` → store `key_prefix` + `key_hash` → return raw **once** (never retrievable).
- `GET /api/export` (`Authorization: Bearer dp_live_…`) → hash lookup + `revoked_at` check → update `last_used_at` → return caller's `profiles`/`user_skills`/`user_skill_profiles`/`saved_jobs` JSON, read-only.
- `POST /api/keys/revoke` (session) → `revoked_at=now()` — immediate invalidation.

---

## Matching Formulas

Both live in `lib/matching.ts` — single source of truth, imported by Jobs page and Gap Report. **Neither calls AI**; AI only narrates their outputs.

### Stack Match % — per job posting (Jobs page, detail panel)

```ts
// lib/matching.ts:stackMatchPct
stackMatchPct(jobSkills, userSkills) =>
  round( matchedDistinct / totalDistinct * 100 )
// matchedDistinct = job's distinct skill_mentions ∩ user_skills
// totalDistinct   = distinct skills extracted for that job_id
// returns undefined ("Not enough data") when totalDistinct === 0 — not 0%
```

### Market Alignment % — Gap Report overall (weighted by demand)

```ts
// lib/matching.ts:marketAlignmentPct
marketAlignmentPct(userSkills, top50) =>
  round( sum(mention_count where skill ∈ userSkills ∩ top50)
       / sum(mention_count over all top50) * 100 )
// top50 = skill_demand_snapshots for current month ordered by mention_count desc, limit 50
// "typescript" at the top contributes far more than a niche skill at #50
```

Both are `Math.round` integer percentages. `computeRisingDeclining(history, skillKeys)` does MoM delta: `(last - prev)/prev *100`, with `prev===0 → 100%` if `last>0`.

---

## Skill Dictionary

Single source of truth: `lib/skills-dictionary.ts` — **28 canonical skills**. Every subsystem (ingestion extraction, GitHub sync, Skills page validation, tutorial indexer rotation, stack-match/market-alignment) draws from this one table so a skill typed on Skills page reliably matches one extracted from a job posting.

| Canonical | Aliases | | Canonical | Aliases |
|-----------|---------|-|-----------|---------|
| `typescript` | `ts` | | `go` | `golang` |
| `javascript` | `js` | | `rust` | — |
| `react` | `react.js` | | `java` | — |
| `next.js` | `nextjs`, `next` | | `c++` | `cpp` |
| `vue` | `vue.js` | | `swift` | — |
| `angular` | — | | `kotlin` | — |
| `svelte` | — | | `flutter` | — |
| `node.js` | `node`, `nodejs` | | `django` | — |
| `python` | — | | `laravel` | — |
| | | | `elixir` | — |
| `graphql` | `gql` | | `tailwindcss` | `tailwind` |
| `postgresql` | `postgres`, `psql` | | `mongodb` | `mongo` |
| `redis` | — | | `docker` | — |
| `kubernetes` | `k8s` | | `aws` | `amazon web services` |

- Stored lowercase (`typescript` not `TypeScript`); helpers `normalizeSkill(input)` / `isKnownSkill(skill)`.
- Ingestion regex: `\b{alias}\b` case-insensitive per alias; GitHub language/topic names go through the same table — anything not in it is discarded (e.g. `"Jupyter Notebook"` → `null`).
- `SKILL_COLORS` covers 10 high-volume skills (`typescript #2DD4BF`, `react #818CF8`, …) used in charts.

---

## Prerequisites

| Requirement | Version / Notes |
|-------------|-----------------|
| Node.js | 20+ (project uses `@types/node ^20`, `typescript ^5`, Next 16) |
| Package manager | `pnpm` (preferred — `package-lock.json` present) or `npm` |
| Supabase project | Postgres + `pgvector` extension; Auth enabled (magic-link) |
| `CRON_SECRET` | Random string — must match Vercel Cron `Authorization` header on all `app/api/cron/*` routes |
| AI provider | One of: `OPENROUTER_API_KEY` / `GOOGLE_GENERATIVE_AI_API_KEY` / `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` (see [Environment](#environment)) |
| YouTube Data API key | For `app/api/cron/tutorial-index` — `YOUTUBE_API_KEY` (server-only) |
| GitHub PAT | For sync — `GITHUB_TOKEN` public-repo read scope (server-only) |
| Resend API key | For alerts — `RESEND_API_KEY` (server-only) |
| Adzuna / Jooble / The Muse keys | Optional — free `ADZUNA_APP_ID`+`ADZUNA_APP_KEY`, `JOOBLE_API_KEY` (POST-only, key in URL path), `THEMUSE_API_KEY` (3.6k/hr vs 500/hr keyless) |

---

## Environment

Copy `.env.example` → `.env.local` — 18 vars. Only two are public; everything else is server-only (`server-only` import in `lib/ai/provider.ts`).

```bash
cp .env.example .env.local
# then fill the values below
```

| Variable | Visibility | Required | Purpose |
|----------|-----------|----------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Public | Yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public | Yes | Supabase anon key (RLS-respecting) |
| `SUPABASE_SERVICE_ROLE_KEY` | Server | Yes | Bypass RLS — only in `lib/supabase/service-role.ts` + `app/api/cron/*` |
| `SUPABASE_CONNECTION_URL` | Server | Optional | Direct Postgres connection string (if needed for `psql`/pgvector) |
| `AI_PROVIDER` | Server | No | `openai` \| `anthropic` \| `google` \| `mistral` \| `deepseek` \| `openrouter` \| `ollama` \| `generic` — inferred from `AI_MODEL` prefix or available key if unset |
| `AI_MODEL` | Server | Yes | Generation model (e.g. `openai/gpt-4o-mini`, `gemini-2.5-flash`, `claude-sonnet-4-5`) |
| `AI_MODEL_EMBEDDING` | Server | Yes if using Tutorial Search | Embedding model (e.g. `text-embedding-3-small`, `gemini-embedding-001`) |
| `AI_API_KEY` | Server | Yes | Generic key (also accepts provider-specific aliases) |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GOOGLE_GENERATIVE_AI_API_KEY` / `MISTRAL_API_KEY` / `DEEPSEEK_API_KEY` / `OPENROUTER_API_KEY` | Server | One of | Provider-specific aliases for `AI_API_KEY` |
| `AI_BASE_URL` / `OLLAMA_BASE_URL` / `OPENAI_BASE_URL` | Server | No | Override for OpenAI-compatible providers; `ollama` defaults to `http://localhost:11434/v1` |
| `CRON_SECRET` | Server | Yes | Must match Vercel Cron auth header — distinct from `API_KEY_PEPPER` |
| `YOUTUBE_API_KEY` | Server | For tutorial indexing | Only in `app/api/cron/tutorial-index` |
| `API_KEY_PEPPER` | Server | For `/api/export` | Secret mixed into `sha256(raw+pepper)` — distinct from `CRON_SECRET`; rotating invalidates all issued keys |
| `GITHUB_TOKEN` | Server | For GitHub sync | PAT public-read only — only in `app/api/cron/github-sync` |
| `RESEND_API_KEY` | Server | For alerts | Only in `app/api/cron/alert-dispatch` |
| `ADZUNA_APP_ID` / `ADZUNA_APP_KEY` | Server | Optional | Adzuna free pair — keep `us,gb` scope to stay under 2.5k/mo |
| `JOOBLE_API_KEY` | Server | Optional | POST-only, key embedded in URL path `jooble.org/api/{key}` — never log the URL |
| `THEMUSE_API_KEY` | Server | Optional | Register anyway (3.6k/hr vs 500/hr keyless) |
| `WEEKLY_INDEX_BUDGET` | Server | No | Max skills per weekly indexing run — default `40` (well under ~90–100 daily quota ceiling) |

> **Provider examples** (choose one line):
> - `AI_PROVIDER=openai AI_API_KEY=sk-… AI_MODEL=gpt-4o-mini`
> - `AI_PROVIDER=google GOOGLE_GENERATIVE_AI_API_KEY=… AI_MODEL=gemini-2.5-flash AI_MODEL_EMBEDDING=gemini-embedding-001`
> - `AI_PROVIDER=anthropic ANTHROPIC_API_KEY=… AI_MODEL=claude-sonnet-4-5`
> - `AI_PROVIDER=openrouter OPENROUTER_API_KEY=… AI_MODEL=deepseek/deepseek-chat`
> - `AI_PROVIDER=ollama AI_MODEL=llama3.1 OLLAMA_BASE_URL=http://localhost:11434/v1`

Auth email (magic-link) is configured in the Supabase Dashboard (SMTP / default sender) — not via `RESEND_API_KEY`; keep the two delivery paths independent.

---

## Quick Start

```bash
# 1. Clone
git clone https://github.com/<you>/dev-pulse.git
cd dev-pulse

# 2. Install (pnpm preferred; npm also works)
pnpm install
# or: npm install

# 3. Environment
cp .env.example .env.local
# Edit .env.local — at minimum fill:
#   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
#   AI_PROVIDER + (AI_API_KEY or provider-specific key) + AI_MODEL,
#   CRON_SECRET, API_KEY_PEPPER

# 4. Supabase — run migrations in order (SQL editor or supabase CLI)
#   001_initial_schema.sql → 002_rls_policies.sql → 003_vector_search_rpc.sql
#   → 004_job_summaries.sql → 005_disable_rls_on_public_tables.sql
#   → 006_update_job_sources.sql → 007_video_lessons.sql → 008_ai_quota.sql
#   Ensure: create extension if not exists vector;  (first migration does this)

# 5. Develop
pnpm dev
# open http://localhost:3000 → redirected to /sign-in → enter email → click magic link → Dashboard

# 6. Trigger ingestion manually (optional — otherwise daily 06:00 UTC via vercel.json)
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/ingest

# 7. Trigger tutorial indexing (weekly 02:00 UTC) / GitHub sync (weekly 04:00 UTC) the same way:
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/tutorial-index
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/github-sync
```

No Supabase env yet? Pages still render in demo mode — Dashboard shows `"No data yet — ingestion has not run"` empty state; auth gate falls back to allowing render when `createClient()` fails (middleware handles the real redirect when env is present).

---

## Development

### Scripts

| Script | Command | What it does |
|--------|---------|--------------|
| Dev | `pnpm dev` | `next dev` with `next.config.ts` + `proxy.ts` auth, file watcher reindexes `codegraph` ~1s |
| Build | `pnpm build` | `next build` — run whenever an API route or server component changes |
| Start | `pnpm start` | `next start` |
| Lint | `pnpm lint` | `eslint` (config `eslint.config.mjs`, `eslint-config-next`) |
| Typecheck | `pnpm exec tsc --noEmit` | Strict TS — zero errors required |
| Format | via `shadcn` / Tailwind v4 | `app/globals.css` + `components/ui/*` tokens |

### Data integrity (after first runs)

```sql
-- ingestion produced rows?
select skill, mention_count from skill_demand_snapshots
where month = to_char(now(),'YYYY-MM') order by mention_count desc limit 20;
-- expect typescript, react, python, node.js in top 10

-- chapters vs chunks balance
select skill_tag, count(*), avg(view_count) from tutorial_chunks group by skill_tag order by count(*) desc;
select count(distinct video_id) from tutorial_chapters;  -- expect 0 < chapters < chunks (not 0%, not 100%)
select * from skill_index_status order by last_indexed_at desc limit 10;

-- GitHub sync didn't clobber manual
select user_id, skill, source from user_skills where source='github_sync';

-- matching sanity (hand-check one job)
select j.id, j.title, json_agg(sm.skill) from job_postings j
join skill_mentions sm on sm.job_id=j.id group by j.id limit 5;
```

### Security gate (run before every PR — AGENTS.md §18)

```bash
# no private keys in client components
grep -r "SERVICE_ROLE" app/ | grep -v "lib/supabase/service-role\|app/api/cron"
grep -r "SUPABASE_SERVICE" app/components/        # 0
grep -r "OPENAI_API_KEY" app/                     # 0
grep -r "YOUTUBE_API_KEY" app/                     # 0
grep -r "RESEND_API_KEY" app/                     # 0
grep -r "GITHUB_TOKEN" app/                        # 0
grep -r "API_KEY_PEPPER" app/                      # 0 outside lib/api-keys + app/api/keys*
grep -r "AI_MODEL" app/                            # 0 outside app/api + lib/ai
grep -r "@anthropic-ai/sdk" app/                  # 0
grep -r "openai" app/components/                  # 0
grep -r "resend" app/components/                  # 0
grep -r "octokit" app/components/                 # 0
grep -rl "googleapis.com/youtube" app/ | grep -v "app/api/cron/tutorial-index"   # 0
grep -rl "api.github.com" app/ | grep -v "app/api/cron/github-sync"              # 0
grep -rn "console.log.*apiKey\|console.log.*rawKey" app/                          # 0
pnpm exec tsc --noEmit              # 0 errors
pnpm exec eslint .                  # 0 warnings in new files
pnpm build                          # must succeed if routes changed
```

### RLS & auth checks

- [ ] Valid email → magic link → click → session cookie → any page except `/sign-in` loads; sign-out → redirect to `/sign-in`
- [ ] `profiles` row autocreated via `on_auth_user_created` trigger on first sign-in
- [ ] `select * from user_skills where user_id != auth.uid()` returns 0 rows for a signed-in user (prove RLS, not just UI)
- [ ] `GET /api/export` without `Authorization: Bearer dp_live_…` → 401; with revoked key → 401
- [ ] `GET /api/cron/ingest` without `CRON_SECRET` → 401

---

## API Routes

All under `app/api/` — Next.js App Router, `runtime = "nodejs"`, Zod-validated, `server-only` where keys are used.

| Route | Method | Auth | Purpose |
|-------|--------|------|---------|
| `/api/auth/callback` | GET | magic-link code | Exchange code → session cookie → redirect `?next=` |
| `/api/cron/ingest` | GET | `CRON_SECRET` bearer | Daily ingest — 10 sources (see Pipelines) |
| `/api/cron/tutorial-index` | GET | `CRON_SECRET` | Weekly tutorial chapters + chunks + lesson generation |
| `/api/cron/github-sync` | GET | `CRON_SECRET` | Weekly GitHub public-repo skill sync |
| `/api/cron/alert-dispatch` | GET | `CRON_SECRET` | Instant + digest + learning-gap emails via Resend |
| `/api/gap-report` | POST | Session (`supabase.auth.getUser`) | Feature 1 — `{target_role, skills[1..16], include_tutorials}` → deterministic alignment + AI 3 recommendations |
| `/api/tutorial-search` | POST | Session | Feature 3 — `{skill}` (dictionary-validated) → `embed` → Stage 1 chapters → Stage 2 chunks → 7 results with optional `chapter_label` |
| `/api/tutorial-lessons/[video_id]` | GET | Session | Lesson notes for `LessonTheater` |
| `/api/jobs` | GET | None (public feed) / Session for personalization | `?limit&offset&source&skill` → `getJobsWithSkills` with `monitoredSources` filter |
| `/api/jobs/stats` | GET | None | `getJobsStats` for header counts |
| `/api/jobs/[id]/summary` | GET | Session | Feature 4 — AI-restructured About/Role/Requirements (cached after first generation) |
| `/api/profile` | GET/POST | Session | Identity + career target — reads/writes `profiles` |
| `/api/profile/skills` | GET/POST/DELETE | Session | `user_skills` CRUD (dictionary-validated tags) |
| `/api/alert-preferences` | GET/POST | Session | 3 alert toggles + threshold/webhook |
| `/api/saved-jobs` | GET/POST/DELETE | Session | `saved_jobs` by `user_id` |
| `/api/keys` | POST | Session | Generate `dp_live_` — hash + store, return raw once |
| `/api/keys/revoke` | POST | Session | `revoked_at=now()` — immediate invalidation |
| `/api/export` | GET | Hashed bearer `dp_live_…` (not session) | Read-only caller's `profiles`/`user_skills`/`user_skill_profiles`/`saved_jobs` JSON |
| `/api/trends` | GET | None | `?skills&range=3M|6M|12M` → `getTrendsData` (shared with Dashboard chart) |
| `/api/trends-summary` | GET/POST | None / Session | Feature 2 — AI one-paragraph trend synthesis (grounded) |
| `/api/debug/*` | GET | None/Service-role | `anon-snapshots`, `counts`, `dashboard`, `env`, `session`, `table-access` — debug only |

Profile-scoped routes (`/api/profile*`, `/api/gap-report`, `/api/saved-jobs`, `/api/alert-preferences`, `/api/keys*`) all call `supabase.auth.getUser()` server-side and 401 on missing session before touching Supabase. `/api/export` is the only route that accepts a hashed bearer key instead of a session — never both, never silent fallback.

---

## Contributing

Follow `AGENTS.md` §4 without exception — **PLAN → APPROVE → BUILD → CHECK → REPORT**:

1. **Read `AGENTS.md`** — architecture rule (§2: browser never holds keys) + identity model (§3: magic-link, session + RLS) before any code.
2. **Read the relevant skills** — skills override memory: `vercel/next.js`, `vercel/ai`, `supabase`, `supabase-postgres-best-practices`, `vercel-react-best-practices`, `impeccable`, `framer-motion-animator`, `secure-coding`, `shadcn/ui`.
3. **Inspect existing code** — sample 2–3 similar files; check `codegraph` for callers/callees before editing.
4. **Write an implementation prompt** in `prompts/` (goal, skills read, code inspected, decisions, files touched, requirements, security checks, acceptance, manual steps). Include: *"Verify that no API keys are exposed to the browser, and that every profile-scoped route validates the Supabase session or API key server-side, before marking complete."*
5. **Ask for approval** — post the prompt path, wait for yes.
6. **Build only after approval** — never code before the prompt is approved unless explicitly skipped.
7. **Run all checks** (§18) — `tsc --noEmit`, `eslint`, `next build`, security gate greps, DB sanity queries. Report real output.
8. **Close** with *What I did / Test / Needs your attention*.

Other conventions: `typescript strict` + no `any`, Zod on all external inputs, deterministic matching in `lib/matching.ts` only (never AI), `pnpm` + `shadcn` for UI, Framer Motion (not GSAP), honest `"Not disclosed"` / `"Not enough data"` gaps, single `SKILLS_DICTIONARY` source of truth.

---

## License

MIT — Copyright (c) 2026 DevPulse (prg-04). See [`LICENSE`](./LICENSE).

---

*Built for remote developers who want data, not vibes. Data refreshed daily · Last update: `ingestion_runs.completed_at` · 10 sources.*
