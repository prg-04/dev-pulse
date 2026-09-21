import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { createYouTubeClient, YouTubeVideoCandidate } from "@/lib/youtube/client";
import { CURRENT_LESSON_MODEL } from "@/lib/lesson-generation";
import { embed, embedMany } from "ai";
import { fetchTranscript, YoutubeTranscriptError } from "youtube-transcript";

export const runtime = "nodejs";

interface ParsedChapter {
  start_seconds: number;
  label: string;
}

interface TranscriptChunk {
  start_seconds: number;
  text: string;
}

interface OnDemandResult {
  skill: string;
  status: "indexed" | "skipped_no_results" | "skipped_recent" | "failed";
  video_id?: string;
  chunks: number;
  chapters: number;
  lesson_initialized: boolean;
  error?: string;
}

const MIN_VIEW_COUNT = 10000;
const MIN_DURATION_SECONDS = 600;
const CHAPTER_MIN_LINES = 3;
const CHUNK_DURATION_SECONDS = 60;
const TITLE_EXCLUDE_PATTERN = /\bin\s+\d+\s*(seconds?|minutes?|mins?)\b/i;
const ON_DEMAND_COOLDOWN_MINUTES = 30;

function parseISOString(value: string | null): Date {
  if (!value) return new Date(0);
  return new Date(value);
}

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

  for (let i = 1; i < chapters.length; i++) {
    if (chapters[i].start_seconds <= chapters[i - 1].start_seconds) {
      return [];
    }
  }

  return chapters;
}

function chunkTranscript(
  transcript: { offset: number; text: string }[]
): TranscriptChunk[] {
  if (transcript.length === 0) return [];
  const normalized = transcript.map((t) => ({ offset: t.offset, text: t.text }));

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

async function withRetry<T>(
  fn: () => Promise<T>,
  { attempts = 3, baseDelayMs = 2000 } = {}
): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      const isRetryable =
        /429|5\d\d/.test(msg) || (err instanceof Error && /Failed to fetch/i.test(err.message));
      if (!isRetryable || i >= attempts - 1) {
        throw lastError;
      }
      const delayMs = baseDelayMs * Math.pow(2, i);
      console.warn(
        `[tutorial-index-ondemand] Retry ${i + 1}/${attempts - 1} after error: ${msg} (wait ${delayMs}ms)`
      );
      await new Promise((r) => setTimeout(r, delayMs));
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
            `[tutorial-index-ondemand] embed quota hit batch ${Math.floor(i / BATCH) + 1}, retry ${
              attempt + 1
            }/3 after ${Math.round(delay)}ms`
          );
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        throw e;
      }
    }
    if (i + BATCH < texts.length) {
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
  return all;
}

export async function indexSkillOnDemand(
  supabase: ReturnType<typeof createServiceRoleClient>,
  skill: string,
  youtubeApiKey: string
): Promise<OnDemandResult> {
  if (!supabase) {
    throw new Error("Supabase client is null");
  }

  // 1. Idempotency: check if on-demand was requested recently
  const { data: existingStatus } = await supabase
    .from("skill_index_status")
    .select("on_demand_requested_at, last_run_status")
    .eq("skill", skill)
    .maybeSingle();

  const existingRow = existingStatus as {
    on_demand_requested_at: string | null;
    last_run_status: string | null;
  } | null;

  if (existingRow?.on_demand_requested_at) {
    const lastRequested = parseISOString(existingRow.on_demand_requested_at);
    const cooldownMs = ON_DEMAND_COOLDOWN_MINUTES * 60 * 1000;
    if (Date.now() - lastRequested.getTime() < cooldownMs) {
      return {
        skill,
        status: "skipped_recent",
        chunks: 0,
        chapters: 0,
        lesson_initialized: false,
        error: `On-demand indexing was requested recently (${ON_DEMAND_COOLDOWN_MINUTES}m cooldown)`,
      };
    }
  }

  // 2. Mark as requested now
  await supabase
    .from("skill_index_status")
    .upsert(
      {
        skill,
        on_demand_requested_at: new Date().toISOString(),
      },
      { onConflict: "skill" }
    );

  // 3. Search YouTube for a single video
  const youtubeClient = createYouTubeClient();
  let candidates: YouTubeVideoCandidate[] = [];
  let youtubeError: string | null = null;
  try {
    candidates = await youtubeClient.searchVideos(skill, 5);
  } catch (err) {
    youtubeError = err instanceof Error ? err.message : String(err);
    console.error(`[tutorial-index-ondemand] YouTube search failed for "${skill}":`, youtubeError);
  }

  if (youtubeError) {
    await supabase
      .from("skill_index_status")
      .upsert(
        {
          skill,
          last_indexed_at: new Date().toISOString(),
          last_run_status: "failed",
          last_error: youtubeError,
        },
        { onConflict: "skill" }
      );
    return {
      skill,
      status: "failed",
      chunks: 0,
      chapters: 0,
      lesson_initialized: false,
      error: youtubeError,
    };
  }

  if (candidates.length === 0) {
    await supabase
      .from("skill_index_status")
      .upsert(
        {
          skill,
          last_indexed_at: new Date().toISOString(),
          last_run_status: "skipped_no_results",
          last_error: "No YouTube results for on-demand query",
        },
        { onConflict: "skill" }
      );
    return {
      skill,
      status: "skipped_no_results",
      chunks: 0,
      chapters: 0,
      lesson_initialized: false,
    };
  }

  const filtered = candidates.filter((c) => {
    if (c.view_count <= MIN_VIEW_COUNT) return false;
    if (c.duration_seconds <= MIN_DURATION_SECONDS) return false;
    if (TITLE_EXCLUDE_PATTERN.test(c.title)) return false;
    return true;
  });

  const selected = filtered.slice(0, 1);
  if (selected.length === 0) {
    const diag = `no_selected: candidates=${candidates.length} filtered=${filtered.length} (view>${MIN_VIEW_COUNT}, dur>${MIN_DURATION_SECONDS}s)`;
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
    return {
      skill,
      status: "skipped_no_results",
      chunks: 0,
      chapters: 0,
      lesson_initialized: false,
      error: diag,
    };
  }

  const video = selected[0];

  // 4. Check if this specific video is already indexed for this skill
  const { data: existingChunks } = await supabase
    .from("tutorial_chunks")
    .select("video_id")
    .eq("skill_tag", skill)
    .eq("video_id", video.video_id)
    .maybeSingle();

  if (existingChunks) {
    // Video already indexed; just ensure a lesson row exists
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
        console.error(`[tutorial-index-ondemand] Lesson init failed for ${video.video_id}:`, initError);
      }
    }

    await supabase
      .from("skill_index_status")
      .upsert(
        {
          skill,
          last_indexed_at: new Date().toISOString(),
          last_run_status: "success",
          last_error: null,
        },
        { onConflict: "skill" }
      );

    return {
      skill,
      status: "indexed",
      video_id: video.video_id,
      chunks: 0,
      chapters: 0,
      lesson_initialized: !!existingLesson,
    };
  }

  // 5. Parse chapters
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
        console.error(`[tutorial-index-ondemand] Chapter upsert failed for ${video.video_id}:`, chapterError);
      } else {
        totalChapters = chapters.length;
      }
    } catch (err) {
      console.error(`[tutorial-index-ondemand] Chapter upsert failed for ${video.video_id}:`, err);
    }
  }

  // 6. Fetch transcript
  let transcriptChunks: TranscriptChunk[] = [];
  try {
    const transcript = await withRetry(() => fetchTranscript(video.video_id), {
      attempts: 2,
      baseDelayMs: 4000,
    });
    const rawChunks = chunkTranscript(
      transcript.map((t) => ({ offset: t.offset, text: t.text }))
    );
    transcriptChunks = rawChunks;
  } catch (err) {
    if (err instanceof YoutubeTranscriptError) {
      console.warn(`[tutorial-index-ondemand] Transcript unavailable for ${video.video_id}:`, err.message);
    } else {
      console.error(`[tutorial-index-ondemand] Transcript fetch failed for ${video.video_id}:`, err);
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
        console.error(`[tutorial-index-ondemand] Chunk upsert failed for ${video.video_id}:`, chunkError);
      } else {
        totalChunks = transcriptChunks.length;
      }
    } catch (err) {
      console.error(`[tutorial-index-ondemand] Chunk upsert failed for ${video.video_id}:`, err);
    }
  }

  // 7. Initialize video_lessons row for lesson-step cron to pick up
  const needsLesson = totalChapters > 0 || totalChunks > 0;
  let lessonInitialized = false;

  if (needsLesson) {
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
        console.error(`[tutorial-index-ondemand] Lesson init failed for ${video.video_id}:`, initError);
      } else {
        lessonInitialized = true;
      }
    } else {
      lessonInitialized = true;
    }
  }

  // --- Best-effort embeddings ---
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
            `[tutorial-index-ondemand] Chapter embedding update failed for ${video.video_id} @${chapters[i].start_seconds}s:`,
            updateError.message
          );
        }
      }
    } catch (err) {
      console.warn(
        `[tutorial-index-ondemand] Chapter embedding best-effort failed for ${video.video_id}, chapters persisted without embeddings:`,
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
            `[tutorial-index-ondemand] Chunk embedding update failed for ${video.video_id} @${transcriptChunks[i].start_seconds}s:`,
            updateError.message
          );
        }
      }
    } catch (err) {
      console.warn(
        `[tutorial-index-ondemand] Chunk embedding best-effort failed for ${video.video_id}, chunks persisted without embeddings:`,
        (err as Error).message
      );
    }
  }

  // 8. Update skill_index_status
  const hasData = totalChunks > 0 || totalChapters > 0;
  let runStatus: string;
  let runError: string | null = null;

  if (hasData) {
    runStatus = "success";
  } else {
    runStatus = "success_empty";
    runError = "Video found but no chapters/transcript data extracted";
  }

  await supabase
    .from("skill_index_status")
    .upsert(
      {
        skill,
        last_indexed_at: new Date().toISOString(),
        last_run_status: runStatus,
        last_error: runError,
      },
      { onConflict: "skill" }
    );

  console.info(
    `[tutorial-index-ondemand] Skill "${skill}" status=${runStatus} video=${video.video_id} chunks=${totalChunks} chapters=${totalChapters} lesson=${lessonInitialized}`
  );

  return {
    skill,
    status: runStatus === "success" ? "indexed" : "skipped_no_results",
    video_id: video.video_id,
    chunks: totalChunks,
    chapters: totalChapters,
    lesson_initialized: lessonInitialized,
    error: runError ?? undefined,
  };
}
