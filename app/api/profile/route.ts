import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const ProfileSchema = z.object({
  full_name: z.string().max(100).optional().nullable(),
  location_text: z.string().max(100).optional().nullable(),
  timezone: z.string().max(50).optional().nullable(),
  github_username: z.string().max(39).regex(/^[a-zA-Z0-9-]*$/, "invalid github username").optional().nullable(),
  auto_git_sync: z.boolean().optional(),
  target_role: z.string().max(200).optional().nullable(),
  target_tier: z.string().max(200).optional().nullable(),
  comp_floor: z.number().int().min(0).max(10000000).optional().nullable(),
  comp_ceiling: z.number().int().min(0).max(10000000).optional().nullable(),
  comp_currency: z.string().max(10).optional().nullable(),
  include_equity: z.boolean().optional().nullable(),
  contractor_pref: z.string().max(50).optional().nullable(),
  monitored_sources: z.array(z.string()).optional(),
});

export async function GET() {
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Missing supabase env" }, { status: 500 });
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ profile: data, email: user.email });
}

export async function PUT(req: NextRequest) {
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Missing supabase env" }, { status: 500 });
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
  const parsed = ProfileSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const payload: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(parsed.data)) {
    if (v !== undefined) payload[k] = v;
  }
  if (Object.keys(payload).length === 0) return NextResponse.json({ error: "No fields" }, { status: 400 });

  // Validate monitored_sources values if present
  if (payload.monitored_sources) {
    const allowed = new Set(["hackernews", "himalayas", "remotejobs", "remotive", "arbeitnow", "remoteok", "jobicy", "adzuna", "jooble", "themuse"]);
    const arr = payload.monitored_sources as string[];
    for (const s of arr) if (!allowed.has(s)) return NextResponse.json({ error: `Unknown source: ${s}` }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("profiles")
    .upsert({ id: user.id, ...payload }, { onConflict: "id" })
    .select()
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  try {
    revalidatePath("/gap-report");
    revalidatePath("/(app)/gap-report");
  } catch {}
  return NextResponse.json({ profile: data });
}
