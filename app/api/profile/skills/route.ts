import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { normalizeSkill } from "@/lib/skills-dictionary";

const AddSchema = z.object({
  skill: z.string().min(1).max(50),
  years: z.number().min(0).max(50).optional().nullable(),
  depth_tier: z.enum(["core", "familiar", "learning"]).optional().nullable(),
});

export async function GET() {
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Missing env" }, { status: 500 });
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data, error } = await supabase.from("user_skills").select("*").eq("user_id", user.id).order("updated_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ skills: data });
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Missing env" }, { status: 500 });
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = AddSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const canonical = normalizeSkill(parsed.data.skill);
  if (!canonical) return NextResponse.json({ error: "Unknown skill — not in dictionary" }, { status: 400 });

  // Do not overwrite manual with github_sync — here we are manual, so insert or upsert manual
  const { data, error } = await supabase
    .from("user_skills")
    .upsert(
      {
        user_id: user.id,
        skill: canonical,
        years: parsed.data.years ?? null,
        depth_tier: parsed.data.depth_tier ?? null,
        source: "manual",
      },
      { onConflict: "user_id,skill" }
    )
    .select()
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  try {
    revalidatePath("/gap-report");
    revalidatePath("/(app)/gap-report");
  } catch {}
  return NextResponse.json({ skill: data });
}

export async function DELETE(req: NextRequest) {
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Missing env" }, { status: 500 });
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const skillParam = req.nextUrl.searchParams.get("skill");
  if (!skillParam) return NextResponse.json({ error: "Missing skill param" }, { status: 400 });
  const canonical = normalizeSkill(skillParam);
  if (!canonical) return NextResponse.json({ error: "Unknown skill" }, { status: 400 });
  const { error } = await supabase.from("user_skills").delete().eq("user_id", user.id).eq("skill", canonical).eq("source", "manual");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  try {
    revalidatePath("/gap-report");
    revalidatePath("/(app)/gap-report");
  } catch {}
  return NextResponse.json({ ok: true });
}
