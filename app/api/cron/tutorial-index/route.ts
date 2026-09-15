import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { SKILLS_DICTIONARY } from "@/lib/skills-dictionary";
import { embed, embedMany } from "ai";
import { fetchTranscript, YoutubeTranscriptError } from "youtube-transcript";
import {
  buildTranscriptFromChunks,
  CURRENT_LESSON_MODEL,
  generateLessonForVideo,
} from "@/lib/lesson-generation";

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

interface YouTubeVideoCandidate {
  video_id: string;
  title: string;
  channel_name: string;
  view_count: number;
  duration_seconds: number;
  published_at: string | null;
  description: string;
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
const MIN_VIEW_COUNT = 10000;
const MIN_DURATION_SECONDS = 600;
const CHAPTER_MIN_LINES = 3;
const CHUNK_DURATION_SECONDS = 60;
const TITLE_EXCLUDE_PATTERN = /\bin\s+\d+\s*(seconds?|minutes?|mins?)\b/i;

// --- Helpers ---
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

function chunkTranscript(
  transcript: { offset: number; text: string }[]
): TranscriptChunk[] {
  if (transcript.length === 0) return [];

  const chunks: TranscriptChunk[] = [];
  let currentChunk: TranscriptChunk = { start_seconds: transcript[0].offset, text: "" };

  for (const item of transcript) {
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

// --- YouTube API ---
async function searchYouTubeVideos(
  skill: string,
  apiKey: string
): Promise<YouTubeVideoCandidate[]> {
  const searchUrl = new URL("https://www.googleapis.com/youtube/v3/search");
  searchUrl.searchParams.set("q", `${skill} complete tutorial course`);
  searchUrl.searchParams.set("type", "video");
  searchUrl.searchParams.set("order", "relevance");
  searchUrl.searchParams.set("publishedAfter", getPublishedAfter());
  searchUrl.searchParams.set("maxResults", "14");
  searchUrl.searchParams.set("key", apiKey);

  const searchRes = await fetch(searchUrl.toString());
  if (!searchRes.ok) {
    throw new Error(`YouTube search failed: ${searchRes.status}`);
  }

  const searchData = await searchRes.json();
  const items = searchData.items ?? [];
  if (items.length === 0) return [];

  const videoIds = items
    .map((item: Record<string, unknown>) => {
      const idObj = item.id as { videoId?: string } | string | undefined;
      const vid = typeof idObj === "string" ? idObj : idObj?.videoId;
      return typeof vid === "string" ? vid : null;
    })
    .filter((id: string | null): id is string => id !== null);

  if (videoIds.length === 0) return [];

  // Fetch detailed metadata
  const videosUrl = new URL("https://www.googleapis.com/youtube/v3/videos");
  videosUrl.searchParams.set("id", videoIds.join(","));
  videosUrl.searchParams.set("part", "contentDetails,snippet,statistics");
  videosUrl.searchParams.set("key", apiKey);

  const videosRes = await fetch(videosUrl.toString());
  if (!videosRes.ok) {
    throw new Error(`YouTube videos fetch failed: ${videosRes.status}`);
  }

  const videosData = await videosRes.json();
  const candidates: YouTubeVideoCandidate[] = [];

  for (const video of videosData.items ?? []) {
    const iso8601Duration = video.contentDetails?.duration ?? "";
    const durationSeconds = parseISO8601Duration(iso8601Duration);
    const viewCount = Number(video.statistics?.viewCount ?? 0);
    const publishedAt = video.snippet?.publishedAt ?? null;

    candidates.push({
      video_id: video.id,
      title: video.snippet?.title ?? "",
      channel_name: video.snippet?.channelTitle ?? "",
      view_count: viewCount,
      duration_seconds: durationSeconds,
      published_at: publishedAt,
      description: video.snippet?.description ?? "",
    });
  }

  return candidates;
}

function parseISO8601Duration(duration: string): number {
  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;

  const hours = match[1] ? parseInt(match[1], 10) : 0;
  const minutes = match[2] ? parseInt(match[2], 10) : 0;
  const seconds = match[3] ? parseInt(match[3], 10) : 0;
  return hours * 3600 + minutes * 60 + seconds;
}

function getPublishedAfter(): string {
  const date = new Date();
  date.setFullYear(date.getFullYear() - 2);
  return date.toISOString();
}

// --- Embedding helpers ---
async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const { createEmbeddingModel } = await import("@/lib/ai/provider");
  const model = await createEmbeddingModel();
  const BATCH = 8;
  const all: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH);
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        if (batch.length === 1) {
          const { embedding } = await embed({ model, value: batch[0] });
          all.push(embedding);
        } else {
          const { embeddings } = await embedMany({ model, values: batch });
          all.push(...embeddings);
        }
        break;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        const isQuota = msg.includes("Quota exceeded") || msg.includes("429") || (e as { statusCode?: number })?.statusCode === 429;
        if (isQuota && attempt < 3) {
          const delay = 35000 + Math.random() * 5000;
          console.warn(`[tutorial-index] embed quota hit batch ${Math.floor(i / BATCH) + 1}, retry ${attempt + 1}/3 after ${Math.round(delay)}ms`);
          await new Promise((r) => setTimeout(r, delay));
          lastErr = e;
          continue;
        }
        throw e;
      }
    }
    if (i + BATCH < texts.length) await new Promise((r) => setTimeout(r, 2200));
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
    const { data: existing } = await supabase
      .from("ai_daily_usage")
      .select("generate_calls")
      .eq("usage_date", today)
      .maybeSingle();
    const current = (existing as { generate_calls: number } | null)?.generate_calls ?? 0;
    await supabase.from("ai_daily_usage").upsert(
      {
        usage_date: today,
        generate_calls: Math.max(current, inMemoryGenerateCount),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "usage_date" },
    );
  } catch {
    // table not yet migrated — in-memory guard still enforces per-run limit
  }
}

async function hasGenerateQuotaForVideo(
  supabase: ReturnType<typeof createServiceRoleClient>,
  lessonChunks: { start_seconds: number; chunk_text: string }[],
): Promise<boolean> {
  if (!supabase) return true;
  const WINDOW_CHAR_BUDGET = 6000;
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
  windows = Math.min(windows, 8);
  const { generate_calls } = await getTodayUsage(supabase);
  return generate_calls + windows <= DAILY_GENERATE_LIMIT;
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
  const candidates = await searchYouTubeVideos(skill, youtubeApiKey);
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

  const filtered = candidates.filter((c) => {
    if (c.view_count <= MIN_VIEW_COUNT) return false;
    if (c.duration_seconds <= MIN_DURATION_SECONDS) return false;
    if (TITLE_EXCLUDE_PATTERN.test(c.title)) return false;
    return true;
  });

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

  // 4. Process each new video: chapters + transcript + lesson notes (Feature 5)
  for (let vi = 0; vi < newVideos.length; vi++) {
    const video = newVideos[vi];
    if (vi > 0) await new Promise((r) => setTimeout(r, 1800));
    // --- Chapters ---
    const chapters = parseChapters(video.description);
    if (chapters.length > 0) {
      try {
        const chapterLabels = chapters.map((c) => c.label);
        const chapterEmbeddings = await embedTexts(chapterLabels);

        const chapterRows = chapters.map((ch, idx) => ({
          video_id: video.video_id,
          start_seconds: ch.start_seconds,
          label: ch.label,
          label_embedding: chapterEmbeddings[idx],
        }));

        const { error: chapterError } = await supabase
          .from("tutorial_chapters")
          .upsert(chapterRows, { onConflict: "video_id,start_seconds" });

        if (chapterError) {
          console.error(`[tutorial-index] Chapter upsert failed for ${video.video_id}:`, chapterError);
        } else {
          totalChapters += chapters.length;
        }
      } catch (err) {
        console.error(`[tutorial-index] Chapter embed failed for ${video.video_id}:`, err);
      }
    }

    // --- Transcript ---
    let transcriptChunks: TranscriptChunk[] = [];
    try {
      const transcript = await fetchTranscript(video.video_id);
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
      try {
        const chunkTexts = transcriptChunks.map((c) => c.text);
        const chunkEmbeddings = await embedTexts(chunkTexts);

        const chunkRows = transcriptChunks.map((chunk, idx) => ({
          video_id: video.video_id,
          video_title: video.title,
          channel_name: video.channel_name,
          view_count: video.view_count,
          published_at: video.published_at,
          skill_tag: skill,
          start_seconds: chunk.start_seconds,
          chunk_text: chunk.text,
          embedding: chunkEmbeddings[idx],
        }));

        const { error: chunkError } = await supabase
          .from("tutorial_chunks")
          .upsert(chunkRows, { onConflict: "video_id,start_seconds,skill_tag" });

        if (chunkError) {
          console.error(`[tutorial-index] Chunk upsert failed for ${video.video_id}:`, chunkError);
        } else {
          totalChunks += transcriptChunks.length;
        }
      } catch (err) {
        console.error(`[tutorial-index] Chunk embed failed for ${video.video_id}:`, err);
      }
    }

    const needsLesson = chapters.length > 0 || transcriptChunks.length > 0;
    if (needsLesson) {
      try {
        const { data: existingLesson } = await supabase
          .from("video_lessons")
          .select("video_id, model")
          .eq("video_id", video.video_id)
          .maybeSingle();
        const needsRegen =
          !existingLesson ||
          (existingLesson as { model: string } | null)?.model !== CURRENT_LESSON_MODEL;
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
                `[tutorial-index] Skipping lesson for ${video.video_id}: daily generate quota exhausted (90/day)`,
              );
            } else {
              const windowsForMetric = await (async () => {
                const sorted = [...lessonChunks].sort((a, b) => a.start_seconds - b.start_seconds);
                let w = 0;
                let cur = 0;
                let len = 0;
                for (const c of sorted) {
                  if (len > 0 && cur + c.chunk_text.length > 6000) { w += 1; cur = 0; len = 0; }
                  cur += c.chunk_text.length; len += 1;
                }
                if (len > 0) w += 1;
                return Math.min(w, 8);
              })();
              const t0 = Date.now();
              const lesson = await generateLessonForVideo({
                videoId: video.video_id,
                videoTitle: video.title,
                channelName: video.channel_name,
                allowedTimestamps,
                chunks: lessonChunks,
              });
              lessonGenerateMs += Date.now() - t0;
              if (lesson) {
                await incrementGenerateUsage(supabase, windowsForMetric);
                const { error: lessonError } = await supabase.from("video_lessons").upsert(
                  {
                    video_id: video.video_id,
                    sections: lesson.sections,
                    summary: lesson.summary,
                    model: CURRENT_LESSON_MODEL,
                  },
                  { onConflict: "video_id" }
                );
              if (lessonError) {
                console.error(`[tutorial-index] Lesson upsert failed for ${video.video_id}:`, lessonError);
              } else {
                totalLessons += 1;
              }
            }
            }
          }
        }
      } catch (err) {
        console.error(`[tutorial-index] Lesson generation failed for ${video.video_id}:`, err);
      }
    }
  }

  // --- Backfill: regenerate stale lessons and fill missing (Fix 1 + Fix 2 backfill) ---
  // Covers videos indexed before Feature 5, failed generations, and stale model versions.
  try {
    const allCandidates = selected;
    const candidateIds = allCandidates.map((v) => v.video_id);
    if (candidateIds.length > 0) {
      const { data: existingLessonsRows } = await supabase
        .from("video_lessons")
        .select("video_id, model")
        .in("video_id", candidateIds);
      const lessonsMap = new Map(
        (existingLessonsRows ?? []).map((r: { video_id: string; model: string }) => [r.video_id, r.model]),
      );
      const toRegen = allCandidates.filter((v) => {
        const m = lessonsMap.get(v.video_id);
        return !m || m !== CURRENT_LESSON_MODEL;
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
              `[tutorial-index] Skipping backfill lesson for ${video.video_id}: daily generate quota exhausted (90/day)`,
            );
            continue;
          }

          const title = chunksForVideo[0]?.video_title ?? video.title;
          const channel = chunksForVideo[0]?.channel_name ?? video.channel_name;

          const windowsForMetric = await (async () => {
            const sorted = [...lessonChunks].sort((a, b) => a.start_seconds - b.start_seconds);
            let w = 0;
            let cur = 0;
            let len = 0;
            for (const c of sorted) {
              if (len > 0 && cur + c.chunk_text.length > 6000) { w += 1; cur = 0; len = 0; }
              cur += c.chunk_text.length; len += 1;
            }
            if (len > 0) w += 1;
            return Math.min(w, 8);
          })();
          const t0 = Date.now();
          const lesson = await generateLessonForVideo({
            videoId: video.video_id,
            videoTitle: title,
            channelName: channel,
            allowedTimestamps,
            chunks: lessonChunks,
          });
          lessonGenerateMs += Date.now() - t0;
          if (lesson) {
            await incrementGenerateUsage(supabase, windowsForMetric);
            const { error: lessonError } = await supabase.from("video_lessons").upsert(
              {
                video_id: video.video_id,
                sections: lesson.sections,
                summary: lesson.summary,
                model: CURRENT_LESSON_MODEL,
              },
              { onConflict: "video_id" }
            );
            if (!lessonError) totalLessons += 1;
          }
        } catch (err) {
          console.error(`[tutorial-index] Backfill lesson failed for ${video.video_id}:`, err);
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

  await supabase
    .from("skill_index_status")
    .upsert(
      {
        skill,
        last_indexed_at: new Date().toISOString(),
        gap_mentions_30d: gapCounts.get(skill) ?? 0,
        total_chunks: chunkCount ?? 0,
        total_chapters: chapterVideos ?? 0,
        last_run_status: "success",
        last_error: null,
      },
      { onConflict: "skill" }
    );

  console.info(
    `[tutorial-index] Skill "${skill}" lessons: ${totalLessons} generated in ${lessonGenerateMs}ms`
  );

  return {
    videos: newVideos.length,
    chunks: totalChunks,
    chapters: totalChapters,
    lessons: totalLessons,
    lessonGenerateMs,
    status: "success",
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
    const norm = canarySkill.toLowerCase().trim();
    const found = scored.find((s) => s.skill.toLowerCase() === norm);
    selected = found ? [found] : [{ skill: norm, gapMentions: 0, lastIndexedAt: null }];
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
