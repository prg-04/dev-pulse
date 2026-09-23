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

  try {
    await supabase.rpc("enqueue_discovery_request", {
      p_skill: normalizedSkill,
    });

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
