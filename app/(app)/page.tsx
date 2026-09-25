import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { StatCards } from "@/components/dashboard/StatCards";
import { DashboardTopSkills } from "@/components/dashboard/DashboardTopSkills";
import { SourcesCard } from "@/components/dashboard/SourcesCard";
import { BiggestMovers, SampleIntegrity } from "@/components/dashboard/BiggestMovers";
import { TrendChart } from "@/components/dashboard/TrendChart";
import { getLatestMonth, getTopSkillsWithDelta, getSourcesBreakdown, getBiggestMovers } from "@/lib/queries/dashboard";
import { getTrendsData, buildMonthsBack } from "@/lib/queries/trends";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Skill Demand Dashboard" };

function formatMonthLabel(ym: string): string {
  const d = new Date(ym + "-01T00:00:00Z");
  return d.toLocaleString("en-US", { month: "long", year: "numeric" });
}

export default async function Home() {
  let skills: { rank: number; skill: string; count: number; delta: number }[] = [];
  let stats: {
    jobsIngested: number;
    jobsDelta: number;
    skillsTracked: number;
    skillsDelta: number;
    topSkill: string;
    topSkillCount: number;
    lastUpdate: string;
    monthLabel: string;
    postingsLabel: string;
  } = {
    jobsIngested: 0,
    jobsDelta: 0,
    skillsTracked: 0,
    skillsDelta: 0,
    topSkill: "—",
    topSkillCount: 0,
    lastUpdate: "No data",
    monthLabel: "No data",
    postingsLabel: "",
  };
  let sources: { name: string; count: number; pct: number; color: string }[] = [];
  let movers = { rising: [] as { skill: string; delta: number }[], declining: [] as { skill: string; delta: number }[] };
  let monthLabel = "No data";
  let postingsCount = 0;
  let trendSkills: string[] = [];
  let trendData: Record<string, string | number>[] = [];

  try {
    const supabase = await createClient();
    if (supabase) {
      const latestMonth = await getLatestMonth(supabase);
      if (latestMonth) {
        monthLabel = formatMonthLabel(latestMonth);
        const [topWithDelta, breakdown, biggest] = await Promise.all([
          getTopSkillsWithDelta(supabase, latestMonth),
          getSourcesBreakdown(supabase, latestMonth),
          getBiggestMovers(supabase, latestMonth),
        ]);

        if (topWithDelta.length > 0) {
          skills = topWithDelta;
          const totalMentions = topWithDelta.reduce((a, b) => a + b.count, 0);
          postingsCount = totalMentions;
          stats = {
            jobsIngested: totalMentions,
            jobsDelta: 0,
            skillsTracked: topWithDelta.length,
            skillsDelta: 0,
            topSkill: topWithDelta[0].skill,
            topSkillCount: topWithDelta[0].count,
            lastUpdate: monthLabel,
            monthLabel,
            postingsLabel: `${totalMentions.toLocaleString()} postings across 10 sources`,
          };
          trendSkills = topWithDelta.slice(0, 5).map((s) => s.skill);
          const months = buildMonthsBack(12);
          const { rows } = await getTrendsData(supabase, trendSkills, months);
          trendData = rows;
        }
        if (breakdown.length > 0) {
          const colors = ["#FB923C", "#2DD4BF", "#A78BFA", "#38BDF8", "#F43F5E", "#22C55E", "#F59E0B", "#6366F1", "#06B6D4", "#475569"];
          sources = breakdown.map((b, i) => ({
            name:
              b.source === "hackernews"
                ? "HackerNews"
                : b.source.charAt(0).toUpperCase() + b.source.slice(1),
            count: b.count,
            pct: b.pct,
            color: colors[i % colors.length],
          }));
        }
        if (biggest.rising.length > 0 || biggest.declining.length > 0) {
          movers = biggest;
        }
      }
    }
  } catch (err) {
    console.error("Dashboard data fetch failed:", err);
  }

  const hasData = skills.length > 0;
  const postingsLabel = `${postingsCount.toLocaleString()} postings across 10 sources`;

  return (
    <main className="mx-auto max-w-[1280px] px-6 py-6">
      <div className="mb-6">
        <h1 className="font-[var(--font-heading)] text-[28px] font-bold tracking-tight text-white">Developer skill demand</h1>
        <p className="mt-1 text-xs text-[#64748B]">
          {monthLabel} · {hasData ? postingsLabel : "No data yet — ingestion has not run"}
        </p>
      </div>

      {hasData ? (
        <>
          <StatCards stats={stats} />
          <div className="mt-6 grid grid-cols-12 gap-6">
            <div className="col-span-12 lg:col-span-8">
              <DashboardTopSkills skills={skills} />
            </div>
            <div className="col-span-12 space-y-4 lg:col-span-4">
              <SourcesCard sources={sources} />
              <BiggestMovers movers={movers} />
              <SampleIntegrity />
            </div>
          </div>
          <div className="mt-6">
            <TrendChart data={trendData} skills={trendSkills} />
          </div>
        </>
      ) : (
        <div className="rounded-xl border border-dashed border-[#1E293B] bg-[#0F172A] p-12 text-center">
          <p className="text-sm text-[#64748B]">No skill demand data available yet.</p>
          <p className="mt-2 text-xs text-[#475569]">The daily ingestion pipeline has not produced any rows. Once ingestion runs, this page will populate automatically.</p>
        </div>
      )}
    </main>
  );
}
