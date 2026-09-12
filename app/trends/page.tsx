import { createClient } from "@/lib/supabase/server";
import { DashboardHeader } from "@/components/dashboard/DashboardHeader";
import { TrendsClient } from "@/components/trends/TrendsClient";
import { mockTrendData } from "@/lib/mock/dashboard-data";

export const dynamic = "force-dynamic";

function toMonthLabel(d: Date) {
  return d.toLocaleString("en-US", { month: "short" });
}

export default async function TrendsPage() {
  let initialData: {
    "3M": Record<string, string | number>[];
    "6M": Record<string, string | number>[];
    "12M": Record<string, string | number>[];
  } = mockTrendData as unknown as typeof mockTrendData;

  try {
    const supabase = await createClient();
    if (supabase) {
      const now = new Date();
      const months: string[] = [];
      for (let i = 11; i >= 0; i--) {
        const dt = new Date(now.getFullYear(), now.getMonth() - i, 1);
        months.push(`${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`);
      }
      const { data } = await supabase
        .from("skill_demand_snapshots")
        .select("skill, month, mention_count")
        .in("month", months)
        .in("skill", ["typescript", "react", "python", "node.js", "postgresql"])
        .order("month", { ascending: true });

      if (data && data.length > 0) {
        // group by month
        const byMonth: Record<string, Record<string, number>> = {};
        months.forEach((m) => (byMonth[m] = {}));
        for (const row of data as { skill: string; month: string; mention_count: number }[]) {
          if (byMonth[row.month]) byMonth[row.month][row.skill] = row.mention_count;
        }
        const allRows = months.map((m) => {
          const dt = new Date(m + "-01T00:00:00Z");
          const label = toMonthLabel(dt);
          const vals = byMonth[m];
          return {
            month: label,
            typescript: vals["typescript"] ?? 0,
            react: vals["react"] ?? 0,
            python: vals["python"] ?? 0,
            "node.js": vals["node.js"] ?? 0,
            postgresql: vals["postgresql"] ?? 0,
          } as Record<string, string | number>;
        });
        // filter zero-only months tail? keep all but if all zeros fallback to mock
        const hasData = allRows.some((r) => (r["typescript"] as number) > 0 || (r["react"] as number) > 0);
        if (hasData) {
          initialData = {
            "12M": allRows,
            "6M": allRows.slice(-6),
            "3M": allRows.slice(-3),
          };
        }
      }
    }
  } catch {
    // fallback to mockTrendData
  }

  return (
    <div className="min-h-screen bg-[#070A14] text-white">
      <DashboardHeader />
      <main className="mx-auto max-w-[1280px] px-6 py-8">
        <div className="mb-2 text-[11px] font-semibold tracking-widest text-[#14B8A6]">TELEMETRY / MARKET INDEX</div>
        <h1 className="font-[var(--font-heading)] text-[32px] font-bold tracking-tight text-white leading-none">
          Skill demand trends
        </h1>
        <p className="mt-2 text-sm text-[#64748B]">Month-by-month from HackerNews &#39;Who is Hiring&#39; threads</p>

        <div className="mt-6">
          <TrendsClient initialData={initialData} />
        </div>
      </main>
      <footer className="mt-8 border-t border-[#1E293B] py-4 text-center text-[11px] text-[#475569]">
        Data refreshed daily · Last update: 2 hours ago · 4 sources
      </footer>
    </div>
  );
}
