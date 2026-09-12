# Dashboard Implementation Prompt — DevPulse Skill Demand Dashboard

## Goal
Implement pixel-exact **Developer Skill Demand Dashboard** at 1280px per `design/dashboard.png`. Desktop is source of truth; mobile stacks sensibly. Must read live data from Supabase `skill_demand_snapshots` + job counts, with framer-motion animations, shadcn/ui charts, and no API keys in browser.

## Skills Read
- `supabase` — RLS, anon vs service_role, Data API exposure, security checklist
- `supabase-postgres-best-practices` — query performance, indexes, RLS perf
- `ai-sdk` — verified against bundled docs, not memory; gateway model strings
- `vercel-react-best-practices` — strict TS, server vs client, no `any`
- `framer-motion-animator` — v12 API, no async in animate, use built-in sequence
- `secure-coding` — input validation, server/client boundary, env prefix check
- `impeccable` — typography/spacing discipline
- `shadcn/ui Charts` — via `npx shadcn add chart` wrapper over Recharts, not raw Recharts / Tremor
- Next.js App Router — from `node_modules/next/dist/docs` (not training memory)

## Code Inspected
- `app/page.tsx` — boilerplate create-next-app, to be replaced
- `app/layout.tsx` — Geist + Noto + Playfair, correct
- `app/globals.css` — Tailwind v4 + shadcn/tailwind.css, dark tokens already defined but needs DevPulse dark navy override
- `components/ui/card.tsx`, `chart.tsx`, `button.tsx` — available
- `lib/utils.ts` — `cn` re-export
- `package.json` — missing: `ai`, `@ai-sdk/*`, `@supabase/supabase-js`, `@supabase/ssr`, `zod`, `framer-motion`, `youtube-transcript`; has `recharts`, `next@16.3.5`, `tailwindcss@4`
- `.env.local` — misnamed: `SUPABASE_PERISHABLE_KEY` → `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_SECRET` → `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_PROJECT_URL` → `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_CONNECTION_URL` → keep for server direct. Missing `AI_MODEL`, `CRON_SECRET`, `YOUTUBE_API_KEY`, `WEEKLY_INDEX_BUDGET`
- `components.json` — `base-sera`, `taupe`, `rsc:true`
- `design/dashboard.png` — reference: dark #070A14 bg, teal #14B8A6 accent, 4 stat cards with colored top borders, Top 50 table with relative volume bars, source pills, right rail (Sources/Biggest movers/Sample Integrity), bottom Skill demand over time chart (5 lines, 3M/6M/12M)

## Decisions & Assumptions
- **Env compat**: Support both `NEXT_PUBLIC_SUPABASE_URL|_ANON_KEY` and legacy `SUPABASE_PROJECT_URL`/`SUPABASE_PERISHABLE_KEY`/`SUPABASE_CONNECTION_URL` in `lib/supabase/*` with fallback + console warning. Create `.env.example` mapping. Never expose `SUPABASE_SERVICE_ROLE_KEY` to client; server-only. Verify before marking complete.
- **Data source**: Dashboard reads `skill_demand_snapshots` (month `YYYY-MM`) ordered by `mention_count` desc, limit 50, plus `job_postings` count for stat card. Never `COUNT(*)` on `skill_mentions` in request. If Supabase empty/unavailable, fallback to mock data matching PNG (42,891 postings, 240 skills, typescript 8,432 etc.) so UI renders without failing build.
- **Missing deps**: `npm install @supabase/supabase-js @supabase/ssr zod framer-motion` (keep `ai` out of dashboard; dashboard is not AI feature). `youtube-transcript` deferred to ingestion phase. Project uses npm (package-lock.json), not pnpm.
- **Styling**: Override dark bg to `#070A14`/`#0B1220` card bg via `globals.css` or Tailwind arbitrary values to match PNG exactly — not default oklch. Use `Noto_Sans` + `Playfair_Display` for heading per layout. No GSAP.
- **Architecture**: Server Component `app/page.tsx` fetches via `lib/supabase/server.ts` (anon key), passes to Client islands for animations (Framer Motion) and chart (shadcn ChartContainer). No browser Supabase service_role, no AI provider call, no `NEXT_PUBLIC_` leakage.
- **Chart**: shadcn `ChartContainer` wrapping `AreaChart`/`LineChart` with 5 series, gradient fills, Tailwind v4 CSS vars, Framer Motion entrance. Time ranges 3M/6M/12M filter client-side.
- **Verification**: Security grep checks from §15 must pass.

## Files To Touch
- `prompts/dashboard.md` (this file)
- `.env.example` — create correct names + legacy mapping note
- `.env.local` — keep as-is but code handles compat; optionally document rename
- `lib/supabase/client.ts` — new, anon client with fallback env resolution
- `lib/supabase/server.ts` — new, server client (anon for dashboard reads)
- `lib/mock/dashboard-data.ts` — new, PNG-matching fallback data
- `app/page.tsx` — replace with dashboard layout
- `components/dashboard/*` — new: `StatCards.tsx`, `TopSkillsTable.tsx`, `SourcesCard.tsx`, `BiggestMovers.tsx`, `SampleIntegrity.tsx`, `TrendChart.tsx`, `DashboardHeader.tsx`
- `app/globals.css` — extend dark vars for dashboard navy
- `package.json` + `package-lock.json` — after dep install
- `components/ui/badge.tsx`, `skeleton.tsx` — add via shadcn if needed for pills/loaders

## Requirements
- Match PNG exactly at 1280px: header nav (Dashboard active with teal underline), title/subtitle, 4 stat cards (top borders teal/purple/green), filter pills (All active teal), table with rank/skill/bar/count/delta, right rail cards, trend chart with insight banner, footer.
- Responsive: stack columns <1024px, simplify grids, collapse nav.
- Framer Motion: number count-ups on stat cards, bar width animations on table, chart area entrance.
- Data: Try Supabase first, fallback to mock without error UI. Show “Live” indicator.
- No mobile reference — adapt sensibly.
- Use existing Tailwind patterns before adding new ones.

## Security Checks (must pass before complete)
```
grep -r "SERVICE_ROLE" app/           # 0
grep -r "OPENAI_API_KEY" app/         # 0
grep -r "YOUTUBE_API_KEY" app/         # 0
grep -r "AI_MODEL" app/               # 0
grep -r "@anthropic-ai/sdk" app/      # 0
grep -r "openai" app/components/      # 0
grep -rl "googleapis.com/youtube" app/ | grep -v "app/api/cron/tutorial-index" # 0
```
*Verify that no API keys are exposed to the browser before marking complete.* Check Network tab + `window` object.

## Acceptance Criteria
- `npx tsc --noEmit` zero errors, `npx eslint .` zero warnings in new files, `npx next build` succeeds
- Dashboard loads with data (Supabase or mock) — 42,891 stat, 240 skills, typescript top
- Top 50 table ranks correct, bars proportional, delta colors (green positive, red negative)
- Sources card percentages sum ~100%, Biggest movers rising green/declining red
- Trend chart renders 5 lines, 3M/6M/12M toggles, tooltip shows August 2026 values
- Animations run without `async` in `animate`
- Responsive at 1280/768/375 per browser checks
- Security greps all zero, no keys in client bundle

## Manual Test Steps
1. `npm install && npm run dev` — open http://localhost:3000
2. Verify header matches PNG (DevPulse logo, Dashboard underlined teal, Live dot)
3. Verify 4 stat cards values + deltas
4. Click filter pills — table filters (mock: just UI state if no per-source data)
5. Scroll table — “Show 25 more” expands
6. Check right rail cards render correctly
7. Check trend chart toggles 3M/6M/12M, hover tooltip shows values
8. Resize to 768 and 375 — layout stacks, no overflow
9. `npx tsc --noEmit && npx next build` — passes
10. Run security greps — all zero; inspect Network tab — no keys
