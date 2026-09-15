import "server-only";

import { z } from "zod";
import { generateObject, generateText } from "ai";

// ---------------------------------------------------------------------------
// Zod schemas — structured output contract for lesson notes
// ---------------------------------------------------------------------------

export const CURRENT_LESSON_MODEL = "gemini-3.6-flash-concept-v2"; // bump when prompt/windowing/narration guard changes — indexSkill regenerates when video_lessons.model != this

const MAX_SECTIONS_PER_VIDEO = 40; // keep in sync with LessonOutputSchema's sections max below

export const LessonSectionSchema = z.object({
  start_seconds: z.number().int().min(0),
  heading: z.string().min(1).max(120),
  key_points: z.array(z.string().min(1).max(300)).min(1).max(5),
  code_example: z.string().max(800).optional().nullable(),
});

// Per-window call is capped small (a window covers a bounded chunk of video).
export const LessonWindowOutputSchema = z.object({
  summary: z.string().min(1).max(600).nullable().optional(),
  sections: z.array(LessonSectionSchema).min(1).max(8),
});

// Final merged output for a whole video can hold more sections than any
// single window call, since long videos are processed across many windows.
export const LessonOutputSchema = z.object({
  summary: z.string().min(1).max(600).nullable().optional(),
  sections: z.array(LessonSectionSchema).min(1).max(MAX_SECTIONS_PER_VIDEO),
});

export type LessonSection = z.infer<typeof LessonSectionSchema>;
export type LessonOutput = z.infer<typeof LessonOutputSchema>;

// For DB storage — matches video_lessons.sections jsonb shape
export type VideoLessonSections = LessonSection[];
export type VideoLessonRow = {
  video_id: string;
  sections: VideoLessonSections;
  summary: string | null;
  generated_at: string;
  model: string;
};

export type TranscriptChunk = { start_seconds: number; chunk_text: string };

// ---------------------------------------------------------------------------
// Grounding system prompt — Feature 5 (Lesson Note Synthesis)
// ---------------------------------------------------------------------------

export const LESSON_SYSTEM_PROMPT = `You are writing study notes from a tutorial video's transcript, not a transcript summary. For each segment, state the concept or technique being taught and why it matters, in your own words — do not describe what the speaker said or did ('the speaker introduces...', 'he mentions...', 'the video says...'); describe what the concept *is*. Every claim must be grounded in the provided transcript text. Do not add libraries, APIs, commands, or best practices not discussed in the source. If a segment has no real teaching content (e.g. intro filler, 'let's get started'), keep the note brief rather than restating filler or inventing content.`;

export const LESSON_USER_PROMPT_TEMPLATE = (params: {
  videoTitle: string;
  channelName: string;
  allowedTimestamps: number[]; // real chapter/chunk start_seconds within THIS window only
  transcript: string; // ordered transcript text for THIS window only
  windowInfo?: string; // optional context note, e.g. "This is part 3 of 6 of a longer video."
}) =>
  `Extract and explain the concepts this tutorial teaches — do not summarize what the speaker said.

Video: "${params.videoTitle}" by ${params.channelName}
${params.windowInfo ? params.windowInfo + "\n" : ""}Section timestamps must be chosen ONLY from this allowed list: [${params.allowedTimestamps.join(", ")}]
Each section's start_seconds must be one of those values exactly — never invent a new timestamp.
Only use timestamps from this list that are actually covered by the transcript excerpt below — if the excerpt doesn't contain real teaching content for a listed timestamp, omit that timestamp rather than guessing at its content.

Transcript excerpt (ordered, covers only this portion of the video):
---
${params.transcript}
---

Return JSON with:
- summary: 1-2 sentence concept-level summary of what THIS excerpt teaches (not what the speaker does), or null if excerpt too sparse
- sections: array of sections (as many as the excerpt genuinely supports), each with:
  - start_seconds (from allowed list, and only ones covered by this excerpt)
  - heading: concept name (3-8 words, e.g. "Compile Speed vs Type Safety Trade-offs", not "Speaker Introduction")
  - key_points: 2-4 bullets stating the concept/technique and why it matters, in your own words as study notes (never "the speaker explains...", never "he mentions..."), each grounded in this transcript excerpt
  - code_example: optional, only if the transcript literally shows code/commands — omit otherwise, never invent a snippet

If a segment is just filler/intro with no real teaching content, keep that section brief (1 bullet) rather than padding. Every claim must trace to this transcript excerpt.`;

// ---------------------------------------------------------------------------
// Narration-phrase guard — defense in depth, same philosophy as timestamp validation
// ---------------------------------------------------------------------------

const NARRATION_PHRASE_PATTERNS: RegExp[] = [
  /\bthe speaker\b/i,
  /\bhe (mentions|says|explains|introduces|discusses|notes|describes)\b/i,
  /\bshe (mentions|says|explains|introduces|discusses|notes|describes)\b/i,
  /\bthey (mention|say|explain|introduce|discuss|note|describe)\b/i,
  /\bthe (video|presenter|instructor|narrator) (says|shows|explains|introduces|discusses|mentions)\b/i,
  /^(so |now )?i wanted to\b/i,
];

function containsNarrationPhrasing(text: string): boolean {
  return NARRATION_PHRASE_PATTERNS.some((re) => re.test(text));
}

/**
 * Drop individual bullets (not whole sections) that slipped past the prompt's
 * instruction and read as transcript narration instead of concept synthesis.
 * Mirrors filterToAllowedTimestamps: never rewrite the model's words, only
 * remove what fails the check. A section left with zero valid bullets is dropped.
 */
export function filterNarrationPhrasing(
  sections: LessonSection[],
): LessonSection[] {
  const cleaned: LessonSection[] = [];
  for (const s of sections) {
    const keptPoints = s.key_points.filter((p) => {
      const bad = containsNarrationPhrasing(p);
      if (bad) {
        console.warn(
          `[lesson-generation] Dropping narration-style bullet at ${s.start_seconds}s: "${p.slice(0, 120)}"`,
        );
      }
      return !bad;
    });
    if (keptPoints.length === 0) {
      console.warn(
        `[lesson-generation] Section at ${s.start_seconds}s ("${s.heading}") had zero valid bullets after narration-phrase filtering, dropping section`,
      );
      continue;
    }
    cleaned.push({ ...s, key_points: keptPoints });
  }
  return cleaned;
}

// ---------------------------------------------------------------------------
// Timestamp allowlist guard
// ---------------------------------------------------------------------------

function formatSectionsPreview(sections: LessonSection[]): string {
  return sections.map((s) => `${s.start_seconds}s ${s.heading}`).join(" | ");
}

/**
 * Validate that all section start_seconds are in the allowed set.
 * Drops any invented timestamp and logs a warning.
 * Returns filtered sections (never invents replacement).
 */
export function filterToAllowedTimestamps(
  sections: LessonSection[],
  allowed: Set<number>,
): LessonSection[] {
  const filtered: LessonSection[] = [];
  for (const s of sections) {
    if (allowed.has(s.start_seconds)) {
      filtered.push(s);
    } else {
      console.warn(
        `[lesson-generation] Dropping invented timestamp ${s.start_seconds} not in allowed set [${[...allowed].join(",")}] heading="${s.heading}"`,
      );
    }
  }
  return filtered;
}

// ---------------------------------------------------------------------------
// Windowing — chunk-boundary-aware, so every offered timestamp has real
// grounding text in the SAME model call that's asked to write about it.
// A flat character-count truncation of the whole video's transcript silently
// drops grounding for later chapters while still listing them as allowed —
// this replaces that with per-window generation instead.
// ---------------------------------------------------------------------------

const WINDOW_CHAR_BUDGET = 6000; // per-call transcript budget, leaves headroom vs a flat 8000 cap
export const MAX_WINDOWS_PER_VIDEO = 8; // raised from 3 — was 8→3 for free-tier, now 8 again to cover 3h+ videos end-to-end; see prompts/2026-09-15-ai-lesson-notes-fix.md

// --- Content-quality guards (sponsor/music, verbatim, code shape) ---

const SPONSOR_MUSIC_PATTERNS: RegExp[] = [
  /\bthis video is sponsored by\b/i,
  /\[music\]/i,
  /♪/g,
  /\b\[♪+/,
];

function isSponsorOrMusicChunk(text: string): boolean {
  return SPONSOR_MUSIC_PATTERNS.some((re) => re.test(text));
}

const CODE_SHAPE_PATTERNS: RegExp[] = [
  /[{}\[\]();]/,
  /=>|->|:=|::/,
  /^\s*(import |from |func |def |class |const |let |var |kubectl |go |npm |yarn |pnpm |git |docker |def |package )/i,
  /`[^`]+`/,
  /\$ [a-z]/,
];

function looksLikeCode(text: string): boolean {
  if (!text || text.trim().length < 8) return false;
  // sponsor/music prose must never be treated as code
  if (isSponsorOrMusicChunk(text)) return false;
  // must contain code-typical punctuation or keyword
  return CODE_SHAPE_PATTERNS.some((re) => re.test(text));
}

export function filterCodeExampleShape(sections: LessonSection[]): LessonSection[] {
  return sections.map((s) => {
    if (!s.code_example) return s;
    if (!looksLikeCode(s.code_example)) {
      console.warn(`[lesson-generation] Dropping prose code_example at ${s.start_seconds}s: "${s.code_example.slice(0, 80)}"`);
      return { ...s, code_example: undefined };
    }
    return s;
  });
}

function normalizeForOverlap(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").replace(/[^\w\s]/g, "").trim();
}

export function filterVerbatimCopy(
  sections: LessonSection[],
  windowTranscript: string
): LessonSection[] {
  const normTranscript = normalizeForOverlap(windowTranscript);
  if (!normTranscript || normTranscript.length < 40) return sections;
  const cleaned: LessonSection[] = [];
  for (const s of sections) {
    const keptPoints = s.key_points.filter((pt) => {
      const normPt = normalizeForOverlap(pt);
      if (normPt.length < 30) return true;
      // check if any 60-char slice of the point appears verbatim in transcript
      const sliceLen = Math.min(60, normPt.length);
      for (let i = 0; i <= normPt.length - sliceLen; i++) {
        const slice = normPt.slice(i, i + sliceLen);
        if (slice.length >= 30 && normTranscript.includes(slice)) {
          console.warn(`[lesson-generation] Dropping verbatim bullet at ${s.start_seconds}s: "${pt.slice(0, 80)}"`);
          return false;
        }
      }
      return true;
    });
    // also null out verbatim code_example
    let code = s.code_example;
    if (code) {
      const normCode = normalizeForOverlap(code);
      if (normCode.length >= 30 && normTranscript.includes(normCode.slice(0, Math.min(60, normCode.length)))) {
        // only drop if code is prose-like (no code shape); real code won't match transcript verbatim with spaces normalized
        if (!looksLikeCode(code)) {
          console.warn(`[lesson-generation] Dropping verbatim code_example at ${s.start_seconds}s`);
          code = undefined;
        }
      }
    }
    if (keptPoints.length === 0) {
      console.warn(`[lesson-generation] Section at ${s.start_seconds}s ("${s.heading}") had zero valid bullets after verbatim filtering, dropping section`);
      continue;
    }
    cleaned.push({ ...s, key_points: keptPoints, code_example: code });
  }
  return cleaned;
}

export function isWindowSponsorNoise(transcript: string): boolean {
  const low = transcript.toLowerCase();
  // if transcript is short and contains sponsor or is mostly music markers, skip
  if (low.includes("this video is sponsored by") && transcript.length < 400) return true;
  const musicCount = (transcript.match(/\[music\]/gi) || []).length + (transcript.match(/♪/g) || []).length;
  if (musicCount >= 3 && transcript.length < 600) return true;
  return false;
}

type TranscriptWindow = {
  chunks: TranscriptChunk[];
  startSeconds: number;
  endSeconds: number;
};

function buildWindows(chunks: TranscriptChunk[]): TranscriptWindow[] {
  const sorted = [...chunks].sort((a, b) => a.start_seconds - b.start_seconds);
  const windows: TranscriptWindow[] = [];
  let current: TranscriptChunk[] = [];
  let currentChars = 0;

  for (const chunk of sorted) {
    const chunkLen = chunk.chunk_text.length;
    if (current.length > 0 && currentChars + chunkLen > WINDOW_CHAR_BUDGET) {
      windows.push({
        chunks: current,
        startSeconds: current[0].start_seconds,
        endSeconds: current[current.length - 1].start_seconds,
      });
      current = [];
      currentChars = 0;
    }
    current.push(chunk);
    currentChars += chunkLen;
  }
  if (current.length > 0) {
    windows.push({
      chunks: current,
      startSeconds: current[0].start_seconds,
      endSeconds: current[current.length - 1].start_seconds,
    });
  }

  // If a very long video produces more windows than the budget allows,
  // merge the tail windows together rather than silently dropping content —
  // coarser grounding for the back half beats no coverage at all.
  if (windows.length > MAX_WINDOWS_PER_VIDEO) {
    const head = windows.slice(0, MAX_WINDOWS_PER_VIDEO - 1);
    const tail = windows.slice(MAX_WINDOWS_PER_VIDEO - 1);
    const mergedTail: TranscriptWindow = {
      chunks: tail.flatMap((w) => w.chunks),
      startSeconds: tail[0].startSeconds,
      endSeconds: tail[tail.length - 1].endSeconds,
    };
    return [...head, mergedTail];
  }

  return windows;
}

// ---------------------------------------------------------------------------
// Single-window generation call (extracted so the multi-window loop can reuse it)
// ---------------------------------------------------------------------------

async function generateForWindow(params: {
  videoId: string;
  videoTitle: string;
  channelName: string;
  window: TranscriptWindow;
  allowedTimestamps: number[]; // full-video list; filtered to this window's range below
  windowLabel?: string;
  model: Parameters<typeof generateObject>[0]["model"];
}): Promise<z.infer<typeof LessonWindowOutputSchema> | null> {
  const {
    videoId,
    videoTitle,
    channelName,
    window,
    allowedTimestamps,
    windowLabel,
    model,
  } = params;

  const windowAllowed = allowedTimestamps.filter(
    (t) => t >= window.startSeconds && t <= window.endSeconds,
  );
  if (windowAllowed.length === 0) return null;

  const transcript = window.chunks
    .map((c) => c.chunk_text)
    .join(" ")
    .slice(0, WINDOW_CHAR_BUDGET);
  if (transcript.trim().length < 40) return null;
  if (isWindowSponsorNoise(transcript)) {
    console.warn(`[lesson-generation] Skipping sponsor/music window [${window.startSeconds}-${window.endSeconds}] for ${videoId}`);
    return null;
  }

  const userPrompt = LESSON_USER_PROMPT_TEMPLATE({
    videoTitle,
    channelName,
    allowedTimestamps: windowAllowed,
    transcript,
    windowInfo: windowLabel,
  });

  try {
    const result = await generateObject({
      model,
      system: LESSON_SYSTEM_PROMPT,
      prompt: userPrompt,
      schema: LessonWindowOutputSchema,
      maxOutputTokens: 2500,
    });
    return result.object;
  } catch (goErr) {
    console.warn(
      `[lesson-generation] generateObject failed for ${videoId} window [${window.startSeconds}-${window.endSeconds}], falling back to generateText:`,
      goErr,
    );
    try {
      const { text } = await generateText({
        model,
        system: LESSON_SYSTEM_PROMPT,
        prompt:
          userPrompt +
          "\n\nReturn JSON only with keys summary (string|null) and sections (array of {start_seconds, heading, key_points, code_example}). No markdown, no explanation.",
        maxOutputTokens: 2500,
      });
      const match = text.match(/\{[\s\S]*\}/);
      if (!match)
        throw new Error(
          `No JSON in generateText response: ${text.slice(0, 400)}`,
        );
      const parsed = JSON.parse(match[0]);
      const validated = LessonWindowOutputSchema.safeParse(parsed);
      if (!validated.success)
        throw new Error(`Zod validation failed: ${validated.error.message}`);
      return validated.data;
    } catch (textErr) {
      console.error(
        `[lesson-generation] Both generateObject and generateText failed for ${videoId} window [${window.startSeconds}-${window.endSeconds}]:`,
        textErr,
      );
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Generate lesson notes for a single video.
 * - Splits the video's transcript chunks into chunk-boundary-aware windows
 *   sized to a safe token budget, so long videos never lose grounding for
 *   later chapters the way a flat character truncation would.
 * - Calls generateObject once per window, offering only that window's own
 *   timestamps as the allowed list, so every offered timestamp has real
 *   transcript text behind it in the same call.
 * - Merges all windows' sections, re-validates every timestamp against the
 *   full allowed set, strips narration-style bullets, dedupes, and sorts.
 * - Returns null on total failure (caller should log and continue, not
 *   crash the cron run).
 */
export async function generateLessonForVideo(params: {
  videoId: string;
  videoTitle: string;
  channelName: string;
  allowedTimestamps: number[]; // real chapter/chunk start_seconds across the whole video
  chunks: TranscriptChunk[]; // ordered transcript chunks across the whole video
}): Promise<{ summary: string | null; sections: LessonSection[] } | null> {
  const { videoId, videoTitle, channelName, allowedTimestamps, chunks } =
    params;

  if (allowedTimestamps.length === 0) {
    console.warn(
      `[lesson-generation] No allowed timestamps for ${videoId}, skipping`,
    );
    return null;
  }
  if (chunks.length === 0) {
    console.warn(
      `[lesson-generation] No transcript chunks for ${videoId}, skipping`,
    );
    return null;
  }

  const allowedSet = new Set(allowedTimestamps);
  const windows = buildWindows(chunks);

  const { createTextModel, getProviderMeta } =
    await import("@/lib/ai/provider");
  const model = await createTextModel();
  const meta = getProviderMeta();
  const modelId = meta.model;

  const allSections: LessonSection[] = [];
  const summaries: string[] = [];

  for (let i = 0; i < windows.length; i++) {
    const windowLabel =
      windows.length > 1
        ? `This is part ${i + 1} of ${windows.length} of a longer video.`
        : undefined;
    const result = await generateForWindow({
      videoId,
      videoTitle,
      channelName,
      window: windows[i],
      allowedTimestamps,
      windowLabel,
      model,
    });
    if (!result) continue;
    if (result.summary) summaries.push(result.summary.trim());
    allSections.push(...result.sections);
  }

  if (allSections.length === 0) {
    console.warn(
      `[lesson-generation] No sections produced across ${windows.length} window(s) for ${videoId}`,
    );
    return null;
  }

  // Never trust the model on timestamps, even after windowing.
  const timestampFiltered = filterToAllowedTimestamps(allSections, allowedSet);
  if (timestampFiltered.length === 0) {
    console.warn(
      `[lesson-generation] All sections for ${videoId} had invented timestamps, dropping entire lesson. Preview: ${formatSectionsPreview(allSections)}`,
    );
    return null;
  }

  const narrationFiltered = filterNarrationPhrasing(timestampFiltered);
  if (narrationFiltered.length === 0) {
    console.warn(
      `[lesson-generation] All sections for ${videoId} dropped after narration-phrase filtering`,
    );
    return null;
  }

  const codeFiltered = filterCodeExampleShape(narrationFiltered);

  const fullTranscript = chunks.map((c) => c.chunk_text).join(" ");
  const verbatimFiltered = filterVerbatimCopy(codeFiltered, fullTranscript);
  if (verbatimFiltered.length === 0) {
    console.warn(`[lesson-generation] All sections for ${videoId} dropped after verbatim filtering`);
    return null;
  }

  // Sort by start_seconds and dedupe (a chapter could appear near a window boundary).
  const seen = new Set<number>();
  const deduped: LessonSection[] = [];
  const sorted = [...verbatimFiltered].sort(
    (a, b) => a.start_seconds - b.start_seconds,
  );
  for (const s of sorted) {
    if (seen.has(s.start_seconds)) continue;
    seen.add(s.start_seconds);
    deduped.push({
      start_seconds: s.start_seconds,
      heading: s.heading.trim().slice(0, 120),
      key_points: s.key_points.map((p) => p.trim().slice(0, 300)).slice(0, 5),
      code_example: s.code_example
        ? s.code_example.trim().slice(0, 800)
        : undefined,
    });
  }

  const finalSections = deduped.slice(0, MAX_SECTIONS_PER_VIDEO);

  console.info(
    `[lesson-generation] Generated lesson for ${videoId} via ${modelId}: ${finalSections.length} sections across ${windows.length} window(s)`,
  );

  return {
    summary: summaries[0] ? summaries[0].slice(0, 600) : null,
    sections: finalSections,
  };
}

/**
 * Helper: build transcript text from chunk rows (ordered by start_seconds).
 * Retained for previews/exports that want one flat string — no longer used
 * by generateLessonForVideo itself, which windows chunks directly.
 */
export function buildTranscriptFromChunks(chunks: TranscriptChunk[]): string {
  const sorted = [...chunks].sort((a, b) => a.start_seconds - b.start_seconds);
  return sorted.map((c) => c.chunk_text).join(" ");
}
