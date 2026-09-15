import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getJobsWithSkills, getUserSkillsAndGaps, applyArchetypeFilter, sortJobs, type SortKey } from "@/lib/queries/jobs";
import { stackMatchPct } from "@/lib/matching";

export const dynamic = "force-dynamic";

const QuerySchema = z.object({
  q: z.string().max(100).optional(),
  source: z.enum(["all", "hackernews", "himalayas", "remotejobs", "remotive", "arbeitnow", "remoteok", "jobicy", "adzuna", "jooble", "themuse"]).optional(),
  archetype: z.string().max(50).optional(),
  sort: z.enum(["profile_match", "latest", "comp_high_low"]).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  skill: z.string().max(100).optional(),
});

export async function GET(req: NextRequest) {
  const raw: Record<string, string> = {};
  req.nextUrl.searchParams.forEach((v, k) => {
    raw[k] = v;
  });
  const parsed = QuerySchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const q = parsed.data.q?.trim() || undefined;
  const source = parsed.data.source ?? "all";
  const archetype = parsed.data.archetype ?? null;
  const sort: SortKey = (parsed.data.sort as SortKey) ?? "latest";
  const limit = parsed.data.limit ?? 20;
  const offset = parsed.data.offset ?? 0;
  const skillParam = parsed.data.skill?.trim() || undefined;
  const skills = skillParam ? [skillParam] : undefined;

  // Prefer service-role for reading job_postings (no RLS on that table) but allow anon fallback
  let supabaseRead: NonNullable<Awaited<ReturnType<typeof createServiceRoleClient>>> | null = null;
  try {
    supabaseRead = createServiceRoleClient();
  } catch {}
  if (!supabaseRead) {
    const anon = await createClient();
    if (!anon) return NextResponse.json({ error: "Missing Supabase env" }, { status: 500 });
    supabaseRead = anon as unknown as typeof supabaseRead;
  }

  // Get user context for personalization
  let userSkills: string[] = [];
  let gaps = new Set<string>();
  let monitoredSources: string[] | undefined = undefined;
  const savedIds = new Set<string>();
  try {
    const anon = await createClient();
    if (anon) {
      const { data: { user } } = await anon.auth.getUser();
      if (user) {
        const fetched = await getUserSkillsAndGaps(anon, user.id);
        userSkills = fetched.skills;
        gaps = fetched.gaps;
        const { data: profile } = await anon.from("profiles").select("monitored_sources").eq("id", user.id).maybeSingle();
        if (profile && Array.isArray((profile as { monitored_sources?: string[] }).monitored_sources)) {
          monitoredSources = (profile as { monitored_sources: string[] }).monitored_sources;
        }
        const { data: saved } = await anon.from("saved_jobs").select("job_id").eq("user_id", user.id);
        for (const r of (saved as { job_id: string }[] | null) ?? []) savedIds.add(r.job_id);
      }
    }
  } catch {}

  const { jobs, totalCount } = await getJobsWithSkills(supabaseRead as unknown as Parameters<typeof getJobsWithSkills>[0], {
    limit: archetype ? 50 : limit,
    offset: archetype ? 0 : offset,
    search: q,
    source: source === "all" ? undefined : source,
    monitoredSources: source === "all" ? monitoredSources : undefined,
    skills,
  });

  const filtered = archetype ? applyArchetypeFilter(jobs, archetype) : jobs;

  const withMatch = filtered.map((j) => {
    const match = stackMatchPct(j.skills, userSkills);
    const distinctLower = [...new Set(j.skills.map((s) => s.toLowerCase()))];
    const userSet = new Set(userSkills.map((s) => s.toLowerCase()));
    const matchedDistinct = distinctLower.filter((s) => userSet.has(s));
    const gapDistinct = distinctLower.filter((s) => gaps.has(s));
    return {
      ...j,
      stack_match_pct: match,
      stackMatch: match,
      stack_match_label: match === undefined ? "Not enough data" : `${match}% stack match`,
      matched_skills: matchedDistinct,
      gap_skills: gapDistinct,
      is_saved: savedIds.has(j.id),
    };
  });

  const sorted = sortJobs(withMatch, sort);

  // If archetype expanded the fetch to 50, slice to requested page after sort/filter
  const paged = archetype ? sorted.slice(offset, offset + limit) : sorted;

  return NextResponse.json({
    jobs: paged,
    total: archetype ? filtered.length : totalCount,
    hasMore: archetype ? offset + limit < filtered.length : offset + limit < totalCount,
    userSkills,
    gaps: [...gaps],
  });
}
