import { createClient } from "@/lib/supabase/server";
import { DashboardHeader } from "@/components/dashboard/DashboardHeader";
import { StatCards } from "@/components/dashboard/StatCards";
import { TopSkillsTable } from "@/components/dashboard/TopSkillsTable";
import { SourcesCard } from "@/components/dashboard/SourcesCard";
import { BiggestMovers, SampleIntegrity } from "@/components/dashboard/BiggestMovers";
import { TrendChart } from "@/components/dashboard/TrendChart";
import { mockTopSkills } from "@/lib/mock/dashboard-data";

export const dynamic = "force-dynamic";

export default async function Home() {
  let skills = mockTopSkills;
  try {
    const supabase = await createClient();
    if (supabase) {
      const now = new Date();
      const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      const { data } = await supabase
        .from("skill_demand_snapshots")
        .select("skill, mention_count")
        .eq("month", month)
        .order("mention_count", { ascending: false })
        .limit(50);
      if (data && data.length > 0) {
        const deltaMap = new Map(mockTopSkills.map((m) => [m.skill, m.delta]));
        skills = data.map((row, idx) => ({
          rank: idx + 1,
          skill: row.skill as string,
          count: row.mention_count as number,
          delta: deltaMap.get(row.skill as string) ?? 0,
        }));
      }
    }
  } catch {}
  return (
    <div className="min-h-screen bg-[#070A14] text-white">
      <DashboardHeader />
      <main className="mx-auto max-w-[1280px] px-6 py-6">
        <div className="mb-6">
          <h1 className="font-[var(--font-heading)] text-[28px] font-bold tracking-tight text-white">
            Developer skill demand
          </h1>
          <p className="mt-1 text-xs text-[#64748B]">August 2026 · 42,891 postings across 4 sources</p>
        </div>
        <StatCards />
        <div className="mt-6 grid grid-cols-12 gap-6">
          <div className="col-span-12 lg:col-span-8">
            <TopSkillsTable skills={skills} />
          </div>
          <div className="col-span-12 space-y-4 lg:col-span-4">
            <SourcesCard />
            <BiggestMovers />
            <SampleIntegrity />
          </div>
        </div>
        <div className="mt-6">
          <TrendChart />
        </div>
      </main>
      <footer className="mt-8 border-t border-[#1E293B] py-4 text-center text-[11px] text-[#475569]">
        Data refreshed daily · Last update: 2 hours ago · 4 sources
      </footer>
    </div>
  );
}
