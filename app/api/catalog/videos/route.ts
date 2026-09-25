import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { normalizeSkill, ALL_SKILLS } from "@/lib/skills-dictionary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const supabaseAuth = await createClient();
  if (!supabaseAuth) {
    return NextResponse.json({ error: "Missing env" }, { status: 500 });
  }
  const {
    data: { user },
  } = await supabaseAuth.auth.getUser();

  const isDevBypass =
    process.env.NEXT_PUBLIC_ENV === "development" && process.env.NODE_ENV !== "production";
  if (!user && !isDevBypass) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const skill = new URL(req.url).searchParams.get("skill");
  if (!skill) {
    return NextResponse.json({ error: "Missing skill query param" }, { status: 400 });
  }

  const normalizedSkill = normalizeSkill(skill);
  if (!normalizedSkill || !ALL_SKILLS.includes(normalizedSkill)) {
    return NextResponse.json(
      { error: `Unknown skill: ${skill}. Must be one of: ${ALL_SKILLS.join(", ")}` },
      { status: 400 }
    );
  }

  const supabase = createServiceRoleClient();
  if (!supabase) {
    return NextResponse.json({ error: "Missing Supabase env" }, { status: 500 });
  }

  const { data: rows, error } = await supabase
    .from("skill_video_catalog")
    .select("video_id, title, channel_name, thumbnail_url, duration_seconds, view_count, published_at, rank, source, fetched_at")
    .eq("skill", normalizedSkill)
    .order("rank", { ascending: true });

  if (error) {
    console.error("[api/catalog/videos] query failed:", error);
    return NextResponse.json({ error: "Failed to fetch catalog" }, { status: 500 });
  }

  const videos = (rows ?? []).map((r) => ({
    video_id: r.video_id,
    title: r.title,
    channel_name: r.channel_name,
    thumbnail_url: r.thumbnail_url,
    duration_seconds: r.duration_seconds,
    view_count: r.view_count ? Number(r.view_count) : null,
    published_at: r.published_at,
    rank: r.rank,
    source: r.source,
    fetched_at: r.fetched_at,
  }));

  return NextResponse.json({ videos }, { status: 200 });
}
