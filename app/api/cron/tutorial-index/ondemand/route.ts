import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { normalizeSkill, ALL_SKILLS } from "@/lib/skills-dictionary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const BodySchema = z.object({
  skill: z.string().min(1),
});

// Per-user abuse protection (issue #2). The discovery_requests queue is
// global per-skill, so without this one account could enqueue arbitrarily
// many distinct skills. Table tutorial_ondemand_requests carries the
// per-user log — see the pending migration SQL in the issue report.
const MAX_REQUESTS_PER_HOUR = 5;
const RATE_LIMIT_WINDOW_HOURS = 1;
const IDEMPOTENCY_WINDOW_MINUTES = 30;

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

  const supabase = createServiceRoleClient();
  if (!supabase) {
    return NextResponse.json({ error: "Missing Supabase env" }, { status: 500 });
  }

  // Per-user rate limit + idempotency. Skipped only for the dev bypass,
  // which has no user identity by definition (dev-only, never production).
  if (user) {
    const windowStart = new Date(
      Date.now() - RATE_LIMIT_WINDOW_HOURS * 60 * 60 * 1000
    ).toISOString();
    const idempotencyStart = new Date(
      Date.now() - IDEMPOTENCY_WINDOW_MINUTES * 60 * 1000
    ).toISOString();

    const { data: pending, error: pendingError } = await supabase
      .from("tutorial_ondemand_requests")
      .select("id")
      .eq("user_id", user.id)
      .eq("skill", normalizedSkill)
      .gte("created_at", idempotencyStart)
      .limit(1)
      .maybeSingle();
    if (pendingError) {
      console.error(`[tutorial-index-ondemand] Request-log check failed:`, pendingError.message);
      return NextResponse.json(
        { error: "Request log unavailable (has the on-demand rate-limit migration been applied?)", skill },
        { status: 500 }
      );
    }
    if (pending) {
      return NextResponse.json({
        ok: true,
        enqueued: false,
        deduped: true,
        skill: normalizedSkill,
      });
    }

    const { data: recent, error: recentError } = await supabase
      .from("tutorial_ondemand_requests")
      .select("id")
      .eq("user_id", user.id)
      .gte("created_at", windowStart);
    if (recentError) {
      console.error(`[tutorial-index-ondemand] Rate-limit check failed:`, recentError.message);
      return NextResponse.json(
        { error: "Request log unavailable (has the on-demand rate-limit migration been applied?)", skill },
        { status: 500 }
      );
    }
    if ((recent ?? []).length >= MAX_REQUESTS_PER_HOUR) {
      return NextResponse.json(
        {
          error: `Rate limit exceeded: max ${MAX_REQUESTS_PER_HOUR} on-demand requests per ${RATE_LIMIT_WINDOW_HOURS} hour(s)`,
          skill,
        },
        { status: 429 }
      );
    }

    const { error: logError } = await supabase
      .from("tutorial_ondemand_requests")
      .insert({ user_id: user.id, skill: normalizedSkill });
    if (logError) {
      console.error(`[tutorial-index-ondemand] Request-log insert failed:`, logError.message);
      return NextResponse.json(
        { error: "Request log unavailable (has the on-demand rate-limit migration been applied?)", skill },
        { status: 500 }
      );
    }
  }

  try {
    const { error: enqueueError } = await supabase.rpc("enqueue_discovery_request", {
      p_skill: normalizedSkill,
    });

    if (enqueueError) {
      console.error(`[tutorial-index-ondemand] Enqueue failed for "${skill}":`, enqueueError.message);
      return NextResponse.json(
        { error: enqueueError.message, skill },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      enqueued: true,
      skill: normalizedSkill,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[tutorial-index-ondemand] Enqueue failed for "${skill}":`, msg);
    return NextResponse.json(
      { error: msg, skill },
      { status: 500 }
    );
  }
}
