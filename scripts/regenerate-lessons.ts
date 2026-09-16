#!/usr/bin/env ts-node
/**
 * One-off regeneration script — calls generateLessonForVideo directly for all
 * rows where video_lessons.model != CURRENT_LESSON_MODEL, respecting quota.
 * Usage:  npx tsx scripts/regenerate-lessons.ts [--limit 20] [--videoId abc123]
 * Requires env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, AI_* keys
 */
import { createServiceRoleClient } from "../lib/supabase/service-role";
import { CURRENT_LESSON_MODEL, generateLessonForVideo } from "../lib/lesson-generation";

async function main() {
  const args = process.argv.slice(2);
  const limitArg = args.find((a) => a.startsWith("--limit"));
  const videoIdArg = args.find((a) => a.startsWith("--videoId") || a.startsWith("--video_id"));
  const limit = limitArg ? parseInt(limitArg.split("=")[1] ?? limitArg.split(" ")[1] ?? "20", 10) : 20;
  const singleId = videoIdArg ? (videoIdArg.split("=")[1] ?? args[args.indexOf(videoIdArg) + 1]) : undefined;

  const supabase = createServiceRoleClient();
  if (!supabase) {
    console.error("Missing Supabase env");
    process.exit(1);
  }

  let videoIds: string[] = [];
  if (singleId) {
    videoIds = [singleId];
  } else {
    const { data: stale } = await supabase.from("video_lessons").select("video_id").neq("model", CURRENT_LESSON_MODEL).limit(limit);
    videoIds = (stale ?? []).map((r: { video_id: string }) => r.video_id);
    if (videoIds.length < limit) {
      const { data: allChunks } = await supabase.from("tutorial_chunks").select("video_id").limit(200);
      const all = [...new Set((allChunks ?? []).map((r: { video_id: string }) => r.video_id))];
      const { data: existing } = await supabase.from("video_lessons").select("video_id").in("video_id", all);
      const existingSet = new Set((existing ?? []).map((r: { video_id: string }) => r.video_id));
      const missing = all.filter((id) => !existingSet.has(id));
      videoIds = [...videoIds, ...missing].slice(0, limit);
    }
  }

  console.log(`Regenerating ${videoIds.length} video(s) with model ${CURRENT_LESSON_MODEL}`);
  for (const vid of videoIds) {
    const { data: chapters } = await supabase.from("tutorial_chapters").select("start_seconds, label").eq("video_id", vid).order("start_seconds");
    const { data: chunks } = await supabase.from("tutorial_chunks").select("start_seconds, chunk_text, video_title, channel_name").eq("video_id", vid).order("start_seconds");
    const ch = (chapters ?? []) as { start_seconds: number; label: string }[];
    const ck = (chunks ?? []) as { start_seconds: number; chunk_text: string; video_title: string; channel_name: string }[];
    const allowed = ch.length > 0 ? ch.map((c) => c.start_seconds) : ck.map((c) => c.start_seconds);
    const lessonChunks = ck.length > 0 ? ck.map((c) => ({ start_seconds: c.start_seconds, chunk_text: c.chunk_text })) : ch.map((c) => ({ start_seconds: c.start_seconds, chunk_text: c.label }));
    if (lessonChunks.length === 0) {
      console.warn(`Skipping ${vid}: no chunks/chapters`);
      continue;
    }
    const title = ck[0]?.video_title ?? vid;
    const channel = ck[0]?.channel_name ?? "Unknown";
    try {
      const lesson = await generateLessonForVideo({ videoId: vid, videoTitle: title, channelName: channel, allowedTimestamps: allowed, chunks: lessonChunks });
      if (!lesson) {
        console.warn(`Failed for ${vid}: no sections`);
        continue;
      }
      const { error } = await supabase.from("video_lessons").upsert({ video_id: vid, sections: lesson.sections, summary: lesson.summary, model: CURRENT_LESSON_MODEL }, { onConflict: "video_id" });
      if (error) console.error(`Upsert failed for ${vid}:`, error.message);
      else console.log(`OK ${vid}: ${lesson.sections.length} sections stats=${JSON.stringify(lesson.stats)}`);
    } catch (e) {
      console.error(`Error for ${vid}:`, e);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
