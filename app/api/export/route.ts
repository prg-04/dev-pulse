import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resolveUserFromBearer } from "@/lib/api-keys";
import { createClient as createAnonClient } from "@supabase/supabase-js";
import { getSupabaseUrl, getSupabaseServiceRoleKey } from "@/lib/supabase/env";

export async function GET(req: NextRequest) {
  // Accept exactly one identity: bearer OR session, not both silently
  const bearerUserId = await resolveUserFromBearer(req);

  let userId: string | null = bearerUserId;
  let via: "bearer" | "session" = "bearer";

  if (!bearerUserId) {
    const supabase = await createClient();
    if (!supabase) return NextResponse.json({ error: "Missing env" }, { status: 500 });
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    // If request had a bearer that failed verification, reject instead of falling back to session
    const hadBearerHeader = !!req.headers.get("Authorization")?.startsWith("Bearer ");
    if (hadBearerHeader) return NextResponse.json({ error: "Invalid or revoked API key" }, { status: 401 });
    userId = user.id;
    via = "session";

    // For session path, we can reuse the same client for data fetches below via admin or session client
    // Use the session client for RLS correctness
    const [profile, skills, profilesSnap, saved] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
      supabase.from("user_skills").select("*").eq("user_id", userId),
      supabase.from("user_skill_profiles").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(5),
      supabase.from("saved_jobs").select("*").eq("user_id", userId),
    ]);
    return NextResponse.json({
      via,
      profile: profile.data,
      user_skills: skills.data,
      user_skill_profiles: profilesSnap.data,
      saved_jobs: saved.data,
    });
  }

  // Bearer path — use service role to fetch caller's own rows
  const url = getSupabaseUrl();
  const serviceKey = getSupabaseServiceRoleKey();
  if (!url || !serviceKey) return NextResponse.json({ error: "Missing service env" }, { status: 500 });
  const admin = createAnonClient(url, serviceKey);
  const [profile, skills, profilesSnap, saved] = await Promise.all([
    admin.from("profiles").select("*").eq("id", userId).maybeSingle(),
    admin.from("user_skills").select("*").eq("user_id", userId),
    admin.from("user_skill_profiles").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(5),
    admin.from("saved_jobs").select("*").eq("user_id", userId),
  ]);
  return NextResponse.json({
    via,
    profile: profile.data,
    user_skills: skills.data,
    user_skill_profiles: profilesSnap.data,
    saved_jobs: saved.data,
  });
}
