import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const Schema = z.object({
  instant_match_alert: z.boolean().optional(),
  instant_match_threshold: z.number().int().min(0).max(100).optional(),
  weekly_digest: z.boolean().optional(),
  learning_gap_dispatch: z.boolean().optional(),
  delivery_method: z.enum(["email", "webhook"]).optional(),
  webhook_url: z.string().url().max(500).optional().nullable(),
});

export async function GET() {
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Missing env" }, { status: 500 });
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data, error } = await supabase.from("alert_preferences").select("*").eq("user_id", user.id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ prefs: data });
}

export async function PUT(req: NextRequest) {
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
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { data, error } = await supabase
    .from("alert_preferences")
    .upsert({ user_id: user.id, ...parsed.data }, { onConflict: "user_id" })
    .select()
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ prefs: data });
}
