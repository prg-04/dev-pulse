import { createClient } from "@/lib/supabase/server";
import { TrendsClient } from "@/components/trends/TrendsClient";
import { buildMonthsBack, getTrendsData } from "@/lib/queries/trends";
import { getLatestMonth, getTopSkillsWithDelta, getBiggestMovers } from "@/lib/queries/dashboard";

export const dynamic = "force-dynamic";

export default async function TrendsPage() {
  let initialData: {
    "3M": Record<string, string | number>[];
    "6M": Record<string, string | number>[];
    "12M": Record<string, string | number>[];
  } = {
    "3M": [],
    "6M": [],
    "12M": [],
  };
  let initialSkills: string[] = [];
  let marketMovers: { rising: { skill: string; delta: number }[]; declining: { skill: string; delta: number }[] } = { rising: [], declining: [] };
  let hasData = false;

  try {
    const supabase = await createClient();
    if (supabase) {
      const latestMonth = await getLatestMonth(supabase);
      if (latestMonth) {
        const [topWithDelta, movers, trendRows] = await Promise.all([
          getTopSkillsWithDelta(supabase, latestMonth),
          getBiggestMovers(supabase, latestMonth),
          (async () => {
            const months = buildMonthsBack(12);
            const top5 = (await getTopSkillsWithDelta(supabase, latestMonth)).slice(0, 5).map((s) => s.skill);
            return getTrendsData(supabase, top5, months);
          })(),
        ]);

        initialSkills = topWithDelta.slice(0, 5).map((s) => s.skill);
        marketMovers = movers;
        hasData = trendRows.rows.some((r) => initialSkills.some((s) => (r[s] as number) > 0));

        if (hasData) {
          initialData = {
            "12M": trendRows.rows,
            "6M": trendRows.rows.slice(-6),
            "3M": trendRows.rows.slice(-3),
          };
        }
      }
    }
  } catch {
    // keep empty state
  }

  return (
    <main className="mx-auto max-w-[1280px] px-6 py-8">
      <div className="mb-2 text-[11px] font-semibold tracking-widest text-[#14B8A6]">TELEMETRY / MARKET INDEX</div>
      <h1 className="font-[var(--font-heading)] text-[32px] font-bold tracking-tight text-white leading-none">Skill demand trends</h1>
      <p className="mt-2 text-sm text-[#64748B]">Month-by-month from HackerNews &#39;Who is Hiring&#39; threads</p>

      {hasData ? (
        <div className="mt-6">
          <TrendsClient initialData={initialData} initialSkills={initialSkills} marketMovers={marketMovers} />
        </div>
      ) : (
        <div className="mt-6 rounded-xl border border-dashed border-[#1E293B] bg-[#0F172A] p-12 text-center">
          <p className="text-sm text-[#64748B]">No trend data available yet.</p>
          <p className="mt-2 text-xs text-[#475569]">The daily ingestion pipeline has not produced any rows. Once ingestion runs, this page will populate automatically.</p>
        </div>
      )}
    </main>
  );
}
