import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { createYouTubeClient } from "@/lib/youtube/client";
import { SKILLS_DICTIONARY, normalizeSkill, ALL_SKILLS } from "@/lib/skills-dictionary";
import { embed, embedMany } from "ai";
import { fetchTranscript, YoutubeTranscriptError } from "youtube-transcript";
import {
  CURRENT_LESSON_MODEL,
  generateLessonBatch,
  LESSON_BATCH_SIZE,
  WINDOW_CHAR_BUDGET,
  type LessonSection,
} from "@/lib/lesson-generation";
import {
  MIN_VIEW_COUNT,
  MIN_DURATION_SECONDS,
  TITLE_EXCLUDE_PATTERN,
  filterCandidates,
} from "@/lib/video-indexing";

export const runtime = "nodejs";

// --- Types ---
interface SkillIndexStatus {
  skill: string;
  last_indexed_at: string | null;
  gap_mentions_30d: number;
  total_chunks: number;
  total_chapters: number;
  last_run_status: string | null;
  last_error: string | null;
}

interface ParsedChapter {
  start_seconds: number;
  label: string;
}

interface TranscriptChunk {
  start_seconds: number;
  text: string;
}

// --- Constants ---
const WEEKLY_INDEX_BUDGET = Number(process.env.WEEKLY_INDEX_BUDGET ?? "10");
const MAX_VIDEOS_PER_SKILL = 3;
const CHAPTER_MIN_LINES = 3;
const CHUNK_DURATION_SECONDS = 60;

// --- Helpers ---

/** Retry an async function up to `attempts` times with a fixed delay between tries. */
async function withRetry<T>(
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
          `[tutorial-index] Retry ${i + 1}/${attempts - 1} after error: ${
            err instanceof Error ? err.message : err
          }`
        );
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }
  throw lastError;
}
function parseISOString(value: string | null): Date {
  if (!value) return new Date(0);
  return new Date(value);
}

// Parse timestamp lines from YouTube description.
// Requires at least CHAPTER_MIN_LINES matching lines in ascending time order.
function parseChapters(description: string): ParsedChapter[] {
  const lines = description.split("\n");
  const chapters: ParsedChapter[] = [];
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

  if (chapters.length < CHAPTER_MIN_LINES) {
    return [];
  }

  // Verify ascending time order
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

function chunkTranscript(
  transcript: { offset: number; text: string }[]
): TranscriptChunk[] {
  if (transcript.length === 0) return [];
  const normalized = normalizeTranscriptOffsets(transcript as { offset: number; text: string; duration?: number }[]);
  if (normalized.length === 0) return [];

  const chunks: TranscriptChunk[] = [];
  let currentChunk: TranscriptChunk = { start_seconds: normalized[0].offset, text: "" };

  for (const item of normalized) {
    const chunkEnd = currentChunk.start_seconds + CHUNK_DURATION_SECONDS;
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

// --- Per-skill indexing ---
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
          // DB vector is 1536; gemini-embedding-001 returns 3072 — truncate to 1536 for pgvector
          all.push(embedding.length > 1536 ? embedding.slice(0, 1536) : embedding);
        } else {
          const { embeddings } = await embedMany({ model, values: batch });
          for (const e of embeddings) all.push(e.length > 1536 ? e.slice(0, 1536) : e);
        }
        break;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        const isQuota = msg.includes("Quota exceeded") || msg.includes("429") || (e as { statusCode?: number })?.statusCode === 429;
        if (isQuota && attempt < 3) {
          const delay = 35000 + Math.random() * 5000;
          console.warn(`[tutorial-index] embed quota hit batch ${Math.floor(i / BATCH) + 1}, retry ${attempt + 1}/3 after ${Math.round(delay)}ms`);
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

// --- Daily quota guard ---
const DAILY_GENERATE_LIMIT = 90;
let inMemoryGenerateCount = 0;

async function getTodayUsage(
  supabase: ReturnType<typeof createServiceRoleClient>,
): Promise<{ generate_calls: number; embed_calls: number }> {
  if (!supabase) return { generate_calls: inMemoryGenerateCount, embed_calls: 0 };
  const today = new Date().toISOString().slice(0, 10);
  try {
    const { data } = await supabase
      .from("ai_daily_usage")
      .select("generate_calls, embed_calls")
      .eq("usage_date", today)
      .maybeSingle();
    const dbCalls = (data as { generate_calls: number } | null)?.generate_calls ?? 0;
    return {
      generate_calls: Math.max(dbCalls, inMemoryGenerateCount),
      embed_calls: (data as { embed_calls: number } | null)?.embed_calls ?? 0,
    };
  } catch {
    return { generate_calls: inMemoryGenerateCount, embed_calls: 0 };
  }
}

async function incrementGenerateUsage(
  supabase: ReturnType<typeof createServiceRoleClient>,
  windowsUsed: number,
): Promise<void> {
  if (!supabase || windowsUsed <= 0) return;
  inMemoryGenerateCount += windowsUsed;
  const today = new Date().toISOString().slice(0, 10);
  try {
    const { error: rpcError } = await supabase.rpc("increment_generate_calls", {
      p_usage_date: today,
      p_delta: windowsUsed,
    });
    if (rpcError) {
      console.error("[tutorial-index] increment_generate_calls failed:", rpcError);
    }
  } catch {
    // table not yet migrated — in-memory guard still enforces per-run limit
  }
}

async function hasGenerateQuotaForVideo(
  supabase: ReturnType<typeof createServiceRoleClient>,
  lessonChunks: { start_seconds: number; chunk_text: string }[],
): Promise<boolean> {
  if (!supabase) return true;
  // Estimate total windows for this video using the shared budget constant.
  const sorted = [...lessonChunks].sort((a, b) => a.start_seconds - b.start_seconds);
  let windows = 0;
  let currentChars = 0;
  let currentLen = 0;
  for (const c of sorted) {
    if (currentLen > 0 && currentChars + c.chunk_text.length > WINDOW_CHAR_BUDGET) {
      windows += 1;
      currentChars = 0;
      currentLen = 0;
    }
    currentChars += c.chunk_text.length;
    currentLen += 1;
  }
  if (currentLen > 0) windows += 1;
  const { generate_calls } = await getTodayUsage(supabase);
  // We only need enough quota for the first batch; remaining windows are
  // processed by the lesson-step cron on subsequent runs.
  const windowsNeeded = Math.max(1, Math.min(windows, LESSON_BATCH_SIZE));
  return generate_calls + windowsNeeded <= DAILY_GENERATE_LIMIT;
}

// --- Per-skill indexing ---
async function indexSkill(
  supabase: ReturnType<typeof createServiceRoleClient>,
  skill: string,
  youtubeApiKey: string,
  gapCounts: Map<string, number>
): Promise<{ videos: number; chunks: number; chapters: number; lessons: number; lessonGenerateMs: number; status: string }> {
  if (!supabase) {
    throw new Error("Supabase client is null");
  }
  // 1. Search YouTube
  const youtubeClient = createYouTubeClient();
  const candidates = await youtubeClient.searchVideos(skill, 14);
  if (candidates.length === 0) {
    await supabase
      .from("skill_index_status")
      .upsert(
        {
          skill,
          last_indexed_at: new Date().toISOString(),
          last_run_status: "skipped_no_results",
          last_error: null,
        },
        { onConflict: "skill" }
      );
    return { videos: 0, chunks: 0, chapters: 0, lessons: 0, lessonGenerateMs: 0, status: "skipped_no_results" };
  }

  const filtered = filterCandidates(candidates);
  const selected = filtered.slice(0, MAX_VIDEOS_PER_SKILL);
  if (selected.length === 0) {
    const diag = `no_selected: candidates=${candidates.length} filtered=${filtered.length} (view>${MIN_VIEW_COUNT}, dur>${MIN_DURATION_SECONDS}s, titleExclude=${TITLE_EXCLUDE_PATTERN.source})`;
    await supabase
      .from("skill_index_status")
      .upsert(
        {
          skill,
          last_indexed_at: new Date().toISOString(),
          last_run_status: "skipped_no_results",
          last_error: diag,
        },
        { onConflict: "skill" }
      );
    console.warn(`[tutorial-index] ${skill}: ${diag}`);
    return { videos: 0, chunks: 0, chapters: 0, lessons: 0, lessonGenerateMs: 0, status: "skipped_no_results" };
  }

  // 3. Check which videos are already indexed for this skill
  const videoIds = selected.map((v) => v.video_id);
  const { data: existingChunks } = await supabase
    .from("tutorial_chunks")
    .select("video_id")
    .eq("skill_tag", skill)
    .in("video_id", videoIds);

  const existingVideoIds = new Set(
    (existingChunks ?? []).map((r: { video_id: string }) => r.video_id)
  );
  const newVideos = selected.filter((v) => !existingVideoIds.has(v.video_id));

  let totalChapters = 0;
  let totalChunks = 0;
  let totalLessons = 0;
  let lessonGenerateMs = 0;
  let videosWithData = 0;
  let videosWithoutData = 0;
  const failedVideoReasons: string[] = [];

  // 4. Process each new video: chapters + transcript + lesson notes (Feature 5)
  for (let vi = 0; vi < newVideos.length; vi++) {
    const video = newVideos[vi];
    if (vi > 0) await new Promise((r) => setTimeout(r, 1800));
    // --- Chapters — decoupled persistence: chunks first, embeddings best-effort ---
    const chapters = parseChapters(video.description);
    if (chapters.length > 0) {
      // 1. Persist chapters immediately without embeddings (embedding may be null if quota fails)
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
          console.error(`[tutorial-index] Chapter upsert (without embedding) failed for ${video.video_id}:`, chapterError);
        } else {
          totalChapters += chapters.length;
        }
      } catch (err) {
        console.error(`[tutorial-index] Chapter upsert (without embedding) failed for ${video.video_id}:`, err);
      }
      // Embedding is best-effort and runs AFTER lesson generation so a quota
      // exhaustion or timeout during embedding does not block lesson init.
    }

    // --- Transcript ---
    let transcriptChunks: TranscriptChunk[] = [];
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
        console.warn(`[tutorial-index] Transcript unavailable for ${video.video_id}:`, err.message);
      } else {
        console.error(`[tutorial-index] Transcript fetch failed for ${video.video_id}:`, err);
      }
    }

    if (transcriptChunks.length > 0) {
      // 1. Persist chunks immediately with null embedding — lesson generation uses chunk_text, not embeddings
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
          console.error(`[tutorial-index] Chunk upsert (without embedding) failed for ${video.video_id}:`, chunkError);
        } else {
          totalChunks += transcriptChunks.length;
        }
      } catch (err) {
        console.error(`[tutorial-index] Chunk upsert (without embedding) failed for ${video.video_id}:`, err);
      }
      // Embedding is best-effort and runs AFTER lesson generation so a quota
      // exhaustion or timeout during embedding does not block lesson init.
    }

    const needsLesson = chapters.length > 0 || transcriptChunks.length > 0;
    if (needsLesson) {
      try {
        const { data: existingLesson } = await supabase
          .from("video_lessons")
          .select("video_id, model, generation_status, sections, summary")
          .eq("video_id", video.video_id)
          .maybeSingle();
        const existingLessonRow = existingLesson as {
          video_id: string;
          model: string;
          generation_status?: string;
          sections?: LessonSection[];
          summary?: string | null;
        } | null;

        // Regenerate when: no row exists, model changed, or previous run failed.
        // A failed row with the current model is retried; its existing sections
        // are preserved so the batch generator can resume rather than restart.
        const needsRegen =
          !existingLessonRow ||
          existingLessonRow.model !== CURRENT_LESSON_MODEL ||
          existingLessonRow.generation_status === "failed";

        if (needsRegen) {
          const allowedTimestamps =
            chapters.length > 0
              ? chapters.map((c) => c.start_seconds)
              : transcriptChunks.map((c) => c.start_seconds);
          const lessonChunks =
            transcriptChunks.length > 0
              ? transcriptChunks.map((c) => ({ start_seconds: c.start_seconds, chunk_text: c.text }))
              : chapters.map((c) => ({ start_seconds: c.start_seconds, chunk_text: c.label }));
          if (lessonChunks.length > 0 && allowedTimestamps.length > 0) {
            const hasQuota = await hasGenerateQuotaForVideo(supabase, lessonChunks);
            if (!hasQuota) {
              console.warn(
                `[tutorial-index] Skipping lesson for ${video.video_id}: daily generate quota exhausted`,
              );
            } else {
              // Build windows to determine total count for progress tracking
              const { buildWindows } = await import("@/lib/lesson-generation");
              const windowsTotal = buildWindows(lessonChunks).length;

              // Initialize or reset progress tracking in video_lessons.
              // New rows get a full insert; existing rows are updated in place
              // so previously-generated sections and summary are preserved.
              const isModelChange = !!existingLessonRow && existingLessonRow.model !== CURRENT_LESSON_MODEL;
              if (!existingLessonRow) {
                const { error: initError } = await supabase.from("video_lessons").insert({
                  video_id: video.video_id,
                  sections: [],
                  summary: null,
                  model: CURRENT_LESSON_MODEL,
                  windows_total: windowsTotal,
                  next_window_index: 0,
                  generation_status: "processing",
                  generation_error: null,
                });
                if (initError) {
                  console.error(`[tutorial-index] Lesson init failed for ${video.video_id}:`, initError);
                  continue;
                }
              } else if (isModelChange) {
                const { error: initError } = await supabase.from("video_lessons").update({
                  sections: [],
                  summary: null,
                  model: CURRENT_LESSON_MODEL,
                  windows_total: windowsTotal,
                  next_window_index: 0,
                  generation_status: "processing",
                  generation_error: null,
                }).eq("video_id", video.video_id);
                if (initError) {
                  console.error(`[tutorial-index] Lesson reset failed for ${video.video_id}:`, initError);
                  continue;
                }
              } else {
                // Retrying a failed or stalled row — preserve existing content
                const { error: initError } = await supabase
                  .from("video_lessons")
                  .update({
                    windows_total: windowsTotal,
                    next_window_index: 0,
                    generation_status: "processing",
                    generation_error: null,
                  })
                  .eq("video_id", video.video_id);
                if (initError) {
                  console.error(`[tutorial-index] Lesson retry init failed for ${video.video_id}:`, initError);
                  continue;
                }
              }

              const t0 = Date.now();
              const lesson = await generateLessonBatch({
                videoId: video.video_id,
                videoTitle: video.title,
                channelName: video.channel_name,
                allowedTimestamps,
                chunks: lessonChunks,
                startWindowIndex: 0,
                batchSize: LESSON_BATCH_SIZE,
                existingSections: (existingLessonRow?.sections ?? []) as LessonSection[],
                existingSummary: existingLessonRow?.summary ?? null,
              });
              lessonGenerateMs += Date.now() - t0;

              if (lesson) {
                // Increment usage by the number of windows actually processed in this batch
                const windowsProcessed = Math.min(LESSON_BATCH_SIZE, windowsTotal);
                await incrementGenerateUsage(supabase, windowsProcessed);
                if (lesson.stats) {
                  console.info(
                    `[tutorial-index] Lesson batch stats for ${video.video_id}: ${JSON.stringify(lesson.stats)}`,
                  );
                }
                const isComplete = LESSON_BATCH_SIZE >= windowsTotal;
                const { error: lessonError } = await supabase.from("video_lessons").upsert(
                  {
                    video_id: video.video_id,
                    sections: lesson.sections,
                    summary: isComplete ? lesson.summary : null,
                    model: CURRENT_LESSON_MODEL,
                    windows_total: windowsTotal,
                    next_window_index: Math.min(LESSON_BATCH_SIZE, windowsTotal),
                    generation_status: isComplete ? "completed" : "processing",
                    generation_error: null,
                  },
                  { onConflict: "video_id" }
                );
                if (lessonError) {
                  console.error(`[tutorial-index] Lesson upsert failed for ${video.video_id}:`, lessonError);
                } else {
                  totalLessons += 1;
                }
              } else {
                // Batch returned null — mark as failed
                const { error: failError } = await supabase.from("video_lessons").update({
                  generation_status: "failed",
                  generation_error: "Batch returned no sections",
                }).eq("video_id", video.video_id);
                if (failError) {
                  console.error(`[tutorial-index] Lesson failed update (lost claim) for ${video.video_id}:`, failError);
                }
              }
            }
          }
        }
      } catch (err) {
        console.error(`[tutorial-index] Lesson generation failed for ${video.video_id}:`, err);
        const { error: failError } = await supabase.from("video_lessons").update({
          generation_status: "failed",
          generation_error: err instanceof Error ? err.message : String(err),
        }).eq("video_id", video.video_id);
        if (failError) {
          console.error(`[tutorial-index] Lesson failed update (lost claim) for ${video.video_id}:`, failError);
        }
      }
    }

    // --- Best-effort embeddings — run AFTER lesson init so cron timeouts
    //     during embedding do not prevent lesson rows from being created ---
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
            console.warn(`[tutorial-index] Chapter embedding update failed for ${video.video_id} @${chapters[i].start_seconds}s:`, updateError.message);
          }
        }
      } catch (err) {
        console.warn(`[tutorial-index] Chapter embedding best-effort failed for ${video.video_id}, chapters persisted without embeddings:`, (err as Error).message);
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
            console.warn(`[tutorial-index] Chunk embedding update failed for ${video.video_id} @${transcriptChunks[i].start_seconds}s:`, updateError.message);
          }
        }
      } catch (err) {
        console.warn(`[tutorial-index] Chunk embedding best-effort failed for ${video.video_id}, chunks persisted without embeddings:`, (err as Error).message);
      }
    }

    // Track whether this video produced any indexable data
    const videoProducedData = chapters.length > 0 || transcriptChunks.length > 0;
    if (videoProducedData) {
      videosWithData++;
    } else {
      videosWithoutData++;
      const reasons: string[] = [];
      if (chapters.length === 0) reasons.push("no chapters parsed");
      if (transcriptChunks.length === 0) reasons.push("transcript unavailable");
      failedVideoReasons.push(`${video.video_id}: ${reasons.join(", ")}`);
    }
  }

  // --- Backfill: regenerate stale lessons and fill missing (Fix 1 + Fix 2 backfill) ---
  // Covers videos indexed before Feature 5, failed generations, and stale model versions.
  // Uses the same incremental approach as the main loop — processes only the first
  // batch per video; the lesson-step cron picks up the rest.
  try {
    const allCandidates = selected;
    const candidateIds = allCandidates.map((v) => v.video_id);
    if (candidateIds.length > 0) {
      const { data: existingLessonsRows } = await supabase
        .from("video_lessons")
        .select("video_id, model, generation_status")
        .in("video_id", candidateIds);
      const lessonsMap = new Map(
        (existingLessonsRows ?? []).map((r: { video_id: string; model: string; generation_status?: string; sections?: LessonSection[]; summary?: string | null }) => [r.video_id, r]),
      );
      const toRegen = allCandidates.filter((v) => {
        const m = lessonsMap.get(v.video_id);
        // Skip if currently being processed by lesson-step cron
        if (m && (m as { generation_status?: string }).generation_status === "processing") return false;
        // Regenerate when missing, stale model, or previous run failed
        return !m || m.model !== CURRENT_LESSON_MODEL || m.generation_status === "failed";
      });
      for (const video of toRegen) {
        try {
          const { data: storedChapters } = await supabase
            .from("tutorial_chapters")
            .select("start_seconds, label")
            .eq("video_id", video.video_id)
            .order("start_seconds", { ascending: true });
          const { data: storedChunks } = await supabase
            .from("tutorial_chunks")
            .select("start_seconds, chunk_text, video_title, channel_name")
            .eq("video_id", video.video_id)
            .order("start_seconds", { ascending: true });

          const chaptersForVideo = (storedChapters ?? []) as { start_seconds: number; label: string }[];
          const chunksForVideo = (storedChunks ?? []) as { start_seconds: number; chunk_text: string; video_title: string; channel_name: string }[];

          const needsLesson = chaptersForVideo.length > 0 || chunksForVideo.length > 0;
          if (!needsLesson) continue;

          const allowedTimestamps =
            chaptersForVideo.length > 0
              ? chaptersForVideo.map((c) => c.start_seconds)
              : chunksForVideo.map((c) => c.start_seconds);

          const lessonChunks =
            chunksForVideo.length > 0
              ? chunksForVideo.map((c) => ({ start_seconds: c.start_seconds, chunk_text: c.chunk_text }))
              : chaptersForVideo.map((c) => ({ start_seconds: c.start_seconds, chunk_text: c.label }));

          if (lessonChunks.length === 0 || allowedTimestamps.length === 0) continue;

          const hasQuota = await hasGenerateQuotaForVideo(supabase, lessonChunks);
          if (!hasQuota) {
            console.warn(
              `[tutorial-index] Skipping backfill lesson for ${video.video_id}: daily generate quota exhausted`,
            );
            continue;
          }

          const title = chunksForVideo[0]?.video_title ?? video.title;
          const channel = chunksForVideo[0]?.channel_name ?? video.channel_name;

          const windowsTotal = (await import("@/lib/lesson-generation")).buildWindows(lessonChunks).length;

          // Initialize or reset progress tracking.
          // New rows get a full insert; existing rows are updated in place
          // so previously-generated sections and summary are preserved.
          const existingLessonForVideo = lessonsMap.get(video.video_id);
          const isModelChange =
            !!existingLessonForVideo &&
            existingLessonForVideo.model !== CURRENT_LESSON_MODEL;

          if (!existingLessonForVideo) {
            const { error: initError } = await supabase.from("video_lessons").insert({
              video_id: video.video_id,
              sections: [],
              summary: null,
              model: CURRENT_LESSON_MODEL,
              windows_total: windowsTotal,
              next_window_index: 0,
              generation_status: "processing",
              generation_error: null,
            });
            if (initError) {
              console.error(`[tutorial-index] Backfill lesson init failed for ${video.video_id}:`, initError);
              continue;
            }
          } else if (isModelChange) {
            const { error: initError } = await supabase.from("video_lessons").update({
              sections: [],
              summary: null,
              model: CURRENT_LESSON_MODEL,
              windows_total: windowsTotal,
              next_window_index: 0,
              generation_status: "processing",
              generation_error: null,
            }).eq("video_id", video.video_id);
            if (initError) {
              console.error(`[tutorial-index] Backfill lesson reset failed for ${video.video_id}:`, initError);
              continue;
            }
          } else {
            // Retrying a failed or stalled row — preserve existing content
            const { error: initError } = await supabase
              .from("video_lessons")
              .update({
                windows_total: windowsTotal,
                next_window_index: 0,
                generation_status: "processing",
                generation_error: null,
              })
              .eq("video_id", video.video_id);
            if (initError) {
              console.error(`[tutorial-index] Backfill lesson retry init failed for ${video.video_id}:`, initError);
              continue;
            }
          }

          const t0 = Date.now();
          const lesson = await generateLessonBatch({
            videoId: video.video_id,
            videoTitle: title,
            channelName: channel,
            allowedTimestamps,
            chunks: lessonChunks,
            startWindowIndex: 0,
            batchSize: LESSON_BATCH_SIZE,
            existingSections: (existingLessonForVideo?.sections as LessonSection[] | undefined) ?? [],
            existingSummary: existingLessonForVideo?.summary ?? null,
          });
          lessonGenerateMs += Date.now() - t0;

          if (lesson) {
            const windowsProcessed = Math.min(LESSON_BATCH_SIZE, windowsTotal);
            await incrementGenerateUsage(supabase, windowsProcessed);
            if (lesson.stats) {
              console.info(
                `[tutorial-index] Backfill lesson batch stats for ${video.video_id}: ${JSON.stringify(lesson.stats)}`,
              );
            }
            const isComplete = LESSON_BATCH_SIZE >= windowsTotal;
            const { error: lessonError } = await supabase.from("video_lessons").upsert(
              {
                video_id: video.video_id,
                sections: lesson.sections,
                summary: isComplete ? lesson.summary : null,
                model: CURRENT_LESSON_MODEL,
                windows_total: windowsTotal,
                next_window_index: Math.min(LESSON_BATCH_SIZE, windowsTotal),
                generation_status: isComplete ? "completed" : "processing",
                generation_error: null,
              },
              { onConflict: "video_id" }
            );
            if (!lessonError) totalLessons += 1;
          } else {
            const { error: failError } = await supabase.from("video_lessons").update({
              generation_status: "failed",
              generation_error: "Batch returned no sections",
            }).eq("video_id", video.video_id)
              .eq("generation_status", "processing");
            if (failError) {
              console.error(`[tutorial-index] Backfill lesson failed update (lost claim) for ${video.video_id}:`, failError);
            }
          }
        } catch (err) {
          console.error(`[tutorial-index] Backfill lesson failed for ${video.video_id}:`, err);
          const { error: failError } = await supabase.from("video_lessons").update({
            generation_status: "failed",
            generation_error: err instanceof Error ? err.message : String(err),
          }).eq("video_id", video.video_id)
            .eq("generation_status", "processing");
          if (failError) {
            console.error(`[tutorial-index] Backfill lesson failed update (lost claim) for ${video.video_id}:`, failError);
          }
        }
      }
    }
  } catch (err) {
    console.error(`[tutorial-index] Backfill pass failed for ${skill}:`, err);
  }

  // 5. Count total chapters for this skill (distinct video_ids that have chapters)
  const { count: chapterVideos } = await supabase
    .from("tutorial_chapters")
    .select("video_id", { count: "exact", head: true })
    .in("video_id", videoIds);

  const { count: chunkCount } = await supabase
    .from("tutorial_chunks")
    .select("id", { count: "exact", head: true })
    .eq("skill_tag", skill);

  const hasExistingData = (chunkCount ?? 0) > 0 || (chapterVideos ?? 0) > 0;
  const producedNewData = totalChunks > 0 || totalChapters > 0;

  let runStatus: string;
  let runError: string | null;

  if (hasExistingData && producedNewData && videosWithoutData > 0) {
    runStatus = "partial";
    const sampleReasons = failedVideoReasons.slice(0, 3).join("; ");
    runError = `${videosWithData} of ${newVideos.length} new videos produced data; ${videosWithoutData} failed (${sampleReasons})`;
  } else if (hasExistingData && producedNewData) {
    runStatus = "success";
    runError = null;
  } else if (hasExistingData && !producedNewData) {
    if (newVideos.length > 0) {
      // New videos were attempted but every one failed — not a success.
      runStatus = "failed";
      runError = `${videosWithoutData} new videos all failed (${failedVideoReasons.slice(0, 3).join("; ")})`;
    } else {
      // All selected videos were already indexed; no new data needed this run.
      runStatus = "success";
      runError = null;
    }
  } else if (!hasExistingData && producedNewData) {
    runStatus = "success";
    runError = null;
  } else if (!hasExistingData && !producedNewData && selected.length > 0) {
    if (videosWithoutData > 0) {
      runStatus = "failed";
      runError = `${videosWithoutData} new videos all failed (${failedVideoReasons.slice(0, 3).join("; ")})`;
    } else {
      runStatus = "success_empty";
      runError = `${selected.length} videos found, transcripts unavailable for all`;
    }
  } else {
    runStatus = "skipped_no_results";
    runError = null;
  }

  await supabase
    .from("skill_index_status")
    .upsert(
      {
        skill,
        last_indexed_at: new Date().toISOString(),
        gap_mentions_30d: gapCounts.get(skill) ?? 0,
        total_chunks: chunkCount ?? 0,
        total_chapters: chapterVideos ?? 0,
        last_run_status: runStatus,
        last_error: runError,
      },
      { onConflict: "skill" }
    );

  console.info(
    `[tutorial-index] Skill "${skill}" status=${runStatus} videos=${selected.length} new=${newVideos.length} withData=${videosWithData} withoutData=${videosWithoutData} lessons: ${totalLessons} generated in ${lessonGenerateMs}ms`
  );

  return {
    videos: newVideos.length,
    chunks: totalChunks,
    chapters: totalChapters,
    lessons: totalLessons,
    lessonGenerateMs,
    status: runStatus,
  };
}

// --- Main cron handler ---
export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceRoleClient();
  if (!supabase) {
    return NextResponse.json({ error: "Missing Supabase env" }, { status: 500 });
  }

  const youtubeApiKey = process.env.YOUTUBE_API_KEY;
  if (!youtubeApiKey) {
    return NextResponse.json({ error: "YOUTUBE_API_KEY is not configured" }, { status: 500 });
  }

  const url = new URL(req.url);
  const canarySkill = url.searchParams.get("skill");
  const canaryLimit = url.searchParams.get("limit");

  // 1. Refresh gap_mentions_30d for all skills from gap_report_events
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const { data: gapEvents, error: gapError } = await supabase
    .from("gap_report_events")
    .select("skill")
    .gte("created_at", thirtyDaysAgo.toISOString());

  if (gapError) {
    return NextResponse.json(
      { error: `Failed to fetch gap_report_events: ${gapError.message}` },
      { status: 500 }
    );
  }

  const gapCounts = new Map<string, number>();
  for (const row of gapEvents ?? []) {
    const skill = (row as { skill: string }).skill;
    gapCounts.set(skill, (gapCounts.get(skill) ?? 0) + 1);
  }

  // 2. Load existing skill_index_status for all known skills
  const { data: statusRows, error: statusError } = await supabase
    .from("skill_index_status")
    .select("*");

  if (statusError) {
    return NextResponse.json(
      { error: `Failed to fetch skill_index_status: ${statusError.message}` },
      { status: 500 }
    );
  }

  const statusMap = new Map<string, SkillIndexStatus>();
  for (const row of statusRows ?? []) {
    statusMap.set(row.skill, row as SkillIndexStatus);
  }

  // 3. Build ranked list of all dictionary skills
  const allSkills = Object.keys(SKILLS_DICTIONARY);
  const scored = allSkills.map((skill) => {
    const status = statusMap.get(skill);
    const gapMentions = gapCounts.get(skill) ?? 0;
    const lastIndexedAt = status?.last_indexed_at ?? null;
    return { skill, gapMentions, lastIndexedAt };
  });

  // Sort: primary by gapMentions desc, secondary by lastIndexedAt asc (older first)
  scored.sort((a, b) => {
    if (b.gapMentions !== a.gapMentions) {
      return b.gapMentions - a.gapMentions;
    }
    const aTime = parseISOString(a.lastIndexedAt).getTime();
    const bTime = parseISOString(b.lastIndexedAt).getTime();
    return aTime - bTime;
  });

  // 4. Reserve slots for never-indexed skills with zero gap mentions
  const neverIndexed = scored.filter((s) => s.gapMentions === 0 && !s.lastIndexedAt);
  const reserveCount = Math.min(Math.floor(WEEKLY_INDEX_BUDGET * 0.2), neverIndexed.length);
  const reserved = neverIndexed.slice(0, reserveCount);

  const prioritized = scored.filter((s) => !reserved.includes(s));
  let selected = [...reserved, ...prioritized].slice(0, WEEKLY_INDEX_BUDGET);
  if (canarySkill) {
    // Validate against the skill dictionary (same pattern as the ondemand
    // route): an unknown value must be rejected, never indexed verbatim —
    // a pasted Gap object here once wrote JSON skill_tags for two videos.
    const normalized = normalizeSkill(canarySkill);
    if (!normalized || !ALL_SKILLS.includes(normalized)) {
      return NextResponse.json(
        { error: `Unknown skill: ${canarySkill}. Must be one of: ${ALL_SKILLS.join(", ")}` },
        { status: 400 }
      );
    }
    const found = scored.find((s) => s.skill.toLowerCase() === normalized);
    selected = found ? [found] : [{ skill: normalized, gapMentions: 0, lastIndexedAt: null }];
  } else if (canaryLimit) {
    const n = Math.min(Math.max(parseInt(canaryLimit, 10) || WEEKLY_INDEX_BUDGET, 1), WEEKLY_INDEX_BUDGET);
    selected = selected.slice(0, n);
  }
  const selectedSkills = selected.map((s) => s.skill);

  const skillSummary: Record<string, { videos: number; chunks: number; chapters: number; lessons: number; lessonGenerateMs?: number; status: string }> = {};
  const errors: string[] = [];

  // 5. Process each selected skill
  for (const skill of selectedSkills) {
    try {
      const result = await indexSkill(supabase, skill, youtubeApiKey, gapCounts);
      skillSummary[skill] = result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[tutorial-index] Skill "${skill}" failed:`, msg);
      errors.push(`${skill}: ${msg}`);

      await supabase
        .from("skill_index_status")
        .upsert(
          {
            skill,
            last_indexed_at: new Date().toISOString(),
            last_run_status: "failed",
            last_error: msg,
          },
          { onConflict: "skill" }
        );

      skillSummary[skill] = { videos: 0, chunks: 0, chapters: 0, lessons: 0, status: "failed" };
    }
  }

  const totalVideos = Object.values(skillSummary).reduce((sum, s) => sum + s.videos, 0);
  const totalChunks = Object.values(skillSummary).reduce((sum, s) => sum + s.chunks, 0);
  const totalChapters = Object.values(skillSummary).reduce((sum, s) => sum + s.chapters, 0);
  const totalLessonsAll = Object.values(skillSummary).reduce((sum, s) => sum + (s.lessons ?? 0), 0);
  const totalLessonMs = Object.values(skillSummary).reduce((sum, s) => sum + ((s as unknown as { lessonGenerateMs?: number }).lessonGenerateMs ?? 0), 0);

  return NextResponse.json({
    ok: true,
    skillsProcessed: selectedSkills.length,
    skills: selectedSkills,
    totalVideos,
    totalChunks,
    totalChapters,
    totalLessons: totalLessonsAll,
    totalLessonMs,
    errors: errors.length > 0 ? errors : undefined,
    details: skillSummary,
  });
}
