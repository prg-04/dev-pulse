import type { SupabaseClient } from "@supabase/supabase-js";

export type JobPostingRow = {
  id: string;
  external_id: string;
  source: string;
  company: string | null;
  title: string | null;
  description: string | null;
  comp_min: number | null;
  comp_max: number | null;
  comp_currency: string | null;
  liquidity_tier: string | null;
  contractor_type: string | null;
  location_text: string | null;
  external_url: string | null;
  posted_at: string | null;
  ingested_at: string | null;
};

export type JobWithSkills = JobPostingRow & {
  skills: string[];
};

export type JobsStats = {
  total: number;
  bySource: Record<string, number>;
  lastUpdate: string | null;
};

export async function getJobsStats(supabase: SupabaseClient): Promise<JobsStats> {
  const { data: postings } = await supabase.from("job_postings").select("source");
  const bySource: Record<string, number> = {};
  let total = 0;
  for (const r of (postings as { source: string }[] | null) ?? []) {
    bySource[r.source] = (bySource[r.source] ?? 0) + 1;
    total++;
  }
  const { data: lastRun } = await supabase
    .from("ingestion_runs")
    .select("completed_at")
    .eq("status", "success")
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return {
    total,
    bySource,
    lastUpdate: (lastRun as { completed_at?: string } | null)?.completed_at ?? null,
  };
}

export async function getJobsWithSkills(
  supabase: SupabaseClient,
  opts: { limit: number; offset: number; search?: string; source?: string; monitoredSources?: string[]; skills?: string[] }
): Promise<{ jobs: JobWithSkills[]; totalCount: number }> {
  let query = supabase.from("job_postings").select("*", { count: "exact" });

  if (opts.source && opts.source !== "all") {
    query = query.eq("source", opts.source);
  } else if (opts.monitoredSources && opts.monitoredSources.length > 0) {
    query = query.in("source", opts.monitoredSources);
  }

  if (opts.skills && opts.skills.length > 0) {
    const uniqueSkills = [...new Set(opts.skills.map((s) => s.trim().toLowerCase()).filter(Boolean))];
    if (uniqueSkills.length > 0) {
      const { data: mentions } = await supabase
        .from("skill_mentions")
        .select("job_id")
        .in("skill", uniqueSkills);
      const jobIds = [...new Set((((mentions as { job_id: string }[] | null) ?? []) as { job_id: string }[]).map((m) => m.job_id))];
      if (jobIds.length === 0) {
        return { jobs: [], totalCount: 0 };
      }
      query = query.in("id", jobIds);
    }
  }

  if (opts.search) {
    const escaped = opts.search.replace(/%/g, "\\%").replace(/_/g, "\\_");
    query = query.or(`title.ilike.%${escaped}%,description.ilike.%${escaped}%,company.ilike.%${escaped}%`);
  }

  query = query.order("posted_at", { ascending: false, nullsFirst: false }).order("ingested_at", { ascending: false });
  query = query.range(opts.offset, opts.offset + opts.limit - 1);

  const { data, error, count } = await query;
  if (error || !data) return { jobs: [], totalCount: count ?? 0 };

  const postings = data as JobPostingRow[];
  if (postings.length === 0) return { jobs: [], totalCount: count ?? 0 };

  const jobIds = postings.map((p) => p.id);
  const { data: mentions } = await supabase.from("skill_mentions").select("job_id, skill").in("job_id", jobIds);
  const skillMap = new Map<string, string[]>();
  for (const m of (mentions as { job_id: string; skill: string }[] | null) ?? []) {
    const arr = skillMap.get(m.job_id) ?? [];
    arr.push(m.skill);
    skillMap.set(m.job_id, arr);
  }

  const jobs: JobWithSkills[] = postings.map((p) => ({
    ...p,
    skills: skillMap.get(p.id) ?? [],
  }));

  return { jobs, totalCount: count ?? postings.length };
}

export async function getUserSkillsAndGaps(
  supabase: SupabaseClient,
  userId: string
): Promise<{ skills: string[]; gaps: Set<string> }> {
  let skills: string[] = [];
  try {
    const { data: rows } = await supabase.from("user_skills").select("skill").eq("user_id", userId);
    if (rows && (rows as { skill: string }[]).length > 0) {
      skills = (rows as { skill: string }[]).map((r) => r.skill.toLowerCase());
    } else {
      const { data: lastProfile } = await supabase
        .from("user_skill_profiles")
        .select("skills")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (lastProfile && (lastProfile as { skills: string[] }).skills?.length) {
        skills = ((lastProfile as { skills: string[] }).skills ?? []).map((s) => s.toLowerCase());
      }
    }
  } catch {}

  let gaps = new Set<string>();
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data: gapRows } = await supabase
      .from("gap_report_events")
      .select("skill")
      .eq("user_id", userId)
      .gte("created_at", thirtyDaysAgo);
    for (const r of (gapRows as { skill: string }[] | null) ?? []) {
      gaps.add(r.skill.toLowerCase());
    }
  } catch {}

  return { skills, gaps };
}

export function applyArchetypeFilter(
  jobs: JobWithSkills[],
  archetype: string | null
): JobWithSkills[] {
  if (!archetype || archetype === "all") return jobs;
  const lower = archetype.toLowerCase();
  return jobs.filter((j) => {
    const text = `${j.title ?? ""} ${j.description ?? ""}`.toLowerCase();
    const loc = (j.location_text ?? "").toLowerCase();
    if (lower === "senior fullstack" || lower === "senior_fullstack") {
      return /(senior|staff|lead|principal|full-stack|fullstack)/i.test(text);
    }
    if (lower === "backend") return /(backend|server|api|postgres|go\b|node|golang|microservice)/i.test(text);
    if (lower === "frontend") return /(frontend|react|vue|canvas|webgl|tailwind|next\.js)/i.test(text);
    if (lower === "infra/devops" || lower === "infra" || lower === "devops")
      return /(infra|devops|kubernetes|k8s|aws|docker|platform|terraform)/i.test(text);
    if (lower === "us remote" || lower === "us remote ($160k+)" || lower === "us_remote") {
      const compOk = (j.comp_min ?? 0) >= 160000 || (j.comp_max ?? 0) >= 160000;
      const locOk = /(remote|us|utc)/i.test(loc);
      return compOk && locOk;
    }
    return true;
  });
}

export type SortKey = "profile_match" | "latest" | "comp_high_low";

type SortableJob = JobWithSkills & { stack_match_pct?: number | null; stackMatch?: number | null; stack_match?: number | null };

function getMatchScore(j: SortableJob): number {
  const v = j.stack_match_pct ?? j.stackMatch ?? j.stack_match;
  return typeof v === "number" ? v : -1;
}

export function sortJobs(jobs: SortableJob[], sort: SortKey): SortableJob[] {
  const copy = [...jobs];
  if (sort === "profile_match") {
    copy.sort((a, b) => {
      const diff = getMatchScore(b) - getMatchScore(a);
      if (diff !== 0) return diff;
      const da = a.posted_at ? new Date(a.posted_at).getTime() : a.ingested_at ? new Date(a.ingested_at).getTime() : 0;
      const db = b.posted_at ? new Date(b.posted_at).getTime() : b.ingested_at ? new Date(b.ingested_at).getTime() : 0;
      return db - da;
    });
  } else if (sort === "comp_high_low") {
    copy.sort((a, b) => (b.comp_max ?? b.comp_min ?? 0) - (a.comp_max ?? a.comp_min ?? 0));
  } else {
    copy.sort((a, b) => {
      const da = a.posted_at ? new Date(a.posted_at).getTime() : a.ingested_at ? new Date(a.ingested_at).getTime() : 0;
      const db = b.posted_at ? new Date(b.posted_at).getTime() : b.ingested_at ? new Date(b.ingested_at).getTime() : 0;
      return db - da;
    });
  }
  return copy;
}
