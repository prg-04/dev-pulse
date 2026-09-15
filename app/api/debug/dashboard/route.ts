import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  if (!supabase) {
    return NextResponse.json({ error: "Missing Supabase env" }, { status: 500 });
  }

  const [latestMonth, topSkills, sources, movers] = await Promise.all([
    supabase.from("skill_demand_snapshots").select("month").order("month", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("skill_demand_snapshots").select("skill, mention_count").order("mention_count", { ascending: false }).limit(5),
    supabase.from("skill_demand_snapshots").select("source, mention_count").order("mention_count", { ascending: false }).limit(10),
    supabase.from("skill_demand_snapshots").select("skill, mention_count").order("mention_count", { ascending: false }).limit(50),
  ]);

  const latest = (latestMonth.data as { month?: string } | null)?.month ?? null;
  const top = (topSkills.data as { skill: string; mention_count: number }[] | null) ?? [];
  const sourceRows = (sources.data as { source: string; mention_count: number }[] | null) ?? [];

  const bySource = new Map<string, number>();
  for (const r of sourceRows) bySource.set(r.source, (bySource.get(r.source) ?? 0) + r.mention_count);
  const total = [...bySource.values()].reduce((a, b) => a + b, 0) || 1;
  const sourceBreakdown = [...bySource.entries()].map(([source, count]) => ({ source, count, pct: Math.round((count / total) * 1000) / 10 }));

  const all = (movers.data as { skill: string; mention_count: number }[] | null) ?? [];
  const rising = [...all].sort((a, b) => b.mention_count - a.mention_count).slice(0, 3).map(r => ({ skill: r.skill, delta: 0 }));
  const declining = [...all].sort((a, b) => a.mention_count - b.mention_count).slice(0, 3).map(r => ({ skill: r.skill, delta: 0 }));

  return NextResponse.json({
    latestMonth: latest,
    topSkills: top.map(t => ({ skill: t.skill, count: t.mention_count })),
    sourceBreakdown,
    movers: { rising, declining },
    totalSnapshots: all.length,
  });
}
