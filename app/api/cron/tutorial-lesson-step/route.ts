import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  LESSON_BATCH_SIZE,
  generateLessonBatch,
  type LessonSection,
} from "@/lib/lesson-generation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

interface LessonProgressRow {
  video_id: string;
  sections: LessonSection[];
  summary: string | null;
  windows_total: number;
  next_window_index: number;
  generation_status: string;
  generation_error: string | null;
}

export async function GET(req: Request) {
  return POST(req);
}

export async function POST(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceRoleClient();
  if (!supabase) {
    return NextResponse.json({ error: "Missing Supabase env" }, { status: 500 });
  }

  // 1. Find all videos currently being processed (cap rows so one invocation
  //    does not exhaust its timeout on a large backlog)
  const { data: pendingRows, error: pendingError } = await supabase
    .from("video_lessons")
    .select("video_id, sections, summary, windows_total, next_window_index, generation_status, generation_error")
    .eq("generation_status", "processing")
    .limit(LESSON_BATCH_SIZE);

  if (pendingError) {
    return NextResponse.json(
      { error: `Failed to fetch pending lessons: ${pendingError.message}` },
      { status: 500 }
    );
  }

  const pending = (pendingRows ?? []) as LessonProgressRow[];

  if (pending.length === 0) {
    return NextResponse.json({ ok: true, processed: 0, message: "No pending lessons" });
  }

  const results: {
    video_id: string;
    status: string;
    sections_added: number;
    next_window_index: number;
    windows_total: number;
    error?: string;
  }[] = [];

  // Rate-limit between videos to stay within provider RPM limits
  const DELAY_BETWEEN_VIDEOS_MS = 2000;

  for (const row of pending) {
    try {
      // 2. Re-fetch allowed timestamps from persisted chapters/chunks
      const { data: chapters, error: chaptersError } = await supabase
        .from("tutorial_chapters")
        .select("start_seconds")
        .eq("video_id", row.video_id)
        .order("start_seconds");

      const { data: chunks, error: chunksError } = await supabase
        .from("tutorial_chunks")
        .select("start_seconds, chunk_text")
        .eq("video_id", row.video_id)
        .order("start_seconds");

      if (chaptersError || chunksError) {
        console.error(
          `[lesson-step] Source query failed for ${row.video_id}:`,
          chaptersError ?? chunksError
        );
        results.push({
          video_id: row.video_id,
          status: "retry",
          sections_added: 0,
          next_window_index: row.next_window_index,
          windows_total: row.windows_total,
          error: chaptersError?.message ?? chunksError?.message ?? "Source query failed",
        });
        continue;
      }

      const chapterStarts = (chapters ?? []).map((c) => c.start_seconds);
      const chunkStarts = (chunks ?? []).map((c) => c.start_seconds);
      const allowedTimestamps =
        chapterStarts.length > 0 ? chapterStarts : chunkStarts;
      const lessonChunks =
        (chunks ?? []).map((c) => ({
          start_seconds: c.start_seconds,
          chunk_text: c.chunk_text,
        }));

      if (allowedTimestamps.length === 0 || lessonChunks.length === 0) {
        const { error: failError } = await supabase
          .from("video_lessons")
          .update({
            generation_status: "failed",
            generation_error: "No chapters or chunks available for resume",
          })
          .eq("video_id", row.video_id)
          .eq("generation_status", "processing")
          .eq("next_window_index", row.next_window_index);

        if (failError) {
          console.error(`[lesson-step] Failed update (lost claim) for ${row.video_id}:`, failError);
        }
        results.push({
          video_id: row.video_id,
          status: "failed",
          sections_added: 0,
          next_window_index: row.next_window_index,
          windows_total: row.windows_total,
          error: "No chapters or chunks available for resume",
        });
        continue;
      }

      const existingSections = (row.sections ?? []) as LessonSection[];
      const existingStats = {
        windowsTotal: row.windows_total,
        windowsSucceeded: 0,
        windowsSkipped: 0,
        windowsFallbackTimestamp: 0,
        windowsTruncated: 0,
        skipReasons: {},
      };

      const result = await generateLessonBatch({
        videoId: row.video_id,
        videoTitle: "", // not needed for batch processing beyond prompt context
        channelName: "",
        allowedTimestamps,
        chunks: lessonChunks,
        startWindowIndex: row.next_window_index,
        batchSize: LESSON_BATCH_SIZE,
        existingSections,
        existingStats,
      });

      if (!result) {
        const { error: failError } = await supabase
          .from("video_lessons")
          .update({
            generation_status: "failed",
            generation_error: "Batch returned no sections — all filtered out",
          })
          .eq("video_id", row.video_id)
          .eq("generation_status", "processing")
          .eq("next_window_index", row.next_window_index);

        if (failError) {
          console.error(`[lesson-step] Failed update (lost claim) for ${row.video_id}:`, failError);
        }
        results.push({
          video_id: row.video_id,
          status: "failed",
          sections_added: 0,
          next_window_index: row.next_window_index,
          windows_total: row.windows_total,
          error: "Batch returned no sections",
        });
        continue;
      }

      const isComplete = row.next_window_index + LESSON_BATCH_SIZE >= row.windows_total;
      const nextIndex = Math.min(row.next_window_index + LESSON_BATCH_SIZE, row.windows_total);

      const updateData: Record<string, unknown> = {
        sections: result.sections,
        generation_status: isComplete ? "completed" : "processing",
        next_window_index: nextIndex,
        generation_error: null,
      };

      // Only update summary on completion (first batch's summary may be sparse)
      if (isComplete && result.summary) {
        updateData.summary = result.summary;
      }

      const { error: updateError } = await supabase
        .from("video_lessons")
        .update(updateData)
        .eq("video_id", row.video_id)
        .eq("generation_status", "processing")
        .eq("next_window_index", row.next_window_index);

      if (updateError) {
        console.error(`[lesson-step] Upsert failed for ${row.video_id}:`, updateError);
        results.push({
          video_id: row.video_id,
          status: "failed_upsert",
          sections_added: result.sections.length - existingSections.length,
          next_window_index: row.next_window_index,
          windows_total: row.windows_total,
          error: updateError.message,
        });
        continue;
      }

      results.push({
        video_id: row.video_id,
        status: isComplete ? "completed" : "processing",
        sections_added: result.sections.length - existingSections.length,
        next_window_index: nextIndex,
        windows_total: row.windows_total,
      });

      // Atomically increment ai_daily_usage for windows processed in this batch
      const windowsProcessed = Math.min(LESSON_BATCH_SIZE, row.windows_total - row.next_window_index);
      if (windowsProcessed > 0) {
        const today = new Date().toISOString().slice(0, 10);
        const { error: rpcError } = await supabase.rpc("increment_generate_calls", {
          p_usage_date: today,
          p_delta: windowsProcessed,
        });
        if (rpcError) {
          console.error(`[lesson-step] increment_generate_calls failed for ${row.video_id}:`, rpcError);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[lesson-step] Batch failed for ${row.video_id}:`, msg);
      const { error: failError } = await supabase
        .from("video_lessons")
        .update({
          generation_status: "failed",
          generation_error: msg,
        })
        .eq("video_id", row.video_id)
        .eq("generation_status", "processing")
        .eq("next_window_index", row.next_window_index);

      if (failError) {
        console.error(`[lesson-step] Failed update (lost claim) for ${row.video_id}:`, failError);
      }
      results.push({
        video_id: row.video_id,
        status: "failed",
        sections_added: 0,
        next_window_index: row.next_window_index,
        windows_total: row.windows_total,
        error: msg,
      });
    }

    // Rate-limit between videos
    if (results.length < pending.length) {
      await new Promise((r) => setTimeout(r, DELAY_BETWEEN_VIDEOS_MS));
    }
  }

  const completed = results.filter((r) => r.status === "completed").length;
  const failed = results.filter((r) => r.status.startsWith("failed")).length;
  const stillProcessing = results.filter((r) => r.status === "processing").length;

  return NextResponse.json({
    ok: true,
    processed: results.length,
    completed,
    failed,
    still_processing: stillProcessing,
    results,
  });
}
