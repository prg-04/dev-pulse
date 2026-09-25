# Implementation Prompt — GitHub OAuth sign-in (additive, magic-link untouched)

## Goal
Add "Continue with GitHub" as a second sign-in option on `app/sign-in/page.tsx`,
alongside the existing magic-link form. No changes to the OTP flow, no migrations,
no video-discovery/lesson-notes code. Supabase dashboard already has GitHub
Client ID/Secret configured — app-side wiring only.

## Skills read
- `supabase` (project skill `.agents/skills/supabase`): OAuth via
  `signInWithOAuth({ provider: 'github', options: { redirectTo } })`, callback
  handled by `exchangeCodeForSession` (provider-agnostic); RLS/security checklist
  (never expose service-role key, session validated server-side, RLS second layer).
- AGENTS.md §3 (identity model: magic-link session, `profiles` row via
  `on_auth_user_created` trigger, routes check `supabase.auth.getUser()`),
  §5 (sign-in page is the one un-referenced screen — minimal on-brand build allowed),
  §17 (CRON_SECRET vs session auth), §18 (security gate greps).

## Code inspected
- `app/sign-in/page.tsx` (109 lines, "use client"): `SignInInner` reads `?next`
  (default `/`), `status: idle|sending|sent|error` + `errorMsg` state, error shown
  as `<p className="text-xs text-[#F87171]">{errorMsg}</p>`; success as green
  `#22C55E` panel; submit button teal `#14B8A6` → hover `#2DD4BF`; card
  `max-w-[420px] bg-[#0F172A] border-[#1E293B]` on `bg-[#070A14]` page.
- `app/api/auth/callback/route.ts` (41 lines): reads `code` + `next`, creates
  `@supabase/ssr` server client from request cookies, calls
  `supabase.auth.exchangeCodeForSession(code)` — provider-agnostic, works for
  OTP and OAuth identically. No change needed. Redirects `origin+next`
  (dev) / `forwardedHost` (prod); failure → `/sign-in?error=auth_code_error`.
- `proxy.ts`: `/sign-in` and `/api/auth*` are public; all other pages redirect
  to `/sign-in?next=<pathname>` when no session. OAuth callback path already public.
- `app/api/profile/route.ts`: GET returns `{ profile, email }`; PUT upserts
  `profiles` with Zod-validated `github_username` (`max 39, ^[a-zA-Z0-9-]*$`).
- `components/layout/AppHeader.tsx`: avatar = `https://github.com/${githubUsername}.png`
  from `GET /api/profile` → `profile.github_username`, fallback = initials from
  `full_name`/email local-part (FIX 4 logic, already shipped).
- `supabase/migrations/002_rls_policies.sql:60-76`: `handle_new_user()` inserts
  `profiles(id)` only — does NOT read `new.raw_user_meta_data`. No existing hook
  populates `github_username` from OAuth metadata.
- Grep `user_metadata|preferred_username|avatar_url|signInWithOAuth` across
  `app/ lib/ components/` → zero matches. No existing OAuth or metadata code.

## Decisions and assumptions
1. Callback route needs NO change — `exchangeCodeForSession` is provider-agnostic.
   Reuse the exact `redirectTo: ${origin}/api/auth/callback?next=${encodeURIComponent(next)}`
   pattern from the OTP flow.
2. Layout: GitHub button ABOVE the email form with an "or" divider (both options
   visible, no toggle hiding magic-link). Matches task instruction.
3. Button style: full-width `rounded-lg border border-[#1E293B] bg-[#070A14]`
   with GitHub-mark SVG (inline, no new dep — `lucide-react` has a `Github` icon;
   confirm export name at build time, fallback inline SVG) + "Continue with GitHub"
   white text; hover `border-[#14B8A6]/50`. Loading state `oauthLoading` boolean,
   disabled while redirecting.
4. Error handling: reuse the SAME `status==="error"` + `errorMsg` pattern
   (`text-xs text-[#F87171]`). OAuth failures surface as thrown error from
   `signInWithOAuth` (immediate) — post-redirect failures land on
   `/sign-in?error=auth_code_error` from the callback route.
5. **Gap found (propose, don't implement yet):** `SignInInner` never reads the
   `?error=auth_code_error` query param the callback route already sets — so a
   user who cancels GitHub OAuth (or any exchange failure) lands on a clean
   sign-in form with NO error shown. Minimal additive fix: read `error` via the
   existing `useSearchParams` and map `auth_code_error` → "Sign-in was cancelled
   or the link expired. Please try again." using the same `errorMsg` display.
   This benefits BOTH flows (OTP exchange failures hit the same redirect) and
   touches no magic-link logic — but needs Evans sign-off since it's adjacent
   to existing code, not brand-new code.
6. Item 5 (GitHub username auto-populate): NO hook exists. `handle_new_user()`
   only inserts `profiles(id)`. Proposal (NOT implemented — needs confirmation):
   either (a) extend `handle_new_user()` to read `new.raw_user_meta_data ->
   'preferred_username'/'user_name'` and set `profiles.github_username` on
   insert (requires a NEW migration — task says don't touch migrations without
   confirming; also note `raw_user_meta_data` is user-editable per the supabase
   skill checklist, so treat as convenience prefill, not trust), or (b) a
   first-sign-in client/server lazy-backfill: after session established, if
   `profiles.github_username` is null and `user.user_metadata.preferred_username`
   exists, PUT it via the existing `/api/profile` route (no migration, respects
   RLS + Zod validation, user can still edit). Option (b) is recommended:
   no migration, uses the existing validated write path, and immediately feeds
   the AppHeader avatar (`github.com/{handle}.png`) without the user typing
   anything. Supabase GitHub provider maps: `user_metadata.user_name` (login),
   `preferred_username`, `avatar_url`, `full_name`/`name` — confirm exact keys
   against a real OAuth user at implementation time.

## Files you will touch
- `app/sign-in/page.tsx` — ADDITIVE ONLY: new `oauthLoading` state, `handleGitHub()`
  calling `signInWithOAuth`, new button + divider JSX above the email form.
  Do NOT modify `handleSubmit`, the `sent` panel, or any existing styling.
- Optionally (only if Evans approves decision 5): same file — read `error`
  search param, map to `errorMsg` display. ~5 lines.

## Files you will NOT touch
- `app/api/auth/callback/route.ts` (already provider-agnostic)
- Any file under `supabase/migrations/`
- Anything related to video-discovery / tutorial-lessons / LessonTheater
- `app/api/profile/route.ts`, `proxy.ts`, `AppHeader.tsx`

## Requirements
1. `supabase.auth.signInWithOAuth({ provider: 'github', options: { redirectTo:
   \`${origin}/api/auth/callback?next=${encodeURIComponent(next)}\` } })`
   from the browser client (`@/lib/supabase/client`), same `next` handling as OTP.
2. Both options visible simultaneously — no toggle, no tab hiding magic-link.
3. Dark-theme styling consistent with the card (teal `#14B8A6` accents on
   `#0F172A`/`#070A14`); GitHub icon + "Continue with GitHub".
4. OAuth immediate errors → same `text-xs text-[#F87171]` error line as email form.
5. TypeScript strict, no `any`; reuse existing `status`/`errorMsg` state shape
   (extend, don't restructure).

## Security checks (AGENTS.md §18 gate)
- No new env vars; only `NEXT_PUBLIC_SUPABASE_URL`/`ANON_KEY` already in the
  browser client. No `SERVICE_ROLE`, no provider secrets client-side.
- `grep -r "signInWithOAuth" app/ --include=*.tsx` → only `app/sign-in/page.tsx`.
- Callback route unchanged → session/cookie handling unchanged; RLS untouched.
- "Verify that no API keys are exposed to the browser, and that every
  profile-scoped route validates the Supabase session or API key server-side,
  before marking complete."

## Acceptance criteria
- [ ] Signed-out visit to `/sign-in` shows BOTH "Continue with GitHub" and the
      email magic-link form.
- [ ] Clicking GitHub redirects to `github.com/login/oauth/authorize` and, after
      authorizing, lands on the `next` target with an active session
      (Dashboard loads, no redirect loop).
- [ ] Cancelling on GitHub's page returns to `/sign-in?error=auth_code_error`
      (existing callback behavior); with decision-5 fix, a readable error shows.
- [ ] Magic-link flow byte-identical behavior (send → green "Check your email" panel).
- [ ] `npx tsc --noEmit` zero errors; `npx eslint` zero warnings in touched file;
      `npx next build` passes.
- [ ] Security gate greps (§18) all return zero matches for new code.

## Manual test steps
1. `pnpm dev`, incognito → `/jobs` → redirected to `/sign-in?next=/jobs`.
2. Click "Continue with GitHub" → GitHub authorize → expect landing on `/jobs`
   signed in; header avatar/initials render.
3. Sign out, click GitHub button, click Cancel on GitHub → back to
   `/sign-in?error=auth_code_error` (+ readable error if decision-5 approved).
4. Sign out, use email flow end-to-end → green panel → click link → signed in.
   Confirm unchanged.
5. Desktop 1280px + 375px: button full-width, divider legible, no overflow.
