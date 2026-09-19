import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { CURRENT_LESSON_MODEL, generateLessonForVideo } from "@/lib/lesson-generation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function hasGenerateQuota(
  supabase: ReturnType<typeof createServiceRoleClient>,
  lessonChunks: { start_seconds: number; chunk_text: string }[]
): Promise<boolean> {
  const WINDOW_CHAR_BUDGET = 6000;
  const DAILY_GENERATE_LIMIT = 90;
  const sorted = [...lessonChunks].sort((a, b) => a.start_seconds - b.start_seconds);
  let windows = 0;
  let cur = 0;
  let len = 0;
  for (const c of sorted) {
    if (len > 0 && cur + c.chunk_text.length > WINDOW_CHAR_BUDGET) {
      windows++;
      cur = 0;
      len = 0;
    }
    cur += c.chunk_text.length;
    len++;
  }
  if (len > 0) windows++;
  if (!supabase) return true;
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await supabase.from("ai_daily_usage").select("generate_calls").eq("usage_date", today).maybeSingle();
  const used = (data as { generate_calls: number } | null)?.generate_calls ?? 0;
  return used + windows <= DAILY_GENERATE_LIMIT;
}

export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const videoId = (body as { video_id?: string })?.video_id;
  const limit = Math.min(Math.max(Number((body as { limit?: number })?.limit ?? 20), 1), 100);

  const supabase = createServiceRoleClient();
  if (!supabase) return NextResponse.json({ error: "Missing Supabase env" }, { status: 500 });

  // If single video_id requested, regenerate just that video
  if (videoId) {
    const { data: chapters } = await supabase.from("tutorial_chapters").select("start_seconds, label").eq("video_id", videoId).order("start_seconds");
    const { data: chunks } = await supabase.from("tutorial_chunks").select("start_seconds, chunk_text, video_title, channel_name").eq("video_id", videoId).order("start_seconds");
    const ch = (chapters ?? []) as { start_seconds: number; label: string }[];
    const ck = (chunks ?? []) as { start_seconds: number; chunk_text: string; video_title: string; channel_name: string }[];
    if (ch.length === 0 && ck.length === 0) return NextResponse.json({ error: "No chapters or chunks for video_id" }, { status: 404 });
    const allowed = ch.length > 0 ? ch.map((c) => c.start_seconds) : ck.map((c) => c.start_seconds);
    const lessonChunks = ck.length > 0 ? ck.map((c) => ({ start_seconds: c.start_seconds, chunk_text: c.chunk_text })) : ch.map((c) => ({ start_seconds: c.start_seconds, chunk_text: c.label }));
    const title = ck[0]?.video_title ?? "Unknown";
    const channel = ck[0]?.channel_name ?? "Unknown";
    if (!(await hasGenerateQuota(supabase, lessonChunks))) {
      return NextResponse.json({ error: "Daily generate quota exhausted" }, { status: 429 });
    }
    const lesson = await generateLessonForVideo({ videoId, videoTitle: title, channelName: channel, allowedTimestamps: allowed, chunks: lessonChunks });
    if (!lesson) return NextResponse.json({ error: "Generation returned no sections" }, { status: 500 });
    const { error: upsertError } = await supabase.from("video_lessons").upsert({ video_id: videoId, sections: lesson.sections, summary: lesson.summary, model: CURRENT_LESSON_MODEL }, { onConflict: "video_id" });
    if (upsertError) return NextResponse.json({ error: upsertError.message }, { status: 500 });
    return NextResponse.json({ ok: true, video_id: videoId, stats: lesson.stats, sections: lesson.sections.length });
  }

  // Bulk: all rows where model != CURRENT_LESSON_MODEL, limited
  const { data: stale } = await supabase.from("video_lessons").select("video_id, model").neq("model", CURRENT_LESSON_MODEL).limit(limit);
  // Also find videos with no lesson at all (have chunks but no lesson row)
  let candidates: string[] = (stale ?? []).map((r: { video_id: string }) => r.video_id);

  if (candidates.length < limit) {
    const { data: allChunks } = await supabase.from("tutorial_chunks").select("video_id").limit(200);
    const allIds = [...new Set((allChunks ?? []).map((r: { video_id: string }) => r.video_id))];
    const { data: existing } = await supabase.from("video_lessons").select("video_id").in("video_id", allIds);
    const existingSet = new Set((existing ?? []).map((r: { video_id: string }) => r.video_id));
    const missing = allIds.filter((id) => !existingSet.has(id) && !candidates.includes(id));
    candidates = [...candidates, ...missing].slice(0, limit);
  }

  const results: { video_id: string; status: string; stats?: unknown; error?: string }[] = [];
  for (const vid of candidates) {
    const { data: chapters } = await supabase.from("tutorial_chapters").select("start_seconds, label").eq("video_id", vid).order("start_seconds");
    const { data: chunks } = await supabase.from("tutorial_chunks").select("start_seconds, chunk_text, video_title, channel_name").eq("video_id", vid).order("start_seconds");
    const ch = (chapters ?? []) as { start_seconds: number; label: string }[];
    const ck = (chunks ?? []) as { start_seconds: number; chunk_text: string; video_title: string; channel_name: string }[];
    const allowed = ch.length > 0 ? ch.map((c) => c.start_seconds) : ck.map((c) => c.start_seconds);
    const lessonChunks = ck.length > 0 ? ck.map((c) => ({ start_seconds: c.start_seconds, chunk_text: c.chunk_text })) : ch.map((c) => ({ start_seconds: c.start_seconds, chunk_text: c.label }));
    if (lessonChunks.length === 0 || allowed.length === 0) {
      results.push({ video_id: vid, status: "skipped_empty" });
      continue;
    }
    if (!(await hasGenerateQuota(supabase, lessonChunks))) {
      results.push({ video_id: vid, status: "skipped_quota" });
      continue;
    }
    try {
      const title = ck[0]?.video_title ?? vid;
      const channel = ck[0]?.channel_name ?? "Unknown";
      const lesson = await generateLessonForVideo({ videoId: vid, videoTitle: title, channelName: channel, allowedTimestamps: allowed, chunks: lessonChunks });
      if (!lesson) {
        results.push({ video_id: vid, status: "failed_empty" });
        continue;
      }
      const { error } = await supabase.from("video_lessons").upsert({ video_id: vid, sections: lesson.sections, summary: lesson.summary, model: CURRENT_LESSON_MODEL }, { onConflict: "video_id" });
      if (error) {
        results.push({ video_id: vid, status: "failed_upsert", error: error.message });
      } else {
        // update ai_daily_usage via same path as tutorial-index
        const windowCount = lesson.stats?.windowsTotal ?? Math.ceil(lessonChunks.reduce((s, c) => s + c.chunk_text.length, 0) / 6000);
        const today = new Date().toISOString().slice(0, 10);
        const { data: existing } = await supabase.from("ai_daily_usage").select("generate_calls").eq("usage_date", today).maybeSingle();
        const cur = (existing as { generate_calls: number } | null)?.generate_calls ?? 0;
        await supabase.from("ai_daily_usage").upsert({ usage_date: today, generate_calls: cur + windowCount, updated_at: new Date().toISOString() }, { onConflict: "usage_date" });
        results.push({ video_id: vid, status: "regenerated", stats: lesson.stats });
      }
    } catch (e) {
      results.push({ video_id: vid, status: "failed", error: e instanceof Error ? e.message : String(e) });
    }
  }

  return NextResponse.json({ ok: true, currentModel: CURRENT_LESSON_MODEL, candidates: candidates.length, results });
}

export async function GET(req: NextRequest) {
  return POST(req);
}
