import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  if (!supabase) {
    return NextResponse.json({ error: "Missing Supabase env" }, { status: 500 });
  }

  const { data: { user } } = await supabase.auth.getUser();
  
  const [snapshots, jobs] = await Promise.all([
    supabase.from("skill_demand_snapshots").select("*").limit(3),
    supabase.from("job_postings").select("*").limit(3),
  ]);

  return NextResponse.json({
    user: user ? { id: user.id, email: user.email } : null,
    snapshots: snapshots.data ?? [],
    snapshotsError: snapshots.error?.message ?? null,
    jobs: jobs.data ?? [],
    jobsError: jobs.error?.message ?? null,
  });
}
