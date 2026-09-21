import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { normalizeSkill } from "@/lib/skills-dictionary";
import { createClient } from "@/lib/supabase/server";
import { getMockTutorials } from "@/lib/mock/gap-report-tutorials";

const BodySchema = z.object({
  skill: z.string().min(1),
});

// Cosine distance threshold for accepting a match.
// 0.0 = identical, 0.5 = roughly similar, 1.0 = unrelated, 2.0 = opposite.
// 0.5 (similarity > 0.5) is a reasonable starting point; tune after real data review.
const DISTANCE_THRESHOLD = 0.5;

type ChapterHit = {
  id: string;
  video_id: string;
  start_seconds: number;
  label: string;
  label_embedding: number[];
  indexed_at: string;
  distance: number;
};

type ChunkHit = {
  id: string;
  video_id: string;
  video_title: string;
  channel_name: string;
  view_count: number | null;
  published_at: string | null;
  skill_tag: string;
  start_seconds: number;
  chunk_text: string;
  embedding: number[];
  indexed_at: string;
  distance: number;
};

function formatMMSS(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const rawSkill = parsed.data.skill.trim();
  const canonical = normalizeSkill(rawSkill);
  if (!canonical) {
    return NextResponse.json({ error: "Unknown skill" }, { status: 400 });
  }
  const skill = canonical;

  const supabase = await createClient();
  if (!supabase) {
    return NextResponse.json({ error: "Missing env" }, { status: 500 });
  }

  // Check if we have any indexed data for this skill — fetch up to 50 video_ids
  // to use as filter for chapter search (fixes prior limit(1) bug that capped results to 1 video)
  const { data: chunkRowsFull } = await supabase
    .from("tutorial_chunks")
    .select("video_id")
    .eq("skill_tag", skill)
    .limit(50);

  const hasIndexedData = chunkRowsFull && chunkRowsFull.length > 0;

  // If no indexed data, return mock tutorials ONLY in local development.
  // Production must not serve synthetic data as if it were real search results.
  const allowMockTutorials = process.env.NEXT_PUBLIC_ENV === "development";
  if (!hasIndexedData && allowMockTutorials) {
    const mockTutorials = getMockTutorials(skill);
    if (mockTutorials.length > 0) {
      return NextResponse.json({
        results: mockTutorials.map((t) => ({
          video_id: t.video_id,
          video_title: t.video_title,
          channel_name: t.channel_name,
          view_count: t.view_count,
          start_seconds: t.start_seconds,
          starts_at: t.starts_at,
          chapter_label: t.chapter_label,
        })),
      }, { status: 200 });
    }
    return NextResponse.json({ results: [] }, { status: 200 });
  }

  if (!hasIndexedData) {
    return NextResponse.json({ results: [] }, { status: 200 });
  }

  // Embed the skill name via provider-agnostic embedding model
  let embedding: number[];
  try {
    const { embed } = await import("ai");
    const { createEmbeddingModel } = await import("@/lib/ai/provider");
    const model = await createEmbeddingModel();
    const { embedding: emb } = await embed({
      model,
      value: skill,
    });
    embedding = emb.length > 1536 ? emb.slice(0, 1536) : emb;
  } catch (err) {
    console.error("tutorial-search embed failed", err);
    // Embedding unavailable — return empty rather than fall back to substring matching
    return NextResponse.json({ results: [] }, { status: 200 });
  }

  const chunkVideoIds = [...new Set((chunkRowsFull ?? []).map((r) => (r as { video_id: string }).video_id))];

  let chapterDerivedIds: string[] = [];
  if (chunkVideoIds.length > 0) {
    const { data: chapterRows } = await supabase
      .from("tutorial_chapters")
      .select("video_id")
      .in("video_id", chunkVideoIds);
    chapterDerivedIds = [...new Set((chapterRows ?? []).map((r) => (r as { video_id: string }).video_id))];
  } else {
    const { data: fallbackChapters } = await supabase
      .from("tutorial_chapters")
      .select("video_id")
      .limit(50);
    chapterDerivedIds = [...new Set((fallbackChapters ?? []).map((r) => (r as { video_id: string }).video_id))];
  }

  const videoIds = [...new Set([...chunkVideoIds, ...chapterDerivedIds])];
  if (videoIds.length === 0) {
    return NextResponse.json({ results: [] }, { status: 200 });
  }

  // Stage 1: chapter-first pgvector cosine similarity restricted to those video_ids
  const chapterRpc = await supabase.rpc("match_tutorial_chapters", {
    query_embedding: embedding,
    match_threshold: DISTANCE_THRESHOLD,
    match_count: 20,
    video_ids: videoIds,
  });
  if (chapterRpc.error) {
    console.error("tutorial-search stage-1 RPC failed", chapterRpc.error);
    return NextResponse.json({ error: "Stage 1 search failed" }, { status: 500 });
  }
  const chapterHits = (chapterRpc.data ?? []) as ChapterHit[];
  const acceptedChapters = chapterHits.filter((r) => r.distance < DISTANCE_THRESHOLD);
  const acceptedChapterVideoIds = new Set(acceptedChapters.map((r) => r.video_id));

  // Stage 2: chunk fallback for videos with no accepted chapter match
  const chunkRpc = await supabase.rpc("match_tutorial_chunks", {
    query_embedding: embedding,
    match_threshold: DISTANCE_THRESHOLD,
    match_count: 20,
    p_skill_tag: skill,
  });
  if (chunkRpc.error) {
    console.error("tutorial-search stage-2 RPC failed", chunkRpc.error);
    return NextResponse.json({ error: "Stage 2 search failed" }, { status: 500 });
  }
  const chunkHits = (chunkRpc.data ?? []) as ChunkHit[];
  const acceptedChunks = chunkHits.filter(
    (r) => r.distance < DISTANCE_THRESHOLD && !acceptedChapterVideoIds.has(r.video_id)
  );

  const sorted = [
    ...acceptedChapters.map((r) => ({ ...r, _type: "chapter" as const })),
    ...acceptedChunks.map((r) => ({ ...r, _type: "chunk" as const })),
  ].sort((a, b) => a.distance - b.distance);

  const seen = new Map<string, (typeof sorted)[number]>();
  for (const hit of sorted) {
    if (!seen.has(hit.video_id)) seen.set(hit.video_id, hit);
  }
  const merged = Array.from(seen.values()).slice(0, 7);

  // Look up video metadata from tutorial_chunks for chapter results
  const allVideoIds = [...new Set(merged.map((r) => r.video_id))];
  const { data: videoMeta } = await supabase
    .from("tutorial_chunks")
    .select("video_id, video_title, channel_name, view_count")
    .in("video_id", allVideoIds);

  const metaMap = new Map((videoMeta ?? []).map((r) => [r.video_id, r]));

  const results = merged.map((r) => {
    const meta = metaMap.get(r.video_id);
    const isChapter = r._type === "chapter";
    const base: Record<string, unknown> = {
      video_id: r.video_id,
      video_title: meta?.video_title ?? r.video_id,
      channel_name: meta?.channel_name ?? "Unknown",
      view_count: meta?.view_count ?? null,
      start_seconds: r.start_seconds,
      starts_at: formatMMSS(r.start_seconds),
    };
    if (isChapter) {
      base.chapter_label = r.label;
    }
    return base;
  });

  return NextResponse.json({ results }, { status: 200 });
}
