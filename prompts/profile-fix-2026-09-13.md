# Profile Save Not Persisting — Implementation Prompt

**Date:** 2026-09-13
**Author:** Sisyphus
**Status:** Awaiting approval — do not build until Evans says "yes"
**Related:** AGENTS.md §3, §5f, §8, §11, §13, §18

## Goal
Fix Profile & Market Preferences page so every editable field the user changes is actually persisted to Supabase and is visible immediately without a hard refresh. Today the Profile page renders correctly from `profiles`/`user_skills`/`alert_preferences`, but mutations appear to succeed (Save button goes to "Saving..." then back) while on reload the old values reappear, and newly-added skills never appear in the "ACTIVE PRODUCTION WEIGHTS" chip list at all. This prompt fixes the client state bugs and the server upsert edge case that together cause "inputs not updated".

## Skills Read
- `supabase` — `createClient` from `@supabase/ssr`, `supabase.auth.getUser()` server-side check, cookie handling via `next/headers`, anon vs service_role, RLS `using ((select auth.uid()) = id)` pattern from `supabase/migrations/002_rls_policies.sql`
- `supabase-postgres-best-practices` — upsert vs update (`ON CONFLICT (id) DO UPDATE`), why `update().eq().select().maybeSingle()` returns `null` not error when row missing, keep `set_updated_at` trigger, avoid raw `COUNT(*)`
- `vercel-react-best-practices` — React state: never `const [x] = useState(initial)` without setter if you intend to mutate; sync `initialData` → local editable copies; optimistic update vs `router.refresh()`; avoid swallowing `catch {}`; parallel fetches with `Promise.all`
- `vercel/next.js` — App Router `force-dynamic`, Route Handlers (`app/api/profile/route.ts`, `app/api/profile/skills/route.ts`, `app/api/alert-preferences/route.ts`), client `"use client"` boundary, `fetch` from same origin carries Supabase session cookie automatically
- `secure-coding` — Zod validation at trust boundary, no secrets in client, verify session/API key before write, never log raw `Bearer`
- `impeccable` / `framer-motion-animator` — existing ProfileClient layout uses arbitrary Tailwind colors `#070A14`, `#0F172A`, `#1E293B`, `#14B8A6` — preserve exact desktop at 1280px, no redesign

## Code Inspected
- `components/profile/ProfileClient.tsx` — 632 lines: `ProfileClient` with `InitialData`, `handleSave` (lines 118-153), `handleAddSkill` (155-179), `handleRemoveSkill` (181-186), `toggleSource`, six panel refs, state declarations lines 35-109
- `app/(app)/profile/page.tsx` — Server Component `force-dynamic`, `Promise.all` of 5 queries (`profiles`, `user_skills`, `gap_report_events`, `alert_preferences`, `api_keys`), builds `initialData` and passes to `ProfileClient`
- `app/api/profile/route.ts` — Zod `ProfileSchema`, `GET` with `auth.getUser()`+401, `PUT` with `supabase.from("profiles").update(payload).eq("id", user.id).select().maybeSingle()` — returns `null` data when row missing, no error
- `app/api/profile/skills/route.ts` — Zod `AddSchema`, `POST` with `upsert({user_id, skill, years, depth_tier, source:"manual"}, {onConflict:"user_id,skill"})`, `DELETE ?skill=` with `delete().eq("source","manual")`
- `app/api/alert-preferences/route.ts` — Zod `Schema`, `PUT` with `upsert({user_id, ...parsed.data}, {onConflict:"user_id"})`
- `lib/supabase/server.ts` — `createServerClient` with `cookies()` getAll/setAll, returns `null` if env missing
- `lib/supabase/middleware.ts` + `proxy.ts` — `updateSession` reads/writes cookies, proxy redirects unauthenticated non-public paths to `/sign-in`, `/api/*` is public-by-proxy (each route does its own 401)
- `lib/skills-dictionary.ts` — `normalizeSkill`, aliases, 31 canonical skills — used by skills route and client `handleAddSkill`
- `supabase/migrations/001_initial_schema.sql` — `profiles` PK = `auth.users(id)`, `user_skills` unique `(user_id,skill)`, `alert_preferences` PK = `user_id`
- `supabase/migrations/002_rls_policies.sql` — RLS enabled on `profiles`/`user_skills`/`alert_preferences`, `handle_new_user()` trigger, `set_updated_at()` triggers

## Decisions and Assumptions
- **Root cause is primarily client state, not RLS or auth.** `handleSave` correctly calls `/api/profile` PUT which does `auth.getUser()` + 401 and then `update`. Network tab will show 200 in prod. The user sees "not updated" because: (a) skills list uses `const [skills] = useState(initialData.skills)` with no setter, so `handleAddSkill` clears inputs but never pushes into the displayed chip list; (b) `handleRemoveSkill` deletes server-side but never filters local `skills`; (c) `handleSave` updates the `profile` object but error branch is `catch {}` with zero UI feedback, and a second `PUT /api/alert-preferences` runs after profile save without error handling — if it fails the first save's success is misleading. A secondary server edge case is `update().eq()` returning `null` data when the `profiles` row doesn't exist (race with trigger), which the client spreads as `{...p, ...null}` = no visible change and no error.
- **Keep the existing two-endpoint save model.** `ProfileClient.handleSave` already does `PUT /api/profile` then `PUT /api/alert-preferences`. Do not merge into one route; fix error handling and add `router.refresh()` so Server Component data stays consistent after mutation.
- **Use optimistic local update + `router.refresh()` for consistency.** For skills, optimistically `setSkills` on 200 so the chip appears instantly, then call `router.refresh()` to revalidate the Server Component's `Promise.all` queries without a full reload. Same for profile: `setProfile` + `router.refresh()`.
- **Fix server `PUT /api/profile` to tolerate missing row.** Replace `update().eq()` with `upsert({id: user.id, ...payload}, {onConflict:"id"})`. This matches AGENTS.md §11 trigger intent (row should exist, but upsert is defensive and matches `§17` "upsert not insert" pattern used elsewhere). Keeps RLS (`using((select auth.uid())=id) with check(...)`) satisfied because `id=user.id`.
- **Do not change `DELETE ...eq("source","manual")` semantics.** AGENTS.md §12d requires `source='manual'` to take precedence and never be overwritten by `github_sync`. The DELETE route intentionally only removes manual rows (UI only shows × for manual anyway). Preserving this is correct; document it.
- **No redesign, no new dependencies, no mobile breakpoint changes.** Desktop 1280px is source of truth per §5. Mobile adaption already stacks `grid-cols-12` → `col-span-12` correctly. Keep arbitrary colors and `lucide-react` icons as-is.
- **Assume Supabase env is configured.** If `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` missing, `createClient()` returns `null` and routes return 500. That path is out of scope for this fix (already handled by `proxy.ts` + `app/(app)/layout.tsx` guard). This fix does not add dummy data.
- **Assume `normalizeSkill` dictionary is authoritative.** `handleAddSkill` validates client-side then server re-validates. No change to dictionary.
- **Assumption about testing:** Playwright not configured in this repo; manual browser verification is primary acceptance. Unit test for `normalizeSkill` not needed for this fix.

## Files You Will Touch
- `components/profile/ProfileClient.tsx` — primary fix: add setters for `skills`/`gapExpansion`/`apiKeyPrefix` if mutated, fix `handleAddSkill`/`handleRemoveSkill` to mutate local state, fix `handleSave` to handle both PUTs with error UI, add `useRouter().refresh()`, surface `skillError`/`saveError`, fix `compFloor`/`compCeiling` number parsing edge, keep `toggleSource` as-is but ensure it mutates `profile.monitored_sources`
- `app/api/profile/route.ts` — secondary fix: change `update().eq("id", user.id)` to `upsert({id: user.id, ...payload}, {onConflict:"id"})` with same field allowlist, keep Zod validation and `monitored_sources` allowlist check, return 500 on Supabase error with message
- `app/(app)/profile/page.tsx` — no logic change; confirm `force-dynamic` stays, possibly add `revalidate = 0` comment (no functional change needed)
- `prompts/profile-fix-2026-09-13.md` — this file (documentation only)
- No migration change — `001`/`002` already correct for RLS and triggers; no new table/column

**Files you will NOT touch:** `lib/skills-dictionary.ts`, `lib/supabase/*`, `proxy.ts`, `app/(app)/layout.tsx`, `supabase/migrations/*`, `vercel.json`, any cron routes, any other page.

## Requirements
1. **Skills add/remove reflects instantly and persists**
   - Change `const [skills] = useState(...)` to `const [skills, setSkills] = useState(...)` (and same for any other state that needs mutation)
   - On `POST /api/profile/skills` 200, push `json.skill` into `setSkills(prev=>[...prev, json.skill])` if not already present, or replace matching `skill` entry; clear inputs and error
   - On `DELETE /api/profile/skills?skill=...` 200, `setSkills(prev=>prev.filter(s=>s.skill!==canonical))`
   - Handle 400 with `setSkillError(j.error)` and keep inputs, handle network error similarly
2. **Profile save persists and shows feedback**
   - `handleSave` must `await` both `PUT /api/profile` and `PUT /api/alert-preferences`, check `res.ok` for each, parse `json.error` on failure, surface via `saveError` banner or toast (no silent `catch {}`)
   - On success, `setProfile(p=>({...p, ...json.profile}))` AND `router.refresh()` so Server Component queries revalidate; set `savedAt` to locale time
   - On failure, set `saveError` string and do not update `savedAt`
   - Keep `saving` boolean for button disabled state, show "Saving..." label
3. **Server upsert fix**
   - In `app/api/profile/route.ts` PUT, replace `from("profiles").update(payload).eq("id", user.id)` with `from("profiles").upsert({id: user.id, ...payload}, {onConflict:"id"}).select().maybeSingle()` — preserves Zod allowlist and `monitored_sources` validation, fixes silent null when row missing
   - Return `500` with `error.message` on failure (existing behavior) and `200 {profile:data}` on success
4. **Preserve existing styling and structure**
   - No change to Tailwind classes, grid, colors, icons, panel `ref`/`observer` logic, or `scrollToPanel`
   - Keep `normalizeSkill` client check before POST (UX), keep server check inside route (security)
5. **Security checks (before marking complete)**
   - `grep -r "SERVICE_ROLE\|YOUTUBE_API_KEY\|RESEND_API_KEY\|GITHUB_TOKEN\|API_KEY_PEPPER\|AI_MODEL" app/components/ components/profile/` must be zero (it already is; verify not introduced)
   - Every profile-scoped route validates `supabase.auth.getUser()` server-side and rejects 401 before touching data (already true for `profile`, `profile/skills`, `alert-preferences`; verify not removed)
   - No API keys exposed in responses beyond the masked `apiKeyPrefix` already returned server-side
   - `Verify that no API keys are exposed to the browser, and that every profile-scoped route validates the Supabase session or API key server-side, before marking complete.`
6. **Diagnostics and build**
   - `npx tsc --noEmit` zero errors
   - `npx eslint .` zero warnings in changed files (or document pre-existing)
   - `npx next build` succeeds (or note free-tier quota skip with `next build` log)

## Acceptance Criteria
- [ ] Add a skill via Profile → Core Skill Stack → "e.g. typescript" → Add: chip appears instantly, survives hard reload (`Cmd+Shift+R`), appears in `user_skills` via Supabase dashboard query
- [ ] Remove a manual skill via × on chip: chip disappears instantly, survives reload, row deleted from `user_skills`
- [ ] Edit Identity (Full Name, Location), Career (Target Role, Comp Floor/Ceiling, Contractor Pref toggle), toggle a Source chip, toggle Alerts checkboxes, click Save Preferences: each change persists after reload, `profiles` and `alert_preferences` rows show new values in Supabase
- [ ] With no `profiles` row (delete manually then sign in again): Save Preferences still creates the row (upsert) and subsequent reload shows values — no silent "saved but null" state
- [ ] Browser Network tab shows `PUT /api/profile 200`, `PUT /api/alert-preferences 200`, `POST /api/profile/skills 200` with session cookies, no key leakage in any response
- [ ] Typecheck + lint + build checks above pass with real output pasted

## Manual Test Steps
1. `npm run dev`, sign in with magic link, go to `/profile`
2. In Core Skill Stack, type `typescript` (or `next.js` / `python` from dictionary) → Add → see chip appear without reload → reload → still there
3. Click × on that chip → see it disappear → reload → still gone
4. Change Full Name to "Test User", Location to "Berlin", Target Role to "Senior Full-Stack", Comp Floor to 180000, toggle one Source off, toggle one Alert on → Save Preferences → see timestamp "Last saved: ..." update, no console error → reload → all changes still present
5. `npx tsc --noEmit` → paste output
6. `grep -r "SERVICE_ROLE" app/ components/` → expect zero (paste output)
7. Supabase dashboard: `select * from profiles where id = auth.uid()` and `select * from user_skills where user_id = auth.uid()` → verify rows match UI

## Out of Scope (explicitly not in this PR)
- Redesign of Profile layout, new fields, GitHub sync trigger, alert email dispatch, dashboard/trends data wiring, skills page, RLS policy text tweak from `to authenticated`, cron routes, tutorial indexing — none of these move in this PR

## Rollback
- Revert `components/profile/ProfileClient.tsx` to previous `const [skills]` (no setter) and `catch {}` silencing — re-introduces "not updated" symptom
- Revert `app/api/profile/route.ts` to `update().eq()` — re-introduces null-row silent failure
