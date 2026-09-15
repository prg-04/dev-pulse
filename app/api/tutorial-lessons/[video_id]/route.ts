import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export const dynamic = "force-dynamic";

const ParamsSchema = z.object({
  video_id: z
    .string()
    .regex(/^[A-Za-z0-9_-]{11}$/, "Invalid YouTube video ID"),
});

type VideoLessonRow = {
  video_id: string;
  sections: { start_seconds: number; heading: string; key_points: string[]; code_example?: string | null }[];
  summary: string | null;
  generated_at: string;
  model: string;
};

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ video_id: string }> }
) {
  const { video_id } = await params;
  const parsed = ParamsSchema.safeParse({ video_id });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid video_id" }, { status: 400 });
  }

  const supabaseAuth = await createClient();
  if (!supabaseAuth) {
    return NextResponse.json({ error: "Missing Supabase env" }, { status: 500 });
  }
  const {
    data: { user },
  } = await supabaseAuth.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const service = createServiceRoleClient();
  if (!service) {
    return NextResponse.json({ error: "Missing Supabase env" }, { status: 500 });
  }

  const { data, error } = await service
    .from("video_lessons")
    .select("video_id, sections, summary, generated_at, model")
    .eq("video_id", parsed.data.video_id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Notes not available for this video" }, { status: 404 });
  }

  const row = data as VideoLessonRow;
  return NextResponse.json(
    {
      video_id: row.video_id,
      sections: row.sections,
      summary: row.summary,
      generated_at: row.generated_at,
      model: row.model,
    },
    { status: 200 }
  );
}
