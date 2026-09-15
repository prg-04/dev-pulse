# Auth + Profile & Market Preferences + Dashboard Harden — Implementation Prompt

## Goal
Deliver the **foundational identity layer** (§3) and **harden the current Dashboard** to live data (§5a), unlocking all downstream personalized features. This is Phase 1+2 of the roadmap: no Jobs/Skills/Gap Report can ship securely without it.

**Scope — two tracks in one PR, ordered for dependency:**
1. **Track A — Dashboard Harden (§5a, §13, §5 layout rule):** Make Dashboard fully live from `skill_demand_snapshots`/`job_postings`, remove mock leakage, extract shared layout chrome.
2. **Track B — Auth + Profile (§3, §5f, §11, §12e):** Magic-link sign-in, middleware guard, `profiles` trigger + RLS, all six Profile sections, `user_skills`/`alert_preferences`/`api_keys` with correct security, plus `lib/matching.ts` deterministic utilities (§13) shared by future Jobs/Gap Report.

Desktop at 1280px is source of truth per §5; mobile stacks sensibly. No design beyond sign-in screen (one allowed on-brand build). Reuse Tailwind/shadcn patterns.

---

## Skills Read
- `supabase` — Auth magic-link, `@supabase/ssr` cookie session, `createServerClient`/`createBrowserClient`, `supabase.auth.getUser()` server-side validation, service_role vs anon, Data API exposure + RLS checklist (views `security_invoker`, `TO authenticated` + `using((select auth.uid())=user_id)`, UPDATE needs USING+WITH CHECK, SECURITY DEFINER traps)
- `supabase-postgres-best-practices` — query perf, indexes `skill_mentions(skill,month)`/`skill_demand_snapshots(skill,month,source)`, avoid `COUNT(*)` on raw tables in request, upsert `ON CONFLICT DO UPDATE`, partial indexes, connection pooling notes
- `vercel-react-best-practices` — 70 rules: `async-parallel` with Promise.all, `server-cache-react`, `server-parallel-fetching`, `rerender-*` hygiene, `bundle-*` dedup, RSC vs client boundary
- `secure-coding` (React + TypeScript refs) — XSS output encoding, authZ/IDOR, CSRF not needed for magic-link but check, CORS restrictive, secrets never `NEXT_PUBLIC_`, Zod validation at trust boundaries, no `any`, `tsconfig strict`
- `vercel/next.js` (via `node_modules/next/dist/docs` App Router + `AGENTS.md` §2/§8) — App Router pages/layouts, Route Handlers, `middleware.ts`, `force-dynamic`, caching, env prefix rule
- `impeccable` + `framer-motion-animator` + `shadcn/ui` — header/footer chrome, card/skeleton/progress patterns, ChartContainer via shadcn not raw Recharts
- `supabase` §12e + §17 traps — API key hashing `sha256(raw+pepper)`, single-display, masked prefix, revoke invalidates immediately; never log raw key

---

## Code Inspected
- `AGENTS.md` full — §1 scope, §2 browser never holds keys, §3 magic-link flow (6 steps), §5 page rules (5a Dashboard, 5f Profile 6 sections), §8 boundaries, §11 full data model SQL, §12e API key issue/verify/revoke, §13 deterministic matching, §16 decisions, §17/18 traps/checks, §19 env list
- `app/page.tsx` — Server Component `force-dynamic`, single snapshot query `skill_demand_snapshots where month=YYYY-MM limit 50`, delta from `mockTopSkills` map (wrong), hardcoded month label `August 2026`, fallback to mock on empty/throw; renders `StatCards/SourcesCard/BiggestMovers/TrendChart` (all mocked) + per-page header/footer
- `app/trends/page.tsx` — Server Component fetching 12 months for 5 skills (`in(month,months) in(skill,list)`) and mapping to `{3M,6M,12M}` client shape; per-page header/footer duplicated; pattern to share via `lib/queries/trends.ts`
- `app/layout.tsx` — Geist/Geist_Mono/Noto_Sans/Playfair_Display fonts, no shared header/footer — must add
- `components/dashboard/DashboardHeader.tsx` — `"use client"` nav with `usePathname`, active teal underline, only Dashboard+Trends+Gap Report placeholder, Live dot, no auth state, no profile avatar link, no responsive collapse
- `components/dashboard/StatCards.tsx` — `"use client"` framer-motion CountUp, all `mockStats` hardcoded
- `components/dashboard/SourcesCard.tsx`, `BiggestMovers.tsx`, `TrendChart.tsx` — all `mockSources/mockMovers/mockTrendData`, hardcoded AI string
- `components/dashboard/TopSkillsTable.tsx` — client filter pills (All/HN/etc only UI state), bar animate, delta colors
- `components/trends/*` — TrendsClient, TrendChartArea, SkillSelector, TrendStatCards, AITrendIntelligence (`POST /api/trends-summary` pattern to reuse)
- `app/api/trends-summary/route.ts` — Zod validation, allowed skills set, `AI_MODEL` gate, lazy `ai/generateText` import, fallbackSummary, grounding prompt constraint
- `lib/supabase/server.ts` — `createServerClient` with `cookies()` getAll/setAll, returns null if env missing (correct)
- `lib/supabase/client.ts` — `createBrowserClient`, throws if missing env
- `lib/supabase/env.ts` — supports canonical `NEXT_PUBLIC_SUPABASE_URL/_ANON_KEY` + legacy `SUPABASE_PROJECT_URL/SUPABASE_PERISHABLE_KEY/SUPABASE_URL` with fallback; `getSupabaseServiceRoleKey()` server-only; needs compat kept + warning
- `lib/skills-dictionary.ts` — 31 skills, aliases, `normalizeSkill`/`isKnownSkill`, colors — single source of truth per §14, must be used for Skills/Profile validation
- `lib/mock/dashboard-data.ts` — `mockTopSkills` (26 with dup rust), `mockStats` (42,891), `mockSources`, `mockMovers`, `mockTrendData` 3M/6M/12M
- `components/ui/*` (card, chart, button) — shadcn available
- `app/globals.css` — Tailwind v4 + shadcn/tailwind.css, light/dark oklch tokens; needs DevPulse navy `#070A14`/`#0F172A`/`#1E293B` overrides via arbitrary values already used in components
- `package.json` — `next@16.3.5`, `react@19.2.8`, `@supabase/ssr@0.12.7`, `@supabase/supabase-js@2.116`, `ai@7.0.99`, `framer-motion@13.2`, `recharts@3.8`, `zod@4.6.2`, `shadcn@4.21` — `resend` and `octokit` missing (defer to dispatch/sync phases, not this PR)
- `.env.example` + `.env.local` — NOW CORRECT: `NEXT_PUBLIC_SUPABASE_URL/_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_CONNECTION_URL`, `AI_MODEL=ollama/llama3.1`, `CRON_SECRET`, `YOUTUBE_API_KEY`, `WEEKLY_INDEX_BUDGET=40` — legacy commented; verify before building
- `vercel.json` — missing (no cron config yet — out of scope for this PR per §12; do not add ingestion crons here)
- `supabase/` — missing (no migrations yet — must create)
- `prompts/dashboard.md`, `prompts/trends.md`, `prompts/gap-report.md` — prior prompts; new prompt builds on them, not duplicating

---

## Design Reference Inspected
- `design/user-profile.png` — **primary source of truth for Profile & Market Preferences at 1280px**. Desktop exact, mobile stacks sensibly. Inspected pixel-level:
  - **Chrome:** Dark terminal theme `#070A14` bg, `#0F172A` card, `#1E293B` border, `#14B8A6`/`#2DD4BF` accent, `#64748B` muted, `#94A3B8` secondary text. Top nav `Dashboard · Trends · Jobs · Gap Report` with `Live` dot (header) as per `DashboardHeader` — reuse, do not redesign. Page header row: left `CONFIG / TERMINAL_PREFERENCES #NODE-5821` tiny caps, `Profile & Market Preferences` Playfair large + subtitle `Manage your profile delta, calibration baselines, active crawling feeds, and automated intelligence dispatch alerts.` Right badge `CALIBRATION INDEX 94.2% OPTIMAL` green ring + verification check, and `ID: USR-4291A` on Identity card header. Footer `Data refreshed daily · Last update: 2 hours ago · 4 sources` + `DevPulse Terminal v2.4.0`.
  - **Layout:** 12-col grid. Left rail `PREFERENCE_PANELS` (approx col-span-3): nav list `Identity & Account` (active teal dot) · `Career & Comp $220k` · `Skill Baseline 8 stack` · `Monitored Sources 4/4 live` · `Alerts & Dispatch 3 active` · `API & Data Export v2.4` + `CRAWLER HEARTBEAT · ACTIVE` card (`Last job sweep indexed 28,555 listings. Profile vector embeddings refresh hourly.` + teal progress bar). Right main column (col-span-9) stacks six cards vertically with 16px gap.
  - **Card 1 — Identity & Terminal Handle:** Header `Identity & Terminal Handle` + sub `Authentication, geographic parameters, and external developer links.` + `ID: USR-4291A`. Grid: avatar (#070A14 bordered, `__` verified dot) with `@alex.dev` + `Staff / Lead Engineer` + `Remote Ready` pill + image; fields `FULL NAME Alex Rivera` (read-only input), `PRIMARY EMAIL alex.rivera@systems.internal` (read-only — changing email is Supabase Auth account-management, not inline edit), `BASE LOCATION & TARGET ZONE DELTA Nairobi, Kenya (UTC+3)` + green `Targeting US Remote (UTC+4 to UTC-8)` capsule, `CODE REPOSITORY AUTHORITY github.com/alexrivera` + `Verified Sync` green badge (next sync hint, not live syncing).
  - **Card 2 — Career Target & Compensation Filter:** Header `Career Target & Compensation Filter` + `CALIBRATED` badge. Row 1: `TARGET ROLE ARCHETYPE Senior Full-Stack Engineer / Distributed Systems` (with cross-refs `Backend, Systems, High-Concurrency Node/Go`) + `LIQUIDITY & COMPANY MATURITY TIER Tier-1 US Remote & Seed-to-Series B` (High-Liquidity badge, filters out non-funded). Row 2: `DESIRED BASE COMPENSATION FLOOR (USD) $160,000 – $220,000 / YEAR` (`87th percentile...`) + `Include Equity & Options in Evaluation` checked toggle + `W8-BEN Contractor or Deel / Remote EOR` toggle.
  - **Card 3 — Core Skill Stack & Git Delta Engine:** Header `Core Skill Stack & Git Delta Engine` + `Add Skill Vector` teal link. `ACTIVE PRODUCTION WEIGHTS (YEARS & DEPTH TIER)` pills `typescript 5y · core` etc. (manual vs github_sync visual distinct per §5f.3 — manual solid, github_sync outlined/dotted). `ACTIVE GAP EXPANSION (IN-PROGRESS LEARNING)` chips `aws` `kubernetes` + `Indexed for prioritized curriculum matching` + `Auto-Git Sync` toggle (Weekly repo tag scans) — github_username hint `Next sync: <Sunday>` not live.
  - **Card 4 — Ingestion Sources & Crawlers:** Header `Ingestion Sources & Crawlers` + `ALL PIPELINES HEALTHY` green dot. 2×2 grid cards: `HackerNews 'Who is Hiring'` `1,249 monthly postings Structured extraction - monthly sync`, `Himalayas Remote API` `7,491 monthly postings High engineering density - 6h polling`, `RemoteJobs.com US Vector` `3,205 monthly postings Salary disclosure 1 filtered - daily sync`, `Remotive Remote Feed` `3,611 monthly postings Global contract eligible - 12h sweep` — each with teal toggle. Footer `INGESTION CADENCE SCHEDULE Daily at 06:00 UTC (Recommended)`. Toggles filter **account's Jobs feed/alerts only**, never global ingestion (§5f.4).
  - **Card 5 — Market Intelligence Dispatch & Alerts:** Header `Market Intelligence Dispatch & Alerts` + `WEBHOOK / EMAIL`. Three rows with teal toggles: `Instant Alert on High-Affinity Match` (Notify via email when posting matches ≥90% of active skill profile...), `Weekly Market Delta Digest` (Monday morning briefing...), `Curated Learning Gap Dispatch` (Automatic recommendations when top-tier...).
  - **Card 6 — DevPulse Readout Key & JSON Export:** Header `DevPulse Readout Key & JSON Export` + `Query your own profile delta vectors programmatically.` Row `BEARER TOKEN (READ-ONLY) dp_live_994e28...` (masked prefix e.g. `dp_live_a1b2••••` after first view) with `Copy Key` + `Export JSON` buttons. Full key shown plaintext exactly once at generation with `copy this now — you won't see it again` notice; thereafter only masked + Regenerate invalidates immediately.
  - **Bottom action bar:** Left `Ready to commit updates Last saved: 14m ago · DevPulse Engine Synced` green dot + `Discard` + `Save Preferences` teal CTA. Must persist independently per section but bar commits batch per reference.

---

## Decisions & Assumptions
- **Design is source of truth for Profile:** `design/user-profile.png` overrides any textual ambiguity in §5f. Match layout, spacing, typography (Playfair for headings, Noto/Geist for body), color, component states, hover, toggle states, pill/badge/verified-sync treatments exactly at 1280px. Do not improve the reference. When a field in §5f says "text" but the design shows an input/pill/toggle, follow the design.
- **Env compat kept:** `lib/supabase/env.ts` continues to support legacy `SUPABASE_PROJECT_URL`/`SUPABASE_PERISHABLE_KEY` etc. but canonical `NEXT_PUBLIC_*` is source of truth. Add dev warning when fallback used; never expose service_role to client (`grep` gate).
- **No `vercel.json` crons in this PR:** ingestion/indexing/sync/dispatch are §12 pipelines; wiring them now without tables would fail build. Only cron-adjacent work is `api_keys` hashing/revoke and shared `CRON_SECRET` validation helper for future routes.
- **Magic-link only, no password/OAuth:** per §3/§16. Supabase Auth email delivery handles sign-in; Resend is NOT for auth (keep paths separate). Profile email field is read-only display of `auth.users.email`.
- **Shared layout extraction:** Move `DashboardHeader` + `Data refreshed daily · Last update: X · 4 sources` footer into `app/layout.tsx` (or `app/(app)/layout.tsx` group if middleware requires). Remove per-page header/footer duplication in `app/page.tsx` + `app/trends/page.tsx`.
- **Dashboard data contract:** All panels read `skill_demand_snapshots` aggregated by cron, never `skill_mentions` raw. If current `YYYY-MM` has zero rows (e.g., early month or fresh DB), fallback to latest `month` present in table (query `order by month desc limit 1`), not to mock — mock only if table completely empty (demo mode). Stat `lastUpdate` from `ingestion_runs.completed_at` or `max(skill_demand_snapshots month)` if runs not yet created.
- **Deterministic matching lives in `lib/matching.ts`:** Implement §13a `stackMatchPct(jobSkills:string[], userSkills:string[]) => number | null` (null = no data vs 0%) and §13b `marketAlignmentPct(userSkills:string[], top50:{skill,mention_count}[]) => number` demand-weighted. No AI calls. Unit-tested with one hand-checked example.
- **Profile writes are session-gated, RLS-enforced:** Every `profiles`/`user_skills`/`alert_preferences`/`api_keys` route calls `supabase.auth.getUser()` server-side and rejects 401; RLS `TO authenticated using((select auth.uid())=user_id) with check(...)` is second layer. Service role never in user routes.
- **API keys:** `POST /api/keys` generates `dp_live_` + 32 hex, `key_hash=sha256(raw+API_KEY_PEPPER)` hex, stores `key_prefix` first 12 chars, returns raw once. `GET /api/export` verifies by hashing presented bearer, checks `revoked_at is null`, updates `last_used_at`, returns caller’s own `profiles+user_skills+user_skill_profiles+saved_jobs`. `POST /api/keys/revoke` sets `revoked_at=now()`. Add `API_KEY_PEPPER` to `.env.example` distinct from `CRON_SECRET`; never commit real value. Never log raw key (`grep` gate).
- **TypeScript strict, no `any`:** Zod on every API input, `normalizeSkill` against `SKILLS_DICTIONARY` for skill inputs, `isKnownSkill` guard for free-text.
- **UI components:** Use `shadcn add card badge skeleton tabs progress input` via `npx shadcn@latest add` only as needed (do not copy manually). Reuse existing Tailwind arbitrary values for navy (`#070A14` bg, `#0F172A` card, `#1E293B` border, `#14B8A6` accent). Implements impeccable + framer-motion guidance for subtle motion.

---

## Files To Touch
- `prompts/auth-profile-dashboard-harden.md` (this file)
- `supabase/migrations/001_initial_schema.sql` — create `pgvector` extension, all §11 tables: `job_postings`, `skill_mentions`, `skill_demand_snapshots`, `profiles` (with RLS + trigger `handle_new_user`), `user_skills`, `user_skill_profiles`, `saved_jobs`, `alert_preferences`, `alert_dispatch_log`, `api_keys`, `github_sync_runs`, `ingestion_runs`, `gap_report_events`, `skill_index_status`, `tutorial_chapters`, `tutorial_chunks`; indexes as spec; `skill_index_status` seed not required
- `supabase/migrations/002_rls_policies.sql` — enable RLS on all user-scoped tables, policies `TO authenticated using((select auth.uid())=user_id) with check(...)` (profiles uses `id`), verify `anon`/`authenticated` GRANTS per §7 docs; add `WITH (security_invoker=true)` if any views added
- `lib/supabase/middleware.ts` — new helper `updateSession(request)` for `@supabase/ssr` cookie refresh (per supabase skill)
- `middleware.ts` — new, protects every page except `/sign-in` and `/api/*` public; redirects unauthenticated to `/sign-in`; refreshes session via `lib/supabase/middleware.ts`
- `app/(auth)/sign-in/page.tsx` — new minimal on-brand sign-in (email input + “Send magic link” button, dark UI, no password field, states: idle/sending/sent/error)
- `app/api/auth/callback/route.ts` — new, exchanges `code` for session (Supabase SSR code verifier) and redirects to `/`
- `app/layout.tsx` — extract shared chrome: render `DashboardHeader` (now auth-aware, shows user avatar/email + sign-out, mobile collapse) + `Footer` (`Data refreshed daily · Last update: X · 4 sources` with live `lastUpdate` prop from server query); `children` is page content
- `components/layout/AppHeader.tsx` — refactor/rename `DashboardHeader` to shared header; add nav `Dashboard · Trends · Jobs · Skills · Gap Report` + profile icon linking to `/profile`; `isActive` underline teal; Live indicator; mobile hamburger
- `components/layout/AppFooter.tsx` — new footer component with `lastUpdate` prop
- `lib/queries/dashboard.ts` — new shared query helpers: `getLatestMonth()`, `getTopSkills(month,limit)`, `getSourcesBreakdown(month)`, `getBiggestMovers()`, `getTrendMonths(range)` — all against `skill_demand_snapshots`; parallel via `Promise.all`
- `lib/queries/trends.ts` — new, shared with `lib/queries/dashboard.ts` logic for `TrendChart` vs Trends page (no divergent endpoints §5b)
- `lib/matching.ts` — new §13 deterministic arithmetic: `stackMatchPct`, `marketAlignmentPct`, helpers for `hasEnoughData`
- `lib/api-keys.ts` — new server-only helper: `generateApiKey()`, `hashKey(raw)`, `verifyKey(bearer)` against `api_keys` + pepper
- `app/page.tsx` — rewrite to use `lib/queries/dashboard.ts` parallel fetches, compute real `StatCards`/`SourcesCard`/`BiggestMovers`/`TrendChart` props; remove mock imports except empty-DB fallback demo if table truly empty; forward `lastUpdate` to layout/footer; pass real deltas (cur vs prev month) to `TopSkillsTable`
- `app/trends/page.tsx` — update to remove duplicated header/footer, use shared `lib/queries/trends.ts` + shared footer prop
- `app/profile/page.tsx` — new Server Component fetching `profiles` + `user_skills` + `alert_preferences` + `api_keys` (masked) + `gap_report_events` for gap-expansion display
- `components/profile/*` — new client islands: `IdentitySection.tsx` (full_name/location/timezone/github_username, email read-only, Next sync hint), `CareerTargetSection.tsx` (target_role/tier, comp floor/ceiling/currency, include_equity, contractor_pref), `CoreSkillStackSection.tsx` (user_skills list with manual vs github_sync visual distinct, depth_tier/years, auto_git_sync toggle), `SourcesSection.tsx` (monitored_sources toggles §5f.4), `AlertsSection.tsx` (instant_match_alert/threshold, weekly_digest, learning_gap_dispatch), `ApiKeySection.tsx` (generate/revoke, masked prefix `dp_live_a1b2••••`, copy-once notice)
- `app/api/profile/route.ts` — `GET` (own row) + `PUT` (update own row) with `getUser()` 401, Zod, RLS
- `app/api/profile/skills/route.ts` — `GET` + `POST`/`PUT`/`DELETE` per skill, Zod + `normalizeSkill` + RLS (manual source only; github_sync rows read-only)
- `app/api/alert-preferences/route.ts` — `GET` + `PUT` with Zod
- `app/api/keys/route.ts` — `POST` generate (session required) + `GET` masked list
- `app/api/keys/revoke/route.ts` — `POST` revoke own key (session required)
- `app/api/export/route.ts` — `GET` bearer-or-session (one identity per request, hashed compare, 401 on revoked/missing)
- `lib/skills-dictionary.ts` — verify `ALL_SKILLS` used for validation in all new routes; add `getSkillOrNull` helper if helpful
- `.env.example` — add `API_KEY_PEPPER` (server-only, distinct from CRON_SECRET) with docs; ensure `NEXT_PUBLIC_SUPABASE_URL/_ANON_KEY` + `SUPABASE_SERVICE_ROLE_KEY` + `AI_MODEL` + `CRON_SECRET` notes
- `components/ui/card.tsx`, `badge.tsx`, `skeleton.tsx`, `tabs.tsx`, `progress.tsx`, `input.tsx`, `label.tsx` — add via `npx shadcn add` as needed (do not copy manually)
- `eslint.config.mjs` / `tsconfig.json` — no change expected (strict already)

---

## Requirements
- **Profile visual — exact match:** `design/user-profile.png` is source of truth at 1280px. Implement left `PREFERENCE_PANELS` rail (Identity & Account active teal · Career & Comp · Skill Baseline · Monitored Sources · Alerts & Dispatch · API & Data Export) + `CRAWLER HEARTBEAT` card + six right-column cards (Identity & Terminal Handle → Career Target → Core Skill Stack → Ingestion Sources → Dispatch & Alerts → Readout Key) + bottom `Save Preferences` bar (Ready to commit updates / Discard / Save). Match spacing, typography (Playfair headings, Noto/Geist body), color (`#070A14`/`#0F172A`/`#1E293B`/`#14B8A6`/`#64748B`/`#94A3B8`), toggle/pill/badge/verified states, and responsive stack (<1024px rail collapses, cards stack) without improving the reference. When §5f text and design disagree, design wins.
- **Dashboard live:** Stat cards, Top 50 table (with real MoM delta next to each skill), Sources breakdown, Biggest movers, TrendChart all from `skill_demand_snapshots`/`job_postings`/`ingestion_runs`. Shared query helpers parallel (`Promise.all`). No `COUNT(*)` on `skill_mentions`. Empty current month → latest month fallback. Mock only if DB completely empty (demo).
- **Shared layout:** Header+footer built once in `app/layout.tsx` (or route group), not per page. Header shows `Dashboard · Trends · Jobs · Skills · Gap Report` with active teal underline + Live dot + profile avatar linking to `/profile`; footer shows `Data refreshed daily · Last update: X · 4 sources`.
- **Auth:** Email input → `supabase.auth.signInWithOtp({email, options:{emailRedirectTo: origin+"/api/auth/callback"}})` → Supabase sends magic link. Callback exchanges code, creates `profiles` row via trigger, redirects `/`. Unauthenticated visitor to `/`/`/trends`/`/profile`/`/jobs` redirects to `/sign-in`. Sign-out clears session.
- **Profile CRUD:** All six §5f sections independently editable, persist across sign-out/in, validated with Zod + `SKILLS_DICTIONARY`. `monitored_sources` default 4, toggles filter only Jobs/alerts (future) — never ingestion. `github_username` change shows `Next sync: <next Sunday>` hint (§12d). `auto_git_sync` toggle writes `profiles.auto_git_sync`.
- **Core Skill Stack:** `user_skills` rows with `source` badge distinct (manual vs github_sync). Insert validates against dictionary, upsert respects `manual` precedence for future sync (do not overwrite manual with github_sync — enforce in route + document constraint). Active gap expansion sub-list display-only from `gap_report_events` latest per user.
- **Alerts:** Three toggles + `instant_match_threshold` (default 90) + `delivery_method`/`webhook_url`. Persist to `alert_preferences` with upsert on `user_id`.
- **API Keys:** Generate once copyable raw, thereafter masked `dp_live_a1b2••••` + Regenerate invalidates old via `revoked_at`. Hash is `sha256(raw+API_KEY_PEPPER)` hex. Export reads via bearer *or* session, never both silently.
- **Matching utility:** `lib/matching.ts` exported and used by no page yet but imported in at least one API/utility to prove contract before Jobs/Gap Report.
- **Server/client boundary:** No `SUPABASE_SERVICE_ROLE_KEY`/`API_KEY_PEPPER`/`YOUTUBE_API_KEY`/`GITHUB_TOKEN`/`RESEND_API_KEY` in client bundle. All AI remains via `POST /api/trends-summary` (existing) — no new AI calls here. YouTube embed pattern safe in client, Data API never.
- **Validation:** Zod on every Route Handler input; no `any`; `unknown` + narrow.

---

## Security Checks (must pass before PR)
```bash
grep -r "SERVICE_ROLE" app/           # 0
grep -r "SUPABASE_SERVICE" app/components/ # 0
grep -r "OPENAI_API_KEY" app/         # 0
grep -r "YOUTUBE_API_KEY" app/         # 0
grep -r "RESEND_API_KEY" app/         # 0
grep -r "GITHUB_TOKEN" app/            # 0
grep -r "API_KEY_PEPPER" app/          # 0 in app/components, allowed only in app/api/keys* and lib/api-keys.ts (server)
grep -r "AI_MODEL" app/               # 0 in app/components, allowed only app/api/trends-summary
grep -r "@anthropic-ai/sdk" app/      # 0
grep -r "openai" app/components/      # 0
grep -r "resend" app/components/      # 0
grep -r "octokit" app/components/     # 0
grep -rl "googleapis.com/youtube" app/ | grep -v "app/api/cron/tutorial-index" # 0 (no tutorial-index yet, so 0 total)
grep -rl "api.github.com" app/ | grep -v "app/api/cron/github-sync"           # 0
grep -rn "console.log.*apiKey\|console.log.*rawKey\|console.log.*bearer" app/  # 0
# Manual: every profile-scoped route calls supabase.auth.getUser() server-side and 401 before Supabase query (or hashed bearer for /api/export only)
# Manual: RLS policies TO authenticated using((select auth.uid())=user_id) with check on all user tables; enable RLS
# Manual: api_keys stores only key_hash + key_prefix, never plaintext; Regenerate invalidates immediate
# Manual: No NEXT_PUBLIC_ leakage — curl Network tab + window.__ NEXT_DATA__ + source map search for pepper/tokens returns 0
npx tsc --noEmit        # 0 errors
npx eslint .            # 0 warnings in new files
npx next build          # 0 errors
```

---

## Acceptance Criteria
- `npx tsc --noEmit` 0 errors, `npx next build` 0 errors, `npx eslint .` 0 warnings in touched files
- Profile at 1280px matches `design/user-profile.png` pixel-perfect: left PREFERENCE_PANELS rail active state, CRAWLER HEARTBEAT card, six right cards (Identity, Career Target, Core Skill Stack, Ingestion Sources 2×2 toggles + cadence, Dispatch 3 toggles, Readout Key) + Save Preferences bar. No design drift — compare screenshot diff to reference. Responsive stacks correctly at 768/375 without desktop regression.
- Dashboard: counts/bars/movers/sources/trend all reflect real `skill_demand_snapshots` (verify `SELECT skill,mention_count FROM skill_demand_snapshots WHERE month='YYYY-MM' ORDER BY mention_count DESC LIMIT 5` matches UI); month fallback works; mock only if table empty
- `lib/matching.ts` exports `stackMatchPct`/`marketAlignmentPct` with one hand-checked example matching manual SQL arithmetic (e.g., job with 5 skills, 3 matched → 60%)
- Header/footer shared — navigating `/`↔`/trends`↔`/profile` does not remount header; active nav underlines correctly (`Profile` active on `/profile`); footer `Last update` matches `ingestion_runs` or snapshot month
- Sign-in: entering email sends magic link (Supabase Auth email log), clicking link creates session + `profiles` row (verify trigger), redirects `/`, not a password field anywhere
- Unauthenticated `GET /` or `/profile` redirects `/sign-in` via `middleware.ts`
- Profile: save Identity updates `profiles`; Career Target + Sources toggles persist after sign-out/in; Core Skill Stack add/remove validates against `SKILLS_DICTIONARY`, shows `manual` vs `github_sync` badge distinct; gap expansion list reads `gap_report_events` (empty OK); Alerts toggles persist; Sources toggle does NOT affect Dashboard counts
- API key: `POST /api/keys` returns raw once with copy notice; reload shows masked prefix; `POST /api/keys/revoke` → old `Authorization: Bearer dp_live_...` `GET /api/export` returns 401; `GET /api/export` with valid key returns caller’s own JSON only
- `GET /api/export` without session or valid bearer → 401; with session returns same as bearer but caller’s own rows only (cross-user query returns 0 via RLS)
- RLS proof: as User A, `supabase.from('user_skills').select()` never returns User B rows (direct Supabase query with RLS on)
- No mock data rendered when DB has data; no fabricated `Not disclosed` confusion — comp/liquidity fields not in this PR

---

## Manual Test Steps
1. `supabase db push` or apply `supabase/migrations/*.sql` via `execute_sql` / `psql`; `supabase db advisors` — fix any
2. `npm run dev` — open `/sign-in`, enter email, click Send — verify Supabase Auth magic link sent (dashboard Email tab); click link — redirected `/`, session cookie set
3. Verify `profiles` row auto-created (`select * from profiles where id=auth.uid()`)
4. Visit `/` while signed out (clear cookies) → redirect `/sign-in`; sign in → back to `/`
5. Dashboard: compare Top 5 counts to `skill_demand_snapshots` query; click `12M/6M/3M` toggles (TrendChart) and verify same query backing Trends page
6. Visit `/profile` — edit full_name, location, github_username (show `Next sync: Sunday 04:00 UTC` hint), save, reload — persisted; sign out/in — still persisted
7. Core Skill Stack: add `typescript` (valid), add `foobar` (reject), remove one, toggle `Auto-Git Sync` on/off — verify `user_skills` source badges
8. Sources toggles: turn off `himalayas`, verify Dashboard global counts unchanged (toggle only filters future Jobs — note in UI)
9. Alerts: toggle each of 3, set threshold 90, save — verify `alert_preferences` row
10. API key: `POST /api/keys` — copy raw, reload — shows `dp_live_a1b2••••` only; `GET /api/export` with raw bearer returns JSON; revoke, then same bearer → 401; session `GET /api/export` (cookie) also works when no bearer
11. `npx tsc --noEmit && npx next build && npx eslint .` — all green
12. Run Security Checks block — all greps 0 (except allowed server files), RLS manual checks pass, no keys in Network tab / source
13. Check responsive at 1280/768/375 — header collapses, Profile sections stack, no overflow

---

## Verify Before Marking Complete
> Verify that no API keys are exposed to the browser, and that every profile-scoped route validates the Supabase session or API key server-side, before marking complete.

- `grep` gates above (especially `API_KEY_PEPPER` only in server files, never logged)
- `window`, Network, source map contain no `SUPABASE_SERVICE_ROLE_KEY`, `API_KEY_PEPPER`, `CRON_SECRET`
- All six Profile sections round-trip through `getUser()` + RLS; cross-user read returns 0
- Dashboard queries use snapshots only, not raw `skill_mentions` aggregation

