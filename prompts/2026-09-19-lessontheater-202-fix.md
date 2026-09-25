# Fix LessonTheater crash on 202 "still generating" response

## Goal
Prevent the runtime `TypeError: Cannot read properties of undefined (reading 'map')` in `LessonTheater.tsx:382` when the `/api/tutorial-lessons/[video_id]` endpoint returns HTTP 202 because lesson generation is still in progress.

## Skills Read
- `vercel-react-best-practices` — client-side data fetching and error handling patterns

## Code Inspected
- `components/gap-report/LessonTheater.tsx` — `fetchLesson()` at lines 139-174
- `app/api/tutorial-lessons/[video_id]/route.ts` — returns 202 with `{ error, status, reason }` body when `generation_status !== "completed"`

## Root Cause
The API route returns HTTP 202 with a JSON body shaped like `{ error: "Notes are still being generated", status, reason }` when a lesson is still being generated. The Fetch API considers 202 as `ok` (`res.ok === true`), so the client code at `LessonTheater.tsx:152-166` falls through to:

```ts
const data = (await res.json()) as VideoLesson;
lessonCache.set(tutorial.video_id, data);
setLesson(data);
```

This type-casts the error object to `VideoLesson`, but the object has no `sections` property. When the component later renders `lesson.sections.map(...)` at line 382, it crashes because `sections` is `undefined`.

## Decisions and Assumptions
- 202 is semantically "still generating" — an expected transient state, not a hard error. The component already has `lessonError` state and an error panel (lines 370-377) that tells the user notes are being generated.
- The fix should treat 202 as a known status and route it through the existing `lessonError` path rather than trying to render an empty lesson.
- No API contract change needed. The API should keep returning 202 with its current body.
- Only `LessonTheater.tsx` consumes this endpoint, so one client-side fix is sufficient.

## Files to Touch
- `components/gap-report/LessonTheater.tsx` — add explicit `res.status === 202` handling in `fetchLesson()`

## Requirements
1. Add explicit 202 status check after the 404 check and before the `!res.ok` check
2. Parse `error` from the 202 response JSON
3. Cache the error in `lessonErrorCache` and set `lessonError` state
4. Clear `lesson` state so the error panel renders instead of the lesson panel
5. Do NOT change the API route

## Security Checks
- No new data exposure: 202 response body only contains `error`, `status`, `reason` — all already rendered in the existing error panel
- No new fetch targets or environment variable usage
- No changes to auth flow or Supabase queries

## Acceptance Criteria
- Opening `LessonTheater` for a video with `generation_status !== "completed"` shows the amber error panel: "Notes are still being generated" + reason, instead of crashing
- Opening `LessonTheater` for a completed video still renders sections normally
- Opening `LessonTheater` for a video with no `video_lessons` row still shows 404 behavior
- No TypeScript or ESLint errors in the changed file

## Manual Test Steps
1. Find a video in `video_lessons` with `generation_status = 'processing'` or `'pending'`
2. Open the Gap Report and expand the `LessonTheater` for that video
3. Verify: amber error panel appears with "Notes are still being generated"
4. Verify: no runtime console errors
5. Find a video with `generation_status = 'completed'` and real `sections`
6. Open `LessonTheater` for that video
7. Verify: lesson sections render and are clickable
