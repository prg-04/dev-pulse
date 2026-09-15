import type { SupabaseClient } from "@supabase/supabase-js";

export type TrendPoint = Record<string, string | number>;

function toMonthLabel(ym: string): string {
  const dt = new Date(ym + "-01T00:00:00Z");
  return dt.toLocaleString("en-US", { month: "short" }) + ` '${String(dt.getFullYear()).slice(-2)}`;
}

export async function getTrendsData(
  supabase: SupabaseClient,
  skills: string[],
  months: string[]
): Promise<{ rows: TrendPoint[]; months: string[] }> {
  if (skills.length === 0 || months.length === 0) return { rows: [], months };
  const { data } = await supabase
    .from("skill_demand_snapshots")
    .select("skill, month, mention_count")
    .in("month", months)
    .in("skill", skills)
    .order("month", { ascending: true });
  const byMonth: Record<string, Record<string, number>> = {};
  months.forEach((m) => (byMonth[m] = {}));
  for (const row of (data ?? []) as { skill: string; month: string; mention_count: number }[]) {
    if (byMonth[row.month]) byMonth[row.month][row.skill] = row.mention_count;
  }
  const rows: TrendPoint[] = months.map((m) => {
    const vals = byMonth[m];
    const out: TrendPoint = { month: toMonthLabel(m) };
    skills.forEach((s) => {
      out[s] = vals[s] ?? 0;
    });
    return out;
  });
  return { rows, months };
}

export function buildMonthsBack(count: number, anchor = new Date()): string[] {
  const months: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const dt = new Date(anchor.getFullYear(), anchor.getMonth() - i, 1);
    months.push(`${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`);
  }
  return months;
}
