import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  // Local-dev diagnostics only — unreachable in production.
  const isDev =
    process.env.NEXT_PUBLIC_ENV === "development" && process.env.NODE_ENV !== "production";
  if (!isDev) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const supabase = await createClient();
  if (!supabase) {
    return NextResponse.json({ error: "Missing Supabase env" }, { status: 500 });
  }

  // Try to query skill_demand_snapshots with the anon client
  const { data, error } = await supabase
    .from("skill_demand_snapshots")
    .select("*")
    .limit(5);

  return NextResponse.json({
    error: error?.message ?? null,
    count: data?.length ?? 0,
    rows: data ?? [],
  });
}
