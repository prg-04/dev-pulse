# Gap Report Implementation Prompt — DevPulse Gap Report (design/gap-report.png)

## Goal
Implement pixel-exact **Gap Report** page at 1280px per `design/gap-report.png` — note: user request said "dashboard feature" but referenced `design/gap-report.png`; the reference is the **Gap Report** page (AGENTS §5e), not Dashboard. Desktop is source of truth; mobile stacks sensibly. Page must read live data from Supabase (`skill_demand_snapshots`, `user_skill_profiles`, `gap_report_events`, `tutorial_chunks`/`tutorial_chapters`), compute deterministic scores in `lib/matching.ts` (§13), and render tutorial cards with chapter-first badge logic (§6, §12b/§15 Feature 3). AI synthesis via `POST /api/gap-report` is grounded (§15 constraint) and optional — UI must work with deterministic fallback when `AI_MODEL` is absent or AI call fails.

## Skills Read
- `supabase` — RLS, anon vs service_role, Data API exposure, `security_invoker` views, `TO authenticated USING (auth.uid()=user_id)` vs `auth.role()` deprecation, `SELECT` policy required for `UPDATE`
- `supabase-postgres-best-practices` — query performance, indexes (`skill, month`), RLS perf with `(select auth.uid())`, upsert vs insert, `ivfflat` pgvector indexes for `tutorial_chapters`/`tutorial_chunks`
- `ai-sdk` (`ai` ^7.0.99) — verified against bundled `node_modules/ai/docs` not memory; Gateway model strings `provider/model`, `generateText` with Zod-structured output, `embed` for tutorial search only (not for gap report scoring). Confirmed `AI_MODEL` env drives provider; swap is one env var
- `vercel-react-best-practices` — server vs client, `async-parallel` with `Promise.all`, `server-parallel-fetching`, `bundle-barrel-imports` (`lucide-react` via Next optimize), no `any`, `strict` TS, `rerender-*` rules, `bundle-dynamic-imports` for heavy chart/player
- `framer-motion-animator` — v13.2 present, v12 API notes: no `async/await` in `animate`, use built-in `transition` + `motion.div`, animate bar widths, score count-up, card entrance stagger
- `secure-coding` (React/TS) — XSS via `dangerouslySetInnerHTML` not needed; Zod validation at route boundary, no secrets in client, `NEXT_PUBLIC_` prefix audit
- `impeccable` — typography/spacing discipline, reuse Tailwind/shadcn patterns, dark navy palette exact match
- `shadcn/ui` + Charts — `ChartContainer` over Recharts only, `npx shadcn add chart card badge progress skeleton tabs` as needed; generated code is owned not dependency
- Next.js App Router — from `node_modules/next/dist/docs` per `AGENTS.md` nextjs-agent-rules (16.3.5 App Router breaking changes). Route handler `route.ts` conventions, `dynamic="force-dynamic"`, `headers()`/`cookies()` async in Next 16

## Code Inspected
- `app/layout.tsx` — Geist + Noto_Sans + Playfair_Display, `font-sans`/`font-heading` vars, correct; no nav — header is per-page `DashboardHeader`
- `app/page.tsx` (Dashboard) — pattern to reuse: `force-dynamic`, `createClient()` from `lib/supabase/server.ts` with fallback to `mockTopSkills` when Supabase empty; `DashboardHeader`, `StatCards`, `TopSkillsTable`, `SourcesCard`, `BiggestMovers`, `TrendChart` layout grid 12 cols
- `components/dashboard/DashboardHeader.tsx` — sticky top 52px, `#070A14`, teal underline active, `isActive` via `usePathname()`, Live dot `#22C55E`, gap `Dashboard · Trends · Gap Report` + profile. Current Gap Report link is `href="#"` placeholder — to be wired to `/gap-report`
- `components/dashboard/*` — card style `bg-[#0F172A] border-[#1E293B] rounded-xl p-5`, heading `font-[var(--font-heading)] text-[15px]`, stats count-up via `motion.span`, bar animation `motion.div width%` with `delay: idx*0.03`
- `lib/mock/dashboard-data.ts` — `mockTopSkills` 26 rows, `mockStats` 42891 postings, `mockSources`, `mockMovers` (rising kubernetes +27, go +22, rust +19; declining angular -14, redux not in mock but needed per PNG declining section), `mockTrendData` 3M/6M/12M
- `lib/skills-dictionary.ts` — canonical map `SKILLS_DICTIONARY`, `ALL_SKILLS`, `normalizeSkill()`, `SKILL_COLORS`; missing `redux`, `graphql` variants, `tailwindcss` vs `tailwind` alias — will extend if needed for gap report declining/rising chips (tailwindcss already there; add `redux`, `next.js`already, `go`, `rust`, `kubernetes`, `graphql`, `rest` generic)
- `lib/supabase/env.ts` — handles compat: `NEXT_PUBLIC_SUPABASE_URL` fallback `SUPABASE_PROJECT_URL`/`SUPABASE_URL`; `NEXT_PUBLIC_SUPABASE_ANON_KEY` fallback `SUPABASE_PERISHABLE_KEY`/`SUPABASE_ANON_KEY`; `SUPABASE_SERVICE_ROLE_KEY` fallback `SUPABASE_SERVICE_SECRET`/`SUPABASE_SERVICE_KEY` — server-only, never `NEXT_PUBLIC_`. Correctly gates exposure
- `lib/supabase/server.ts` + `lib/supabase/client.ts` — SSR `createServerClient` via `@supabase/ssr`, `cookies()` getAll/setAll; browser client via `createBrowserClient`. Both use env helpers. Return `null` vs throw distinguishes server guard
- `lib/utils.ts` — `cn` re-export (shadcn helper)
- `app/globals.css` — Tailwind v4 + `tw-animate-css` + `shadcn/tailwind.css`, CSS vars `--chart-1..5`, dark tokens; needs navy `#070A14` bg override via arbitrary classes (not oklch) as dashboard does
- `app/api/trends-summary/route.ts` — exemplar server AI route: Zod `BodySchema` validation, `AI_MODEL` gate with `fallbackSummary`, lazy `import("ai")` for `generateText`, grounding prompt "Only reference skills and counts explicitly provided", `maxOutputTokens:200`, error fallback to deterministic text
- `app/trends/page.tsx` — exemplar data fetching: builds 12-month array, `in("month", months) + in("skill", [...])`, groups by month, maps to `{month,label,val}`, falls back to `mockTrendData` if empty
- `components/ui/{card,chart,button}.tsx` — present via shadcn; need `badge`, `progress`, `skeleton` per gap report progress bar & chips
- `package.json` — deps present: `ai ^7.0.99`, `next 16.3.5`, `react 19.2.8`, `recharts ^3.8.0`, `framer-motion ^13.2.0`, `lucide-react ^1.45.0`, `@supabase/*`, `zod ^4.6.2`, `shadcn ^4.21.0`. **Missing per AGENTS §9/§19**: `resend`, `youtube-transcript`, `octokit`; not needed for Gap Report UI but flagged — installer will not add them speculatively. Uses `npm` (package-lock.json) not pnpm
- `.env.example` + `.env.local` — canonical `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY` + `SUPABASE_SERVICE_ROLE_KEY` + `AI_MODEL=ollama/llama3.1` + `CRON_SECRET` + `YOUTUBE_API_KEY` + `WEEKLY_INDEX_BUDGET=40` + `SUPABASE_CONNECTION_URL`. Legacy aliases documented as fallback. **Misnaming noted by user**: older iterations used `SUPABASE_PERISHABLE_KEY`/`SUPABASE_SERVICE_SECRET`/`SUPABASE_PROJECT_URL` — `lib/supabase/env.ts` already handles compat with warning. No `RESEND_API_KEY`, `GITHUB_TOKEN`, `API_KEY_PEPPER` yet — not needed for Gap Report read path; will not invent them
- `next.config.ts`, `tsconfig.json` — strict true, `paths @/*`, incremental, `jsx: react-jsx`; next config empty — verify `images.remotePatterns` for `img.youtube.com` thumbnails if using `next/image` (or use plain `<img>` since thumbnails are public ytimg — allowed direct browser ref per §8)
- `design/gap-report.png` — reference parse (1280px navy): Top nav `DevPulse | Dashboard · Trends · Gap Report (teal underline) · Live · avatar`. Left col `Your skills` card: title + `ACTIVE PROFILE` badge (teal outline), 6 pills `typescript× react× node.js× postgresql× docker× aws× + add skill…`, `6 skills evaluated max: 16`, `Re-analyse` button with refresh icon, `Compared against 42,891 postings · August 2026 data`, divider, `TELEMETRIC SAMPLE LIVE FEED` with `US REMOTE 61.4%` + `CONFIDENCE 99.2%` mini cards. Right col stacked: `Market alignment INDEX: 0.742` card: huge `74%` teal + `+6.8% since last quarter`, teal progress bar, `Target baseline: 60%` left / `Top tier threshold: 80%` right, `High competitive fit •` top-right. Then `Your strengths` (green left border, check icon, `3 verified core matches`, pills `typescript (8,432) react (7,891) postgresql (4,110)` green rarity, paragraph). Then `Skills to consider v1.1 TUTORIALS ACTIVE` (red border, warning icon, helper `Click a skill to preview deep-linked learning`, pills `kubernetes (3,840) ▼` active teal border, `rust (1,920) ▶` red border, `graphql (2,410) ▶` red). Below: `kubernetes — tutorials 2 targeted timestamps extracted` container with 2 cards: Card1 collapsed `Kubernetes Crash Course for Beginners FreeCodeCamp · 1.2M views · Starts at 14:32` with thumbnail placeholder + play + `3:24:18`. Card2 expanded: header `Kubernetes in 100 Seconds Fireship · 890K views · Starts at 0:42` with collapse arrow, below an embedded player mock: top bar `DevPulse Stream ID #4092-K8S` left + `SYNCED: 1080p60` right, center code snippet `kubectl get pods --all-namespaces` + table, bottom bar play/pause `00:42 / 2:18` + `CH 2: CONTROL PLANE` teal badge + `1.0x ⚙ ⛶`; note overlay badge persists while playing (chapter-anchored II). Then explanatory text `Adding Kubernetes container orchestration would expand your eligibility to 68% of senior DevOps-adjacent fullstack roles.` Then `Rising in demand Q3 velocity index` (teal border, `go (+22%) tailwindcss (+18%) next.js (+15%)` green pills, `Go continues rapid adoption...`). Then `Declining in demand Legacy substitution trend` (amber border, `redux (-12%) rest (-9%)` amber pills with red text, `Redux boilerplate increasingly...`). Then `Recommendations ACTIONABLE NEXT STEPS` (dark teal bg `#0a2e2a` like, `◎ Recommendations`, 3 numbered rows: 1 Prioritize Kubernetes fundamentals..., 2 Emphasize your PostgreSQL..., 3 Consider expanding into Go...). Footer `Data refreshed daily · Last update: 2 hours ago · 4 sources`

## Decisions & Assumptions
- **Naming confusion**: Implement **Gap Report** (`/app/gap-report/page.tsx`) not Dashboard. Also wire header link from `#` to `/gap-report` vs leaving placeholder.
- **Routing & data**: Server Component `app/gap-report/page.tsx` (`dynamic="force-dynamic"`) fetches: (1) current user `auth.getUser()` via `createClient()` if available else anonymous preview; (2) `skill_demand_snapshots` for current month (`YYYY-MM`) ordered by `mention_count` desc limit 50 for market alignment denominator + top-tier detection; (3) historical 6M trend for rising/declining; (4) if authenticated, `user_skills` or last `user_skill_profiles.skills` as "Your skills" list (fallback to PNG mock `[typescript,react,node.js,postgresql,docker,aws]` when unauth or empty). **Never** raw `COUNT(*) on skill_mentions` in request — use snapshots only. If Supabase empty/unavailable, fall back to deterministic mock matching `design/gap-report.png` numbers so page never crashes.
- **Deterministic scoring — single source of truth**: Create `lib/matching.ts` per §13/§17: `stackMatchPct(jobSkillMentionCount, userSkillSet) => number|undefined` for completeness, and `marketAlignmentPct(userSkills, top50Rows) => {score:number, topTier:boolean}` as demand-weighted coverage `(sum mention_count where skill in user set ∩ top50)/(sum all top50)`. Both pure TS/SQL arithmetic, no AI. Gap Report and Jobs will import from here. 74% shown in PNG derives from 3 matches high-volume; our fallback will compute to ~74% with same inputs for verification.
- **Strengths/Gaps split**: `strengths = userSkills.filter(s => top50Map.has(s) && high-volume tier)` (verified core matches), `gaps = top-tier skills (top 15? per product spec) not in userSkills` — surfaced as `Skills to consider` pills with market counts. Include deterministic counts `(8,432)` etc from snapshot rows.
- **Rising/Declining**: Compute MoM delta from 6M snapshots: `(last - prev)/prev*100` per skill; rising top 3 positive, declining top 2 negative; pill colors green/amber as PNG.
- **Tutorial cards — mock-first but API-ready**: Gap Report spec says tutorial search hits `tutorial_chunks`/`tutorial_chapters` via `POST /api/tutorial-search`. For PNG fidelity without full ingestion, provide `lib/mock/gap-report-tutorials.ts` with 2 videos for `kubernetes` exactly as PNG: (1) `Kubernetes Crash Course for Beginners` / `FreeCodeCamp` / `1.2M` / `Starts at 14:32` / `3:24:18` / `video_id: k8s-crash-2024` / chapter fallback none; (2) `Kubernetes in 100 Seconds` / `Fireship` / `890K` / `Starts at 0:42` / `video_id: k8s-100s` / `chapter: CH 2: CONTROL PLANE` / `start_seconds:42` / `duration 138s`. Build `components/gap-report/TutorialCard.tsx` per §6: thumbnail `https://img.youtube.com/vi/{video_id}/hqdefault.jpg` (safe direct browser use §2 exception), title/channel/views/Starts at MM:SS, **chapter badge only if `chapter_label` present** — chunk-only cards omit badge entirely. Click expands inline `<iframe src="https://www.youtube.com/embed/{video_id}?start={start_seconds}&autoplay=1">` without navigation; expanded player retains chapter overlay badge if present. Do not call YouTube Data API from client — all search via server route.
- **API routes (server-only)**: `POST /api/gap-report` — Zod validates `{target_role?:string, skills:string[]}` against `ALL_SKILLS`, requires auth if configured but degrades to anonymous with ` gap_report_events` insert skipped when no session (mirrors Dashboard fallback strategy). Deterministic compute first, then optionally call `generateText` via `ai` Gateway for recommendations prose with grounding `system: "You are analysing real job market data. Only reference skills and counts explicitly provided..."` If `AI_MODEL` missing or call fails, return deterministic fallback recommendations matching PNG. Insert `user_skill_profiles` + `gap_report_events` per gap when authenticated (via service? actually anon client with RLS — need session client). `POST /api/tutorial-search` — Zod validates `skill`, embeds via `ai.embed`, Stage 1 chapter cosine search then Stage 2 chunk fallback (per §15 Feature 3); if `tutorial_chapters`/`tutorial_chunks` empty, return mock above instead of error. This keeps live-demo credibility while not blocking UI on empty indexing.
- **Env compat**: Use `lib/supabase/env.ts` helpers everywhere; never hardcode legacy names. No new `NEXT_PUBLIC_` secrets. `AI_MODEL`, `YOUTUBE_API_KEY`, `GITHUB_TOKEN` stay server-only. Document in `.env.example` any missing `RESEND_API_KEY`/`GITHUB_TOKEN`/`API_KEY_PEPPER` as optional for gap-report (not required for read).
- **Styling**: Match PNG exactly at 1280. Use arbitrary Tailwind colors `#070A14` page bg, `#0F172A` card bg, `#1E293B` borders, `#14B8A6`/`#2DD4BF` teal accents, `#22C55E` green strengths, `#EF4444` red skill-to-consider border, `#F59E0B` amber declining, `#A78BFA` purple etc. Reuse `DashboardHeader` + `cn`. Framer Motion for: market alignment bar width `74%`, strength count-up, tutorial card expand (`AnimatePresence`), rising/declining pill entrance stagger. No GSAP, no Tremer. Use `shadcn` `Badge`/`Progress`/`Skeleton` primitives — add via `npx shadcn@latest add badge progress skeleton` if absent.
- **Responsive**: Stack left `Your skills` (1col) + right column (1col) at <1024; pills wrap; tutorial player remains 16:9; keep desktop 2-col grid `grid-cols-12 gap-6` with `lg:col-span-4` + `lg:col-span-8` as Dashboard does.
- **Missing dict entries**: Add `redux`, `graphql` canonical entries if absent; `rest` maps loosely to `REST` — treat as allowed raw skill with display text `rest` lowercased, not normalized through dict (UI chip still valid).

## Files To Touch
- `prompts/gap-report.md` (this file)
- `lib/matching.ts` — new, deterministic formulas §13 (stackMatch + marketAlignment) sharing utility
- `lib/mock/gap-report-tutorials.ts` — new, PNG-faithful fallback videos for `kubernetes` (include chapter vs chunk distinction)
- `lib/mock/gap-report.ts` — new, deterministic fallback report matching PNG (market alignment 74, strengths 3, gaps 3, rising/declining, recommendations 3) for offline/demo
- `app/gap-report/page.tsx` — new Server Component, `force-dynamic`, fetches snapshots + user skills, computes via `lib/matching.ts`, passes to client
- `components/gap-report/GapReportClient.tsx` — new Client wrapper managing skill selection, re-analyse, tutorial expand state, framer-motion orchestration
- `components/gap-report/MarketAlignmentCard.tsx` — new, 74% hero, progress bar, baseline markers, INDEX badge, "High competitive fit •"
- `components/gap-report/StrengthsCard.tsx` — new, green border, verified core matches, skill pills with counts, explanatory sentence
- `components/gap-report/SkillsToConsiderCard.tsx` — new, red border, skill chips (active state teal vs red), tutorial list container with header counts
- `components/gap-report/TutorialCard.tsx` — new §6 spec: thumbnail via `img.youtube.com`, metadata, badge conditional, iframe expand, `AnimatePresence`
- `components/gap-report/RisingCard.tsx` + `DecliningCard.tsx` — new, velocity/legacy trend cards
- `components/gap-report/RecommendationsCard.tsx` — new, teal bg, numbered actionable steps
- `components/gap-report/YourSkillsPanel.tsx` — new, left column active profile, skill pills ×, Re-analyse button, telemetry sample
- `app/api/gap-report/route.ts` — new, Zod validation, deterministic compute, optional AI synthesis (grounded), inserts `user_skill_profiles`/`gap_report_events` when authed
- `app/api/tutorial-search/route.ts` — new, Zod skill validation, two-stage pgvector search (chapter first), mock fallback, returns `video_id,title,channel,view_count,start_seconds,chapter_label?`
- `components/dashboard/DashboardHeader.tsx` — edit, wire Gap Report link `href="/gap-report"` with active state
- `app/globals.css` — no change except verify dark vars; use arbitrary colors as existing pages do
- `.env.example` — verify legacy→canonical mapping note; optionally add comments for `RESEND_API_KEY`/`GITHUB_TOKEN`/`API_KEY_PEPPER` as not required for this page
- `package.json` — no new deps needed (all present); if `badge`/`progress` missing, run `npx shadcn@latest add badge progress skeleton` (owned code)

## Requirements
- Pixel match `design/gap-report.png` at 1280px: dark bg, card radii `rounded-xl`, borders `#1E293B`, teal progress `#14B8A6` to 74%, strengths green border, skills-to-consider red border, rising teal border, declining amber, recommendations dark teal. Typography: heading `Playfair_Display`, body `Noto_Sans`, mono pills `11px`.
- Left panel skill pills closable `×`, `+ add skill…` affordance, max 16 indicator, `Re-analyse` with `RefreshCw` icon, teal live feed numbers.
- Market alignment card shows 74% count-up, `INDEX:0.742`, `+6.8% since last quarter`, progress bar with target 60% + top tier 80% markers.
- Strengths: 3 pills with market counts `(8,432)` etc, green tint `bg-[#22C55E]/15 border-[#22C55E]/30`, paragraph as PNG.
- Skills to consider: 3 skill tabs, active `kubernetes` with teal border + dropdown caret, others red border + play caret; `v1.1 TUTORIALS ACTIVE` badge, helper text. Tutorials container shows 2 cards matching PNG exactly.
- TutorialCard: thumbnail `img.youtube.com/vi/{id}/hqdefault.jpg`, title/channel/views/startsAt, chapter badge `CH 2: CONTROL PLANE` only on chapter-anchored result; click expands iframe `youtube.com/embed/{id}?start={s}&autoplay=1`; second card default expanded in PNG state — render as such initially; collapse/expand toggle.
- Rising/Declining: pills with deltas `(+22%)` etc, colored per direction, descriptive sentence below.
- Recommendations: 3 numbered items with `1 2 3` badge, teal on dark bg.
- Interactivity: Click skill chip filters tutorials; Re-analyse re-calls `/api/gap-report` with current skills; tutorial expand collapsed→iframe without page navigation.
- Data: If Supabase has real `skill_demand_snapshots` for August 2026 month, scores reflect real data; else fallback to mock deterministic so demo never blanks.
- No mobile reference — stack left+right, make pills scroll-horiz, keep readable <768.
- Animations: bar width stagger `delay idx*0.03`, card fade `opacity 0→1 y 8 duration 0.4`, number count-up without async animate.

## Security Checks (must pass before complete)
```
grep -r "SERVICE_ROLE" app/           # 0 (only allowed in app/api/cron/*, not gap-report)
grep -r "SUPABASE_SERVICE" app/        # 0 outside lib/supabase
grep -r "OPENAI_API_KEY" app/          # 0
grep -r "ANTHROPIC_API_KEY" app/       # 0
grep -r "YOUTUBE_API_KEY" app/         # 0
grep -r "RESEND_API_KEY" app/          # 0
grep -r "GITHUB_TOKEN" app/            # 0
grep -r "API_KEY_PEPPER" app/          # 0
grep -r "AI_MODEL" app/                # 0 (server only via process.env in route.ts)
grep -r "@anthropic-ai/sdk" app/      # 0
grep -r "openai" app/components/      # 0
grep -r "resend" app/components/      # 0
grep -r "octokit" app/components/     # 0
grep -rl "googleapis.com/youtube" app/ | grep -v "app/api/cron/tutorial-index" # 0 — gap report only uses /api/tutorial-search + img.youtube.com
grep -rl "api.github.com" app/ | grep -v "app/api/cron/github-sync"           # 0
# Verify every profile-scoped route validates server-side:
# /api/gap-report, /api/tutorial-search (skill-agnostic but still Zod-validates, no user data leak), /api/keys etc — each must call supabase.auth.getUser() or hash check before touching user tables
# Verify API keys are never logged:
grep -rn "console.log.*apiKey\|console.log.*rawKey" app/  # 0
```
*Verify that no API keys are exposed to the browser, and that every profile-scoped route validates the Supabase session or API key server-side, before marking complete.* Check Network tab + `window.__*` for leaked env.

## Acceptance Criteria
- `npx tsc --noEmit` zero errors, `npx eslint .` zero warnings in new files, `npx next build` succeeds
- `/gap-report` loads at 1280px matching PNG: left panel skills + Re-analyse + telemetry, right column cards in exact order with correct borders/colors/barges
- Market alignment shows 74% (or live-computed if Supabase has different counts) with progress bar proportional, baseline 60% + top tier 80% markers aligned
- Strengths shows 3 verified matches with correct counts sourcing `skill_demand_snapshots` (not invented)
- Skills to consider shows 3 skills sorted by demand, `kubernetes` active with 2 tutorials; inactive chips show correct fallback counts
- Tutorial cards: Card1 collapsed thumbnail+meta no iframe; Card2 expanded iframe at `?start=42` with persistent `CH 2: CONTROL PLANE` overlay; chapter badge appears only on chapter-anchored card (verify via mock gap-report-tutorials distinguishing field)
- Clicking a collapsed card expands iframe at correct timestamp without navigation; collapsing returns to thumbnail view
- Rising shows 3 green pills, declining 2 amber pills, values match computed deltas (verify against Supabase or mock)
- Recommendations shows 3 numbered grounded items — none invent demand figures; AI route fallback when `AI_MODEL` absent still returns sensible static items
- Responsive at 1280/768/375: no horizontal overflow, cards stack, nav collapses as Dashboard does
- Header Gap Report link active (teal underline) when on `/gap-report`
- `lib/matching.ts` arithmetic verified against manual calculation for one hand-checked example (e.g. typescript 8432 / sum top50 ~... = 74%)
- Security greps all zero, no `img.youtube.com` beyond TutorialCard, no `youtube.googleapis.com` in client, no keys in bundle
- Fallback mock renders when Supabase unavailable (disconnect `.env` test)

## Manual Test Steps
1. `npm install && npm run dev` — open http://localhost:3000/gap-report
2. Verify header: DevPulse logo, Dashboard/Trends/Gap Report with Gap Report underlined teal, Live green dot, profile icon
3. Verify left panel: `Your skills` + `ACTIVE PROFILE` badge, 6 pills `typescript·react·node.js·postgresql·docker·aws` with `×`, `+ add skill…`, `6 skills evaluated max:16`, `Re-analyse` button, `Compared against 42,891 postings · August 2026 data`, `TELEMETRIC SAMPLE LIVE FEED` + `US REMOTE 61.4%` `CONFIDENCE 99.2%`
4. Verify Market alignment card: `74%` teal hero, `INDEX:0.742` badge, `+6.8%`, teal bar at 74%, markers `Target baseline:60%` / `Top tier threshold:80%`, `High competitive fit •` top-right
5. Verify Your strengths: green left border, `3 verified core matches`, 3 green pills with counts, paragraph about top-tier US remote requirements
6. Verify Skills to consider: red left border, `v1.1 TUTORIALS ACTIVE` badge, helper text, 3 skill chips (`kubernetes (3,840) ▼` active teal, rust/graphql red with `▶`), container header `kubernetes — tutorials 2 targeted timestamps extracted`, 2 tutorial cards as PNG
7. Click first tutorial card (collapsed) — expands iframe inline at `Starts at 14:32`, no navigation away; verify thumbnail `img.youtube.com/vi/k8s-crash-2024/hqdefault.jpg` before expand
8. Verify second card expanded by default — iframe `youtube.com/embed/k8s-100s?start=42&autoplay=1` with `CH 2: CONTROL PLANE` badge overlay; collapse via `▲` then re-expand; verify chunk-only vs chapter distinction (no badge on chunk-only if tested with `rust` mock)
9. Click `rust` chip — tutorial list updates to rust tutorials (or shows `no tutorials indexed yet` empty state if none mocked, never error)
10. Click `Re-analyse` — POSTs to `/api/gap-report`, toast/loading, recomputes alignment, updates cards (deterministic path when `AI_MODEL` unset still works <2s)
11. Resize to 768 and 375 — left/right stack, no overflow, pills wrap, player stays 16:9
12. Run `npx tsc --noEmit && npx next build` — passes
13. Run security greps above — all zero; open DevTools Network — request to `/api/gap-report` contains no `SERVICE_ROLE`/`YOUTUBE_API_KEY` in response, `window` has no secrets; verify `img.youtube.com` thumbnails load, `youtube.googleapis.com` never called from client
14. Disconnect Supabase by renaming `.env.local` temporarily — reload page still shows mock data (74%, 42,891) without crash
15. Verify `lib/matching.ts` manually: in console `marketAlignmentPct(['typescript','react','postgresql'], mockTop50)` ≈ 74

