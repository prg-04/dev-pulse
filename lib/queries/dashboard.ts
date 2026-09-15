import type { SupabaseClient } from "@supabase/supabase-js";

export type DashboardTopSkills = { rank: number; skill: string; count: number; delta: number };

export async function getLatestMonth(supabase: SupabaseClient): Promise<string | null> {
  const { data } = await supabase
    .from("skill_demand_snapshots")
    .select("month")
    .order("month", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as { month?: string } | null)?.month ?? null;
}

export async function getTopSkillsForMonth(
  supabase: SupabaseClient,
  month: string,
  limit = 50
): Promise<{ skill: string; mention_count: number }[]> {
  const { data } = await supabase.from("skill_demand_snapshots").select("skill, mention_count").eq("month", month);
  if (!data) return [];
  const agg = new Map<string, number>();
  for (const row of data as { skill: string; mention_count: number }[]) {
    agg.set(row.skill, (agg.get(row.skill) ?? 0) + (row.mention_count ?? 0));
  }
  return [...agg.entries()]
    .map(([skill, mention_count]) => ({ skill, mention_count }))
    .sort((a, b) => b.mention_count - a.mention_count)
    .slice(0, limit);
}

export async function getTopSkillsWithDelta(
  supabase: SupabaseClient,
  currentMonth: string
): Promise<DashboardTopSkills[]> {
  const curYear = Number(currentMonth.slice(0, 4));
  const curMon = Number(currentMonth.slice(5, 7));
  const prevDate = new Date(curYear, curMon - 2, 1);
  const prevMonth = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, "0")}`;
  const [cur, prev] = await Promise.all([
    getTopSkillsForMonth(supabase, currentMonth, 50),
    getTopSkillsForMonth(supabase, prevMonth, 50),
  ]);
  const prevMap = new Map(prev.map((r) => [r.skill, r.mention_count]));
  return cur.map((row, idx) => {
    const p = prevMap.get(row.skill) ?? 0;
    const delta = p === 0 ? (row.mention_count > 0 ? 100 : 0) : Math.round(((row.mention_count - p) / p) * 1000) / 10;
    return { rank: idx + 1, skill: row.skill, count: row.mention_count, delta };
  });
}

export async function getSourcesBreakdown(
  supabase: SupabaseClient,
  month: string
): Promise<{ source: string; count: number; pct: number }[]> {
  const { data } = await supabase.from("skill_demand_snapshots").select("source, mention_count").eq("month", month);
  if (!data || data.length === 0) return [];
  const bySource = new Map<string, number>();
  for (const r of data as { source: string; mention_count: number }[]) {
    bySource.set(r.source, (bySource.get(r.source) ?? 0) + r.mention_count);
  }
  const total = [...bySource.values()].reduce((a, b) => a + b, 0) || 1;
  return [...bySource.entries()]
    .map(([source, count]) => ({ source, count, pct: Math.round((count / total) * 1000) / 10 }))
    .sort((a, b) => b.count - a.count);
}

export async function getBiggestMovers(
  supabase: SupabaseClient,
  currentMonth: string
): Promise<{ rising: { skill: string; delta: number }[]; declining: { skill: string; delta: number }[] }> {
  const skills = await getTopSkillsWithDelta(supabase, currentMonth);
  const rising = [...skills]
    .filter((s) => s.delta > 0)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 3)
    .map((s) => ({ skill: s.skill, delta: s.delta }));
  const declining = [...skills]
    .filter((s) => s.delta < 0)
    .sort((a, b) => a.delta - b.delta)
    .slice(0, 3)
    .map((s) => ({ skill: s.skill, delta: s.delta }));
  return { rising, declining };
}

export async function getIngestionLastUpdate(supabase: SupabaseClient): Promise<string | null> {
  const { data } = await supabase
    .from("ingestion_runs")
    .select("completed_at")
    .eq("status", "success")
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as { completed_at?: string } | null)?.completed_at ?? null;
}
