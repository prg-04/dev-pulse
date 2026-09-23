import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { getJobsWithSkills, getJobsStats, getUserSkillsAndGaps } from "@/lib/queries/jobs";
import { stackMatchPct } from "@/lib/matching";
import { JobsClient, type JobsInitialJob } from "@/components/jobs/JobsClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Live Job Postings" };

export default async function JobsPage({ searchParams }: { searchParams?: Record<string, string | string[]> }) {
  let stats = { total: 0, bySource: { hackernews: 0, himalayas: 0, remotejobs: 0, remotive: 0, arbeitnow: 0, remoteok: 0, jobicy: 0, adzuna: 0, jooble: 0, themuse: 0 } as Record<string, number>, lastUpdate: null as string | null };
  let initialJobs: JobsInitialJob[] = [];
  let totalCount = 0;
  let userSkills: string[] = [];
  let gaps: string[] = [];
  let savedIds: string[] = [];
  const skillFilter = typeof searchParams?.skill === "string" ? searchParams.skill.trim() : undefined;

  try {
    let readClient: Awaited<ReturnType<typeof createClient>> | ReturnType<typeof createServiceRoleClient> = null;
    try {
      readClient = createServiceRoleClient();
    } catch {}
    if (!readClient) readClient = await createClient();

    if (readClient) {
      const fetchedStats = await getJobsStats(readClient as Parameters<typeof getJobsStats>[0]);
      stats = fetchedStats;

      // Try to get user context
      let monitored: string[] | undefined;
      const anon = await createClient();
      if (anon) {
        const { data: { user } } = await anon.auth.getUser();
        if (user) {
          const fetched = await getUserSkillsAndGaps(anon, user.id);
          userSkills = fetched.skills;
          gaps = [...fetched.gaps];
          const { data: profile } = await anon.from("profiles").select("monitored_sources").eq("id", user.id).maybeSingle();
          if (profile && Array.isArray((profile as { monitored_sources?: string[] }).monitored_sources)) {
            monitored = (profile as { monitored_sources: string[] }).monitored_sources;
          }
          const { data: saved } = await anon.from("saved_jobs").select("job_id").eq("user_id", user.id);
          savedIds = ((saved as { job_id: string }[] | null) ?? []).map((r) => r.job_id);
        }
      }

      const { jobs, totalCount: count } = await getJobsWithSkills(readClient as Parameters<typeof getJobsWithSkills>[0], {
        limit: 20,
        offset: 0,
        source: undefined,
        monitoredSources: monitored,
        skills: skillFilter ? [skillFilter] : undefined,
      });

      totalCount = count;
      initialJobs = jobs.map((j) => {
        const match = stackMatchPct(j.skills, userSkills);
        const distinctLower = [...new Set(j.skills.map((s) => s.toLowerCase()))];
        const userSet = new Set(userSkills.map((s) => s.toLowerCase()));
        const gapSet = new Set(gaps.map((s) => s.toLowerCase()));
        const matchedDistinct = distinctLower.filter((s) => userSet.has(s));
        const gapDistinct = distinctLower.filter((s) => gapSet.has(s));
        return {
          ...j,
          skills: j.skills,
          stack_match_pct: match,
          stackMatch: match,
          stack_match_label: match === undefined ? "Not enough data" : `${match}% stack match`,
          matched_skills: matchedDistinct,
          gap_skills: gapDistinct,
          is_saved: savedIds.includes(j.id),
        };
      });
    }
  } catch {}

  return (
    <main className="mx-auto max-w-[1280px] px-6 py-6">
      <JobsClient initialJobs={initialJobs} initialTotal={totalCount} stats={stats} userSkills={userSkills} gaps={gaps} initialSkill={skillFilter} />
    </main>
  );
}
