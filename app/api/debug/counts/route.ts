import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export async function GET() {
  const supabase = createServiceRoleClient();
  if (!supabase) {
    return NextResponse.json({ error: "Missing Supabase env" }, { status: 500 });
  }

  const [jobCount, mentionCount, snapshotCount, runCount] = await Promise.all([
    supabase.from("job_postings").select("*", { count: "exact", head: true }),
    supabase.from("skill_mentions").select("*", { count: "exact", head: true }),
    supabase.from("skill_demand_snapshots").select("*", { count: "exact", head: true }),
    supabase.from("ingestion_runs").select("*", { count: "exact", head: true }),
  ]);

  return NextResponse.json({
    job_postings: jobCount.count ?? 0,
    skill_mentions: mentionCount.count ?? 0,
    skill_demand_snapshots: snapshotCount.count ?? 0,
    ingestion_runs: runCount.count ?? 0,
  });
}
