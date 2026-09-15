import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  if (!supabase) {
    return NextResponse.json({ error: "Missing Supabase env" }, { status: 500 });
  }

  const tables = ["job_postings", "skill_mentions", "skill_demand_snapshots", "ingestion_runs", "profiles"];
  const results: Record<string, { count: number | null; error: string | null }> = {};

  for (const table of tables) {
    const { count, error } = await supabase.from(table).select("*", { count: "exact", head: true });
    results[table] = { count: count ?? 0, error: error?.message ?? null };
  }

  return NextResponse.json(results);
}
