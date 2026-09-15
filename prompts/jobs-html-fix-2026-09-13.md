# Jobs HTML Descriptions Fix — Implementation Prompt

**Date:** 2026-09-13
**Author:** Sisyphus
**Related:** AGENTS.md §5c, §8, §9, secure-coding

## Goal
Fix visible HTML tags in /jobs descriptions. Raw `job_postings.description` from Himalayas/Remotive contains `<p>`, `<ul>`, `<li>`, `&amp;`, etc. Currently `JobDetail.tsx:173/187` slices raw HTML and `app/api/jobs/[id]/summary/route.ts:18` fallback splits raw HTML, so users see `<div>` tags.

## Code Inspected
- `app/api/cron/ingest/route.ts` — stores `job.description` verbatim from `job.description ?? job.excerpt` (Himalayas), `job.description` (Remotive/RemoteJobs), `comment.text` (HN plain). Skill/comp extraction uses combinedText with raw HTML.
- `components/jobs/JobDetail.tsx:173` `{(job.description ?? "").slice(0,400)}` and `187` `{(job.description ?? "").slice(0,200)}` — direct raw display when summary missing.
- `app/api/jobs/[id]/summary/route.ts:17` `fallbackSummary` splits raw description by sentences, `84` AI prompt injects `description.slice(0,8000)` raw.
- `lib/queries/jobs.ts` — search uses `description.ilike`, archetype filter uses `j.description` raw.
- No existing sanitizer; `package.json` has no `sanitize-html` or `he`.

## Decisions
- Create `lib/sanitize.ts` `stripHtml(value: string | null): string` — server and client safe, no deps. Handles `<br>` → newline, block close tags → newline, strip `<[^>]*>`, decode `&amp; &lt; &gt; &quot; &#39; &nbsp; &#x...; &#...;`, collapse whitespace, trim. Pure regex, no DOM, works in Node and browser.
- Sanitize at ingestion (future data) + at render (existing data) defense-in-depth. Ingestion fix alone would require backfill; render fix alone wouldn't clean AI prompt or skill extraction. Do both.
- Do not use `dangerouslySetInnerHTML` — strip to plain text per AGENTS.md §15 "honest data", never invent formatting.
- Keep skill extraction on stripped text for better dictionary matching (avoids matching inside tags).

## Files to Touch
- `lib/sanitize.ts` (new) — `stripHtml` utility
- `app/api/cron/ingest/route.ts` — import `stripHtml`, apply to `job.description` before storing `postingsToInsert` and before skill/comp extraction; keep original external_id/source unchanged
- `components/jobs/JobDetail.tsx` — import `stripHtml`, use for fallback paragraphs
- `app/api/jobs/[id]/summary/route.ts` — import `stripHtml`, use in `fallbackSummary` and before AI prompt

## Requirements
1. `stripHtml("<p>Hello<br/>World &amp; Co</p>")` → `"Hello\nWorld & Co"` (test manually)
2. Ingestion stores `description: stripHtml(job.description)` — verify with `extractSkills` on stripped combinedText
3. JobDetail fallback shows stripped text, not raw tags; `slice(0,400)` after stripping
4. Summary route fallback and AI prompt use stripped description
5. No `any`, no `@ts-ignore`, strict types, no new dependencies

## Acceptance
- [ ] /jobs detail for Himalayas/Remotive posting shows no `<p>` `<li>` tags, only clean paragraphs/bullets
- [ ] AI summary fallback shows clean sentences
- [ ] `npx tsc --noEmit` clean on changed files
- [ ] `grep -r "dangerouslySetInnerHTML" components/jobs/` → zero

## Test
1. Add `stripHtml("<p>Test &amp; <strong>bold</strong></p><ul><li>One</li><li>Two</li></ul>")` manual check returns clean
2. Visit /jobs → open Remotive/Himalayas job → detail shows plain text, inspect page source no `&lt;p&gt;`
3. Trigger `GET /api/jobs/{id}/summary` for HTML-heavy job → fallback not containing `<`

## Security
Verify no API keys in client, stripHtml does not introduce XSS — it removes tags entirely, never renders HTML.
