# Trends Implementation Prompt — DevPulse Skill Demand Trends

## Goal
Implement pixel-exact **Skill Demand Trends** page at 1280px per `design/trends.png`. This is the second core dashboard view: month-by-month trend visualization sourced from `skill_demand_snapshots` (HackerNews archive), with multi-skill comparison, range selection, and AI-generated trend intelligence. Desktop is source of truth; mobile stacks sensibly. Must match reference exactly — layout, spacing, typography, colors, component states, hover behavior.

Reference: `design/trends.png` shows:
- Dark navy background `#070A14`, header with DevPulse logo left, nav Dashboard/Trends/Gap Report center (Trends active with teal underline), Live indicator + icon right
- Telemetry header: "TELEMETRY / MARKET INDEX" teal small caps, "Skill demand trends" Playfair large, subtitle "Month-by-month from HackerNews 'Who is Hiring' threads"
- Skill selector bar: rounded dark container with removable skill pills (typescript x, react x, python x) + "[type to add...]" input + "Showing 3 of 5 skills (max 5)" right, and 3M/6M/12M toggle (6M active teal) on far right
- Legend row: colored dots (typescript teal #2DD4BF, react lavender #818CF8, python emerald #34D399) + "Normalized volume: mention frequency / 10k posts" right
- Main chart: AreaChart with gradients, Y-axis 0-10k, X-axis Jan-Aug, dashed grid, tooltip card (Aug 2026, HN #4129, per-skill counts with delta +34% green, +8% green, -2% red)
- Three bottom stat cards: typescript Rank #1 8,432 mentions +34%, react Rank #2 7,891 +8%, python Rank #3 7,203 -2% each with mini sparkline, Peak label, Vol: xx/100
- AI Trend Intelligence card: sparkles icon, paragraph with inline colored deltas, footer "Generated from 6 months of job posting data · Updated daily" + "Confidence score: 98.4%" right
- Footer: "Data refreshed daily · Last update: 2 hours ago · 4 sources"

## Skills Read
- `supabase` — RLS, anon vs service_role, Data API exposure, security checklist; verified Data API settings (`anon` grant) and RLS per checklist
- `supabase-postgres-best-practices` — query performance, indexes on skill_mentions(skill, month), avoid COUNT(*) on raw table, use skill_demand_snapshots, pagination
- `ai-sdk` — verified against bundled docs `node_modules/ai/docs/` not memory; gateway model strings `provider/model`, generateText with grounding constraint, not invented stats
- `vercel-react-best-practices` — strict TS, server vs client, no `any`, hooks correctness
- `framer-motion-animator` — v12 API, no async in animate, use built-in sequence for chart entrance + number count-ups
- `secure-coding` — input validation, server/client boundary, env prefix check (no NEXT_PUBLIC_ leakage)
- `impeccable` — typography/spacing discipline, avoid templated defaults, reuse Tailwind patterns
- `shadcn/ui Charts` — via `npx shadcn add chart` wrapper over Recharts, not raw Recharts / Tremor; ChartContainer + AreaChart with Tailwind v4 CSS vars
- Next.js App Router — from `node_modules/next/dist/docs` (not training memory); App Router caching, force-dynamic for live data
- `migrate-ai-sdk-v6-to-v7` — checked; current ai version 5.x in repo so v7 migration not needed now but model string format is `provider/model`

## Code Inspected
- `AGENTS.md` — full file read without delegation; sections 2 (browser never holds keys), 7 (stack), 9 (data model), 12 (AI layer Feature 2 trend summary), 14 (HN Algolia pitfalls), 15 (checks), 16 (env vars)
- `app/page.tsx` — existing dashboard Home server component; pattern for fetching skill_demand_snapshots with fallback to mockTopSkills
- `app/layout.tsx` — Geist + Noto_Sans + Playfair_Display fonts, correct variable setup
- `app/globals.css` — Tailwind v4 + shadcn/tailwind.css, dark tokens need DevPulse navy override #070A14 via arbitrary values (not default oklch)
- `components/dashboard/TrendChart.tsx` — existing 5-skill AreaChart with 3M/6M/12M but styling mismatched to trends.png (needs redesign per reference: legend dots, normalized volume label, tooltip, Y-axis labels, grid)
- `components/dashboard/DashboardHeader.tsx` — header with sticky nav, active underline pattern to reuse (Trends active state)
- `components/ui/chart.tsx`, `card.tsx`, `button.tsx` — available shadcn components; need badge/input for skill pills
- `lib/mock/dashboard-data.ts` — mockTrendData with 3M/6M/12M arrays, mockTopSkills with counts/deltas, to reuse as fallback
- `lib/supabase/client.ts`, `server.ts`, `env.ts` — created with compat fallback for legacy env names (NEXT_PUBLIC_SUPABASE_URL ↔ SUPABASE_PROJECT_URL ↔ SUPABASE_URL etc.); code already handles misnamed envs but needs verification
- `package.json` — has recharts@3.8.0, framer-motion@13.2.0, next@16.3.5, tailwindcss@4; MISSING: `ai` (Vercel AI SDK) — tech stack gap, also missing `@ai-sdk/openai` or provider, `youtube-transcript` deferred (not needed for trends)
- `.env.example` — lists correct NEXT_PUBLIC_ names plus legacy aliases commented; correct per AGENTS §16
- `.env.local` — MISNAMED: uses `SUPABASE_PERISHABLE_KEY` (should be NEXT_PUBLIC_SUPABASE_ANON_KEY), `SUPABASE_PROJECT_URL` (should be NEXT_PUBLIC_SUPABASE_URL), `SUPABASE_ANON_KEY` (anon duplicate), `SUPABASE_SERVICE_SECRET` (should be SUPABASE_SERVICE_ROLE_KEY), `SUPABASE_CONNECTION_URL` valid server direct; MISSING: AI_MODEL, CRON_SECRET, YOUTUBE_API_KEY, WEEKLY_INDEX_BUDGET, NEXT_PUBLIC_ prefixed vars — env var gap per task note "some env variables might not be correctly named"
- `design/trends.png` — full reference inspected pixel-level (header, selector, chart, cards, AI card)
- `design/dashboard.png` — existing reference for comparison
- `components.json` — base-sera, taupe, rsc:true

## Decisions & Assumptions
- **Workflow compliance**: Following AGENTS §3 loop strictly after prior violation feedback: Read AGENTS.md directly (no delegation), read skills from disk, inspect code, write prompt, ask approval, build only after approval.
- **Env compat**: Keep fallback support in `lib/supabase/env.ts` for misnamed vars (SUPABASE_PROJECT_URL → NEXT_PUBLIC_SUPABASE_URL, SUPABASE_PERISHABLE_KEY → NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_SECRET → SUPABASE_SERVICE_ROLE_KEY) with deprecation warning. Add `.env.example` canonical names + note. Document that `NEXT_PUBLIC_` is required for browser but legacy still works server-side. Verify no server-only keys leak to client bundle.
- **Missing tech stack**: Install `ai` package (Vercel AI SDK) via npm (project uses package-lock.json, not pnpm). Do not install `@ai-sdk/openai` separately unless needed — use AI Gateway model string via `AI_MODEL` env. Check installed `ai` version via `node_modules/ai/package.json` before writing generateText code; read bundled docs for correct API. Keep `recharts` via shadcn Chart wrapper, not raw. Confirm framer-motion v12 API from skill.
- **Route**: Create `app/trends/page.tsx` as separate route per header nav (not just component). Update `DashboardHeader` to use Next.js `Link` with active state for /trends (underline teal). Keep existing `app/page.tsx` dashboard untouched; trends is new page.
- **Data fetching**: Trends data comes from `skill_demand_snapshots` only (per AGENTS §13: Dashboard reads snapshots, never raw aggregation). Server Component fetches last 12 months for up to 5 skills, ordered by month. Normalize to mention frequency /10k posts if total post counts available, else raw mention_count. If Supabase empty, fallback to `mockTrendData[range]` so UI renders without error. No COUNT(*) in request.
- **Skill selector**: Max 5 skills, default 3 (typescript, react, python) matching PNG. Free-text input with autocomplete from `lib/skills-dictionary.ts` (if exists, else static list derived from mockTopSkills). Pills show `x` to remove, styled with teal border bg #0F172A. Input placeholder "[type to add...]" italic serif.
- **Time range**: 3M/6M/12M toggle filters already-fetched 12M dataset client-side; active state bg teal #14B8A6 text black (or per PNG: dark bg with teal border for active 6M). Chart x-axis labels Jan-Aug (dynamic based on current month in real data, but PNG shows Jan-Aug 2026 — mock to match).
- **Chart**: Rebuild `components/trends/TrendChart.tsx` (or reuse but adapt) to match PNG exactly: AreaChart with monotone curves, linear gradients (typescript teal, react #818CF8, python #34D399), dashed grid #1E293B, Y-axis 0-10k with tick 2k, X-axis months, tooltip card dark #1E293B border, values + deltas colored. Framer Motion entrance (opacity y), no async in animate.
- **Bottom cards**: Three cards with colored top borders matching skill, large numbers (Playfair or serif), delta badges (green +%, red -%), mini sparkline AreaChart, footer Peak + Vol.
- **AI Trend Intelligence**: Server-side `POST /api/trends-summary` (or inline generateText in server component) calls `generateText` via `ai` package with grounding constraint: "You are analysing real job market data. Only reference skills and counts explicitly provided. Do not invent..." Input: raw counts for selected skills over selected range. Output: one paragraph + confidence score. If AI_MODEL missing or AI call fails, fallback to static sentence like existing TrendChart sparkles text, don't block render. Must go through API route, never browser direct.
- **Security**: Browser never holds YOUTUBE_API_KEY, SUPABASE_SERVICE_ROLE_KEY, AI_MODEL. All AI calls via Next.js Route Handler. Verify with greps before complete.
- **Styling**: Match PNG exactly at 1280px (max-w-[1280px] mx-auto px-6). Tailwind arbitrary colors (#070A14 bg, #0F172A card, #1E293B border, #64748B muted, #14B8A6 teal). Use Playfair for headings, Noto Sans/Geist for body. Reuse existing patterns.
- **Verification**: Security grep checks from AGENTS §15 must pass; no API keys exposed to browser.

## Files To Touch
- `prompts/trends.md` (this file)
- `app/trends/page.tsx` — new Server Component fetching trends data, rendering shell
- `app/api/trends-summary/route.ts` — new Route Handler for AI trend summary (server-only, calls generateText via ai SDK, Zod validation, CRON_SECRET not needed here but verify env)
- `components/trends/TrendChart.tsx` — new or heavily reworked chart component matching PNG (AreaChart with gradients, tooltip, legend)
- `components/trends/SkillSelector.tsx` — new client island for pill selector + input + max 5 enforcement
- `components/trends/TrendStatCards.tsx` — new three-card grid with Rank, mentions, delta, sparkline
- `components/trends/AITrendIntelligence.tsx` — new card with sparkles, generated paragraph, confidence footer (client or server)
- `components/dashboard/DashboardHeader.tsx` — update nav links to use next/link with active state for /trends
- `lib/mock/dashboard-data.ts` — extend/verify mockTrendData covers needed months; add normalized volume if needed
- `lib/skills-dictionary.ts` — inspect/create if missing; source of truth for autocomplete and validation
- `lib/supabase/env.ts` — already has compat; verify fallback works, add warning log for legacy names
- `.env.example` — ensure canonical names documented + legacy mapping note (may already be correct)
- `package.json` + `package-lock.json` — after `npm install ai` (and potentially `zod` already present)
- `app/globals.css` — extend if needed for chart tooltip dark vars
- `components/ui/badge.tsx`, `input.tsx` — add via shadcn if needed for pills

## Requirements
- Match `design/trends.png` exactly at 1280px: telemetry label, heading, subtitle, skill selector bar, range toggle, legend + normalized volume label, main chart (gradients, grid, axes, tooltip), three stat cards, AI intelligence card, footer.
- Responsive: stack columns <1024px (chart full width, cards stack), simplify skill selector to wrap, collapse nav on mobile — keep desktop exact.
- Framer Motion: chart area entrance, stat card stagger, number count-up (no async in animate).
- Data: Fetch from `skill_demand_snapshots` where month in last 12 months, skill in selected list, ordered chronologically. Fallback to mockTrendData without error. Never call external HN API from browser.
- Skill selector: max 5, shows "Showing X of 5 skills (max 5)", removable pills, type-ahead, validates against dictionary, prevents duplicates.
- Chart tooltip: shows Aug 2026 (last month), HN #4129 (or total post count if available), per-skill 8,432 (+34%) etc. with dot colors.
- AI card: Generated via server Route Handler, grounding constraint, confidence score, fallback if AI unavailable.
- Use existing Tailwind patterns before adding new ones;reuse ChartContainer.

## Security Checks (must pass before complete)
```
grep -r "SERVICE_ROLE" app/           # must return zero matches
grep -r "OPENAI_API_KEY" app/         # must return zero matches
grep -r "YOUTUBE_API_KEY" app/         # must return zero matches
grep -r "AI_MODEL" app/               # must return zero matches (server only, check app/api/* is server, but grep app/ should exclude api/trends-summary if it uses process.env.AI_MODEL — actually this must be 0 in app/components, but allow in app/api — so check app/components and app/trends)
grep -r "@anthropic-ai/sdk" app/      # must return zero matches
grep -r "openai" app/components/      # must return zero matches
grep -rl "googleapis.com/youtube" app/ | grep -v "app/api/cron/tutorial-index" # must return zero matches
```
*Verify that no API keys are exposed to the browser before marking complete.* Check Network tab responses, browser source, `window` object. Ensure YouTube Data API only in tutorial indexer route, not trends.

## Acceptance Criteria
- `npx tsc --noEmit` zero errors, `npx eslint .` zero warnings in new files, `npx next build` succeeds
- `/trends` route loads, header shows Trends active with teal underline, Dashboard inactive
- Skill selector shows 3 pills default, can add up to 5, remove with x, max 5 message, input placeholder correct, legacy env vars still work via fallback
- Range toggle 3M/6M/12M switches chart data client-side, 6M default active teal per PNG
- Chart renders at 1280px matching PNG: Y 0-10k, X Jan-Aug, dashed grid, three colored areas with gradients, legend dots, normalized volume label
- Tooltip on hover shows correct Aug 2026 values (typescript 8,432 +34% etc.) with correct colors
- Three bottom cards show Rank #1/#2/#3, large counts, colored deltas, mini sparklines, Peak + Vol footer
- AI Trend Intelligence card renders paragraph with inline colored deltas, sparkles icon, footer confidence 98.4% (or real AI-generated if AI_MODEL set)
- Data integrity: if Supabase has data, chart reflects real mention_counts; if empty, falls back to mock without crash
- Responsive at 1280/768/375 per browser checks, no overflow
- Security greps all zero (allowing AI_MODEL only in app/api), no keys in client bundle, no direct provider SDK imports in components
- Tech stack gap fixed: `ai` installed, version checked vs latest, env vars documented

## Manual Test Steps
1. `npm install && npm run dev` — open http://localhost:3000/trends
2. Verify header matches PNG (Telemetry/Market Index label, Skill demand trends heading, subtitle, nav active)
3. Verify skill selector bar: 3 pills, x removes, type to add autocomplete, add until 5, 6th blocked with message
4. Verify range toggles: click 3M, 6M, 12M — chart updates, active state teal border/bg per PNG
5. Verify legend + normalized volume label top right
6. Hover chart — tooltip appears with Aug 2026 values and deltas colored correctly
7. Verify three stat cards: numbers, deltas, spaklines, Peak/Vol footers
8. Verify AI Trend Intelligence card: paragraph with colored deltas, confidence score, sparkles
9. If AI_MODEL set, verify API route generates text within 10s and contains no invented stats (compare to Supabase snapshot counts)
10. If AI_MODEL not set, verify fallback static text shows without error
11. Resize to 768 and 375 — layout stacks, no overflow, nav collapses
12. `npx tsc --noEmit && npx next build` — passes
13. Run security greps — all zero (except AI_MODEL in api route server file); inspect Network tab — no keys; check browser source — no SUPABASE_SERVICE_ROLE_KEY

