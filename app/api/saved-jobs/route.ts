import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const BodySchema = z.object({ job_id: z.string().uuid() });

export async function GET() {
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Missing Supabase env" }, { status: 500 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data, error } = await supabase.from("saved_jobs").select("job_id, saved_at").eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ saved: data ?? [] });
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Missing Supabase env" }, { status: 500 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { error } = await supabase.from("saved_jobs").upsert(
    { user_id: user.id, job_id: parsed.data.job_id },
    { onConflict: "user_id,job_id" }
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Missing Supabase env" }, { status: 500 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const jobId = req.nextUrl.searchParams.get("job_id");
  if (!jobId) return NextResponse.json({ error: "Missing job_id" }, { status: 400 });
  const uuidCheck = z.string().uuid().safeParse(jobId);
  if (!uuidCheck.success) return NextResponse.json({ error: "Invalid job_id" }, { status: 400 });
  const { error } = await supabase.from("saved_jobs").delete().eq("user_id", user.id).eq("job_id", jobId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
