# Update Jobs Data Sources — 4 → 10 Sources Implementation Prompt

## Goal
Expand DevPulse job ingestion from 4 sources (HackerNews, Himalayas, RemoteJobs.org, Remotive) to **10 sources** per AGENTS.md §10 and §12a, adding the three keyed sources (Adzuna, Jooble, The Muse) and three additional keyless sources (Arbeitnow, RemoteOK, Jobicy). All ten are called server-side in the daily cron `GET /api/cron/ingest` regardless of any account's `monitored_sources` toggle — toggles only filter what an account *sees* (§5f item 4). Update every UI string, badge, enum, and DB constraint that currently hardcodes "4 sources" to "10 sources". Enforce AGENTS.md compliance requirements: Adzuna `salary_is_predicted` honesty rule, Adzuna "Jobs by Adzuna" attribution badge, Jooble POST-only key-in-URL secrecy, Jobicy 1/hour guidance, Adzuna quota scope, and per-source failure isolation (one source failing never blocks other nine).

## Skills Read
- `supabase` — `supabase-postgres-best-practices` — schema design, RLS, `ON CONFLICT` upsert, `check` constraints on `source`, `text[]` default for `monitored_sources`, `pgcrypto`/`vector` extensions already enabled. Verified `supabase/migrations/001_initial_schema.sql` uses `check (source in ('hackernews','himalayas','remotejobs','remotive'))` for `job_postings` and `default '{hackernews,himalayas,remotejobs,remotive}'` for `profiles.monitored_sources` — both must be expanded to 10.
- `vercel/next.js` — App Router 16.3.5 `route.ts` handlers, `runtime="nodejs"`, `dynamic="force-dynamic"`, `CRON_SECRET` Bearer check pattern already in `app/api/cron/ingest/route.ts`, `NEXT_PUBLIC_` public-vs-server boundary (§2, §8). No client component may import or reference `ADZUNA_APP_ID`, `JOOBLE_API_KEY`, `THEMUSE_API_KEY`, `YOUTUBE_API_KEY`, `GITHUB_TOKEN`, `RESEND_API_KEY`, `API_KEY_PEPPER`, `SUPABASE_SERVICE_ROLE_KEY`.
- `vercel/ai` — Not used in ingestion (dictionary-based extraction only per §12a) — confirm no AI call added to ingestion.
- `vercel-react-best-practices` — Server vs client split, `force-dynamic`, parallel fetch, strict TS.
- `secure-coding` — Input sanitization via Zod on `app/api/jobs/route.ts` query schema, server-only secrets, Jooble URL contains secret never logged, `CRON_SECRET` vs session auth distinct, `stripHtml` on descriptions.
- `impeccable` — Dark palette `#070A14`/`#0F172A`/`#1E293B`/`#14B8A6`/`#2DD4BF`, badge colors per source — extend with 6 new distinct colors following existing style, Adzuna badge small attribution per compliance.
- Existing ingestion pattern — `app/api/cron/ingest/route.ts` prior jobs-feature audit: `Promise.allSettled` + per-source try/catch, dedup by `external_id`, chunked `select` for existing ids, batch upsert 100 rows, skill extraction via `lib/skills-dictionary.ts` regex, `extractComp`/`extractLiquidityTier`/`extractContractorType` best-effort, `deriveMonth`, skill_mentions + skill_demand_snapshots upsert. Keep this structure; add 6 new fetchers in same style.

## Code Inspected
- `app/api/cron/ingest/route.ts` (558 lines) — 4 fetchers (`fetchHackerNews`, `fetchHimalayas`, `fetchRemoteJobs`, `fetchRemotive`), `Promise.allSettled([4])`, `sourceNames=["hackernews","himalayas","remotejobs","remotive"]`, `RawJob` type, helpers `deriveMonth`, `extractSkills`, `extractComp`, `extractLiquidityTier`, `extractContractorType`, `POSTGRES` batch logic, `CRON_SECRET` guard, service-role client, `ingestion_runs` audit. No Adzuna/Jooble/TheMuse/Arbeitnow/RemoteOK/Jobicy fetchers yet.
- `lib/skills-dictionary.ts` — 30 canonical skills, aliases, `normalizeSkill()`, `ALL_SKILLS` — unchanged.
- `lib/queries/jobs.ts` — `getJobsWithSkills` supports `source` and `monitoredSources` via `eq`/`in`, `getJobsStats`, `getUserSkillsAndGaps`, `applyArchetypeFilter`, `sortJobs` — no source hardcode; compatible.
- `app/api/jobs/route.ts` — `QuerySchema` enum `["all","hackernews","himalayas","remotejobs","remotive"]` — must expand to 10. Uses `getJobsWithSkills` with `monitoredSources` when source=all.
- `app/api/jobs/stats/route.ts` — `bySourceOrdered` with 4 keys — must expand to 10.
- `components/jobs/JobsClient.tsx` — `SOURCE_META` 4 entries, header "4 verified remote engineer sources", "Feed Ingestion: Healthy (4/4 nodes)", `sourcesForFilter` maps 4.
- `components/jobs/JobCard.tsx` — `sourceBadge` switch 4 cases, comp/location rendering, `stack_match_pct`, gap chips; missing 6 new badges + Adzuna attribution.
- `components/dashboard/SourcesCard.tsx` — subtitle "4 ingest pipelines".
- `components/layout/AppFooter.tsx` — "Data refreshed daily · Last update: X · 4 sources".
- `components/profile/ProfileClient.tsx` — Ingestion Sources panel renders 4 cards (HackerNews, Himalayas, RemoteJobs, Remotive), toggle `monitored_sources`, rail meta `${profile.monitored_sources.length}/4 live` — must become 10 rows grouped (keyless first, then keyed 3) same visual style, no new layout.
- `app/(app)/jobs/page.tsx` — stats init `bySource: {hackernews:0,himalayas:0,remotejobs:0,remotive:0}` 4 keys.
- `app/(app)/page.tsx` (Dashboard) — `"4 sources"` strings: `postingsLabel: "... across 4 sources"`, `postingsLabel = "... across 4 sources"` fallback.
- `supabase/migrations/001_initial_schema.sql` — `job_postings.source` check constraint 4 values, `profiles.monitored_sources` default 4 values — need migration `006_update_job_sources.sql` expanding both to 10.
- `vercel.json` — cron `/api/cron/ingest` `0 6 * * *` unchanged — single daily cron still handles all 10.
- `.env.example` — has `NEXT_PUBLIC_SUPABASE_URL/ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `YOUTUBE_API_KEY`, `GITHUB_TOKEN`, `RESEND_API_KEY`, `API_KEY_PEPPER`, `WEEKLY_INDEX_BUDGET=40` — missing `ADZUNA_APP_ID`, `ADZUNA_APP_KEY`, `JOOBLE_API_KEY`, `THEMUSE_API_KEY` (optional).
- `app/api/jobs/stats` consumer `JobsFilters` not source-hardcoded — uses passed `sources` prop.
- `lib/queries/dashboard.ts` `getSourcesBreakdown` aggregates by `source` dynamically — no hardcode, just ensure color array supports 10.

## Decisions & Assumptions
- **Schema migration** — Create `supabase/migrations/006_update_job_sources.sql` that: (a) drops old `job_postings_source_check` and re-adds `check (source in ('hackernews','himalayas','remotejobs','remotive','arbeitnow','remoteok','jobicy','adzuna','jooble','themuse'))`, (b) alters `profiles.monitored_sources` default to `'{hackernews,himalayas,remotejobs,remotive,arbeitnow,remoteok,jobicy,adzuna,jooble,themuse}'`. Existing rows unaffected; new profiles get 10 defaults. Use `if exists` guards and idempotent `alter table ... drop constraint if exists`.
- **Fetcher design — mirror existing 4** — Add 6 new `async fetchX(): Promise<RawJob[]>` functions, each `try/catch` internal, `console.error("[ingest] X failed:", err)` and `return []` on failure so `Promise.allSettled` isolation holds. All fetches use `fetch(url, {headers, signal?})` server-side only. No client import.
- **Arbeitnow** — `GET https://www.arbeitnow.com/api/job-board-api?remote=true` (or without param then filter), no auth, fields: `data: [{slug, company_name, title, description, remote, job_types, location, created_at}]`. Build `external_id: arbeitnow-${slug}`, `location_text: location`, `posted_at: created_at`. Apply `remote` boolean filter if API param not respected. Poll politely once daily.
- **RemoteOK** — `GET https://remoteok.com/api` with `User-Agent` header (required), no auth, returns array where first element is legal notice. Filter `item.id` existing, `tags` field used for description skill extraction fallback but still store `description`. `external_id: remoteok-${id}`, `company: company`, `posted_at: date`. Keep `tags` joined into description for skill extraction if description sparse.
- **Jobicy** — `GET https://jobicy.com/api/v2/remote-jobs?industry=engineering&count=200` (or default 50), no auth, response `{jobs: [...]}` paginated? Fetch 1 page of 200 daily (within 1/hour guidance). `external_id: jobicy-${id}`, `location_text: jobGeo || location`, `posted_at: pubDate`.
- **Adzuna** — `GET https://api.adzuna.com/v1/api/jobs/{country}/search/{page}?app_id=...&app_key=...&results_per_page=20&content-type=application/json` where `country` fixed to `us` and `gb` only (2 countries × 1-2 pages max to stay under 250/day, 2500/month). If `ADZUNA_APP_ID/KEY` missing, log `Adzuna skipped: missing credentials` and return `[]` — do not fail ingestion. Parse `results: [{id, title, description, company: {display_name}, location: {display_name}, created, salary_min/max, salary_is_predicted, redirect_url}]`. **Honesty rule (§9): only set `comp_min/max` when `salary_is_predicted === false`; otherwise `undefined` (renders "Not disclosed")**. Log 429 as "Adzuna quota exhausted" distinct message. Attribution: `JobCard` Adzuna badge shows "Jobs by Adzuna" small link per ToS.
- **Jooble** — `POST https://jooble.org/api/{JOOBLE_API_KEY}` with body `JSON.stringify({keywords: "developer", location: "remote", page: 1})`, `Content-Type: application/json`. Key embedded in URL path — never log URL with key; if logged, redact. If `JOOBLE_API_KEY` missing, skip with log and return `[]`. Parse `jobs: [{id, title, snippet, company, location, updated, salary, link}]`. Handle salary string parsing via existing `extractComp`. Watch for 429.
- **The Muse** — `GET https://www.themuse.com/api/public/jobs?category=Software%20Engineer&page=1` with optional `?api_key=` if `THEMUSE_API_KEY` set. Keyless 500/hr vs 3600/hr with key — register free key recommended but code supports keyless fallback. Parse `results: [{id, name, company:{name}, locations:[{name}], publication_date, contents, refs:{landing_page}}]`. `external_id: themuse-${id}`, `description: contents` stripHtml later, `external_url: refs.landing_page`.
- **Adzuna quota safety** — Limit Adzuna to 2 countries (us, gb) × 2 pages × 20 per page = 80 jobs max per daily run, well under 250/day. Jooble/TheMuse also limited to 1 page each. Total 10 sources each ≤3 pages (existing ones already capped at 2-3), keep ingestion under 30s.
- **Ingestion orchestration** — Expand `Promise.allSettled([...10 fetchers...])` and `sourceNames` array to 10 in same order. Ensure errors array captures per-source reason without aborting others. `allJobs` accumulates all. Keep deduplicate, existingIds chunked 100, batch upsert 100, skill extraction same, snapshot counts same. No change to skill logic.
- **UI — follow existing Tailwind/shadcn patterns** — `components/jobs/JobsClient.tsx` `SOURCE_META` expanded to 10 with colors: hackernews #FB923C, himalayas #A78BFA, remotejobs #2DD4BF, remotive #F472B6, arbeitnow #38BDF8, remoteok #F43F5E, jobicy #22C55E, adzuna #F59E0B, jooble #6366F1, themuse #06B6D4. Header meta updated to "10 verified remote engineer sources" and "10/10 nodes". `SourcesCard` subtitle "10 ingest pipelines". Footer "10 sources". Dashboard "across 10 sources". No redesign — just string/number updates.
- **Profile panel grouping** — AGENTS §5f item 4 says reference mockup shows 4 rows, add remaining 6 rows in same visual style, grouped however reads cleanest (keyless first, then three that need server-owned key). Implement as 2× grid of 10 cards: first 7 keyless (hackernews, himalayas, remotejobs, remotive, arbeitnow, remoteok, jobicy), then 3 keyed (adzuna, jooble, themuse) with subtle "keyed" note. Same `toggleSource` handler. Rail meta `${profile.monitored_sources.length}/10 live`.
- **JobCard badges** — Add cases for 6 new sources in `sourceBadge` with label/color; for `source==='adzuna'` return extra `attribution: true` flag to render small "Jobs by Adzuna" badge link below source badge (compliance, not style). Do not apply attribution to other 9 sources.
- **API contracts** — `app/api/jobs/route.ts` Zod enum expands to `z.enum(["all","hackernews","himalayas","remotejobs","remotive","arbeitnow","remoteok","jobicy","adzuna","jooble","themuse"])`. Same for `app/api/jobs/stats` ordering. No breaking change for existing clients sending old source values.
- **Env handling** — `.env.example` adds `ADZUNA_APP_ID=`, `ADZUNA_APP_KEY=`, `JOOBLE_API_KEY=`, `THEMUSE_API_KEY=` (optional, comment about keyless fallback), plus notes: Adzuna quota tight (§10), Jooble key in URL path secret, never log. No `NEXT_PUBLIC_` prefix for any of these. Code checks `process.env.ADZUNA_APP_ID` etc server-side only; missing key ⇒ skip that source with log, not 500.
- **No AI calls** — Ingestion stays dictionary-based; no `generateText`/`embed`.
- **Backwards compat** — Profiles with old 4-element `monitored_sources` still valid (subset of 10). Ingestion still writes `source` values that old code can read; old UI would just ignore unknown sources but updated UI handles them.

## Files To Touch
- `prompts/2026-09-14-update-jobs-ten-sources.md` (this file)
- `supabase/migrations/006_update_job_sources.sql` — new migration: expand `job_postings.source` check and `profiles.monitored_sources` default to 10 values.
- `app/api/cron/ingest/route.ts` — edit: add 6 fetchers (Arbeitnow, RemoteOK, Jobicy, Adzuna with salary_is_predicted guard, Jooble POST with key-in-URL redaction, The Muse optional key), expand `Promise.allSettled` + `sourceNames` to 10, reuse existing helpers, keep per-source isolation, add quota/skip logs.
- `app/api/jobs/route.ts` — edit: `QuerySchema` source enum to 10 values.
- `app/api/jobs/stats/route.ts` — edit: `bySourceOrdered` to include 10 keys + ordered `sources` array.
- `components/jobs/JobsClient.tsx` — edit: `SOURCE_META` 10 entries, header copy "10 verified...", "10/10 nodes", `totalLive` unchanged.
- `components/jobs/JobCard.tsx` — edit: `sourceBadge` 6 new cases with colors, Adzuna attribution badge render when `source==='adzuna'`.
- `components/jobs/JobsFilters.tsx` — no enum change needed (receives `sources` prop) — verify no hardcode.
- `components/dashboard/SourcesCard.tsx` — edit: subtitle "10 ingest pipelines".
- `components/layout/AppFooter.tsx` — edit: "10 sources".
- `app/(app)/jobs/page.tsx` — edit: `stats` init `bySource` 10 keys, `total` handling unchanged.
- `app/(app)/page.tsx` — edit: two occurrences of `"4 sources"` → `"10 sources"`, keep `buildMonthsBack` logic.
- `components/profile/ProfileClient.tsx` — edit: Ingestion Sources panel from 4 to 10 cards grouped (7 keyless + 3 keyed), rail meta `/10 live`, same toggle style.
- `lib/queries/jobs.ts` — no change (already dynamic) — verify import still works.
- `lib/queries/dashboard.ts` — edit: `colors` array from 4 to 10 entries to avoid color reuse collisions.
- `.env.example` — edit: add `ADZUNA_APP_ID`, `ADZUNA_APP_KEY`, `JOOBLE_API_KEY`, `THEMUSE_API_KEY` (optional) with comments about quota, secrecy, and server-only.
- `README.md` (if updated) — optional: mention 10 sources in ingestion docs; not required but check not to regress.

## Requirements
- Cron still daily single route ingesting all 10 in parallel; any single source failure/empty/429/missing key logs per-source and continues — other nine still ingest.
- Adzuna `salary_is_predicted:true` ⇒ `comp_min`/`comp_max` forced to `undefined`/`null` (never stored/displayed as employer-stated), renders "Not disclosed" in JobCard.
- Jooble API key never appears in logs or client bundle; constructed server-side only; if leaked in error message, redacted.
- Adzuna attribution badge only on `source==='adzuna'` cards (small "Jobs by Adzuna" with link to https://www.adzuna.com), not on other 9.
- Profile toggles for all 10 sources persist to `profiles.monitored_sources` via `PUT /api/profile`; `GET /api/jobs?source=all` respects `monitoredSources` filtering (or `?source=adzuna` direct filter).
- `GET /api/jobs/stats` returns counts for all 10 sources; Dashboard `getSourcesBreakdown` reflects 10.
- All UI strings updated: Jobs header, footer, dashboard, profile rail, sources card.
- No `NEXT_PUBLIC_` secrets; no client `fetch` to external job APIs; no AI calls in ingest.
- `npx tsc --noEmit` zero errors, `npx eslint .` zero warnings in changed files.

## Security Checks (must pass before complete)
```
grep -r "SERVICE_ROLE" app/           # only app/api/cron/ingest/route.ts and lib/supabase/service-role.ts (+ other cron routes)
grep -r "SUPABASE_SERVICE" app/        # only lib/supabase/*
grep -r "OPENAI_API_KEY" app/          # 0
grep -r "YOUTUBE_API_KEY" app/          # only app/api/cron/tutorial-index/route.ts
grep -r "RESEND_API_KEY" app/           # only app/api/cron/alert-dispatch/route.ts
grep -r "GITHUB_TOKEN" app/             # only app/api/cron/github-sync/route.ts
grep -r "API_KEY_PEPPER" app/           # only app/api/keys/* and lib/api-keys.ts
grep -r "CRON_SECRET" app/              # only app/api/cron/*/route.ts
grep -r "AI_MODEL" app/                 # only server routes app/api/*/route.ts (gap-report, trends-summary, jobs/[id]/summary)
grep -r "ADZUNA" app/                   # only app/api/cron/ingest/route.ts (server-only) — must be 0 in app/components/*
grep -r "JOOBLE" app/                   # only app/api/cron/ingest/route.ts (server-only)
grep -r "THEMUSE" app/                  # only app/api/cron/ingest/route.ts
grep -r "JOOBLE_API_KEY\|ADZUNA_APP" app/components/  # 0
grep -r "@anthropic-ai/sdk" app/        # 0
grep -r "\"openai\"" app/components/    # 0
grep -r "resend" app/components/        # 0
grep -r "octokit" app/components/       # 0
grep -rl "googleapis.com/youtube" app/ | grep -v "app/api/cron/tutorial-index"  # 0
grep -rl "api.github.com" app/ | grep -v "app/api/cron/github-sync"              # 0
grep -rl "hn.algolia.com\|himalayas.app\|remotejobs.org\|remotive.com\|arbeitnow.com\|remoteok.com\|jobicy.com\|api.adzuna.com\|jooble.org\|themuse.com" app/ | grep -v "app/api/cron/ingest"  # 0 — only ingest cron calls live APIs
grep -rn "console.log.*apiKey\|console.log.*rawKey\|console.log.*JOOBLE\|console.log.*ADZUNA" app/  # 0
```
Verify that no API keys are exposed to the browser, and that every profile-scoped route validates the Supabase session or API key server-side, before marking complete. Check Network tab + `window` for leaked env; confirm `img.youtube.com` handling unchanged.

## Acceptance Criteria
- `npx tsc --noEmit` passes; `npx eslint .` passes for changed files; `npx next build` succeeds.
- `supabase/migrations/006_update_job_sources.sql` applied (or SQL idempotent) — `job_postings` Accepts 10 source values, `profiles.monitored_sources` default contains 10.
- `GET /api/cron/ingest` without `Authorization: Bearer $CRON_SECRET` → 401; with valid secret → 200, ingests from ≥2 sources (real), `jobsIngested>0` or descriptive 0 with message not crash, `ingestion_runs` updated success, per-source logs present, Adzuna 429 logged as "Adzuna quota exhausted" not generic, missing keys logged as skipped.
- After ingestion, `SELECT source, COUNT(*) FROM job_postings GROUP BY source` shows rows for at least 4 of 10 (HN+Remotive+Himalayas stable; new ones may be empty if keys missing — acceptable as skipped not failed).
- `GET /api/jobs?source=arbeitnow` returns only that source; `?source=adzuna` returns Adzuna jobs with "Jobs by Adzuna" badge in UI; `?source=all` respects account's `monitored_sources`.
- `GET /api/jobs/stats` returns `bySource` with 10 keys; Dashboard SourcesCard shows 10 bars; footer shows "10 sources".
- Jobs page header shows "10 verified remote engineer sources" + "10/10 nodes"; filters show 10 source chips with counts and distinct colors; profile panel shows 10 toggles grouped same style, rail `X/10 live`.
- JobCard Adzuna cards render attribution badge; non-Adzuna cards do not; Adzuna `salary_is_predicted:true` jobs show "Not disclosed" not predicted number.
- `Profiles` with old 4 defaults still load; toggling a new source persists and filters Jobs feed + alerts but not Dashboard global counts.
- Security greps pass; no live API calls from browser (Network only `/api/jobs*`); no secrets in bundle.

## Manual Test Steps
1. `npm run dev` → signed-out → /sign-in redirect → magic link sign-in → lands /jobs.
2. `curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/ingest` → 200 `{jobsIngested:N, errors?}`; check Supabase `SELECT source, COUNT(*) FROM job_postings GROUP BY source` — expect ≥4 sources with counts (HN, Himalayas, Remotive, RemoteJobs baseline; new sources appear when keys/env set).
3. Test Adzuna honesty: craft mock Adzuna response with `salary_is_predicted:true, salary_min:50000` — verify ingested `comp_min` is null in DB and UI shows "Not disclosed" not $50k.
4. Test Jooble secrecy: `grep -r JOOBLE app/components` 0; trigger Jooble fetch with missing key → log "Jooble skipped: missing JOOBLE_API_KEY" not crash, ingest still success.
5. Reload /jobs → header "10 verified remote engineer sources", "10/10 nodes", source chips 10 with counts, 10 distinct dot colors.
6. Click profile → Monitored Sources panel shows 10 rows (7 keyless + 3 keyed grouped); toggle `arbeitnow` off → Save → reload /jobs → `All Sources` count decreases, Dashboard counts unchanged.
7. Set source filter `?source=adzuna` → only Adzuna cards; verify small "Jobs by Adzuna" badge/link on each; other sources no badge.
8. Type "typescript" in search → filters; select archetype `backend` → filters; sort `Comp: High → Low` → reorders; `Profile Match` uses `stackMatchPct`.
9. Dashboard → Sources this month shows 10 rows/bars, subtitle "10 ingest pipelines", footer "10 sources".
10. Run `npx tsc --noEmit && npx next build` → pass; run security greps → only allowed matches; DevTools Network shows no external job API calls.
11. Resize 1280/768/375 → no overflow; filters wrap; list then detail stacks.

