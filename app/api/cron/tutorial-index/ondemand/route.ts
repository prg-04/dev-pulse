import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { normalizeSkill, ALL_SKILLS } from "@/lib/skills-dictionary";
import { indexSkillOnDemand } from "../ondemand";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const BodySchema = z.object({
  skill: z.string().min(1),
});

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

  const { skill } = parsed.data;

  const normalizedSkill = normalizeSkill(skill);
  if (!normalizedSkill || !ALL_SKILLS.includes(normalizedSkill)) {
    return NextResponse.json(
      { error: `Unknown skill: ${skill}. Must be one of: ${ALL_SKILLS.join(", ")}` },
      { status: 400 }
    );
  }

  // Validate user session — this is a user-triggered action (AGENTS §3)
  const supabaseAuth = await createClient();
  if (!supabaseAuth) {
    return NextResponse.json({ error: "Missing env" }, { status: 500 });
  }
  const {
    data: { user },
  } = await supabaseAuth.auth.getUser();

  // Dev-mode bypass for local testing: allow unauthenticated access only when
  // BOTH NEXT_PUBLIC_ENV is "development" AND NODE_ENV is not "production".
  const isDevBypass =
    process.env.NEXT_PUBLIC_ENV === "development" && process.env.NODE_ENV !== "production";
  if (!user && !isDevBypass) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const youtubeApiKey = process.env.YOUTUBE_API_KEY;
  if (!youtubeApiKey) {
    return NextResponse.json({ error: "YOUTUBE_API_KEY is not configured" }, { status: 500 });
  }

  const supabase = createServiceRoleClient();
  if (!supabase) {
    return NextResponse.json({ error: "Missing Supabase env" }, { status: 500 });
  }

  // Enforce daily on-demand cap to protect the shared AI generation pool.
  const onDemandLimit = Number(process.env.ON_DEMAND_INDEX_LIMIT ?? "10");
  if (onDemandLimit > 0) {
    const today = new Date().toISOString().slice(0, 10);
    const { data: usageRow } = await supabase
      .from("ai_daily_usage")
      .select("on_demand_index_calls")
      .eq("usage_date", today)
      .maybeSingle();

    const currentCalls = (usageRow as { on_demand_index_calls?: number } | null)?.on_demand_index_calls ?? 0;
    if (currentCalls >= onDemandLimit) {
      return NextResponse.json(
        { error: `On-demand indexing limit reached today (${currentCalls}/${onDemandLimit})` },
        { status: 429 }
      );
    }
  }

  try {
    const result = await indexSkillOnDemand(supabase, normalizedSkill, youtubeApiKey);

    // Increment the daily on-demand counter if indexing actually ran.
    if (result.status !== "skipped_recent" && result.status !== "failed") {
      const today = new Date().toISOString().slice(0, 10);
      await supabase.rpc("increment_on_demand_index_calls", {
        p_usage_date: today,
        p_delta: 1,
      });
    }

    return NextResponse.json({
      ok: true,
      result,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[tutorial-index-ondemand] Skill "${skill}" failed:`, msg);
    return NextResponse.json(
      { error: msg, skill },
      { status: 500 }
    );
  }
}
