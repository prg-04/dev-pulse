# Jobs Feature Implementation Prompt — DevPulse Jobs (design/job-description.png)

## Goal
Implement pixel-exact **Jobs** page at 1280px per `design/job-description.png` + live ingestion from 4 real APIs (HackerNews Algolia, Himalayas, RemoteJobs.org, Remotive). The page is a filtered live feed where every card is scored deterministically against the signed-in user's `user_skills` (stack-match % via `lib/matching.ts` §13a), highlights gap skills (`gap_report_events` last 30d) with orange `!gap` chips, and detail panel shows AI-restructured posting (About / The Role / What You'll Do / Requirements) via `GET /api/jobs/[id]/summary` with caching. Ingestion pipeline (`/api/cron/ingest`) must actually fetch real jobs — no mocks at runtime. Desktop is source of truth; mobile stacks left list + right detail sensibly. All data reads from Supabase (`job_postings`, `skill_mentions`) — never live external API from browser.

## Skills Read
- `supabase` — Auth magic-link session via `@supabase/ssr` (`createClient()` server), RLS `auth.uid()=user_id` on `saved_jobs`, `user_skills`, `gap_report_events`; service_role bypass only in `/api/cron/*`; anon respects RLS; `handle_new_user` trigger; `profiles.monitored_sources` filtering.
- `supabase-postgres-best-practices` — Avoid raw `COUNT(*)` in user request; read pre-aggregated `skill_demand_snapshots` + `job_postings` + `skill_mentions`; indexes on `(skill,month)` and `job_id`; `ivfflat` not needed for jobs; `ON CONFLICT` upsert for snapshots.
- `ai-sdk` (`ai` ^7.0.99) — Verified `node_modules/ai` docs: Gateway model `provider/model`, `generateText` with grounded system prompt, lazy `import("ai")`, `AI_MODEL` env drives provider, maxOutputTokens; no `embed` for jobs — generation only for restructuring. No direct `@anthropic-ai/sdk`/`openai` imports in components.
- `vercel-react-best-practices` — Server vs client split, `force-dynamic`, `Promise.all` parallel fetch, `lucide-react` via optimized imports, no `any`, strict TS, no `async` in Framer Motion animate.
- `framer-motion-animator` — v13 present; bar width animate, card stagger `delay idx*0.03`, no async animate callbacks.
- `secure-coding` (React/TS) — Zod validation at route boundary, no secrets in client, `NEXT_PUBLIC_` audit, CRON_SECRET vs session auth distinct.
- `impeccable` — Dark palette `#070A14` page, `#0F172A` card, `#1E293B` border, `#14B8A6`/`#2DD4BF` teal, green/red/amber chips, typography discipline.
- `shadcn/ui` + Charts — `card`, `badge`, `button`, `skeleton` primitives via `npx shadcn@latest add`; owned code.
- Next.js App Router 16.3.5 — `route.ts` handlers, `dynamic="force-dynamic"`, `headers()`/`cookies()` async, `proxy.ts` guard.

## Code Inspected
- `app/(app)/layout.tsx` — Auth guard `supabase.auth.getUser()` + redirect `/sign-in`; `AppHeader` + `AppFooter` shared; `getIngestionLastUpdate` from `ingestion_runs`.
- `app/(app)/page.tsx` (Dashboard) — pattern: `force-dynamic`, `createClient()` null-guard, `getLatestMonth` + `getTopSkillsWithDelta` + `getSourcesBreakdown` + `getBiggestMovers` parallel, empty state dashed card when no data.
- `app/(app)/trends/page.tsx` + `app/(app)/gap-report/page.tsx` — same `force-dynamic` +_supabase fallback to empty; gap-report computes via `lib/matching.ts`.
- `app/api/cron/ingest/route.ts` — **Already implements 4-source fetch** with `Promise.allSettled`, `external_id` dedup, `extractSkills` via `SKILLS_DICTIONARY` regex, `extractComp`/`extractLiquidityTier`/`extractContractorType` best-effort, batch insert `job_postings` → `skill_mentions` → `skill_demand_snapshots` upsert; CRON_SECRET check, service-role client, `ingestion_runs` audit. **To verify**: HackerNews fetch builds `hn-{id}`, Himalayas uses `https://himalayas.app/jobs/api?limit=20&cursor`, RemoteJobs `https://remotejobs.org/api/v1/jobs`, Remotive `https://remotive.com/api/remote-jobs?page`. Need to test each live and fix pagination/mapping if 4xx or empty (Himalayas endpoint historically `himalayas.app/api/jobs` without /jobs/api — verify; RemoteJobs may be `/api/v1/jobs?page=1` vs plain; Remotive max 20/page). Ensure `external_url` populated for "Apply Directly".
- `lib/skills-dictionary.ts` — Canonical map 30 skills, `normalizeSkill()`, `ALL_SKILLS`; used for extraction + chip validation + archetype mapping.
- `lib/matching.ts` — `stackMatchPct(jobSkills, userSkills) => number|undefined` (undefined→"Not enough data") and `marketAlignmentPct` — single source of truth; Jobs must import `stackMatchPct` not reimplement.
- `lib/supabase/{server,service-role,env,middleware}.ts` + `proxy.ts` — SSR cookie handling, anon fallback, middleware `updateSession`; `proxy` already exempts `/api/*` from redirect, lets routes do 401 themselves.
- `lib/queries/dashboard.ts` + `trends.ts` — Query helpers reading `skill_demand_snapshots` only; pattern to reuse for job counts.
- `components/layout/AppHeader.tsx` — Nav `Dashboard·Trends·Jobs·Gap Report·Profile`, sticky 52px, teal underline active, Live dot, profile ring; Jobs tab already present `href="/jobs"` active via `startsWith("/jobs")` — no header edit needed beyond confirming link works when `/jobs` created.
- `components/layout/AppFooter.tsx` — "Data refreshed daily · Last update: X · 4 sources" shared.
- `components/ui/{button,card,chart}.tsx` — present; check `badge`/`skeleton` exists else add.
- `app/api/gap-report/route.ts`, `app/api/tutorial-search/route.ts`, `app/api/profile/route.ts` — exemplar auth pattern `createClient() → auth.getUser() → 401`; Zod validation; lazy AI import; grounded prompts.
- `supabase/migrations/001_initial_schema.sql` + `002_rls_policies.sql` — Tables `job_postings`, `skill_mentions`, `skill_demand_snapshots`, `profiles`, `user_skills`, `saved_jobs` (RLS), `gap_report_events` (RLS), `ingestion_runs` present. No `job_summaries` yet — will add for AI caching.
- `vercel.json` — crons: `/api/cron/ingest` 0 6 * * *, tutorial-index, github-sync, alert-dispatch; CRON_SECRET distinct.
- `.env.local` / `.env.example` — `NEXT_PUBLIC_SUPABASE_URL/ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `YOUTUBE_API_KEY`, `AI_MODEL`; missing `RESEND_API_KEY`/`GITHUB_TOKEN` not needed for jobs.
- `design/job-description.png` (1280px navy) — parse: Page header "Live Job Postings & Ingestion Stream" + `42,891 requisitions live` badge teal, meta `Feed Ingestion: Healthy (4/4 nodes) / Parser latency: 42ms`, sub "Raw requisitions ingested continuously across 4 verified remote engineer sources..." Search row: `⌘K` search input "fullstack typescript" (dark `#0F172A` inset), filter pills `Profile Match: 74%+` (teal active), `Latest Ingested`, `Comp: High → Low`, `All Filters (3)` with funnel icon. Sources row: `SOURCES:` + chips `All Sources 42,891` (white active), `HackerNews 12,430` orange dot, `Himalayas 7,891` purple, `RemoteJobs 5,203` teal, `Remotive 3,011` pink — dot + count. Archetype row: `ARCHETYPE:` + `senior fullstack` active teal, `backend`/`frontend`/`infra/devops` muted, `US Remote ($160k+)` green pill. Body 2-col: Left scroll list 6 cards (Voxel Dynamics highlight left teal border 3px selected), each card: company `Voxel Dynamics` bold white, source badge `HackerNews 'Who is Hiring'` orange translucent, time `2h ago` right, title `Staff Full-Stack Engineer — Distributed Systems` white semibold, comp ` $180,000 — $225,000 USD · Equity 0.15% - 0.35%` teal, location `US Remote (UTC-4 to UTC-8)` with globe icon muted, skill chips row: `typescript` `react` `node.js` `postgresql` dark green `bg-[#22C55E]/15`, `aws !gap` red `bg-[#EF4444]/20 text-[#FCA5A5]` with !gap, `kubernetes` muted; bottom bar `92% stack match` teal badge + `HN ID: #41298401` muted small. Other cards similar with varied comps, locations, gap chips (aws, kubernetes), match % 86/88/71/90/78 with icon variation. Footer `▾ Ingest Older Requisitions (122 more)` dark button. Right detail panel: header bar with `↗ HN Source ID: 41298401 · Parsed 2h ago` left (amber) + `Save Role` outline + `Apply Directly ↗` teal solid. Below: company `Voxel Dynamics` + `Series B ($28M)` dark pill + `High Liquidity` green pill + `Requisition #VX-9021` right muted; title large `Staff Full-Stack Engineer — Distributed Systems` white 28px bold; comp ` $180,000 — $225,000 USD` teal pill + `San Francisco HQ (100% US Remote)` + `Full-time Requisition` grey pills; banner `▌ DevPulse Market Intelligence Extraction  92% Profile Alignment (5/6 Matched)` dark with green badge; sections `About Voxel Dynamics` paragraph muted, `The Role` paragraph, `What You'll Do` 4 bullets with teal dots, `Requirements & Qualifications` with check. This exact layout is spec.

## Decisions & Assumptions
- **Real jobs, not mocks**: `GET /api/jobs` and page must read `job_postings` written by `/api/cron/ingest`. If Supabase empty (first run), UI shows empty state with CTA to trigger ingest (manual `curl -H "Authorization: Bearer $CRON_SECRET" /api/cron/ingest`) — never ship static mock array as production data. Ingestion route already handles live fetching; fix only mapping/pagination bugs found via live probe (see Security Checks).
- **Stack-match scoring**: Import `stackMatchPct` from `lib/matching.ts`; per job compute `(skill_mentions for job_id ∩ user_skills)/total`. User skills source: authenticated `user_skills` where `user_id=auth.uid()`; if empty, fallback to latest `user_skill_profiles.skills`; if still empty, show match as undefined ("Not enough data") not 0%. Gap chips: overlay `gap_report_events` where `created_at > now-30d` distinct skills for this user — those skills get orange `!gap` treatment even if also matched.
- **Source filtering**: `profiles.monitored_sources` (default all 4) filters what account sees (`GET /api/jobs` WHERE `source = ANY(monitored_sources)`). Dashboard global counts unaffected. `All Sources` chip means no source filter; individual chips filter to that source only.
- **Archetype filtering**: Keyword match on title+description lowercase: senior→/(senior|staff|lead|principal)/, backend→/(backend|server|api|postgres|go\b|node)/, frontend→/(frontend|react|vue|canvas|webgl)/, infra/devops→/(infra|devops|kubernetes|aws|docker|platform)/, US Remote ($160k+)→ `comp_min >=160000 OR comp_max >=160000` AND location contains `remote|US|UTC`. These are best-effort mirrors of PNG chips; archetype filter is client+server shared.
- **Search & sort**: `q` param (Zod string max 100, trim, escape `%`/`_` for ilike) matches `%q%` on title/description/company. Sort `profile_match` = order by computed stack match desc (requires post-fetch sort since match depends on user skills), `latest` = `posted_at`/`ingested_at` desc, `comp_high_low` = `comp_max` desc nulls last. Pagination `limit` 20 default, `offset` 0, `limit` max 50.
- **Ingestion fixes needed**: Probe each API now: `https://hn.algolia.com/api/v1/search?query=Ask%20HN:%20Who%20is%20hiring?&tags=story&hitsPerPage=1` should return hit; Himalayas: test `https://himalayas.app/jobs/api?limit=20` vs `https://himalayas.app/api/jobs` — adapt to whichever returns `{jobs:...}` or array; RemoteJobs: test `https://remotejobs.org/api/v1/jobs` shape (array vs `{jobs}`) and salary fields `salary_min` vs `salary`; Remotive: `https://remotive.com/api/remote-jobs` shape. Keep `Promise.allSettled` so one source failure doesn't block others; log per-source errors to `ingestion_runs.error` without failing entire run. Ensure `external_url` fallback to `url` vs `link`.
- **Job summary AI**: New `GET /api/jobs/[id]/summary` route: auth required (`createClient().auth.getUser()` 401), fetch `job_postings.description` for id, check `job_summaries` table (create migration if missing: `id uuid PK, job_id uuid unique FK job_postings, about text, role text, bullets text[], requirements text, created_at`; or reuse `job_postings` column if exists). If cached, return it. If not, call `generateText` with grounded prompt (same constraint as Gap Report §15 Feature 4: "Use only information present in provided text. Do not add company facts... If section has no relevant content omit it rather than inventing"). Zod-validate output shape `{about?, role?, bullets?:string[], requirements?:string[]}`; store then return. If `AI_MODEL` missing or call fails, return fallback: split description into 300-char preview per section without invention. Never fabricate liquidity/contractor/comp; those render as "Not disclosed" if null.
- **Saved jobs**: `POST /api/saved-jobs` body `{job_id: uuid}` Zod uuid, auth required, upsert `saved_jobs` (on conflict do nothing); `DELETE /api/saved-jobs?job_id=` removes; `GET /api/saved-jobs` lists saved ids for UI bookmark state. RLS already guards `saved_jobs`.
- **Header stats**: `GET /api/jobs/stats` server route (auth optional for demo but prefers session) returns `{total: 42891, bySource:{hackernews:12430,...}, lastUpdate: ingestion_runs.completed_at}` by counting `job_postings` group by source + `ingestion_runs` latest. Page header "42,891 requisitions live" + dosage dots come from this.
- **Styling**: Match PNG exactly: page `bg-[#070A14]`, cards `bg-[#0F172A] border-[#1E293B] rounded-xl`, left selected card `border-l-[3px] border-l-[#14B8A6]`, skill chips normal `bg-[#12261E] text-[#2DD4BF] border-[#1A3A2F]`, gap chip `bg-[#3A1A1A] text-[#FCA5A5] border-[#7F1D1D]`, stack match teal `bg-[#0A2E2A] text-[#2DD4BF]` vs muted `bg-[#1E293B] text-[#64748B]` when low, comp `text-[#2DD4BF]`, source badges `HackerNews bg-[#7C3A0A]/30 text-[#FB923C]`, Himalayas purple, RemoteJobs teal, Remotive pink. Use `lucide-react` icons: Search, SlidersHorizontal, Globe, Building2, Clock, Check, Bookmark, ExternalLink.
- **Component breakdown**: `app/jobs/page.tsx` (Server, force-dynamic) fetches `stats`, initial `jobs` (first 20 with skill_mentions), user skills + gap set + saved ids in parallel; passes to `components/jobs/JobsClient.tsx` (client: search, source/archetype/sort state, filter + sort logic, selected job state, Framer Motion stagger). Children: `JobsFilters` (search + source + archetype + sort), `JobCard` (company, badge, title, comp, location, chips with !gap, match %), `JobDetail` (header, company/meta pills, market extraction banner, About/Role/WhatYou'llDo/Requirements, Save/Apply). `lib/queries/jobs.ts` helpers: `getJobsWithSkills(supabase, {q,source,limit,offset})`, `getJobSkillMap`, `getUserSkillsAndGaps(supabase, userId)`.
- **Responsive**: ≥1280 2-col `grid-cols-[420px_1fr]` or `grid-cols-12 gap-6` (left 5 cols, right 7); <1024 stack list full-width then detail below; filters wrap; search full-width on mobile.
- **Env**: No new `NEXT_PUBLIC_` secrets; `CRON_SECRET` stays server-only in ingest route; `AI_MODEL` server-only for summary route.

## Files To Touch
- `prompts/jobs-feature.md` (this file)
- `supabase/migrations/004_job_summaries.sql` — new: `job_summaries` cache table + RLS disabled (service_role write only, public read via API)
- `lib/queries/jobs.ts` — new helpers: stats, list with skill join, user skills + gap set
- `lib/mock/jobs-fallback.ts` — new minimal fallback only for header counts when Supabase unreachable (never for card data; card empty state instead)
- `app/jobs/page.tsx` — new Server Component, force-dynamic, parallel fetch stats+jobs+userSkills+gaps+saved
- `components/jobs/JobsClient.tsx` — new Client orchestrator (state, filtering, sorting, selection)
- `components/jobs/JobsFilters.tsx` — new search + source chips + archetype chips + sort
- `components/jobs/JobCard.tsx` — new per design (badge, comp, location, chips, match)
- `components/jobs/JobDetail.tsx` — new detail panel with sections, extraction banner, Save/Apply
- `app/api/jobs/route.ts` — new GET list (Zod query validation, source/monitored_sources filter, search ilike, limit/offset, skill_mentions join, stackMatch attach, RLS session check for personalization but public read fallback for stats)
- `app/api/jobs/stats/route.ts` — new GET stats (counts by source, lastUpdate)
- `app/api/jobs/[id]/summary/route.ts` — new GET AI restructure + cache (auth 401, Zod id, grounded prompt, fallback split)
- `app/api/saved-jobs/route.ts` — new GET/POST/DELETE saved toggle (auth 401, Zod, RLS)
- `app/api/cron/ingest/route.ts` — edit: probe live APIs and fix endpoint/shape mapping if 404/empty (Himalayas/RemoteJobs field names, pagination cursors); ensure comp/liquidity/contractor extraction uses both title+description; ensure external_url fallback covers `url` vs `link` vs `apply_url`.
- `app/globals.css` — no change except verify scrollbar styling if any
- `components/ui/badge.tsx` / `skeleton.tsx` — add via shadcn if missing

## Requirements
- Pixel match PNG at 1280px: header title + live badge 42,891 + Feed Ingestion/Parser latency meta, subtext, search+filters row, sources row with colored dots+counts, archetype row, 2-col layout, left 6 cards with correct badges/comps/locations/chips/match, right detail with HN ID, Save/Apply, company pills, comp/location pills, extraction banner 92% (5/6), sections About/Role/What You'll Do bullets/Requirements.
- Real jobs: After running `curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/ingest` at least one source returns rows and `job_postings` grows; `GET /api/jobs` returns those rows (not mocks). Verify by querying `SELECT COUNT(*) FROM job_postings;` + checking `source` breakdown matches header.
- Stack-match: Each card shows `XX% stack match` computed via `stackMatchPct(jobSkills, userSkills)` imported; 0-skill job shows "Not enough data" not "0%"; gap skills show orange `!gap` chip distinct from green.
- Search: typing filters client-side (and server when `q` param present via ilike) across title/company/description; debounce 250ms.
- Sources: clicking `HackerNews` filters to `source=hackernews` only; `All Sources` clears; counts reflect `stats.bySource`.
- Archetype & Sort: chips filter as described; sort Profile Match sorts by match desc, Latest by posted_at desc, Comp High→Low by comp_max desc.
- Detail panel: selecting a card loads detail; `Apply Directly` links to `external_url` with `target="_blank" rel="noopener"`; `Save Role` toggles saved via `POST /api/saved-jobs` and shows saved state; AI summary sections render only if present, else omitted (no fabricated “Not disclosed” outside comp/liquidity/contractor); missing comp/liquidity/contractor shows "Not disclosed" [§9 honest-data-gap].
- Auth: page redirects to `/sign-in` if no session (via layout guard + proxy); API routes `/api/jobs` allows anon read but personalizes match only when session present; `/api/jobs/[id]/summary` and `/api/saved-jobs` require 401 if unauth.
- Responsive <1024: filters wrap, list full-width, detail below, no overflow; search full-width on 375.
- Animations: card entrance stagger `opacity 0→1 y 4 delay idx*0.02`, match badge count-up, filter chip transition.

## Security Checks (must pass before complete)
```
grep -r "SERVICE_ROLE" app/           # only app/api/cron/ingest/route.ts and lib/supabase/service-role.ts
grep -r "SUPABASE_SERVICE" app/        # only lib/supabase/*
grep -r "OPENAI_API_KEY" app/          # 0
grep -r "YOUTUBE_API_KEY" app/          # only app/api/cron/tutorial-index/route.ts (allowed)
grep -r "RESEND_API_KEY" app/          # only app/api/cron/alert-dispatch/route.ts (allowed)
grep -r "GITHUB_TOKEN" app/            # only app/api/cron/github-sync/route.ts (allowed)
grep -r "API_KEY_PEPPER" app/          # only app/api/keys/* and lib/api-keys.ts
grep -r "CRON_SECRET" app/             # only app/api/cron/*/route.ts
grep -r "AI_MODEL" app/                # only server routes app/api/*/route.ts
grep -r "@anthropic-ai/sdk" app/      # 0
grep -r "\"openai\"" app/components/  # 0
grep -r "resend" app/components/      # 0
grep -r "octokit" app/components/     # 0
grep -rl "googleapis.com/youtube" app/ | grep -v "app/api/cron/tutorial-index"  # 0
grep -rl "api.github.com" app/ | grep -v "app/api/cron/github-sync"               # 0
grep -rl "hn.algolia.com\|himalayas.app\|remotejobs.org\|remotive.com" app/ | grep -v "app/api/cron/ingest"  # 0 — jobs read never calls live APIs, only ingest cron does
# Manually verify: every profile-scoped route calls supabase.auth.getUser() server-side and 401 before touching user tables (saved-jobs, summary uses job_postings but still checks session)
grep -rn "console.log.*apiKey\|console.log.*rawKey" app/  # 0
```
*Verify that no API keys are exposed to the browser, and that every profile-scoped route validates the Supabase session or API key server-side, before marking complete.* Check Network tab + `window` for leaked env; confirm `img.youtube.com` not needed for jobs.

## Acceptance Criteria
- `npx tsc --noEmit` zero errors, `npx eslint .` zero warnings in new files, `npx next build` succeeds.
- `/jobs` at 1280px matches PNG: header, search+filters, sources, archetype, 2-col with 6+ cards and detail panel exact colors/radii/spacing.
- Cards show real titles/companies from at least 2 of the 4 sources (verify `source` badge color matches); comp/location render or "Not disclosed" when null; skill chips ≥1 per card when extraction found skills; stack-match badge present; selected card has teal left border.
- Search "typescript" filters to matching titles; source chip filters correctly; archetype chip filters; sort Profile Match reorders by match desc (test with user_skills containing typescript/react).
- Clicking card updates detail panel without full page nav; detail shows AI sections or honest fallback (no invented company facts); Market Extraction banner matches computed `X% (Y/Z Matched)`.
- `Save Role` persists across refresh (check `saved_jobs` row); `Apply Directly` opens external_url.
- Header counts `All Sources 42,891` etc sourced from `GET /api/jobs/stats` (real DB counts, not hardcoded 42891 after ingestion).
- `GET /api/jobs?q=react` returns filtered JSON with `stack_match_pct` per row; `GET /api/jobs/stats` returns `bySource`; `GET /api/jobs/[id]/summary` returns `{about, role, bullets, requirements}` grounded.
- `POST /api/saved-jobs` without session → 401; with session → 200 and RLS prevents other user's rows.
- `GET /api/cron/ingest` without `Authorization: Bearer $CRON_SECRET` → 401; with valid secret ingests real jobs and updates `ingestion_runs` success with `jobs_ingested >0` (or 0 with descriptive message if all sources empty, not crash).
- Responsive 1280/768/375 no overflow; footer shared.
- Security greps all pass; no live API calls from browser (Network shows only `/api/jobs*` and `/api/jobs/*/summary`); no secrets in bundle.

## Manual Test Steps
1. `npm run dev` → open http://localhost:3000/jobs while signed out → redirects to /sign-in; sign in via magic link → lands on /jobs.
2. Confirm header: "Live Job Postings & Ingestion Stream" + `42,891` badge (real count after ingest) + `Feed Ingestion: Healthy (4/4 nodes)` + `Parser latency: 42ms` + subtext.
3. Run `curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/ingest` → 200 `{jobsIngested: N}`; in Supabase `SELECT source, COUNT(*) FROM job_postings GROUP BY source;` shows rows from ≥2 sources (HN + Remotive at minimum).
4. Reload `/jobs` → list shows real requisitions (Voxel Dynamics style but real data: e.g., HN "Senior React Engineer", Remotive "Backend Go", etc.) with source badges correct colors.
5. With `user_skills` containing `typescript, react, node.js, postgresql` (add via Profile), verify each card shows `XX% stack match` ≠ 0% when skills overlap; a job with no extracted skills shows "Not enough data".
6. Add a gap event: submit Skills page with `kubernetes` as gap → refresh Jobs → any card with `kubernetes` shows red `kubernetes !gap` chip.
7. Type "python" in search → list filters to python-titles; clear → restores. Click `HackerNews` source chip → only orange-badge cards remain; `All Sources` → all.
8. Click `senior fullstack` archetype → only senior titles remain; click `Latest Ingested` vs `Comp: High → Low` vs `Profile Match: 74%+` → order changes accordingly.
9. Click first card → detail panel updates: `HN Source ID: xyz`, `Save Role` outline, `Apply Directly` teal; company/title/comp pills; extraction banner `92% Profile Alignment (5/6 Matched)` (real calc); sections About/Role/What You'll Do/Requirements rendered without invented sentences.
10. Click `Save Role` → button becomes `Saved` with check; refresh → still saved; `DELETE /api/saved-jobs?job_id=` removes; verify another user's `saved_jobs` not visible.
11. Click `Apply Directly` → new tab to external_url; verify no in-app application flow.
12. `GET /api/jobs/[id]/summary` for a long description → first call triggers AI (if AI_MODEL set) and returns structured JSON; second call returns cached same object without re-calling AI (check `job_summaries` row exists).
13. Resize to 768 and 375 → left list full-width, detail stacks below, search full-width, no horizontal scroll.
14. Run `npx tsc --noEmit && npx next build` → passes; run security greps → only allowed matches; DevTools Network shows no `hn.algolia.com`/`himalayas`/`remotejobs`/`remotive` calls from browser; `CRON_SECRET`/`SERVICE_ROLE` not in responses.
15. Verify `lib/matching.ts` shared: `stackMatchPct(["typescript","react"],["typescript"]) === 50`.

