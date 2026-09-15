# Profile & Market Preferences — Completion Prompt

## Goal
Complete the **Profile & Market Preferences** page to match `design/user-profile.png` exactly at 1280px and close remaining functional gaps in the existing scaffold. The UI skeleton and six-section layout are already built; this prompt covers the missing functionality, API routes, and UI bugs that prevent the profile from being fully usable per §5f and §12e.

## Skills Read
- `supabase` — magic-link session handling, `@supabase/ssr`, RLS policies, service_role vs anon
- `supabase-postgres-best-practices` — upsert precedence, RLS correctness, index usage
- `vercel-react-best-practices` — strict TS, server vs client boundary, no `any`
- `vercel/next.js` — App Router Route Handlers, `force-dynamic`, middleware
- `secure-coding` — IDOR prevention, input validation, secret handling, session checks
- `impeccable` — pixel-level UI fidelity to reference image
- `shadcn/ui` — Card, Badge, Toggle, Button, Input, Skeleton patterns

---

## Code Inspected

### Existing scaffold (already built, needs fixes/completion)
- `app/(app)/profile/page.tsx` — Server Component, fetches `profiles`, `user_skills`, `gap_report_events`, `alert_preferences`, `api_keys`. Passes `initialData` to `ProfileClient`.
- `components/profile/ProfileClient.tsx` — Client component with all six §5f sections, left PREFERENCE_PANELS rail, CRAWLER HEARTBEAT card, bottom Save Preferences bar. Has `toggleSource`, `toggleAlert`, `saveCareer`, `handleGitSync`, `handleSave`, `copyApiKey`.
- `app/api/profile/route.ts` — `GET`/`PUT` for `profiles` rows.
- `app/api/profile/skills/route.ts` — `GET`/`POST`/`DELETE` for `user_skills`.
- `app/api/alert-preferences/route.ts` — `GET`/`PUT` for `alert_preferences`.
- `app/api/keys/route.ts` — `GET` (masked list) + `POST` (generate). **Missing: revoke logic, old-key invalidation on generate.**
- `app/api/export/route.ts` — `GET` bearer-or-session, correctly implemented.

### Missing endpoints
- `app/api/keys/revoke/route.ts` — **does not exist.** Required by §12e and §5f item 6.

### Gaps and bugs found
1. **`/api/keys/revoke` missing** — §12e requires `POST /api/keys/revoke` to set `revoked_at = now()`.
2. **`POST /api/keys` does not revoke old keys** — Generating a new key should invalidate all previous unrevoked keys for that user. Currently just inserts without revoking.
3. **"+ Add Skill Vector" button non-functional** — The button in Card 3 (Core Skill Stack) does nothing. Need inline add form + API call to `POST /api/profile/skills`.
4. **Skill removal non-functional** — No ×/remove affordance on skill chips. Need `DELETE /api/profile/skills?skill=...` wired up.
5. **`handleSave` stale `monitored_sources` race** — The second `fetch("/api/profile")` for monitored_sources uses `profile.monitored_sources`, but `setProfile` from the first fetch hasn't caused a re-render yet. It sends stale data (the pre-toggle list). Fix: pass `monitored` directly to the second fetch body, or combine all saves into one request.
6. **API key UI bugs**:
   - "Copy Key" button calls `copyApiKey()` which always generates a **new** key (`POST /api/keys`). It should copy the existing key if one exists, and only generate if none exists.
   - When no key exists, UI shows hardcoded fake `dp_live_994e28ff01cc561cc792b0042`. This is wrong — it should show `generate to view` / empty state.
   - Need a "Regenerate" button that calls `POST /api/keys` (after revoking old via new revoke endpoint) and displays the raw key inline.
   - Need inline copyable field for the raw key (not `alert()`). The full key is shown exactly once per §5f item 6.
7. **`AppHeader.tsx` missing Jobs nav item** — Reference image shows `Dashboard · Trends · Jobs · Gap Report` in top nav. Current code only renders first 3 (`NAV.slice(0, 3)`) and is missing Jobs entirely. AGENTS.md §5 says nav is `Dashboard · Trends · Jobs · Skills · Gap Report`, but the reference image (`user-profile.png`) shows no Skills nav item. **Follow reference image: Dashboard, Trends, Jobs, Gap Report + profile icon.**
8. **Env var inconsistency in AGENTS.md §9/§19** — `AI_MODEL` examples use both `ollama:llama3.1` (colon) and `ollama/llama3.1` (slash). The Vercel AI SDK v7 uses `provider/model-name` (slash) or `provider(model-name)` (parentheses). Colon format `ollama:llama3.1` is incorrect for current SDK. Flag in prompt; do not change existing AI routes unless asked.
9. **`AppFooter.tsx` not in layout** — Currently per-page. Should be in `app/layout.tsx` as a shared footer per §5 layout rule. Pages like `/profile`, `/gap-report`, `/trends` each render their own footer currently. Extract to layout.
10. **Sign-in page missing** — Required by §3. Magic-link only, no password. `/sign-in` page exists at `app/sign-in/page.tsx` but may need review for on-brand dark UI consistency.

---

## Decisions & Assumptions
- **Design is source of truth:** `design/user-profile.png` overrides any textual ambiguity in §5f. Match layout, spacing, typography, color, component states exactly at 1280px.
- **Nav follows reference image:** `Dashboard · Trends · Jobs · Gap Report` + profile icon. No `Skills` in top nav per reference.
- **Shared layout extraction:** Move `AppFooter` into `app/layout.tsx` so all pages share it. Pass `lastUpdate` from server queries via layout props or a shared fetch.
- **`monitored_sources` save fix:** Combine profile save + monitored_sources toggle into a single `PUT /api/profile` request, or pass the current `monitored` array explicitly in the second request body. Do not rely on stale React state closure.
- **Skill add/remove:** Inline form in Card 3. Add validates against `SKILLS_DICTIONARY` via `normalizeSkill`. Remove only allows `source === 'manual'` (github_sync rows are read-only per §12d).
- **API key UX:** 
  - State: `apiKeyRaw` (string | null, full key shown once), `apiKeyPrefix` (string | null, masked prefix from DB).
  - "Copy Key" button: if `apiKeyRaw` exists, copy it. If not but `apiKeyPrefix` exists, generate new (Regenerate). If neither, generate new.
  - "Regenerate" button: calls `POST /api/keys/revoke` then `POST /api/keys`, shows raw inline.
  - Display: when `apiKeyRaw` is set, show full key in a `<input readOnly>` with copy button + "copy this now — you won't see it again" notice. When null, show `${prefix}••••` if prefix exists.
- **Old key invalidation:** `POST /api/keys` first updates all `api_keys` for `user_id` set `revoked_at = now()` where `revoked_at is null`, then inserts the new row.
- **Env compat kept:** `lib/supabase/env.ts` continues supporting legacy env names. Add dev warning when fallback used.
- **No mock data on Profile page:** Remove hardcoded mock `initialData` fallback. If Supabase is unavailable or user is unauthenticated, render empty state or redirect. Mock data in `initialData` hides bugs.
- **Security:** `API_KEY_PEPPER` only in server files (`lib/api-keys.ts`, `app/api/keys/**`). Never in client bundle. `grep` gate must pass.

---

## Files To Touch

### New files
- `prompts/profile-market-preferences.md` — this file
- `app/api/keys/revoke/route.ts` — `POST` revoke own key, session required

### Existing files to modify
- `app/api/keys/route.ts` — revoke old unrevoked keys before inserting new one on `POST`
- `components/profile/ProfileClient.tsx` — fix `handleSave` race, add skill add/remove UI, fix API key copy/regenerate UX, remove hardcoded fake key
- `app/(app)/profile/page.tsx` — remove mock `initialData` fallback, pass real empty state
- `components/layout/AppHeader.tsx` — add `Jobs` nav item, fix desktop nav to show Dashboard/Trends/Jobs/Gap Report
- `app/layout.tsx` — add shared `AppFooter`
- `components/layout/AppFooter.tsx` — adjust to be layout-level (no per-page duplication)
- `app/(app)/gap-report/page.tsx` — remove per-page footer (use layout)
- `app/(app)/trends/page.tsx` — remove per-page footer (use layout)
- `app/(app)/page.tsx` — remove per-page footer (use layout)

### Files to verify (no changes expected unless broken)
- `app/(app)/sign-in/page.tsx` — verify on-brand dark UI, magic-link only
- `lib/supabase/env.ts` — verify compat, add dev warning for legacy fallback
- `.env.example` — verify `API_KEY_PEPPER` documented, check `AI_MODEL` slash format consistency

---

## Requirements

### 1. API Routes
- `POST /api/keys/revoke` — requires active Supabase session (`getUser()` 401). Sets `revoked_at = now()` on caller's active key. Returns `{ ok: true }`.
- `POST /api/keys` — before inserting new key, revoke all existing unrevoked keys for `user_id`. Returns `{ raw, prefix, notice }` exactly once.
- `POST /api/profile/skills` — already exists, validates against `SKILLS_DICTIONARY`.
- `DELETE /api/profile/skills?skill=<canonical>` — already exists, restricts to `source = 'manual'`.

### 2. ProfileClient Fixes
- **`handleSave` race:** Use functional `setProfile` + explicit `monitored` variable captured at click time. Or send `monitored_sources` in the profile PUT body alongside other profile fields. The second fetch must send the correct toggled values, not stale closure.
- **Skill add:** Inline input in Card 3. On submit, call `POST /api/profile/skills` with `{ skill, years?, depth_tier? }`. Validate client-side against `SKILLS_DICTIONARY` for instant feedback; server re-validates.
- **Skill remove:** Add a small `×` or remove affordance on each skill chip. Call `DELETE /api/profile/skills?skill=<canonical>`. Only show remove for `source === 'manual'` skills; github_sync skills show a lock/badge and cannot be removed here.
- **API key copy/regenerate:** 
  - Replace `alert()` copy with inline `<input readOnly value={apiKeyRaw ?? ""}>` + clipboard copy button.
  - "Copy Key" behavior: if `apiKeyRaw` state is set, copy it. If `apiKeyPrefix` exists but `apiKeyRaw` is null, call `POST /api/keys` (regenerate). If neither, call `POST /api/keys` (first generate).
  - "Regenerate" button: calls `POST /api/keys/revoke` then `POST /api/keys`, sets `apiKeyRaw` to returned raw, clears old prefix.
  - When `apiKeyRaw` is null and `apiKeyPrefix` exists: show `${prefix}••••` with "Regenerate" button.
  - When neither exists: show `generate to view` placeholder.
- **Remove hardcoded fake key:** Replace `dp_live_994e28ff01cc561cc792b0042` with proper empty state.

### 3. Header / Layout
- **AppHeader:** Desktop nav renders all 4 items: `Dashboard · Trends · Jobs · Gap Report`. Profile is an icon link on the right (not a nav text item). Mobile hamburger shows same 4 + Profile.
- **AppFooter in layout:** Move footer to `app/layout.tsx`. Pages no longer render their own `<AppFooter>`. Footer `lastUpdate` comes from a shared server-side query or static string.

### 4. Profile Page Server Component
- Remove mock `initialData` fallback. Start with empty/defaults. If `supabase.auth.getUser()` returns no user, either redirect to `/sign-in` (preferred) or render empty state. Do not fabricate profile data in the server component.

---

## Security Checks (must pass before PR)
```bash
# Verify no private keys in client bundle
grep -r "SERVICE_ROLE" app/           # 0
grep -r "OPENAI_API_KEY" app/         # 0
grep -r "YOUTUBE_API_KEY" app/        # 0
grep -r "RESEND_API_KEY" app/         # 0
grep -r "GITHUB_TOKEN" app/           # 0
grep -r "API_KEY_PEPPER" app/         # 0 in app/components, allowed only in app/api/keys* and lib/api-keys.ts
grep -r "AI_MODEL" app/               # 0 in app/components, allowed only in server API routes

# Verify no direct provider SDKs in components
grep -r "@anthropic-ai/sdk" app/      # 0
grep -r "openai" app/components/      # 0
grep -r "resend" app/components/      # 0
grep -r "octokit" app/components/     # 0

# Verify every profile-scoped route calls getUser() server-side
# Manual check for: /api/profile, /api/profile/skills, /api/alert-preferences, /api/keys, /api/keys/revoke, /api/export

# Verify api_keys stores only hash + prefix, never plaintext
grep -rn "key_hash" app/api/keys/     # only hashing, no raw storage
grep -rn "console.log.*apiKey\|console.log.*rawKey\|console.log.*bearer" app/  # 0
```

---

## Acceptance Criteria
- `npx tsc --noEmit` 0 errors, `npx next build` 0 errors, `npx eslint .` 0 warnings in touched files
- Profile at 1280px matches `design/user-profile.png`: left PREFERENCE_PANELS rail with active teal state on Identity, CRAWLER HEARTBEAT card, six right-column cards (Identity, Career Target, Core Skill Stack, Ingestion Sources, Dispatch & Alerts, Readout Key), bottom Save Preferences bar. No mock data visible in UI.
- Header nav: `Dashboard · Trends · Jobs · Gap Report` + Live dot + profile icon. Active underline matches current page.
- Footer shared across all pages via layout, not duplicated per page.
- Core Skill Stack: can add a valid skill via inline input, see it appear as a chip. Can remove manually-added skills. GitHub-synced skills show distinct visual treatment and cannot be removed from profile.
- Career Target save: changing any field and clicking Save Preferences persists after reload.
- Sources toggles: toggle any source, save, reload — toggles persist. Dashboard counts unchanged (toggles only filter account view, per §5f.4).
- Alerts: toggle all three, set threshold, save — persist after reload.
- API Key: 
  - No key → clicking Copy Key generates one, shows full raw key inline with copy button + "copy this now — you won't see it again" notice.
  - Reload → shows `dp_live_a1b2••••` + Regenerate button.
  - Clicking Regenerate invalidates old key; old bearer token returns 401 on `GET /api/export`.
- `POST /api/keys/revoke` works and returns 401 without session.
- `POST /api/keys` revokes old unrevoked keys before inserting new one.
- `handleSave` monitored_sources sends the correct toggled values (no stale closure bug).
- Sign-in: email-only magic-link flow works, no password field.

---

## Manual Test Steps
1. `npm run dev` — open `/sign-in`, enter email, click Send — verify Supabase Auth magic link sent.
2. Click link in email → redirected to `/`, session established, `profiles` row auto-created.
3. Visit `/profile` — verify all six sections render, no mock data.
4. **Header:** verify nav shows `Dashboard · Trends · Jobs · Gap Report` with active underline on Profile. Profile icon links to `/profile`.
5. **Footer:** verify `Data refreshed daily · Last update: X · 4 sources` appears on all pages (Dashboard, Trends, Gap Report, Profile).
6. **Identity:** edit full_name, location, github_username. Save. Reload. Persisted.
7. **Career Target:** edit role, tier, comp range, equity toggle, contractor pref. Save. Reload. Persisted.
8. **Core Skill Stack:** 
   - Add a valid skill (e.g. `typescript`) via "+ Add Skill Vector" — appears as chip with `core`/`familiar`/`learning` selector.
   - Add invalid skill — rejected with error.
   - Remove a manual skill — disappears after save.
   - GitHub-synced skill shows dashed/outlined style and has no remove button.
   - Toggle Auto-Git Sync — persists.
9. **Sources:** toggle any source off, save, reload — toggles persist.
10. **Alerts:** toggle instant match, weekly digest, learning gap. Set threshold. Save. Reload. Persist.
11. **API Key:**
    - No key: click Copy Key → full raw key shown inline. Copy it.
    - Reload page → shows masked prefix + Regenerate button.
    - Click Regenerate → old key invalidated. New raw key shown inline.
    - Use old bearer token on `GET /api/export` → 401.
    - Use new bearer token → 200 with JSON.
12. **Save Preferences bar:** verify "Last saved: X" updates after save. "Discard" reverts unsaved changes.
13. `npx tsc --noEmit && npx next build && npx eslint .` — all green.
14. Run Security Checks block — all greps 0 (except allowed server files).
15. Responsive at 1280/768/375 — header collapses, profile sections stack, no overflow.

---

## Verify Before Marking Complete
> Verify that no API keys are exposed to the browser, and that every profile-scoped route validates the Supabase session or API key server-side, before marking complete.

- `grep` gates above (especially `API_KEY_PEPPER` only in server files, never logged)
- `window`, Network, source map contain no `SUPABASE_SERVICE_ROLE_KEY`, `API_KEY_PEPPER`, `CRON_SECRET`
- All profile-scoped routes (`/api/profile`, `/api/profile/skills`, `/api/alert-preferences`, `/api/keys`, `/api/keys/revoke`) call `supabase.auth.getUser()` and reject 401 before touching data
- `/api/export` accepts bearer OR session, never both silently, hashed comparison only
- `api_keys` stores only `key_hash` + `key_prefix`, never plaintext; Regenerate revokes immediately
- No mock data rendered in Profile UI when DB has real data
