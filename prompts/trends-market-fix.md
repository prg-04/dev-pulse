# Trends Fix Implementation Prompt — Market-Driven Defaults + Dual AI Summary

## Goal
Fix the Trends page so its default view reflects **actual market demand** (top skills from `skill_demand_snapshots`) rather than a hardcoded list. The skill selector becomes a customization/filter layer on top of market data, not the source of truth. Add a dual-mode AI Trend Intelligence block: a **market overview summary** (always about the top movers) plus an **optional custom summary** when the user deviates from the default selection. Update max skills from 5 to 15.

## Skills Read
- `vercel/ai` — `generateText` grounding constraint, server-only API routes, Zod validation
- `supabase` — anon vs service role, RLS, session handling, Data API exposure
- `supabase-postgres-best-practices` — query patterns, indexes on `skill_demand_snapshots`, avoid raw COUNT(*)
- `vercel-react-best-practices` — strict TS, server vs client boundary, no `any`
- `impeccable` — spacing, typography, reuse existing Tailwind patterns
- `shadcn/ui Charts` — ChartContainer + AreaChart via shadcn wrapper, not raw Recharts
- `framer-motion-animator` — v12 API, no async in animate callbacks
- Next.js App Router — server components, `force-dynamic`, route handlers

## Code Inspected
- `app/(app)/trends/page.tsx` — current page hardcodes `["typescript","react","python","node.js","postgresql"]` at line 23; never queries top skills from DB
- `components/trends/TrendsClient.tsx:37` — overrides with another hardcoded default `["typescript","react","python"]`; `max` prop not passed to `SkillSelector`
- `components/trends/AITrendIntelligence.tsx:45-46` — static fallback with invented percentages (`+34%`, `-2%`) about hardcoded skills
- `components/trends/SkillSelector.tsx` — accepts `max` prop (default 15 internally but TrendsClient never passes it); quick-add chips not implemented
- `app/(app)/page.tsx` — Dashboard correctly derives trend skills via `getTopSkillsWithDelta()` then `getTrendsData()`
- `lib/queries/dashboard.ts` — `getLatestMonth`, `getTopSkillsWithDelta`, `getBiggestMovers` available and working
- `lib/queries/trends.ts` — `getTrendsData()` and `buildMonthsBack()` pure functions, take skills array as input
- `app/api/trends/route.ts` — existing client-side fetch target; accepts `skills` comma-separated
- `app/api/trends-summary/route.ts` — existing AI route; accepts `skills`, `range`, `data` in body
- `lib/ai/provider.ts` — provider-agnostic model factory; `createTextModel()` used by trends-summary

## Decisions & Assumptions
- **Data source of truth**: `skill_demand_snapshots` only (per AGENTS.md §13). Trends page derives its default skill list from `getTopSkillsWithDelta()` exactly like the Dashboard.
- **Skill selector role**: filter/customization on top of market data. Default = market's actual top 5 skills. User can swap/add up to 15.
- **Dual AI summary mode**:
  - **Market overview** (default when `selected` === `defaultSkills`): summary discusses the top movers — rising skills, declining skills, overall market direction. Always generated, always relevant.
  - **Custom summary** (when user deviates from defaults): summary discusses specifically the skills the user has selected, using the data passed to it.
  - The server component fetches `marketMovers` (`getBiggestMovers`) and passes it to the client. `AITrendIntelligence` decides which mode to request from `/api/trends-summary` based on whether `skills` matches `defaultSkills`.
- **Max skills**: 15 (per user request). Update `SkillSelector` default and `TrendsClient` to pass `max={15}`.
- **No invented data**: Replace the hardcoded fallback in `AITrendIntelligence` with a generic, skill-agnostic message like "Market data is still loading. Summary will appear once trend data is available." The AI route already has a generic `fallbackSummary()` — ensure the client uses that path rather than inventing percentages.
- **No caching changes needed**: page is already `force-dynamic` and re-renders on every request. Staleness was data-selection staleness, not cache staleness.
- **Trends API route** (`/api/trends`): keep as-is — it correctly serves whatever skills it receives. The fix is upstream in what skills the server component initially requests.
- **Security**: All AI calls remain server-side via `/api/trends-summary`. No keys in client components. No direct provider SDK imports in `app/` or `components/`.

## Files To Touch
1. `app/(app)/trends/page.tsx` — import `getLatestMonth`, `getTopSkillsWithDelta`, `getBiggestMovers` from `lib/queries/dashboard.ts`. Replace hardcoded skills with dynamically fetched top 5. Pass `initialSkills`, `marketMovers`, and `hasMarketData` to `TrendsClient`.
2. `components/trends/TrendsClient.tsx` — accept `initialSkills` and `marketMovers` props. Use `initialSkills` as default `selected` state. Pass `max={15}` to `SkillSelector`. Pass `marketMovers` to `AITrendIntelligence`.
3. `components/trends/AITrendIntelligence.tsx` — add `marketMovers` prop. Replace hardcoded fallback with generic message. Add logic: if `skills` === `defaultSkills`, request market overview summary; else request custom summary. Pass a `mode` indicator (`"market"` | `"custom"`) to the API.
4. `components/trends/SkillSelector.tsx` — update default `max` from 5 to 15 in prop definition (currently default is 15 already but TrendsClient never passes it — make explicit).
5. `app/api/trends-summary/route.ts` — accept optional `mode` field (`"market"` | `"custom"`). When `mode === "market"`, the prompt emphasizes top movers / rising-declining narrative. When `mode === "custom"`, summarize the selected skills' trajectories. Keep grounding constraint.
6. `components/trends/TrendStatCards.tsx` — ensure it renders correctly when more than 3 skills are selected (up to 15).
7. `components/trends/TrendChartArea.tsx` — verify it handles up to 15 skills without color collisions or legend overflow (if issues exist, fix; otherwise leave as-is).

## Requirements
- **Default skills**: derived from `getTopSkillsWithDelta(supabase, latestMonth).slice(0, 5)` on the server. No hardcoded arrays.
- **Market overview AI summary**: always generated on initial load. Discusses the month's biggest movers (rising + declining), overall market direction, and any notable shifts. Uses `marketMovers` data passed from server.
- **Custom AI summary**: triggered when user adds/removes skills such that `selected` !== `initialSkills`. Discusses the selected skills' trajectories and relative positions.
- **Max skills**: 15. Skill selector shows "Showing X of 15 skills (max 15)".
- **Fallback behavior**: if no data in DB, show empty state (existing behavior is correct — keep it). If AI call fails, show generic fallback text, never invented percentages.
- **Client state initialization**: `selected` must initialize from `initialSkills` prop, not from a hardcoded array.
- **Data flow**: Server component → `TrendsClient` (initialData + initialSkills + marketMovers) → client fetches `/api/trends?skills=...` on mount and on skill change → `AITrendIntelligence` fetches `/api/trends-summary` with mode flag.

## Security Checks
```
grep -r "SERVICE_ROLE" app/           # must return zero matches
grep -r "OPENAI_API_KEY" app/         # must return zero matches
grep -r "YOUTUBE_API_KEY" app/        # must return zero matches
grep -r "AI_MODEL" app/               # must return zero matches in components/pages; allowed only in app/api/*
grep -r "@anthropic-ai/sdk" app/      # must return zero matches
grep -r "openai" app/components/      # must return zero matches
```
*Verify that no API keys are exposed to the browser. All AI calls go through `/api/trends-summary` only. Verify Network tab shows no keys in responses.*

## Acceptance Criteria
- `npx tsc --noEmit` zero errors, `npx next build` succeeds
- `/trends` page renders with **market-derived** default skills (top 5 from DB), not `["typescript","react","python","node.js","postgresql"]`
- When DB is empty, page shows existing "No trend data available yet" empty state (unchanged)
- Skill selector defaults to market top 5, shows "Showing 5 of 15 skills (max 15)"
- User can add/remove skills up to 15; chart and stat cards update accordingly
- **Market overview AI summary** appears by default, referencing actual rising/declining movers from DB (not invented percentages)
- When user changes skill selection, AI summary switches to **custom summary** mode discussing selected skills
- When user resets selection back to market defaults, AI summary switches back to market overview
- No hardcoded fallback text with invented stats anywhere in the Trends components
- `AITrendIntelligence` does not contain static strings like `+34%`, `-2%`, or specific skill names in fallback
- Security greps all pass; no keys in client bundle

## Manual Test Steps
1. `npx tsc --noEmit && npx next build` — passes clean
2. Seed `skill_demand_snapshots` with at least 2 months of data for 5+ skills
3. Visit `/trends` while signed in
4. Verify the skill selector defaults to the **actual top 5 skills** from the DB, not a hardcoded list
5. Verify the AI Trend Intelligence card shows a **market overview summary** referencing real rising/declining skills from the data
6. Remove a default skill and add a different skill from the selector
7. Verify the AI summary switches to **custom summary** mode discussing the new selection
8. Reset skills back to defaults — verify summary switches back to market overview
9. Add skills up to 15 total — verify selector enforces max, chart renders all 15
10. Clear all data from `skill_demand_snapshots` — verify empty state renders, no crashes
11. Run security greps — all zero; inspect Network tab — no API keys in `/api/trends-summary` response
