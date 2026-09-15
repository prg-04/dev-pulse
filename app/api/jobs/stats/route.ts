import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { createClient } from "@/lib/supabase/server";
import { getJobsStats } from "@/lib/queries/jobs";

export const dynamic = "force-dynamic";

export async function GET() {
  let supabase: ReturnType<typeof createServiceRoleClient> = null as unknown as ReturnType<typeof createServiceRoleClient>;
  try {
    supabase = createServiceRoleClient();
  } catch {}
  if (!supabase) {
    const anon = await createClient();
    if (!anon) return NextResponse.json({ error: "Missing Supabase env" }, { status: 500 });
    supabase = anon as unknown as typeof supabase;
  }

  const stats = await getJobsStats(supabase as Parameters<typeof getJobsStats>[0]);
  const bySourceOrdered: Record<string, number> = {
    hackernews: stats.bySource.hackernews ?? 0,
    himalayas: stats.bySource.himalayas ?? 0,
    remotejobs: stats.bySource.remotejobs ?? 0,
    remotive: stats.bySource.remotive ?? 0,
    arbeitnow: stats.bySource.arbeitnow ?? 0,
    remoteok: stats.bySource.remoteok ?? 0,
    jobicy: stats.bySource.jobicy ?? 0,
    adzuna: stats.bySource.adzuna ?? 0,
    jooble: stats.bySource.jooble ?? 0,
    themuse: stats.bySource.themuse ?? 0,
  };

  return NextResponse.json({
    total: stats.total,
    bySource: bySourceOrdered,
    lastUpdate: stats.lastUpdate,
    sources: [
      { id: "hackernews", label: "HackerNews", count: bySourceOrdered.hackernews, color: "#FB923C" },
      { id: "himalayas", label: "Himalayas", count: bySourceOrdered.himalayas, color: "#A78BFA" },
      { id: "remotejobs", label: "RemoteJobs", count: bySourceOrdered.remotejobs, color: "#2DD4BF" },
      { id: "remotive", label: "Remotive", count: bySourceOrdered.remotive, color: "#F472B6" },
      { id: "arbeitnow", label: "Arbeitnow", count: bySourceOrdered.arbeitnow, color: "#38BDF8" },
      { id: "remoteok", label: "RemoteOK", count: bySourceOrdered.remoteok, color: "#F43F5E" },
      { id: "jobicy", label: "Jobicy", count: bySourceOrdered.jobicy, color: "#22C55E" },
      { id: "adzuna", label: "Adzuna", count: bySourceOrdered.adzuna, color: "#F59E0B" },
      { id: "jooble", label: "Jooble", count: bySourceOrdered.jooble, color: "#6366F1" },
      { id: "themuse", label: "The Muse", count: bySourceOrdered.themuse, color: "#06B6D4" },
    ],
  });
}
