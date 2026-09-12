# AGENTS.md

You are a **senior full-stack TypeScript engineer** building **DevPulse**, a real-time
developer job market intelligence dashboard. Your job is to understand the request,
read the relevant skills, inspect existing code, write a clear implementation prompt,
get approval, then implement. You do not start coding before approval.

---

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## 1. What You Are Building

DevPulse is a market intelligence dashboard for remote developers. It ingests real
job postings from public APIs daily, extracts and tracks skill mentions over time, and
uses AI to compare a user's current skill set against live market demand — showing
exactly what skills are rising, which are declining, and where the gaps are. It also
scores every ingested job against the user's own skill set so they can see which
roles are actually a fit before reading the full posting, and can keep that skill set
current automatically by syncing languages and topics from their public GitHub repos.

The problem it solves: Remote developers — particularly those in Africa, LATAM, and
Eastern Europe targeting US companies — make skill investment and CV decisions on
gut feel and outdated information. They cannot easily answer "Is TypeScript demand
actually rising?", "Which frameworks are companies hiring for right now?", "How does
my skill set compare to what's in demand this month?", or "Which of these 40 live
postings actually fit what I already know?" with real data. DevPulse answers all of
these with live data, not opinions, and keeps a persistent, verifiable account of the
developer's own profile so that data compounds over time instead of resetting on
every visit.

**Standout feature 1 — the Skill Gap Report.** A developer enters their target role
and current skills on the Skills page. DevPulse compares them against aggregated
demand data from real job postings ingested this month and returns a scored
breakdown — which skills are in the top tier of demand, which are declining, and
what's missing relative to the roles they want. The AI synthesizes the raw counts
into actionable language. This cannot be replicated by pasting data into a chatbot
because the underlying data is live, updated daily, and tracked over months.

**Standout feature 2 — Tutorial Search.** When the Skill Gap Report identifies a
missing skill, the user does not just get told "learn Kubernetes" — they get ranked
video cards pointing at the exact moment, in a real YouTube tutorial, where that
skill is taught. Click the card and the video plays inline, starting at that
timestamp. Timestamp resolution is two-stage: a video's own chapter markers (its
table of contents) are checked first, and only when no chapter is a good match does
the search fall back to the noisier transcript-chunk match (Section 12b, Section 15
Feature 3). Chapters are clean, human-authored labels, so a chapter hit is a tighter,
more trustworthy jump point than a transcript hit — this is why the player shows a
chapter badge (e.g. "Ch 2: Control Plane") whenever the result came from a chapter
match, and no badge when it fell back to a transcript match. This turns the gap
report from a diagnosis into the start of a learning session.

**Standout feature 3 — Live Job Feed with Stack Match.** The Jobs page is not a
static listing. Every ingested posting is scored in real time against the user's
own skill profile (deterministic overlap, not AI) and shown with a stack-match
percentage, so the user's feed is implicitly personalized without them ever
filling out a separate "preferences" form for it. The detail panel also presents
an AI-restructured summary of the raw posting — About / The Role / Requirements —
because postings arrive from four sources with wildly inconsistent formatting.

**Standout feature 4 — Auto-Git Sync.** A connected GitHub username is scanned
weekly against the user's public repositories. Languages and topics that match the
skill dictionary are folded into the user's persistent skill baseline automatically,
tagged distinctly from manually-entered skills, so the profile driving Jobs-page
matching and alerts stays current without the user re-typing it.

**Build nothing beyond this scope:**

- **Dashboard** — live leaderboard of top skills from this month's postings, source
  breakdown, biggest movers, embedded trend chart
- **Trends** — month-by-month demand history per skill, sourced from HackerNews
  archive, AI-generated trend summary
- **Jobs** — live ingested job postings feed, filterable, each scored with a
  deterministic stack-match percentage against the signed-in user's skills; job
  detail view with AI-restructured summary; save-role action
- **Skills** — the input step for the Skill Gap Report: target role/seniority and
  current skill list, feeds directly into the Gap Report
- **Gap Report** — the output of the Skills-page submission: market alignment
  score, strengths, gaps with matched tutorial videos (chapter-first, section 12b/15),
  rising/declining skills, AI recommendations
- **Profile & Market Preferences** — real authenticated account (Supabase Auth,
  magic-link email sign-in), identity fields, career target & compensation filter,
  persistent skill baseline (manual + GitHub-synced), per-account source toggles,
  alert/dispatch preferences, revocable API bearer key and JSON export
- **Daily job ingestion pipeline** — serverless cron pulling postings, extracting
  skill mentions
- **Weekly tutorial indexing pipeline** — serverless cron indexing YouTube
  tutorials for skills prioritised by real gap-report activity, extracting both
  chapter markers and transcript chunks per video
- **Weekly GitHub skill sync pipeline** — serverless cron reading a connected
  account's public repo languages/topics and folding matches into their baseline
- **Alert dispatch pipeline** — serverless cron/trigger sending instant match
  alerts, weekly digests, and learning-gap notifications via email

Do not build: password-based login, third-party OAuth beyond what's specified for
GitHub reads, payment flows, browser extensions, job application tracking, private
GitHub repo access, or any feature that requires scraping pages behind a login wall.

---

## 2. The Non-Negotiable Architecture Rule

**The browser never holds API keys. The browser never calls the AI provider directly.
The browser never calls ingestion, indexing, sync, or dispatch endpoints directly.**

All AI calls go through Next.js API routes (serverless functions). All ingestion,
indexing, sync, and alert-dispatch logic runs server-side via Vercel Cron.
Environment variables prefixed with `NEXT_PUBLIC_` are visible to the browser —
only the Supabase anon key and Supabase URL are safe as public. Every other key,
including `RESEND_API_KEY`, `YOUTUBE_API_KEY`, `GITHUB_TOKEN`, and
`SUPABASE_SERVICE_ROLE_KEY`, stays server-side only.

If you are about to put a non-public key into a client component or a
`NEXT_PUBLIC_` variable, stop. That is wrong. Move the call to an API route.

**Exception, explicitly allowed:** the YouTube thumbnail URL pattern
(`img.youtube.com/vi/{video_id}/hqdefault.jpg`) and the YouTube embed iframe
(`youtube.com/embed/{video_id}`) are public YouTube endpoints designed for direct
browser use. They require no API key and are safe to reference directly in client
components. Do not confuse this with the YouTube Data API itself — `search.list`
and any other Data API call requires `YOUTUBE_API_KEY` and must stay server-side.

---

## 3. Identity Model — Read This Before Building Any Profile Feature

**This section replaces the earlier "no authentication" approach.** DevPulse uses
real Supabase Auth accounts. This decision was made explicitly because the Profile
page requires things a durable anonymous token cannot responsibly provide: sending
email to a verified address, reading a user's GitHub username on their behalf on a
recurring schedule, and issuing a revocable API key tied to a real account the user
can recover if they lose a device.

**The specific auth method is Supabase Auth with magic-link (passwordless email
OTP) sign-in — not email/password.** This is a deliberate choice, not a shortcut:

1. It matches the reference design exactly — the Profile screen has no password
   field, only a full name and email.
2. It removes an entire category of build work (password reset flows, breach
   monitoring, credential storage hygiene) that has no product value here.
3. It still produces a real `auth.users` row with a verified email address, a
   real session, and a real `auth.uid()` — everything RLS and email dispatch need.

**How it works end to end:**

1. User enters their email on a minimal sign-in screen (not in the provided
   mockups — build a simple, on-brand version consistent with the rest of the
   dark UI; this is one of the few places you're allowed to design without a
   reference, since no sign-in screen exists in the reference set).
2. Supabase Auth sends a magic link via its built-in email delivery for the
   sign-in step itself (this is separate from Resend, which is used only for the
   three product alert types in Section 12c, never for auth emails).
3. Clicking the link establishes a Supabase session (cookie-based, via
   `@supabase/ssr`). The session — not a client-generated token — is what every
   subsequent request relies on.
4. A `profiles` row is created automatically on first sign-in (Postgres trigger
   on `auth.users` insert — see Section 11) with `id = auth.users.id`. All other
   profile-scoped tables key off this same `id` via foreign key.
5. Every API route touching profile-scoped data reads the session server-side
   (`supabase.auth.getUser()` inside the route handler, using the server client
   bound to request cookies — never the anon client with a trusted client-sent
   ID) and uses `auth.uid()`. Row Level Security policies on every profile-scoped
   table additionally enforce `auth.uid() = user_id` as a second, independent
   layer — a route bug does not by itself leak another user's data.
6. The "Bearer Token (read-only)" shown on the Profile page is a **separate,
   purpose-built API key** — not the session and not a password. See Section 11's
   `api_keys` table and Section 12e. It exists so a signed-in user can call
   `GET /api/export` from a script without re-authenticating a browser session
   each time. It is read-only: it can fetch the calling account's own data, and
   nothing else.

**What this means for every route you write:** any API route touching `profiles`,
`user_skills`, `user_skill_profiles`, `alert_preferences`, `saved_jobs`, or
`api_keys` must call `supabase.auth.getUser()` server-side and reject with 401 if
there is no valid session — except when the request instead presents a valid
`Authorization: Bearer dp_live_...` API key (Section 12e), which is checked against
the hashed value in `api_keys`, never against a plaintext comparison. A route
accepts at most one of these two identity methods per request; never fall back
silently from one to the other.

---

## 4. How to Work

Follow this loop for every request without exception:

**Step 1 — Read AGENTS.md**
Read the full file before touching any code. Understand the architecture rule
in Section 2 and the identity model in Section 3 before writing a single line.

**Step 2 — Read the relevant installed skills**
Read every skill that applies to the task. Skills are ground truth for this
project's stack — they override your memory of older API versions.

**Step 3 — Inspect existing code**
Check the current state of the relevant files before proposing changes.

**Step 4 — Write an implementation prompt**
Save it in `prompts/` covering: goal, skills read, code inspected, decisions
and assumptions, files you will touch, requirements, security checks,
acceptance criteria, and manual test steps. Include:
_"Verify that no API keys are exposed to the browser, and that every
profile-scoped route validates the Supabase session or API key server-side,
before marking complete."_

**Step 5 — Ask for approval**
Post the prompt path and ask: "Is this good to execute?" Wait for a yes.

**Step 6 — Build only after approval**
Never write code before the prompt is approved unless Evans explicitly skips
the prompt step.

**Step 7 — Run all checks (Section 18)**
Report real output. Never claim a check passed without running it.

**Step 8 — Close with a short report**

- **What I did**: One-line bullets of completed work
- **Test**: Numbered steps to verify in the browser
- **Needs your attention**: Decisions or follow-ups. Say "None" if none.

The workflow is:
**PLAN → APPROVE → BUILD → CHECK → REPORT**

---

## 5. Pages and UI Rules

You do not design UI. Evans provides desktop reference images. You implement
them exactly — layout, spacing, typography, color, component states, hover
behavior. Match the provided reference exactly at desktop (1280px). No mobile
reference exists for any page: adapt sensibly (stack columns, simplify grids,
collapse nav) while keeping desktop exact. Reuse existing Tailwind/shadcn
patterns before adding new ones. When a reference image exists, it is the
source of truth — do not improve it. The sign-in screen (Section 3) is the one
exception where no reference exists — build a minimal, on-brand version.

The product has seven pages, sharing one persistent top nav
(`Dashboard · Trends · Jobs · Skills · Gap Report`, with a profile icon on the
right that opens the Profile page) plus the unstyled-reference sign-in screen.
The nav's live/offline indicator and the footer's "Data refreshed daily · Last
update: X · 4 sources" line are shared across every page — build them once as a
layout-level component, not per-page. Every page except sign-in requires an
active Supabase session; an unauthenticated visitor is redirected to sign-in.

### 5a. Dashboard

Top-level stat cards (jobs ingested, skills tracked, top skill this month, last
update), a ranked Top 50 skills table with relative-volume bars and MoM delta,
a sources breakdown panel, a biggest-movers panel, and an embedded multi-skill
trend chart with an AI-generated one-line summary above it. Reads only from
`skill_demand_snapshots` and `job_postings` source counts — never raw
aggregation queries at request time.

### 5b. Trends

A dedicated, larger version of the trend chart: skill picker (max 5 skills),
3M/6M/12M range toggle, hover tooltip showing exact values per skill at a given
month, per-skill summary cards below the chart (current count, MoM delta, peak
month, a normalised "volume" score), and the same AI Trend Intelligence summary
block used on the Dashboard. This page and the Dashboard's embedded chart must
read from the same underlying query — do not build two divergent trend
endpoints.

### 5c. Jobs

The live ingested job-postings feed. Search bar, source filter chips, an
archetype filter, a sort control (Profile Match / Latest Ingested / Comp High
to Low), and a two-column layout: scrollable list of job cards on the left,
detail panel for the selected job on the right. Each card shows company, title,
comp range, timezone/location, a handful of extracted skill chips (with a
distinct visual treatment for skills that are a declared gap for the signed-in
user — the reference shows this as an orange "!gap" chip), and the stack-match
percentage (Section 13). The detail panel shows an AI-restructured version of
the posting (About the Company / The Role / What You'll Do / Requirements —
Section 15 Feature 4) plus a "DevPulse Market Intelligence Extraction" block
restating the match score and which specific skills matched. Any comp/liquidity/
contractor-type fields that were not parseable from the source posting (Section
9's honest-data-gap note) render as "Not disclosed," never fabricated or left
blank without explanation. "Save Role" writes to `saved_jobs`. "Apply Directly"
links out to the original posting's external URL — do not attempt to build an
in-app application flow.

### 5d. Skills

The entry point for a Skill Gap Report. Target role/seniority selector, a
skill-tag input (type-and-enter or comma-separated, with quick-add chips for
currently in-demand skills pulled from `skill_demand_snapshots`), a "minimum 1
skill" validation state, an "include tutorial matching" checkbox (default
checked), and an "Analyse my skills" submit button. On submit, this calls
`POST /api/gap-report` (Section 15) and navigates to the Gap Report page with
the result. This page pre-fills from the signed-in user's `user_skills` and
saved `target_role` if present, but the submission itself is a point-in-time
snapshot — editing skills here for one report does not silently overwrite the
persistent baseline. Only an explicit save action on the Profile page (or a
GitHub sync run) changes the baseline.

### 5e. Gap Report

The output view. Left column: the skill list that was submitted, with a
re-analyse action. Right column, top to bottom: overall Market Alignment score
(Section 13) with a progress bar against a target baseline and a "top tier"
threshold marker; a Strengths panel (skills that matched high-demand data);
a Skills to Consider panel — this is where Tutorial Search surfaces, with
clickable skill chips that expand into the `TutorialCard` list from Section 6,
including the inline video player showing a chapter badge (e.g. "Ch 2: Control
Plane") whenever the result is chapter-anchored (Section 12b, Section 15
Feature 3); a Rising in Demand panel; a Declining in Demand panel; and a
Recommendations panel with numbered, AI-generated next-step text. Every panel's
numbers must trace back to a real query result — see Section 15's grounding
constraint, which applies here without exception.

### 5f. Profile & Market Preferences

Six stacked sections, each independently editable and saved to the signed-in
user's row(s) (see Section 11):

1. **Identity & Terminal Handle** — full name, verified email (read-only —
   changing the sign-in email is a Supabase Auth account-management action, not
   a plain form field; do not build inline email editing without going through
   Supabase's own re-verification flow), location/timezone, and a GitHub
   username field. Entering or changing the GitHub username does not sync
   immediately — it takes effect on the next weekly sync run (Section 12d);
   show a "Next sync: <date>" hint, not a live "syncing now" state.
2. **Career Target & Compensation Filter** — target role archetype, company
   liquidity/maturity tier, desired comp floor–ceiling, an "include equity"
   toggle, and a contractor-classification preference (e.g. W8-BEN vs
   Deel/EOR). This section is filter _criteria_ the user is telling DevPulse
   about themselves — it is not itself an AI feature and requires no AI call.
3. **Core Skill Stack** — the persistent skill baseline (`user_skills` table)
   used by the Jobs page's stack-match scoring and by alert matching. Each
   skill shows its `source` distinctly (a manually-added skill looks different
   from a GitHub-synced one — follow the reference's visual distinction). A
   separate "active gap expansion" sub-list marks skills the user is currently
   learning (sourced from their most recent Gap Report's flagged gaps) — this
   is display-only, populated from `gap_report_events`, not independently
   editable here. An "Auto-Git Sync" toggle turns the weekly sync on/off for
   this account without disconnecting the stored GitHub username.
4. **Ingestion Sources & Crawlers** — per-account toggles for which of the four
   global data sources count toward _this account's_ Jobs feed and alerts.
   **This does not control the actual daily ingestion cron** — all four sources
   are always ingested globally regardless of any account's toggle state. The
   toggle only filters what that account sees and gets alerted on. Do not wire
   this toggle to the ingestion pipeline itself.
5. **Market Intelligence Dispatch & Alerts** — the three alert types from
   Section 12c, each with its own on/off toggle.
6. **Readout Key & JSON Export** — generates/displays/revokes the API bearer
   key described in Section 3 and Section 11's `api_keys` table. The full key
   is shown in plaintext exactly once, at generation time, in a copyable field
   with a clear "copy this now — you won't see it again" notice. Every
   subsequent page load shows only a masked prefix (e.g. `dp_live_a1b2••••`)
   and a "Regenerate" action that invalidates the old key. Do not build a way
   to redisplay a previously generated key in full — the server never stores
   it in a form that would allow that.

---

## 6. TutorialCard Component

Thumbnail (`img.youtube.com/vi/{video_id}/hqdefault.jpg`), title, channel name,
view count, and a "Starts at MM:SS" label. When the underlying match is
chapter-anchored (Section 12b, Section 15 Feature 3), also show a small chapter
badge next to the timestamp (e.g. "Ch 2: Control Plane" — see the reference's
in-player "CH 2: CONTROL PLANE" indicator); omit the badge entirely when the
match fell back to a transcript chunk, since there is no clean chapter label to
show in that case. On click, expands an inline `<iframe>` embed
(`youtube.com/embed/{video_id}?start={start_seconds}&autoplay=1`) in place —
do not navigate away from the page it was opened on. The expanded player keeps
showing the same chapter badge (if present) as an overlay while playing, per
the reference. Used on the Gap Report page inside the Skills to Consider panel.
No standalone reference image exists for this component in isolation; follow
the layout shown in the Gap Report reference (thumbnail-left, metadata-right,
expanding player with the chapter overlay) and existing shadcn `Card`
conventions for anything not visible in that reference.

---

## 7. Skills and Documentation to Install

Run these commands from the project root before starting any feature work.
Skills are the authoritative source for each technology — read them before
writing code that touches their domain.

### Core Stack Skills (install all before starting)

```bash
# Next.js — official skill, version-matched to the framework
npx skills add vercel/next.js

# Vercel AI SDK — official skill from the vercel/ai repo
npx skills add vercel/ai

# Supabase — official skill covering Auth, Database, Realtime, Edge Functions.
# This is the same skill for both the Postgres/data work AND the Supabase Auth
# (magic-link, session handling, @supabase/ssr) work in Section 3 — read it
# before touching sign-in, session validation, or RLS policies.
npx skills add supabase/agent-skills --skill supabase

# Supabase Postgres best practices — query design, schema, performance, RLS
npx skills add supabase/agent-skills --skill supabase-postgres-best-practices

# React 19 best practices — 62 rules across 8 categories
npx skills add vercel-labs/agent-skills --skill vercel-react-best-practices

# Frontend design patterns — UI conventions for this environment
npx impeccable install
```

### UI Components and Charts

```bash
# shadcn/ui — initialise the component system (run once at project setup)
npx shadcn@latest init

# Add the chart component (built on Recharts, Tailwind v4 compatible)
npx shadcn@latest add chart

# Add dashboard shell components as needed during feature work
# Examples: npx shadcn@latest add card badge skeleton table tabs progress
# Do not add components speculatively — only add what the current task needs
```

### Animation and UI Skills

```bash
# Framer Motion — animations, transitions, chart entrance effects
npx skills add patricio0312rev/skills --skill framer-motion-animator
```

### Security

```bash
# Secure coding — input sanitisation, server/client boundary enforcement
npx skills add securityreviewai/secure-coding-skill
```

### Tutorial Search dependencies

```bash
# Transcript retrieval for public YouTube auto-captions — no OAuth required
npm install youtube-transcript

# pgvector Supabase extension is enabled via SQL migration, not npm —
# see Section 11. No client library needed beyond the existing Supabase client.
# Used for BOTH the transcript-chunk embeddings and the chapter-label
# embeddings (Section 11, Section 12b) — one extension, two embedded tables.
```

### Alert dispatch dependencies

```bash
# Resend — transactional email for the three product alert types (instant
# match, weekly digest, learning-gap dispatch). Server-side only, never
# imported in a client component. This is distinct from Supabase Auth's own
# email delivery, which handles magic-link sign-in emails separately —
# do not route auth emails through Resend or vice versa.
npm install resend
```

### GitHub sync dependencies

```bash
# Octokit — official GitHub REST API client. Used only in the weekly GitHub
# sync cron route, authenticated with a single server-owned GITHUB_TOKEN
# (personal access token, public-repo read scope only) — not per-user OAuth,
# because the data being read (public repo languages/topics) requires no
# individual user authorization. See Section 12d.
npm install octokit
```

### When to use each skill

| Skill                                     | Use when                                                                                         |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `vercel/next.js`                          | Writing App Router pages, API routes, middleware, caching                                        |
| `vercel/ai`                               | Implementing any AI call — generateText, streamText, structured output, embeddings               |
| `supabase`                                | Any Supabase task — schema, **Auth/magic-link/session handling**, RLS, realtime, edge functions  |
| `supabase-postgres-best-practices`        | Writing or reviewing any SQL query or schema change, including RLS policies and pgvector indexes |
| `vercel-react-best-practices`             | Writing React components, hooks, server vs client decisions                                      |
| `impeccable`                              | Building new UI components or reviewing layout decisions                                         |
| `framer-motion-animator`                  | Adding any animation — charts, transitions, counters                                             |
| `secure-coding-skill`                     | Before any PR — verify no key leakage, validate session/API-key checks, verify API-key hashing   |
| `shadcn/ui` (via `npx shadcn@latest add`) | Adding any dashboard component — run the add command, do not copy from docs manually             |

### Additional documentation (read before touching the relevant feature)

- **Next.js App Router**: Auto-generated `AGENTS.md` in project root after
  `npx @next/codemod@canary agents-md` — read before writing any route
- **Vercel AI SDK**: `https://sdk.vercel.ai/docs` — provider setup, streaming,
  structured output, tool calling, embeddings
- **Supabase**: `https://supabase.com/docs` — Auth (magic link, `@supabase/ssr`
  session handling), RLS policies, cron, realtime, pgvector
- **HackerNews Algolia API**: `https://hn.algolia.com/api` — search, items,
  rate limits (10,000 req/hr, no key required)
- **Himalayas API**: `https://himalayas.app/api` — remote jobs, pagination,
  filters (no auth required, max 20/request)
- **RemoteJobs.org API**: `https://remotejobs.org/api/v1/docs` — jobs by
  category, pagination (no auth required)
- **YouTube Data API v3**: `https://developers.google.com/youtube/v3/docs` —
  `search.list` quota cost, `videos.list` for duration/view count/description
  (chapter markers, where present, are read from the description text —
  Section 12b), API key auth
- **GitHub REST API**: `https://docs.github.com/en/rest` — `GET /users/{username}/repos`,
  `GET /repos/{owner}/{repo}/languages`, `GET /repos/{owner}/{repo}/topics`,
  authenticated rate limits (5,000 req/hr with a PAT vs 60 req/hr unauthenticated)
- **shadcn/ui Charts**: `https://ui.shadcn.com/docs/components/chart` — chart
  component API, Tailwind v4 CSS variable setup, BarChart, LineChart, AreaChart
- **shadcn/ui Components**: `https://ui.shadcn.com/docs/components` — read the
  specific component page before adding any component to the project
- **Resend**: `https://resend.com/docs` — sending API, rate limits on the free
  tier, templates. Read before implementing any part of Section 12c.

---

## 8. App Responsibilities and Boundaries

| Layer                               | Responsibility                                                                                                                                                                                    |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Browser (client components)**     | Render UI, rely on the Supabase session cookie for auth state, call safe Next.js API routes, display cached data, embed YouTube iframe player directly                                            |
| **Next.js API routes (serverless)** | Validate the Supabase session or API key, call AI provider via Vercel AI SDK, query Supabase, return safe responses                                                                               |
| **Vercel Cron (serverless)**        | Daily job ingestion; weekly tutorial indexing (chapters + transcript chunks); weekly GitHub sync; alert dispatch checks — all fetch/compute server-side and write to Supabase or send email       |
| **Supabase**                        | Auth (accounts, sessions), all ingested job data, skill counts, trend history, profiles, skill baselines, tutorial chapters and transcript chunks, alert preferences, saved jobs, hashed API keys |
| **Vercel AI SDK**                   | Provider-agnostic AI calls and embeddings — model is set by environment variable                                                                                                                  |
| **Resend**                          | Outbound email for the three _product_ alert types in Section 12c — server-side only. Not used for auth emails (Supabase Auth handles those).                                                     |
| **Octokit / GitHub REST API**       | Read-only fetch of a connected account's public repo languages/topics, server-side only, weekly cron only                                                                                         |

**What the browser must never do:**

- Call the AI provider directly
- Call ingestion, indexing, sync, or alert-dispatch endpoints directly
- Call the YouTube Data API directly (search, video metadata)
- Call the GitHub REST API directly
- Call Resend directly
- Hold `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, `YOUTUBE_API_KEY`,
  `RESEND_API_KEY`, `GITHUB_TOKEN`, `API_KEY_PEPPER`, or any other private key
- Write to Supabase using the service role key (only cron/admin routes do this;
  regular user-facing routes use the session-scoped client so RLS applies)
- Trust a profile-scoped request without the server validating the Supabase
  session (or, where explicitly allowed, a hashed API key) first

**What is safe as `NEXT_PUBLIC_`:**

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

**What is safe to reference directly in client components without an API route,**
because it is a public YouTube-hosted endpoint requiring no key:

- Thumbnail images: `https://img.youtube.com/vi/{video_id}/hqdefault.jpg`
- Embed player: `https://www.youtube.com/embed/{video_id}?start={start_seconds}`

Everything else is server-side only. No exceptions.

---

## 9. Tech Stack

**Use:**

- **Next.js 16+ with App Router** — pages, layouts, API routes, middleware
- **TypeScript** — strict mode throughout, no `any`
- **Tailwind CSS v4** — utility-first styling
- **Framer Motion** — animations and transitions (not GSAP for this project)
- **Vercel AI SDK (`ai` package)** — `generateText`, `streamText`, `embed`/`embedMany`
  for both tutorial chapter-label embeddings and transcript-chunk embeddings
  (Section 11, Section 12b), structured output with Zod schemas; provider set
  by env var
- **Supabase** — Postgres database with the `pgvector` extension enabled, real
  Supabase Auth (magic-link/email OTP, `@supabase/ssr` for session handling),
  Row Level Security enforced on every user-scoped table, Supabase client for
  server-side queries
- **Vercel Cron** — daily job ingestion, weekly tutorial indexing, weekly GitHub
  sync, and alert dispatch checks, all via `vercel.json` cron config
- **Zod** — schema validation on AI structured output and API route inputs
- **shadcn/ui Charts** — chart components built on top of Recharts, styled
  with CSS variables that map cleanly to Tailwind v4 tokens. Install with
  `npx shadcn@latest add chart`. Do not use Tremor — it has known compatibility
  issues with Tailwind v4 and the project maintaining it is unstable. Do not
  use raw Recharts directly — use it only through the shadcn/ui chart wrapper.
- **shadcn/ui** — dashboard shell components: cards, badges, stat blocks,
  skeleton loaders, form elements, tabs, progress bars. Install components
  individually with `npx shadcn@latest add <component>`. You own the generated
  code — it is not a black-box dependency.
- **`youtube-transcript`** — pulls public auto-generated captions for a video
  without requiring OAuth. Used only in the tutorial indexer cron, never client-side.
- **Resend** — transactional email for the three product alert types. Used only
  in the alert dispatch cron/route, never client-side, and never for auth email.
- **Octokit** — GitHub REST API client, authenticated with a single server-owned
  PAT. Used only in the weekly GitHub sync cron route, never client-side.

**Do not use:**

- Custom AI provider SDKs directly (no direct `@anthropic-ai/sdk` imports in
  components — always go through Vercel AI SDK)
- Any scraping library that violates the data sources' terms of service
- Prisma (use Supabase client directly)
- Any page builder or UI framework beyond Tailwind + Framer Motion + shadcn/ui
- `any` type in TypeScript
- The YouTube Data API from anywhere except the tutorial indexer cron route
- The GitHub REST API from anywhere except the GitHub sync cron route
- Resend from anywhere except the alert dispatch cron/route
- A third-party auth library (NextAuth, Clerk) — Supabase Auth is the single
  auth provider; do not introduce a second one
- Per-user GitHub OAuth — the sync only ever reads public data via a single
  server-owned PAT; do not build a GitHub "Connect Account" OAuth flow for this
- A custom video player — playback is always the provider's own YouTube iframe
  embed; DevPulse only ever computes and passes the `start` second

**AI provider configuration:**

```
AI_MODEL=ollama:llama3.1     # free local development
AI_MODEL=groq:llama-3.3-70b  # free cloud testing
AI_MODEL=anthropic:claude-sonnet-4-6  # production
```

The Vercel AI SDK resolves the provider from the model string. Swapping providers
is a one-line env var change. No application code changes. The same provider
configuration is used for both the chapter-label embeddings and the
transcript-chunk embeddings — confirm the configured model supports an
embeddings endpoint before relying on it in production.

**Honest data-availability note — read before building any comp/liquidity/
contractor filtering:** none of the four job-posting sources reliably provide
structured company funding stage, liquidity tier, or contractor-classification
data. Where the Career Target & Compensation Filter (Section 5f, item 2) or the
Jobs page display these fields, they are populated by **best-effort keyword
extraction from the raw posting text** (e.g. matching "Series B", "Seed",
"Deel", "W8-BEN" as literal substrings), not a structured company database.
When extraction finds nothing, the field is `null` and the UI shows "Not
disclosed" — it is never guessed, inferred by AI, or left ambiguously blank.
Comp range follows the same rule where a source doesn't supply it structurally.
The same honesty rule applies to chapters (Section 12b): not every video has
them, and a missing chapter is a `null`/absent row, never a fabricated one.

---

## 10. Data Sources

All sources below are public and require no per-user authentication. The
YouTube Data API requires a free server-owned API key (no OAuth for the calls
this project makes). The GitHub REST API requires a free server-owned personal
access token for the higher authenticated rate limit, not OAuth. Resend and
Supabase Auth's email delivery both require API keys but are outbound
providers, not data sources.

| Source                   | Endpoint                               | Auth               | Rate limit                                 | What it provides                                                                                      |
| ------------------------ | -------------------------------------- | ------------------ | ------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| HackerNews Algolia       | `hn.algolia.com/api/v1`                | None               | 10k req/hr                                 | Monthly "Who is Hiring" threads going back years — 400–900 posts per thread                           |
| Himalayas                | `himalayas.app/jobs/api`               | None               | Max 20/req                                 | Remote jobs filterable by skill, seniority, timezone, country                                         |
| RemoteJobs.org           | `remotejobs.org/api/v1/jobs`           | None               | Public                                     | Remote jobs by category, with salary data                                                             |
| Remotive                 | `remotive.com/api/remote-jobs`         | None               | Public                                     | Remote tech jobs by category                                                                          |
| YouTube Data API v3      | `googleapis.com/youtube/v3`            | API key            | 10,000 units/day (search.list = 100 units) | Video search by skill, metadata (views, duration, publish date, description text for chapter parsing) |
| YouTube (public, no API) | `img.youtube.com`, `youtube.com/embed` | None               | N/A                                        | Thumbnails and inline player embeds                                                                   |
| GitHub REST API          | `api.github.com`                       | PAT (server-owned) | 5,000 req/hr authenticated                 | Public repo list, languages, topics for a given username                                              |

**HackerNews is the primary source for trend history.** Because the "Who is Hiring"
threads go back years and are publicly archived via the Algolia API, this is the
only source that enables month-by-month historical skill demand tracking. The other
three job-posting sources feed the current-month leaderboard and the Jobs page feed.

**Ingestion runs once daily via Vercel Cron.** It does not run on user requests
and is not affected by any account's source toggles (Section 5f, item 4) — those
toggles filter what an account _sees_, not what gets ingested. All four job-posting
APIs are called server-side in the cron handler regardless of any account's
preferences. Results are written to Supabase. The dashboard, trends, and jobs
pages all read from Supabase — none of them call the external APIs directly from
the browser.

**Tutorial indexing runs once weekly via a separate Vercel Cron.** See Section 12b
for the full rotation strategy and the chapter-first / transcript-fallback
extraction — it does not attempt to index every skill every week, because the
YouTube API quota does not allow it.

**GitHub skill sync runs once weekly via a separate Vercel Cron.** See Section 12d.

---

## 11. Data Model

All tables live in Supabase Postgres. Define these before writing any feature code.
The `pgvector` extension must be enabled before creating `tutorial_chapters` or
`tutorial_chunks`:

```sql
create extension if not exists vector;
```

### `job_postings`

Stores every raw job posting ingested. Deduplicated by `external_id`.

```sql
create table job_postings (
  id            uuid primary key default gen_random_uuid(),
  external_id   text not null unique,   -- source's own ID
  source        text not null,          -- 'hackernews' | 'himalayas' | 'remotejobs' | 'remotive'
  company       text,
  title         text,
  description   text,
  comp_min      integer,
  comp_max      integer,
  comp_currency text default 'USD',
  liquidity_tier text,                  -- best-effort keyword extraction; null if not found
  contractor_type text,                 -- best-effort keyword extraction; null if not found
  location_text text,                   -- free-text timezone/location as posted
  external_url  text,                   -- for the Jobs page "Apply Directly" link
  posted_at     timestamptz,
  ingested_at   timestamptz default now()
);
```

### `skill_mentions`

One row per skill per job posting. Populated by the ingestion pipeline after
parsing the job description. This table is also what the Jobs-page stack-match
score reads against per posting (Section 13).

```sql
create table skill_mentions (
  id          uuid primary key default gen_random_uuid(),
  job_id      uuid references job_postings(id) on delete cascade,
  skill       text not null,          -- normalised lowercase: 'typescript', 'next.js'
  month       text not null,          -- 'YYYY-MM' — derived from posted_at
  source      text not null
);

create index on skill_mentions(skill, month);
create index on skill_mentions(job_id);
```

### `skill_demand_snapshots`

Pre-aggregated monthly counts per skill. Populated by the ingestion pipeline
after upsert. The dashboard, trends, and market-alignment scoring all read from
this table — never run raw aggregations on `skill_mentions` in a user request.

```sql
create table skill_demand_snapshots (
  id            uuid primary key default gen_random_uuid(),
  skill         text not null,
  month         text not null,        -- 'YYYY-MM'
  mention_count integer not null default 0,
  source        text not null,
  unique(skill, month, source)
);
```

### `profiles`

One row per Supabase Auth account, created automatically by a trigger on
`auth.users` insert. This is where the Profile page's Identity, Career Target,
and Ingestion Sources sections read and write. **RLS: `auth.uid() = id`.**

```sql
create table profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  full_name       text,
  location_text   text,
  timezone        text,
  github_username text,                -- just the username, not a full URL
  auto_git_sync   boolean not null default false,
  target_role     text,                -- e.g. 'Senior Full-Stack Engineer / Distributed Systems'
  target_tier     text,                -- e.g. 'Tier-1 US Remote & Seed-to-Series B'
  comp_floor      integer,
  comp_ceiling    integer,
  comp_currency   text default 'USD',
  include_equity  boolean default false,
  contractor_pref text,                -- e.g. 'W8-BEN' | 'Deel/EOR'
  monitored_sources text[] not null default '{hackernews,himalayas,remotejobs,remotive}',
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

alter table profiles enable row level security;
create policy "profiles_self_access" on profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

-- Trigger: create a profiles row automatically on signup
create function public.handle_new_user() returns trigger as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
```

### `user_skills`

The persistent skill baseline used by Jobs-page stack-match scoring and alert
matching. Replaces a flat text array so each skill can carry its own years/depth
and be attributed to either a manual entry or a GitHub sync run. **RLS:
`auth.uid() = user_id`.**

```sql
create table user_skills (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles(id) on delete cascade,
  skill       text not null,
  years       numeric,
  depth_tier  text,                  -- 'core' | 'familiar' | 'learning'
  source      text not null default 'manual',  -- 'manual' | 'github_sync'
  updated_at  timestamptz default now(),
  unique(user_id, skill)
);

create index on user_skills(user_id);

alter table user_skills enable row level security;
create policy "user_skills_self_access" on user_skills
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

### `user_skill_profiles`

One row per Skill Gap Report submission from the Skills page. Distinct from
`user_skills` — this is a point-in-time snapshot, not the persistent baseline.
See Section 5d for why these are kept separate. **RLS: `auth.uid() = user_id`.**

```sql
create table user_skill_profiles (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles(id) on delete cascade,
  target_role text,
  skills      text[] not null,      -- ['typescript', 'next.js', 'react']
  created_at  timestamptz default now()
);

create index on user_skill_profiles(user_id, created_at desc);

alter table user_skill_profiles enable row level security;
create policy "user_skill_profiles_self_access" on user_skill_profiles
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

### `saved_jobs`

Jobs saved from the Jobs page via "Save Role." **RLS: `auth.uid() = user_id`.**

```sql
create table saved_jobs (
  user_id  uuid not null references profiles(id) on delete cascade,
  job_id   uuid not null references job_postings(id) on delete cascade,
  saved_at timestamptz default now(),
  primary key (user_id, job_id)
);

alter table saved_jobs enable row level security;
create policy "saved_jobs_self_access" on saved_jobs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

### `alert_preferences`

One row per account. Backs the three toggles in Section 5f, item 5. **RLS:
`auth.uid() = user_id`.**

```sql
create table alert_preferences (
  user_id                 uuid primary key references profiles(id) on delete cascade,
  instant_match_alert     boolean not null default false,
  instant_match_threshold integer not null default 90,   -- stack-match % floor to trigger
  weekly_digest           boolean not null default false,
  learning_gap_dispatch   boolean not null default false,
  delivery_method         text not null default 'email',  -- 'email' | 'webhook'
  webhook_url             text,
  updated_at              timestamptz default now()
);

alter table alert_preferences enable row level security;
create policy "alert_preferences_self_access" on alert_preferences
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

### `alert_dispatch_log`

Audit log of every email/webhook actually sent. Prevents duplicate sends and
gives Evans a way to verify the dispatch pipeline is working. Written only by
server-side cron routes using the service role key.

```sql
create table alert_dispatch_log (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references profiles(id) on delete cascade,
  alert_type   text not null,        -- 'instant_match' | 'weekly_digest' | 'learning_gap'
  reference_id text,                 -- job_id for instant_match, skill for learning_gap, null for digest
  sent_at      timestamptz default now(),
  status       text not null,        -- 'sent' | 'failed'
  error        text
);

create index on alert_dispatch_log(user_id, alert_type, sent_at desc);
```

### `api_keys`

Revocable bearer keys for `GET /api/export` (Section 5f, item 6; Section 3;
Section 12e). **Only the hash is stored — never the plaintext key.**

```sql
create table api_keys (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles(id) on delete cascade,
  key_prefix  text not null,          -- first 12 chars shown to the user, e.g. 'dp_live_a1b2'
  key_hash    text not null,          -- sha256(raw_key + API_KEY_PEPPER), hex-encoded
  created_at  timestamptz default now(),
  last_used_at timestamptz,
  revoked_at  timestamptz
);

create index on api_keys(key_prefix);

alter table api_keys enable row level security;
create policy "api_keys_self_access" on api_keys
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

### `github_sync_runs`

Audit log of every weekly GitHub sync cron execution, one row per account
processed that run. See Section 12d.

```sql
create table github_sync_runs (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references profiles(id) on delete cascade,
  github_username text not null,
  started_at     timestamptz default now(),
  completed_at   timestamptz,
  status         text,               -- 'success' | 'failed' | 'skipped_no_username' | 'skipped_sync_off'
  skills_upserted integer default 0,
  error          text
);

create index on github_sync_runs(user_id, started_at desc);
```

### `ingestion_runs`

Audit log of every daily job-ingestion cron execution. Used to verify the
pipeline is running and to debug failures.

```sql
create table ingestion_runs (
  id            uuid primary key default gen_random_uuid(),
  started_at    timestamptz default now(),
  completed_at  timestamptz,
  status        text,                  -- 'running' | 'success' | 'failed'
  jobs_ingested integer default 0,
  error         text
);
```

### `gap_report_events`

One row per skill flagged as a gap in a completed Skill Gap Report. This is the
signal the tutorial indexer's rotation strategy prioritises against, and also
what populates the "active gap expansion" list on the Profile page (Section 5f,
item 3). **RLS: `auth.uid() = user_id`.**

```sql
create table gap_report_events (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references profiles(id) on delete cascade,
  skill      text not null,
  created_at timestamptz default now()
);

create index on gap_report_events(skill, created_at);
create index on gap_report_events(user_id, created_at desc);

alter table gap_report_events enable row level security;
create policy "gap_report_events_self_access" on gap_report_events
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

### `skill_index_status`

One row per skill known to the system. Tracks when it was last indexed for
tutorials and how much rotation priority it currently has. Read and updated by
the weekly tutorial indexer to decide which skills to process this run.

```sql
create table skill_index_status (
  skill            text primary key,
  last_indexed_at  timestamptz,
  gap_mentions_30d integer not null default 0,  -- refreshed each run from gap_report_events
  total_chunks     integer not null default 0,
  total_chapters   integer not null default 0,   -- videos-with-chapters count for this skill
  last_run_status  text,                         -- 'success' | 'failed' | 'skipped_no_results'
  last_error       text
);
```

### `tutorial_chapters`

One row per chapter marker on an indexed video — its table of contents. This is
the primary, cleaner lookup: chapter labels are short, human-authored, and far
less noisy than transcript text, so a chapter match is preferred whenever one
is available (Section 12b, Section 15 Feature 3). Not every video has chapters
— a video with none simply has no rows here, and search falls back to
`tutorial_chunks` for it (Section 15 Feature 3). A chapter is not tied to a
single `skill_tag`, because the same table of contents serves every skill the
video happens to be indexed under (via `tutorial_chunks.video_id`).

```sql
create table tutorial_chapters (
  id              uuid primary key default gen_random_uuid(),
  video_id        text not null,
  start_seconds   integer not null,
  label           text not null,          -- e.g. 'Control Plane', 'Setting Up Ingress'
  label_embedding vector(1536) not null,
  indexed_at      timestamptz default now(),
  unique(video_id, start_seconds)
);

create index on tutorial_chapters using ivfflat (label_embedding vector_cosine_ops)
  with (lists = 100);

create index on tutorial_chapters(video_id);
```

### `tutorial_chunks`

One row per indexed transcript chunk. This is the noisier backstop the
similarity query falls back to only when a video has no chapters, or none of
its chapters are a close enough match to the requested skill (Section 15
Feature 3).

```sql
create table tutorial_chunks (
  id            uuid primary key default gen_random_uuid(),
  video_id      text not null,
  video_title   text not null,
  channel_name  text not null,
  view_count    integer,
  published_at  timestamptz,
  skill_tag     text not null,         -- which skill this chunk was indexed under
  start_seconds integer not null,
  chunk_text    text not null,
  embedding     vector(1536) not null,
  indexed_at    timestamptz default now(),
  unique(video_id, start_seconds, skill_tag)
);

create index on tutorial_chunks using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

create index on tutorial_chunks(skill_tag);
create index on tutorial_chunks(video_id);
```

---

## 12. The Ingestion, Indexing, Sync, and Dispatch Pipelines

There are five independent scheduled pipelines. All are offline work — they
run on a schedule, not on user requests. The dashboard, trends, jobs, and gap
report pages all read pre-computed results from Supabase, never live external
APIs or live AI calls triggered by a page load.

### 12a. Daily Job Ingestion

**Pipeline steps in order:**

1. Create an `ingestion_runs` record with `status: 'running'`
2. Call all four job-posting data source APIs in parallel
3. Deduplicate against existing `external_id` values in `job_postings`
4. For each new posting: extract skill mentions from title + description using a
   normalised skill dictionary (see Section 14), and extract comp range /
   external URL / liquidity tier / contractor type where the source or the
   posting text provides them (Section 9's honest-data-gap note — extraction
   only, never fabrication)
5. Insert new rows into `job_postings` and `skill_mentions`
6. Upsert aggregated counts into `skill_demand_snapshots` (increment if row exists)
7. Update the `ingestion_runs` record with `status: 'success'` and `jobs_ingested` count
8. On any error: update `ingestion_runs` with `status: 'failed'` and the error message

**This pipeline must never:**

- Be triggered by a user request
- Call the AI provider (skill extraction uses a dictionary match, not AI)
- Be filtered by any account's `monitored_sources` toggle — always ingest all four
- Expose its endpoint without the Vercel Cron authentication header check

### 12b. Weekly Tutorial Indexing

Runs on a separate cron schedule from daily job ingestion (e.g. Sunday 02:00 UTC,
configured independently in `vercel.json`).

**Quota constraint driving the design:** the YouTube Data API allows 10,000
quota units/day by default, and `search.list` costs 100 units per call. A full
run across every skill in the dictionary would exceed quota if the dictionary
is larger than roughly 90–100 skills. The indexer therefore processes a
**rotating subset** each week rather than the whole dictionary.

**Selecting this week's subset — priority order:**

1. Refresh `skill_index_status.gap_mentions_30d` for every skill by counting
   rows in `gap_report_events` from the last 30 days, grouped by skill.
2. Rank skills by a combined score: primarily `gap_mentions_30d` (skills users
   are actually being told they're missing), with `last_indexed_at` ascending
   as a tiebreaker (skills never indexed, or indexed longest ago, move up).
3. Take the top N skills where N is set by a quota budget constant
   (e.g. `WEEKLY_INDEX_BUDGET = 40`, well under the 90–100 ceiling, leaving
   headroom for retries and `videos.list` calls used for filtering).
4. Any skill with zero `gap_mentions_30d` and no prior index (`last_indexed_at`
   is null) still gets a small floor allocation so the catalogue doesn't
   permanently ignore skills nobody has hit yet — reserve a few of the N slots
   for oldest-never-indexed skills specifically.

**Per-skill indexing steps:**

1. `search.list(q: "{skill} tutorial", type: video, order: relevance, publishedAfter: <2 years ago>)`
   — retrieve a candidate list
2. `videos.list` on the candidates to get `viewCount`, `duration`, `channelTitle`,
   and the full `description` text (needed for chapter parsing in step 4)
3. Filter: `viewCount > 10000`, duration > 3 minutes (skip YouTube Shorts),
   drop anything already indexed for this skill this run
4. **Extract chapters first, per video, before touching the transcript.**
   YouTube does not expose authored chapters as a structured API field, but
   almost every creator who defines them lists them in the video description
   as timestamp lines (`0:00 Intro`, `2:14 Setting up the cluster`, ...).
   Parse the description with a timestamp-line regex
   (`^\s*(\d{1,2}:)?\d{1,2}:\d{2}\s+.+$`), requiring at least three matching
   lines in ascending time order for the video to count as chaptered — one or
   two stray timestamp-looking lines in the middle of prose is not a table of
   contents and should be discarded rather than misread as one. A video with
   no qualifying block simply has no chapters; do not invent one.
5. For each parsed chapter: embed the label text via the Vercel AI SDK
   `embed`/`embedMany` call and upsert into `tutorial_chapters`
   (on conflict `video_id, start_seconds` do update)
6. For each surviving video: pull the transcript via `youtube-transcript`
7. If no transcript is available (captions disabled), skip that video for the
   transcript-chunk step only — a video can still keep its extracted chapters
   even if its transcript is unavailable; do not fail the whole skill's run
   over one video
8. Chunk the transcript into ~60-second windows by cumulative caption timestamps
9. Embed each chunk via the Vercel AI SDK `embed`/`embedMany` call
10. Upsert into `tutorial_chunks` (on conflict `video_id, start_seconds, skill_tag`
    do update, so re-indexing a still-relevant video doesn't duplicate)
11. Update `skill_index_status` for this skill: `last_indexed_at = now()`,
    `total_chunks`, `total_chapters`, `last_run_status`

**Why chapters are extracted separately and first:** they are the same "table
of contents first, transcript as backstop" split described in Section 15
Feature 3. Chapter labels are short, clean, and human-written, so a chapter
match points at a tighter, more trustworthy moment than any transcript match
can. Treat chapter extraction as a first-class step, not an afterthought
bolted onto transcript chunking — a video that ends up with good chapters but
no usable transcript is still valuable; one with a good transcript but no
chapters just falls back to chunk-only search for that video.

**This pipeline must never:**

- Be triggered by a user request
- Call the AI provider for anything except embeddings (chapter labels and
  transcript chunks) — chapter _parsing_ is regex over description text, not
  an AI call
- Call the YouTube Data API from anywhere except this cron route
- Attempt every skill in the dictionary in a single run — always respect
  `WEEKLY_INDEX_BUDGET`
- Fail the entire run because one video has no transcript, no parseable
  chapters, or one skill returns zero results — log and continue
- Fabricate a chapter for a video whose description has no qualifying
  timestamp block

### 12c. Alert Dispatch

Three distinct alert types, each independently toggled per account in
`alert_preferences`. All three send through Resend, server-side only, and are
distinct from Supabase Auth's own magic-link emails.

**Instant Match Alert** — runs immediately after the daily job ingestion cron
completes (chained, not a separate schedule). For every account with
`instant_match_alert = true`: compute the stack-match percentage (Section 13b)
for every job ingested in _this run only_ against that account's `user_skills`,
filtered to that account's `monitored_sources`. If any job scores at or above
`instant_match_threshold`, and no `alert_dispatch_log` row already exists for
that `(user_id, 'instant_match', job_id)` combination, send one email via
Resend to the account's verified auth email and log it.

**Weekly Market Delta Digest** — separate weekly cron (e.g. Monday 06:00 UTC).
For every account with `weekly_digest = true`: pull the current week's biggest
movers from `skill_demand_snapshots` (same query the Dashboard's "Biggest
movers" panel uses), filtered to the account's `monitored_sources`, and send
a summary email. One send per account per week — check `alert_dispatch_log`
for an existing `'weekly_digest'` entry in the last 7 days before sending.

**Curated Learning Gap Dispatch** — runs immediately after the weekly tutorial
indexing cron completes (chained, not a separate schedule). For every account
with `learning_gap_dispatch = true`: check whether any skill in that account's
recent `gap_report_events` (last 30 days) was indexed in _this_ tutorial run
(`skill_index_status.last_indexed_at` matches this run's timestamp). If so,
send an email with the newly available tutorial cards for that skill and log
it against `(user_id, 'learning_gap', skill)`.

**This pipeline must never:**

- Send an alert to an account with no verified email — in practice every
  Supabase Auth account has one (magic-link sign-in requires it), so this is
  primarily a defensive check, not an expected path
- Send a duplicate for the same `(user_id, alert_type, reference_id)` —
  always check `alert_dispatch_log` first
- Be triggered by a user request
- Invent copy about market data — the email body pulls the same grounded
  numbers as Section 15's AI features and is subject to the same constraint if
  AI is used to draft the email text

### 12d. Weekly GitHub Skill Sync

Runs on its own weekly cron schedule (e.g. Sunday 04:00 UTC — offset from
tutorial indexing so the two don't compete for compute at the same instant).
Reads only **public** repository data via a single server-owned GitHub PAT
(`GITHUB_TOKEN`) — there is no per-user OAuth, because nothing this pipeline
reads requires the repo owner's authorization.

**Pipeline steps in order:**

1. Select every `profiles` row where `auto_git_sync = true` and
   `github_username` is not null
2. For each: create a `github_sync_runs` record with `status: null` (running)
3. `GET /users/{github_username}/repos` (public repos only, paginated)
4. If the username doesn't resolve (404), mark
   `status: 'skipped_no_username'` and continue to the next account — do not
   fail the whole cron run over one bad username
5. For each repo: `GET /repos/{owner}/{repo}/languages` and
   `GET /repos/{owner}/{repo}/topics`
6. Normalise every returned language and topic against the skill dictionary
   (Section 14) — anything not in the dictionary is discarded, same rule as
   job-posting extraction
7. Upsert matches into `user_skills` with `source = 'github_sync'`: if a skill
   already exists for this user with `source = 'manual'`, do not overwrite it
   with a `github_sync` row — a manually-declared skill always takes precedence
   over an inferred one for the same skill name. Use
   `on conflict (user_id, skill) do update set ... where user_skills.source = 'github_sync'`
   (or an equivalent explicit check) so this precedence rule is enforced at
   the database level, not just in application code
8. Update `github_sync_runs` with `status: 'success'` and `skills_upserted` count
9. On any error for that account: `status: 'failed'`, log the error, continue
   to the next account

**This pipeline must never:**

- Be triggered by a user request
- Attempt to read a private repository — the PAT should be scoped to public
  read access only; if a broader-scoped token is ever used by mistake, the
  pipeline still must not request private repo data
- Fail the entire run because one account's username is invalid or one
  account's API calls error — log per-account and continue
- Overwrite a manually-entered skill with a GitHub-inferred one for the same
  skill name

### 12e. API Key Issuance and the Export Endpoint

Not a scheduled pipeline, but documented here because it's part of the same
"who can touch what data, server-side only" picture as the four pipelines above.

**Issuing a key** (`POST /api/keys`, requires an active Supabase session):

1. Generate a random key: `dp_live_` + 32 hex characters
2. Compute `key_hash = sha256(raw_key + API_KEY_PEPPER)`
3. Insert into `api_keys` with the hash and a `key_prefix` (first 12 chars)
4. Return the full raw key to the caller **once** — it is never stored or
   retrievable again after this response

**Using a key** (`GET /api/export`, `Authorization: Bearer dp_live_...`):

1. Hash the presented key the same way and look up `api_keys` by `key_hash`
2. Reject if no match, or if `revoked_at` is not null
3. Update `last_used_at`
4. Return the calling account's own data as JSON — `profiles`, `user_skills`,
   recent `user_skill_profiles`, `saved_jobs`. Never another account's data,
   and never write access — this endpoint is `GET`-only

**Revoking a key** (`POST /api/keys/revoke`, requires an active Supabase session):
Sets `revoked_at = now()` on the caller's own key. A revoked key must fail the
lookup in step 2 above immediately, not on some delayed cache expiry.

---

## 13. Deterministic Matching — Not AI

Two distinct percentages appear across the product. **Neither is AI-generated.**
Both are plain arithmetic over real rows, computed server-side, so they are
exactly reproducible and defensible in a live demo. Keep them in one shared
utility (`lib/matching.ts`) — do not let the Jobs page and the Gap Report page
drift into two different formulas for what looks like the same kind of number.

### 13a. Stack Match % (per job posting — Jobs page, job detail panel)

For a given job and a given skill list (the signed-in user's `user_skills`, or
a Gap-Report snapshot's `skills` when viewed in that context):

```
stack_match_pct = round(
  (count of skill_mentions.skill for this job_id that appear in the skill list)
  / (total distinct skill_mentions.skill for this job_id)
  * 100
)
```

If a job has zero extracted `skill_mentions` rows, its stack-match is undefined
— show "Not enough data" rather than 0%, since 0% implies a real mismatch, not
missing extraction.

### 13b. Market Alignment % (Gap Report — overall score)

For a given skill list against the current month's top 50 skills by
`mention_count` in `skill_demand_snapshots`:

```
market_alignment_pct = round(
  (sum of mention_count for skills in the list that are in the top 50)
  / (sum of mention_count for all top 50 skills)
  * 100
)
```

This is a demand-weighted coverage score, not a simple overlap count — matching
`typescript` (highest-volume skill) contributes far more than matching a
niche skill further down the top 50. This weighting is what makes the Gap
Report's "Strengths" panel meaningfully different from a plain checklist.

**Both formulas are pure SQL/TypeScript arithmetic against Supabase data.**
Neither calls the AI provider. The AI's job (Section 15) is to explain these
numbers in prose after they're computed — never to produce the numbers
themselves.

---

## 14. Skill Normalisation

Skill extraction for job postings and GitHub repo languages/topics uses
exact-match and alias matching against a hardcoded dictionary in
`lib/skills-dictionary.ts`. It does not use AI — AI is expensive per-call and
unnecessary for this task. The same dictionary is the source of the skill list
the tutorial indexer rotates through, and the only valid vocabulary for
`user_skills`, Skills-page submissions, and stack-match scoring — every system
must draw from this one dictionary so a skill typed on the Skills page reliably
matches the same skill extracted from a job posting or a GitHub repo.

**Normalisation rules:**

- All skills stored lowercase: `'typescript'`, not `'TypeScript'`
- Framework names normalised: `'next.js'`, `'react'`, `'vue'`, `'angular'`
- Tool aliases collapsed: `'node'` and `'node.js'` both map to `'node.js'`
- Language aliases collapsed: `'ts'` maps to `'typescript'`
- GitHub language names normalised the same way: GitHub's own language
  detection returns names like `"TypeScript"`, `"Jupyter Notebook"` — pass
  these through the same lowercase/alias table, and discard anything
  ("Jupyter Notebook", "Dockerfile" as a language entry, etc.) that isn't a
  real dictionary entry rather than inventing a mapping for it

**The skill dictionary is the single source of truth for what counts as a skill.**
If a term is not in the dictionary, it is not counted in job postings, it cannot
be added on the Skills page (the tag input should validate against the
dictionary, with the quick-add chips sourced from it directly), it is silently
dropped during GitHub sync, and it is never a `skill_tag` used by the tutorial
indexer or search — this keeps every system consistent by construction.

---

## 15. The AI Analysis Layer

AI is used in exactly four places. Nowhere else. Matching percentages (Section 13) are explicitly not on this list — they are deterministic arithmetic.

### Feature 1 — Skill Gap Report

**Trigger:** User submits the Skills page form.

**Server-side API route:** `POST /api/gap-report`

**What the route does:**

1. Requires an active Supabase session; reads `target_role` and `skills` from
   the request body (validated with Zod against the skill dictionary)
2. Inserts a `user_skill_profiles` snapshot row for `auth.uid()`
3. Computes `market_alignment_pct` (Section 13b) and per-skill strengths/gaps
   deterministically
4. Queries historical trend for the submitted skills (last 6 months) for the
   rising/declining panels
5. Calls `generateText` via Vercel AI SDK with a structured prompt containing
   the raw counts and the already-computed alignment score, asking only for
   prose synthesis and the numbered recommendations — not for any number
6. Returns structured JSON: `{ market_alignment_pct, strengths, gaps, rising,
declining, recommendations }`
7. For each skill in `gaps`, inserts a row into `gap_report_events` tagged with
   `auth.uid()` — this feeds both the tutorial indexer's rotation priority
   (Section 12b) and the Profile page's "active gap expansion" display
   (Section 5f, item 3)

**What AI does:** Synthesises already-computed numbers into plain-language
analysis and generates the recommendations text. It does not generate the
alignment score, the strengths/gaps split, or any count — those come from
Section 13's deterministic queries. The AI cannot invent numbers. It can only
interpret numbers that are passed to it.

**System prompt constraint:**

```
You are analysing real job market data. Only reference skills and counts
that are explicitly provided in the context. Do not invent demand figures,
trends, or job market statistics. If data is missing, say so.
```

### Feature 2 — Trend summary text

**Trigger:** Dashboard or Trends page loads chart data.

**What AI does:** Generates a one-paragraph plain-language summary of the
most notable trend visible in the chart data (e.g. "TypeScript demand rose
34% between January and August, driven primarily by full-stack roles.").
Uses the same grounding constraint — only references numbers from the data
passed to it. Both pages call the same underlying summary generation so the
Dashboard and Trends page never show contradictory summaries for the same data.

### Feature 3 — Tutorial matching

**Trigger:** Gap report has returned and the UI requests tutorial cards for a
specific gap skill (either eagerly for all gaps, or lazily per-skill on click
— an implementation prompt should confirm which with Evans before building).

**Server-side API route:** `POST /api/tutorial-search`

**What the route does — timestamp resolution is two-stage, chapters first:**

1. Reads `skill` from the request body (validated with Zod against the skill
   dictionary — reject anything not a known skill)
2. Calls the Vercel AI SDK `embed` function on the skill name (optionally
   combined with short context from the gap report, e.g. the user's stated
   target role, if that improves match quality — start with just the skill
   name and iterate)
3. **Stage 1 — chapters.** Find the set of `video_id`s already indexed under
   `skill_tag = skill` (via `tutorial_chunks`), then run a pgvector cosine
   similarity query against `tutorial_chapters.label_embedding` restricted to
   those video ids, ordered by distance. A chapter is accepted as a match only
   below a fixed distance threshold — do not accept a weak chapter match just
   because it's the closest one available for that video.
4. **Stage 2 — transcript fallback.** For any video that has no accepted
   chapter match from Stage 1 (either because it has no chapter rows at all,
   or none clear the threshold), run the existing pgvector cosine similarity
   query against `tutorial_chunks` filtered by `skill_tag = skill`, ordered by
   distance.
5. Merge the two result sets, capped at 5 total, preferring chapter-anchored
   results over chunk-only results for the same video when both exist,
   ordered by similarity distance within each tier.
6. Returns the matching results: `video_id`, `video_title`, `channel_name`,
   `start_seconds`, `view_count`, and — only for Stage-1 results — the
   matched `chapter_label`, so the UI can render the chapter badge described
   in Section 6. Chunk-only results omit `chapter_label` entirely; the UI
   must not fabricate one.

**What AI does here:** Embedding only — no generation, at either stage. This
is retrieval, not synthesis, so there is no risk of invented statistics; every
result returned is a literal row already sitting in `tutorial_chapters` or
`tutorial_chunks` from the indexer (Section 12b). If no chapters and no chunks
exist yet for a requested skill (not yet indexed, or indexed with zero
results), the route returns an empty array and the UI falls back to a plain
"no tutorials indexed yet for this skill" state — never a live YouTube API
call from a user request.

### Feature 4 — Job posting restructuring

**Trigger:** User opens a job's detail panel on the Jobs page.

**Server-side API route:** `GET /api/jobs/{id}/summary` (cache the result
against the job row after first generation — do not regenerate on every view
of the same posting)

**What the route does:**

1. Reads the raw `description` text for the given `job_id`
2. Calls `generateText` via Vercel AI SDK, asking it to restructure the raw
   text into four sections — About the Company, The Role, What You'll Do,
   Requirements & Qualifications — using only sentences/facts present in the
   source text
3. Returns the four sections as structured JSON (Zod-validated shape)

**What AI does here:** Reformatting and extraction only — it may reorder,
summarise, and clean up formatting from the messy raw text the four sources
provide, but it must not add claims about the company, the role, or the
requirements that are not present in the original posting text.

**System prompt constraint:**

```
You are reformatting a real job posting into readable sections. Use only
information present in the provided text. Do not add company facts, role
details, or requirements that are not explicitly stated in the source text.
If a section has no relevant content in the source, omit that section rather
than inventing content for it.
```

AI is not used for: job ingestion, skill extraction, GitHub language/topic
normalisation, stack-match or market-alignment scoring, chart rendering,
tutorial video discovery/filtering (that's vector-similarity retrieval plus
regex chapter parsing, not generative AI), alert-trigger decisions (those are
threshold checks against Section 13's numbers), or any real-time user
interaction beyond the four features above.

---

## 16. Decisions Already Made

Build to these unless Evans explicitly changes them:

- **Real authentication via Supabase Auth, magic-link email sign-in — no
  password field, no third-party OAuth login.** This replaces the earlier
  anonymous profile-token approach entirely. See Section 3. Every user-scoped
  table has RLS enforcing `auth.uid() = user_id` (or `= id` for `profiles`)
  as an independent layer beneath the API routes' own session checks.
- **Tutorial timestamp resolution is chapter-first, transcript-fallback.**
  A video's own chapter markers (parsed from its description, embedded, and
  matched first) are checked before ever falling back to the noisier
  transcript-chunk similarity search. See Section 12b and Section 15 Feature 3. A result only carries a chapter badge (Section 6) when it genuinely came
  from a chapter match — never synthesized to make a chunk-only result look
  more precise than it is.
- **GitHub sync uses a single server-owned PAT, not per-user OAuth.** The data
  being read (public repo languages/topics) requires no individual user
  authorization, so building a GitHub OAuth "Connect Account" flow would be
  unnecessary complexity for this product. See Section 12d. A manually-entered
  skill always takes precedence over a GitHub-inferred one for the same skill.
- **The API bearer key (Section 5f item 6, Section 12e) is separate from the
  Supabase session and never displayed in full more than once.** Only its
  hash is stored. Regenerating invalidates the prior key immediately.
- **Company funding/liquidity tier and contractor-classification fields are
  best-effort text extraction, never AI-inferred and never fabricated.** See
  Section 9. Missing data renders as "Not disclosed." The same honesty rule
  applies to chapters: a video without a parseable chapter block gets no
  `tutorial_chapters` rows, never an invented one.
- **AI is provider-agnostic via Vercel AI SDK.** Ollama locally, Groq for
  staging, any model in production. No direct provider SDK imports in components.
  Confirm the production model supports embeddings before relying on Feature 3.
- **Skill extraction is dictionary-based, not AI, across all three sources of
  skills** — job postings, GitHub sync, and Skills-page input. The pipeline
  uses string matching, not LLM calls per item. One dictionary serves all three.
- **Stack-match and market-alignment percentages are deterministic, never
  AI-generated.** See Section 13. AI only narrates numbers that are already
  computed. Job-posting restructuring (Feature 4) is reformatting, not scoring.
- **Job ingestion is cron-only, daily, and unaffected by any account's source
  toggles.** Toggles filter what an account sees, never what gets ingested.
- **Tutorial indexing is cron-only, weekly, and rotates a subset of skills
  by gap-report priority — it does not attempt every skill every week.**
  See Section 12b. This is a deliberate quota-driven design, not a shortcut
  to fix later. Chapter extraction and transcript chunking both happen in
  this same run, chapters first.
- **GitHub sync is cron-only, weekly, opt-in per account via `auto_git_sync`,**
  and processes accounts independently — one account's failure never blocks
  another's run.
- **Tutorial discovery is search-based, not a fixed curated channel list.**
  Quality is enforced through view-count, duration, and recency filters at
  index time, not a channel whitelist.
- **Tutorial videos play embedded inline via iframe on the site,** not as a
  redirect to YouTube, and the player surfaces a chapter overlay whenever the
  matched result is chapter-anchored (Section 6).
- **Alert dispatch is cron/chained-trigger only, never a user-request
  side-effect,** and sends only through Resend to the account's verified auth
  email — never through a separate, unverified "alert email" field. All three
  alert types check `alert_dispatch_log` before sending to avoid duplicates.
- **Dashboard, Trends, and Jobs all read from Supabase snapshots/extracted
  tables, not raw job tables or live external APIs.** Never run `COUNT(*)`
  aggregations in a user request. The same applies to tutorial search — it
  reads `tutorial_chapters` and `tutorial_chunks`, never calls the YouTube API
  live.
- **HackerNews is the only source for historical trend data.** The other three
  job-posting sources feed current-month leaderboard and the Jobs feed only.
- **The Skills page and the Profile page's Core Skill Stack are intentionally
  separate.** Skills-page submissions are point-in-time snapshots for a single
  Gap Report; `user_skills` is persistent and drives Jobs-page and alert
  matching. Skills-page pre-fills from the baseline but never silently
  overwrites it.
- **Framer Motion for all animations.** GSAP is not used on this project.
- **shadcn/ui Charts for all data visualisation.** Built on Recharts, styled
  with Tailwind v4 CSS variables. Tremor is not used. Raw Recharts is not used
  directly. This decision is final.
- **TypeScript strict mode throughout.** No `any`. No implicit `any`.
- **Zod for all external data validation.** API route inputs and AI structured
  outputs are validated with Zod schemas before use.

---

## 17. Things That Will Trip You Up

- **HackerNews "Who is Hiring" is one thread per month, not a jobs API.**
  To get job postings, search the Algolia API for the thread title
  (`"Ask HN: Who is hiring?"`) then fetch all top-level comments from the
  thread using `hn.algolia.com/api/v1/items/{id}`. The comments are the job
  postings. Do not hit the Firebase API — it requires recursive calls per item.

- **Himalayas caps responses at 20 per request.** Use cursor pagination.
  Do not assume one request returns all jobs.

- **YouTube does not expose authored chapters as a structured API field.**
  There is no `chapters` array on `videos.list`. Chapters have to be parsed
  from the video's own `description` text, where creators list them as
  timestamp lines. Require at least three ascending timestamp lines before
  treating a video as chaptered — a lone `0:00` in an unrelated sentence is
  not a table of contents. A video that fails this check simply gets zero
  `tutorial_chapters` rows and search falls back to its transcript chunks;
  this is an expected, common outcome, not a bug to fix.

- **A chapter match and a chunk match for the same skill can disagree on
  which second to jump to.** When both exist for a video, always prefer the
  chapter (Section 15 Feature 3, Stage 1) — it is the creator's own
  segmentation and is far less likely to land mid-sentence than a fixed
  60-second transcript window.

- **Supabase anon key ≠ service role key.** The anon key respects RLS and
  should be paired with the calling user's session for user-facing routes.
  The service role key bypasses RLS entirely — restrict it to cron/admin
  routes (ingestion, indexing, GitHub sync, alert dispatch) that legitimately
  need to write across all accounts. Never use the service role key in a
  route that's reachable from an authenticated but otherwise-ordinary user
  request.

- **Vercel Cron requires authentication.** Add a `CRON_SECRET` environment
  variable and verify it in every cron route handler, including the tutorial
  indexer, GitHub sync, and alert dispatch:

  ```typescript
  if (
    req.headers.get("Authorization") !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return new Response("Unauthorized", { status: 401 });
  }
  ```

- **`CRON_SECRET` and Supabase session auth are different checks for
  different callers.** Cron routes check `CRON_SECRET` because no user is
  present — they authenticate as the _system_. User-facing routes
  (Profile save, Skills submission, saved jobs, alert preferences, key
  issuance) check the Supabase session, or a hashed API key where Section
  12e explicitly allows it. A route needs exactly one of these checks, never
  both, and never neither.

- **Do not build RLS as the only defence, and do not build API-route checks
  as the only defence.** Both layers are required. A route bug that forgets
  to filter by `auth.uid()` is still safe if RLS is correctly applied to the
  table; RLS misconfiguration is still caught if the route independently
  validates the session and only queries the calling user's own rows.

- **Skill dictionary misses matter.** If a skill appears in job postings, a
  GitHub repo's languages, or Skills-page input but is not in
  `lib/skills-dictionary.ts`, it is silently ignored. Review the dictionary
  after the first ingestion and first GitHub sync run against real data.

- **`skill_demand_snapshots` must be upserted, not inserted.** The cron runs
  daily, not once. Use `ON CONFLICT (skill, month, source) DO UPDATE SET
mention_count = mention_count + EXCLUDED.mention_count`.

- **Stack-match and market-alignment must share one utility function.**
  If the Jobs page and Gap Report page each implement their own version of
  "percentage of matching skills," they will silently drift apart the first
  time either one is tweaked. Put both formulas in `lib/matching.ts` and
  import from there everywhere.

- **A job with zero extracted skills is not a 0% match.** Distinguish "no
  data" from "no overlap" in both the UI and the underlying query — see
  Section 13a.

- **A `user_skills` upsert from GitHub sync must not clobber a manual entry.**
  See Section 12d step 7. Test this explicitly: add a skill manually, then run
  a sync that would also detect that same skill from a repo, and confirm the
  row's `source` stays `'manual'`.

- **Vercel AI SDK model string format changed in v7.** The format is now
  `'provider/model-name'` (e.g. `'anthropic/claude-sonnet-4-6'`) when using
  the AI Gateway, or `anthropic('claude-sonnet-4-6')` when using the provider
  package directly. Read the `vercel/ai` skill before any AI implementation.

- **Framer Motion v12 changed the animation API significantly.** Read the
  `framer-motion-animator` skill before implementing any animation — do not
  rely on older examples you may have seen.

- **Do not use `async/await` inside Framer Motion `animate` callbacks.**
  They are not async-safe. Use Framer Motion's built-in sequence API.

- **YouTube Data API quota is shared across all calls made that day, not
  just the tutorial indexer.** `search.list` = 100 units, `videos.list` = 1
  unit per resource requested. Budget the weekly indexer conservatively
  (`WEEKLY_INDEX_BUDGET`) and log quota errors distinctly from other failures
  so a quota exhaustion doesn't look like a broken integration.

- **GitHub's unauthenticated rate limit is 60 req/hr; the authenticated PAT
  limit is 5,000 req/hr.** Always send the `Authorization` header with
  `GITHUB_TOKEN` in the sync cron — an accidental unauthenticated call path
  will work fine in testing with one account and then fail once there are
  more than a handful of accounts or repos to sync in a single run.

- **Not every video has a usable transcript, and not every video has usable
  chapters — these are independent failure modes.** Auto-captions can be
  disabled, absent for very new videos, or low quality; `youtube-transcript`
  will throw or return empty. Separately, a description may simply not list
  timestamps at all. Catch each per-video and skip only the affected step —
  a video can still contribute chapters with no transcript, or transcript
  chunks with no chapters. Don't fail the skill's entire indexing run over
  one bad video on either axis.

- **`ivfflat` pgvector indexes need data before they're useful.** This
  applies to both `tutorial_chapters.label_embedding` and
  `tutorial_chunks.embedding`. The index quality depends on having a
  reasonable number of rows already in the table at creation time. If
  building this before any indexing runs have happened, create the indexes
  anyway (they'll still work, just less optimally until populated) or defer
  `create index` until after the first indexing run completes — confirm
  which with Evans in the implementation prompt for this specific task.

- **Embeddings must use the same model consistently, for both chapter labels
  and transcript chunks.** If the AI provider or embedding model changes
  later, existing `tutorial_chapters.label_embedding` and
  `tutorial_chunks.embedding` vectors become incomparable to newly embedded
  search queries. A provider/model change requires a full re-index of both
  tables, not just a config change. Flag this explicitly if a provider swap
  is ever requested.

- **Resend free tier has a daily send cap.** The alert dispatch cron should
  log a clear error (not silently drop) if a send is rejected for rate-limit
  reasons, so it's distinguishable from a genuine delivery failure.

- **An account with `instant_match_alert` on but an empty `user_skills` set
  will never match anything.** This is expected, not a bug — an empty skill
  list has nothing to compute a stack-match against. Consider a light UI
  warning on the Profile page rather than a backend special case.

- **API keys must never be logged, including in error messages or stack
  traces.** The raw key exists only in the single issuance response body and
  in the user's own clipboard after that. If a request handler throws while
  processing a `Bearer` header, make sure the error path doesn't echo the
  header value back in a log line.

- **`API_KEY_PEPPER` is a secret, not a public constant.** It must differ
  from `CRON_SECRET` and every other secret in this file, and must never be
  committed. Losing it means every issued API key becomes unverifiable
  (their hashes no longer reproduce) — treat rotating it as equivalent to
  revoking every outstanding key at once, and only do so deliberately.

---

## 18. Checks to Run

Run all checks and report real output. Never claim a check passed without running it.

### TypeScript and Lint

```bash
npx tsc --noEmit        # zero type errors required
npx eslint .            # zero warnings in new files
```

### Build

```bash
npx next build          # run when any API route or server component changes
```

### Security Gate (run before every PR)

```bash
# Verify no private keys are referenced in client components
grep -r "SERVICE_ROLE" app/           # must return zero matches
grep -r "OPENAI_API_KEY" app/         # must return zero matches
grep -r "YOUTUBE_API_KEY" app/        # must return zero matches
grep -r "RESEND_API_KEY" app/         # must return zero matches
grep -r "GITHUB_TOKEN" app/           # must return zero matches
grep -r "API_KEY_PEPPER" app/         # must return zero matches
grep -r "AI_MODEL" app/               # must return zero matches (server only)

# Verify no direct provider SDK imports in components
grep -r "@anthropic-ai/sdk" app/      # must return zero matches
grep -r "openai" app/components/      # must return zero matches
grep -r "resend" app/components/      # must return zero matches
grep -r "octokit" app/components/     # must return zero matches

# Verify the YouTube Data API is only called from the tutorial indexer route
grep -rl "googleapis.com/youtube" app/ | grep -v "app/api/cron/tutorial-index"
# must return zero matches

# Verify the GitHub REST API is only called from the sync cron route
grep -rl "api.github.com" app/ | grep -v "app/api/cron/github-sync"
# must return zero matches

# Verify every profile-scoped route validates identity server-side
# Manually confirm for: /api/profile, /api/gap-report, /api/saved-jobs,
# /api/alert-preferences, /api/keys, /api/keys/revoke — each must call
# supabase.auth.getUser() and reject a missing/invalid session with 401
# before touching Supabase (or, for /api/export only, accept a valid
# hashed Bearer key per Section 12e)

# Verify API keys are never stored or logged in plaintext
grep -rn "key_hash" app/api/keys/     # should be the only place raw keys are hashed, never stored raw
grep -rn "console.log.*apiKey\|console.log.*rawKey" app/  # must return zero matches
```

### Data integrity

```bash
# After first job ingestion run, verify counts are non-zero
# SELECT skill, mention_count FROM skill_demand_snapshots
# WHERE month = 'YYYY-MM' ORDER BY mention_count DESC LIMIT 20;
# Expect TypeScript, React, Python, Node.js in top 10

# After first tutorial indexing run, verify chapters and chunks exist
# and look sane, and that chapters aren't a rare fluke
# SELECT skill_tag, count(*), avg(view_count) FROM tutorial_chunks
# GROUP BY skill_tag ORDER BY count(*) DESC;
# SELECT count(distinct video_id) FROM tutorial_chapters;
# — expect a meaningful fraction (not zero, not 100%) of indexed videos to
# have qualifying chapters; 0% suggests the timestamp regex is too strict,
#100% suggests it's accepting false positives

# Verify a chapter-anchored result and a chunk-only result both render
# correctly end to end for at least one hand-checked skill — one video with
# real chapters, one video indexed only via transcript chunks

# After first GitHub sync run, verify github_sync source rows exist and
# never collide with a manual entry for the same user+skill
# SELECT user_id, skill, source FROM user_skills WHERE source = 'github_sync';

# Verify stack-match and market-alignment agree with manual calculation
# for at least one hand-checked example before trusting the UI
```

### Auth and RLS checks

- [ ] Signing in with a valid email sends a magic link and establishes a
      session on click, with no password ever requested
- [ ] A `profiles` row is created automatically on first sign-in (verify the
      `on_auth_user_created` trigger fired)
- [ ] Visiting any page except sign-in while signed out redirects to sign-in
- [ ] Querying `user_skills`, `saved_jobs`, `alert_preferences`, or
      `gap_report_events` as one signed-in user never returns another
      account's rows — verify directly against Supabase with RLS enabled,
      not just by checking the UI
- [ ] Disabling RLS temporarily on a table (for local testing only, never in
      a real environment) and re-enabling it is a check you can use to prove
      the policy is actually doing something, not just present in the schema

### Browser checks

- [ ] Skill Demand Dashboard loads with real data (not mock)
- [ ] Trend chart renders with at least 3 months of historical data, on both
      Dashboard and Trends pages, with matching values
- [ ] Jobs page loads real ingested postings with a stack-match percentage on
      each card, scoped to the signed-in user's skills
- [ ] A job with no extracted skills shows "Not enough data," not "0% match"
- [ ] A job with no parseable liquidity/contractor data shows "Not disclosed,"
      not a blank field or a fabricated value
- [ ] Job detail panel renders the AI-restructured About/Role/Requirements
      sections and does not introduce facts absent from the raw posting
- [ ] Skills page validates against the skill dictionary and blocks submission
      below 1 skill
- [ ] Gap Report form submits and returns AI analysis within 10 seconds
- [ ] AI analysis contains no invented statistics (verify against Supabase data)
- [ ] Gap Report gap skills generate `gap_report_events` rows
- [ ] Tutorial cards render for a gap skill that has been indexed
- [ ] A tutorial card backed by a chapter match shows the chapter badge
      (e.g. "Ch 2: Control Plane"); a tutorial card backed only by a
      transcript chunk shows no chapter badge
- [ ] Tutorial card click expands an inline iframe player at the correct
      timestamp, and the chapter overlay (if any) persists while playing
- [ ] A gap skill with no indexed tutorials yet shows a clear empty state, not an error
- [ ] Profile page saves persist across sign-out/sign-in on the same account
- [ ] Toggling a source off in Profile does not change the Dashboard's global
      counts, only the Jobs feed and alert matching for that account
- [ ] Generating an API key shows the full key exactly once; reloading the
      Profile page shows only the masked prefix
- [ ] Regenerating a key immediately invalidates the previous one
      (`GET /api/export` with the old key returns 401)
- [ ] No API keys, PATs, or secrets visible in browser Network tab responses
- [ ] No API keys, PATs, or secrets visible in browser source / `window` object
- [ ] All seven pages (including sign-in) responsive at 1280px, 768px, 375px

### Job ingestion pipeline

- [ ] Cron route returns 401 without correct `CRON_SECRET`
- [ ] Cron route creates an `ingestion_runs` record
- [ ] `job_postings` table grows after manual cron trigger
- [ ] `skill_demand_snapshots` upserts correctly (re-running does not double counts)

### Tutorial indexing pipeline

- [ ] Cron route returns 401 without correct `CRON_SECRET`
- [ ] Only processes up to `WEEKLY_INDEX_BUDGET` skills in one run
- [ ] Skills with recent `gap_report_events` are prioritised over skills with none
- [ ] A video whose description has fewer than three ascending timestamp
      lines produces zero `tutorial_chapters` rows, not a false-positive chapter
- [ ] A skill with no transcript-able videos completes with
      `last_run_status: 'skipped_no_results'`, not a crash
- [ ] `skill_index_status.last_indexed_at`, `total_chunks`, and
      `total_chapters` all update after a successful run
- [ ] Re-running against an already-indexed skill does not duplicate rows in
      `tutorial_chunks` or `tutorial_chapters` (unique constraints hold)

### GitHub sync pipeline

- [ ] Cron route returns 401 without correct `CRON_SECRET`
- [ ] Only accounts with `auto_git_sync = true` and a non-null
      `github_username` are processed
- [ ] An invalid username produces `status: 'skipped_no_username'`, not a crash
- [ ] A manually-entered skill is never overwritten by a `github_sync` upsert
      for the same user + skill
- [ ] `github_sync_runs` gets one row per account processed, with an accurate
      `skills_upserted` count

### Alert dispatch pipeline

- [ ] A qualifying job (stack-match ≥ threshold) produces exactly one
      `alert_dispatch_log` row and one email — re-running the check does not
      send a second email for the same job
- [ ] Weekly digest sends at most once per account per 7-day window
- [ ] Learning-gap dispatch only fires for skills actually indexed in that
      run, not the full gap history

---

## 19. Environment Variables

```bash
# Public — safe in client components
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=

# Server-side only — never use NEXT_PUBLIC_ prefix on these
SUPABASE_SERVICE_ROLE_KEY=
AI_MODEL=                # e.g. 'ollama/llama3.1' locally, 'groq/llama-3.3-70b' staging
CRON_SECRET=              # random string — must match Vercel Cron auth header on ALL cron routes
YOUTUBE_API_KEY=          # server-side only, used exclusively in the tutorial indexer cron route
RESEND_API_KEY=           # server-side only, used exclusively in the alert dispatch cron/route
GITHUB_TOKEN=             # server-side only, personal access token, public-repo read scope only,
                           # used exclusively in the GitHub sync cron route
API_KEY_PEPPER=           # server-side only, secret string mixed into API key hashing (Section 12e) —
                           # distinct from every other secret in this list; rotating it invalidates
                           # every issued API key

# Tutorial indexer tuning
WEEKLY_INDEX_BUDGET=40    # max skills processed per weekly indexing run — keep well under
                           # the ~90-100 skill ceiling implied by the 10,000/day quota
```

**For local development with Ollama (free, no subscription):**

```bash
AI_MODEL=ollama/llama3.1
OLLAMA_BASE_URL=http://localhost:11434
```

**For staging with Groq (free tier):**

```bash
AI_MODEL=groq/llama-3.3-70b
GROQ_API_KEY=
```

**Note:** confirm the chosen `AI_MODEL` provider supports an embeddings
endpoint before Feature 3 (Tutorial matching) is built — not all providers
configured for `generateText` also expose `embed`. If it doesn't, a
provider-specific embedding fallback needs to be decided explicitly rather
than assumed. The same embeddings endpoint is used for both
`tutorial_chapters.label_embedding` and `tutorial_chunks.embedding`.

**Note on auth email:** Supabase Auth's magic-link delivery is configured in
the Supabase dashboard (SMTP settings or Supabase's default email sender for
low volume) — it does not use `RESEND_API_KEY` and has no separate env var in
this list. Do not route sign-in emails through Resend; keep the two delivery
paths (auth emails vs. product alert emails) independent, as Section 12c notes.

---

## 20. The Final Reminder

Before writing any code, ask:

> "Does this call belong on the server or the browser?"

Before finishing any task, ask:

> "Can I verify the AI analysis against real Supabase data right now?"

For any tutorial-search work specifically, also ask:

> "Is every video card I'm about to render backed by a real row in
> `tutorial_chapters` or `tutorial_chunks`, or am I about to call YouTube
> live from a user request? And if it shows a chapter badge, did that badge
> come from an actual accepted chapter match, or am I dressing up a chunk
> match to look more precise than it is?"

For any profile-scoped route specifically, also ask:

> "Did I validate the Supabase session (or a hashed API key, where explicitly
> allowed) server-side before touching this data — and does RLS independently
> enforce the same boundary at the table level?"

For any GitHub sync work specifically, also ask:

> "Am I only reading public data with the server-owned token, and am I
> protecting manually-entered skills from being overwritten?"

For any matching or scoring work specifically, also ask:

> "Am I computing this percentage with real arithmetic in lib/matching.ts,
> or did I just let the AI make up a number that sounds plausible?"

For any comp/liquidity/contractor-type field specifically, also ask:

> "Did this come from real extracted text, or am I about to show the user a
> guess dressed up as data?"

If you cannot answer all of these with a clear YES, you are not done. Fix it first.

The product's credibility depends entirely on the AI never being able to invent
data it was not given, and on every number the user sees being reproducible
from a real row in Supabase. Every AI call must be grounded. Every percentage
must trace back to Section 13's arithmetic. Every tutorial card must trace back
to a row already sitting in `tutorial_chapters` or `tutorial_chunks` before the
request came in, and its chapter badge (if any) must trace back to a genuine
accepted chapter match, not a chunk result dressed up to look more precise.
Every account's data must be reachable only by that account, enforced twice —
once in the route, once in RLS.
