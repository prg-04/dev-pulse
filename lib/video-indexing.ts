import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { YouTubeVideoCandidate } from "@/lib/youtube/client";
import { CURRENT_LESSON_MODEL, type LessonSection } from "@/lib/lesson-generation";
import { embed, embedMany } from "ai";
import { fetchTranscript, YoutubeTranscriptError } from "youtube-transcript";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IndexVideoInput {
  video_id: string;
  title: string;
  channel_name: string;
  view_count: number;
  published_at: string | null;
  description: string;
}

export interface IndexVideoResult {
  chapters: number;
  chunks: number;
  lessonInitialized: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Helpers (extracted from ondemand.ts and tutorial-index/route.ts)
// ---------------------------------------------------------------------------

export function parseChapters(description: string): { start_seconds: number; label: string }[] {
  const lines = description.split("\n");
  const chapters: { start_seconds: number; label: string }[] = [];
  const timestampRegex = /^\s*(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\s+(.+)$/;

  for (const line of lines) {
    const match = line.match(timestampRegex);
    if (!match) continue;

    const hours = match[1] ? parseInt(match[1], 10) : 0;
    const minutes = parseInt(match[2], 10);
    const seconds = parseInt(match[3], 10);
    const label = match[4].trim();

    if (!label) continue;

    const startSeconds = hours * 3600 + minutes * 60 + seconds;
    chapters.push({ start_seconds: startSeconds, label });
  }

  if (chapters.length < 3) {
    return [];
  }

  for (let i = 1; i < chapters.length; i++) {
    if (chapters[i].start_seconds <= chapters[i - 1].start_seconds) {
      return [];
    }
  }

  return chapters;
}

export function normalizeTranscriptOffsets(
  transcript: { offset: number; text: string; duration?: number }[]
): { offset: number; text: string }[] {
  if (transcript.length === 0) return [];
  // Drop malformed captions BEFORE unit detection. A single non-finite or
  // negative offset would otherwise flip hasFractional for the whole array
  // (NaN % 1 !== 0 is true), disabling ms-detection and storing raw
  // milliseconds as seconds for every valid caption. Dropped entries are
  // excluded entirely, never repaired — inventing a timestamp for a malformed
  // caption could place bogus text at the wrong point in a lesson.
  const clean = transcript.filter(
    (t) => typeof t.offset === "number" && Number.isFinite(t.offset) && t.offset >= 0
  );
  if (clean.length === 0) return [];
  const finiteDuration = (t: { duration?: number }): number => {
    const d = (t as { duration?: number }).duration;
    return typeof d === "number" && Number.isFinite(d) ? d : 0;
  };
  const hasFractional = clean.some(
    (t) => t.offset % 1 !== 0 || finiteDuration(t) % 1 !== 0
  );
  const maxOffset = Math.max(...clean.map((t) => t.offset));
  const isMs = !hasFractional && maxOffset > 100000;
  if (!isMs) {
    const smallMs = !hasFractional && maxOffset > 5000 && maxOffset < 100000;
    if (smallMs) {
      const avgGap =
        clean.length > 1
          ? (clean[clean.length - 1].offset - clean[0].offset) / (clean.length - 1)
          : 0;
      if (avgGap > 100) {
        return clean.map((t) => ({ offset: Math.floor(t.offset / 1000), text: t.text }));
      }
    }
    return clean.map((t) => ({ offset: t.offset, text: t.text }));
  }
  return clean.map((t) => ({ offset: Math.floor(t.offset / 1000), text: t.text }));
}

export function chunkTranscript(
  transcript: { offset: number; text: string }[]
): { start_seconds: number; text: string }[] {
  if (transcript.length === 0) return [];
  const normalized = normalizeTranscriptOffsets(
    transcript as { offset: number; text: string; duration?: number }[]
  );

  const chunks: { start_seconds: number; text: string }[] = [];
  let currentChunk: { start_seconds: number; text: string } = { start_seconds: normalized[0].offset, text: "" };

  for (const item of normalized) {
    const chunkEnd = currentChunk.start_seconds + 60;
    if (item.offset >= chunkEnd && currentChunk.text.trim().length > 0) {
      chunks.push(currentChunk);
      currentChunk = { start_seconds: item.offset, text: "" };
    }
    currentChunk.text += (currentChunk.text ? " " : "") + item.text;
  }

  if (currentChunk.text.trim().length > 0) {
    chunks.push(currentChunk);
  }

  return chunks;
}

// ---------------------------------------------------------------------------
// Shared candidate quality filters (used by ondemand and video-discovery)
// ---------------------------------------------------------------------------

export const MIN_VIEW_COUNT = 10000;
export const MIN_DURATION_SECONDS = 600;
export const TITLE_EXCLUDE_PATTERN = /\bin\s+\d+\s*(seconds?|minutes?|mins?)\b/i;

export function filterCandidates(candidates: YouTubeVideoCandidate[]): YouTubeVideoCandidate[] {
  return candidates.filter((c) => {
    if (c.view_count <= MIN_VIEW_COUNT) return false;
    if (c.duration_seconds <= MIN_DURATION_SECONDS) return false;
    if (TITLE_EXCLUDE_PATTERN.test(c.title)) return false;
    return true;
  });
}

export function selectTopCandidate(candidates: YouTubeVideoCandidate[]): YouTubeVideoCandidate | undefined {
  return filterCandidates(candidates)[0];
}

// ---------------------------------------------------------------------------
// Retry / embedding helpers
// ---------------------------------------------------------------------------

export async function withRetry<T>(
  fn: () => Promise<T>,
  { attempts = 2, delayMs = 4000 } = {}
): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (i < attempts - 1) {
        console.warn(
          `[video-indexing] Retry ${i + 1}/${attempts - 1} after error: ${
            err instanceof Error ? err.message : err
          }`
        );
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }
  throw lastError;
}

async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const { createEmbeddingModel } = await import("@/lib/ai/provider");
  const model = await createEmbeddingModel();
  const BATCH = 4;
  const all: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH);
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        if (batch.length === 1) {
          const { embedding } = await embed({ model, value: batch[0] });
          all.push(embedding.length > 1536 ? embedding.slice(0, 1536) : embedding);
        } else {
          const { embeddings } = await embedMany({ model, values: batch });
          for (const e of embeddings) all.push(e.length > 1536 ? e.slice(0, 1536) : e);
        }
        break;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        const isQuota =
          msg.includes("Quota exceeded") ||
          msg.includes("429") ||
          ((e as { statusCode?: number })?.statusCode === 429);
        if (isQuota && attempt < 3) {
          const delay = 35000 + Math.random() * 5000;
          console.warn(
            `[video-indexing] embed quota hit batch ${Math.floor(i / BATCH) + 1}, retry ${
              attempt + 1
            }/3 after ${Math.round(delay)}ms`
          );
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        throw e;
      }
    }
    if (i + BATCH < texts.length) await new Promise((r) => setTimeout(r, 5000));
  }
  return all;
}

// ---------------------------------------------------------------------------
// Core: index a single selected video for a skill
// ---------------------------------------------------------------------------

export async function indexVideoForSkill(
  supabase: ReturnType<typeof createServiceRoleClient>,
  skill: string,
  video: IndexVideoInput
): Promise<IndexVideoResult> {
  if (!supabase) {
    throw new Error("Supabase client is null");
  }

  const chapters = parseChapters(video.description);
  let totalChapters = 0;

  if (chapters.length > 0) {
    try {
      const chapterRowsWithoutEmbedding = chapters.map((ch) => ({
        video_id: video.video_id,
        start_seconds: ch.start_seconds,
        label: ch.label,
        label_embedding: null as unknown as number[],
      }));
      const { error: chapterError } = await supabase
        .from("tutorial_chapters")
        .upsert(chapterRowsWithoutEmbedding, { onConflict: "video_id,start_seconds" });
      if (chapterError) {
        console.error(`[video-indexing] Chapter upsert failed for ${video.video_id}:`, chapterError);
      } else {
        totalChapters = chapters.length;
      }
    } catch (err) {
      console.error(`[video-indexing] Chapter upsert failed for ${video.video_id}:`, err);
    }
  }

  let transcriptChunks: { start_seconds: number; text: string }[] = [];
  try {
    const transcript = await withRetry(() => fetchTranscript(video.video_id), {
      attempts: 2,
      delayMs: 4000,
    });
    const rawChunks = chunkTranscript(
      transcript.map((t) => ({ offset: t.offset, text: t.text }))
    );
    transcriptChunks = rawChunks;
  } catch (err) {
    if (err instanceof YoutubeTranscriptError) {
      console.warn(`[video-indexing] Transcript unavailable for ${video.video_id}:`, err.message);
    } else {
      console.error(`[video-indexing] Transcript fetch failed for ${video.video_id}:`, err);
    }
  }

  let totalChunks = 0;

  if (transcriptChunks.length > 0) {
    try {
      const chunkRowsWithoutEmbedding = transcriptChunks.map((chunk) => ({
        video_id: video.video_id,
        video_title: video.title,
        channel_name: video.channel_name,
        view_count: video.view_count,
        published_at: video.published_at,
        skill_tag: skill,
        start_seconds: chunk.start_seconds,
        chunk_text: chunk.text,
        embedding: null as unknown as number[],
      }));
      const { error: chunkError } = await supabase
        .from("tutorial_chunks")
        .upsert(chunkRowsWithoutEmbedding, { onConflict: "video_id,start_seconds,skill_tag" });
      if (chunkError) {
        console.error(`[video-indexing] Chunk upsert failed for ${video.video_id}:`, chunkError);
      } else {
        totalChunks = transcriptChunks.length;
      }
    } catch (err) {
      console.error(`[video-indexing] Chunk upsert failed for ${video.video_id}:`, err);
    }
  }

  const needsLesson = totalChapters > 0 || totalChunks > 0;
  let lessonInitialized = false;

  if (needsLesson) {
    try {
      const { data: existingLesson } = await supabase
        .from("video_lessons")
        .select("video_id")
        .eq("video_id", video.video_id)
        .maybeSingle();

      if (!existingLesson) {
        const { error: initError } = await supabase.from("video_lessons").insert({
          video_id: video.video_id,
          sections: [],
          summary: null,
          model: CURRENT_LESSON_MODEL,
          windows_total: 0,
          next_window_index: 0,
          generation_status: "processing",
          generation_error: null,
        });
        if (initError) {
          console.error(`[video-indexing] Lesson init failed for ${video.video_id}:`, initError);
        } else {
          lessonInitialized = true;
        }
      } else {
        lessonInitialized = true;
      }
    } catch (err) {
      console.error(`[video-indexing] Lesson init failed for ${video.video_id}:`, err);
    }
  }

  // Best-effort embeddings — run AFTER lesson init so a quota
  // exhaustion or timeout during embedding does not block lesson rows.
  if (chapters.length > 0) {
    try {
      const chapterLabels = chapters.map((c) => c.label);
      const chapterEmbeddings = await embedTexts(chapterLabels);
      for (let i = 0; i < chapters.length; i++) {
        const emb = chapterEmbeddings[i];
        if (!emb) continue;
        const truncated = emb.length > 1536 ? emb.slice(0, 1536) : emb;
        const { error: updateError } = await supabase
          .from("tutorial_chapters")
          .update({ label_embedding: truncated })
          .eq("video_id", video.video_id)
          .eq("start_seconds", chapters[i].start_seconds);
        if (updateError) {
          console.warn(
            `[video-indexing] Chapter embedding update failed for ${video.video_id} @${chapters[i].start_seconds}s:`,
            updateError.message
          );
        }
      }
    } catch (err) {
      console.warn(
        `[video-indexing] Chapter embedding best-effort failed for ${video.video_id}, chapters persisted without embeddings:`,
        (err as Error).message
      );
    }
  }

  if (transcriptChunks.length > 0) {
    try {
      const chunkTexts = transcriptChunks.map((c) => c.text);
      const chunkEmbeddings = await embedTexts(chunkTexts);
      for (let i = 0; i < transcriptChunks.length; i++) {
        const emb = chunkEmbeddings[i];
        if (!emb) continue;
        const truncated = emb.length > 1536 ? emb.slice(0, 1536) : emb;
        const { error: updateError } = await supabase
          .from("tutorial_chunks")
          .update({ embedding: truncated })
          .eq("video_id", video.video_id)
          .eq("start_seconds", transcriptChunks[i].start_seconds)
          .eq("skill_tag", skill);
        if (updateError) {
          console.warn(
            `[video-indexing] Chunk embedding update failed for ${video.video_id} @${transcriptChunks[i].start_seconds}s:`,
            updateError.message
          );
        }
      }
    } catch (err) {
      console.warn(
        `[video-indexing] Chunk embedding best-effort failed for ${video.video_id}, chunks persisted without embeddings:`,
        (err as Error).message
      );
    }
  }

  return {
    chapters: totalChapters,
    chunks: totalChunks,
    lessonInitialized,
  };
}
