import { createClient } from "@/lib/supabase/server";
import { GapReportClient } from "@/components/gap-report/GapReportClient";
import { marketAlignmentPct } from "@/lib/matching";
import { normalizeSkill } from "@/lib/skills-dictionary";

export const dynamic = "force-dynamic";

export default async function GapReportPage() {
  let report: {
    marketAlignmentPct: number;
    index: number;
    targetBaseline: number;
    topTierThreshold: number;
    deltaSinceQuarter: number;
    strengths: { skill: string; count: number }[];
    strengthsSummary: string;
    gaps: { skill: string; count: number }[];
    rising: { skill: string; delta: number }[];
    risingSummary: string;
    declining: { skill: string; delta: number }[];
    decliningSummary: string;
    recommendations: string[];
    yourSkills: string[];
    totalPostings: number;
    monthLabel: string;
  } = {
    marketAlignmentPct: 0,
    index: 0,
    targetBaseline: 60,
    topTierThreshold: 80,
    deltaSinceQuarter: 0,
    strengths: [],
    strengthsSummary: "",
    gaps: [],
    rising: [],
    risingSummary: "",
    declining: [],
    decliningSummary: "",
    recommendations: [],
    yourSkills: [],
    totalPostings: 0,
    monthLabel: "No data",
  };

  try {
    const supabase = await createClient();
    if (supabase) {
      const now = new Date();
      const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      const { data: snapshot } = await supabase
        .from("skill_demand_snapshots")
        .select("skill, mention_count")
        .eq("month", month)
        .order("mention_count", { ascending: false })
        .limit(50);

      if (snapshot && snapshot.length > 0) {
        const top50 = snapshot as { skill: string; mention_count: number }[];
        let yourSkills: string[] = [];
        try {
          const { data: userData } = await supabase.auth.getUser();
          if (userData?.user) {
            const { data: profile } = await supabase
              .from("user_skills")
              .select("skill")
              .eq("user_id", userData.user.id);
            if (profile && profile.length > 0) {
              yourSkills = (profile as { skill: string }[])
                .map((r) => normalizeSkill(r.skill) ?? r.skill.toLowerCase());
            } else {
              const { data: lastProfile } = await supabase
                .from("user_skill_profiles")
                .select("skills")
                .eq("user_id", userData.user.id)
                .order("created_at", { ascending: false })
                .limit(1)
                .maybeSingle();
              if (lastProfile && (lastProfile as { skills: string[] }).skills?.length) {
                yourSkills = (lastProfile as { skills: string[] })
                  .skills.map((s) => normalizeSkill(s) ?? s.toLowerCase());
              }
            }
          }
        } catch {
          // keep empty skills
        }

        const alignment = marketAlignmentPct(yourSkills, top50);
        const skillSet = new Set(yourSkills.map((s) => s.toLowerCase()));
        const strengths = top50
          .filter((r) => skillSet.has(r.skill.toLowerCase()))
          .slice(0, 5)
          .map((r) => ({ skill: r.skill, count: r.mention_count }));
        const gaps = top50
          .filter((r) => !skillSet.has(r.skill.toLowerCase()))
          .slice(0, 3)
          .map((r) => ({ skill: r.skill, count: r.mention_count }));

        // history for rising/declining (last 2 months)
        const months: string[] = [];
        for (let i = 1; i >= 0; i--) {
          const dt = new Date(now.getFullYear(), now.getMonth() - i, 1);
          months.push(`${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`);
        }
        const { data: hist } = await supabase
          .from("skill_demand_snapshots")
          .select("skill, month, mention_count")
          .in("month", months)
          .order("month", { ascending: true });
        let rising: { skill: string; delta: number }[] = [];
        let declining: { skill: string; delta: number }[] = [];
        if (hist && hist.length > 0) {
          const map: Record<string, { prev: number; last: number }> = {};
          for (const r of hist as { skill: string; month: string; mention_count: number }[]) {
            if (!map[r.skill]) map[r.skill] = { prev: 0, last: 0 };
            if (r.month === months[0]) map[r.skill].prev = r.mention_count;
            if (r.month === months[1]) map[r.skill].last = r.mention_count;
          }
          const deltas = Object.entries(map)
            .map(([skill, v]) => {
              const delta = v.prev === 0 ? (v.last > 0 ? 100 : 0) : Math.round(((v.last - v.prev) / v.prev) * 100);
              return { skill, delta };
            })
            .filter((d) => d.delta !== 0);
          rising = deltas.filter((d) => d.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 3);
          declining = deltas.filter((d) => d.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, 2);
        }

        const { count } = await supabase.from("job_postings").select("id", { count: "exact", head: true });
        const monthLabel = now.toLocaleDateString("en-US", { month: "long", year: "numeric" });

        report = {
          marketAlignmentPct: alignment,
          index: alignment / 100,
          targetBaseline: 60,
          topTierThreshold: 80,
          deltaSinceQuarter: 0,
          yourSkills,
          strengths: strengths.length > 0 ? strengths : [],
          strengthsSummary: "",
          gaps: gaps.length > 0 ? gaps : [],
          rising,
          risingSummary: "",
          declining,
          decliningSummary: "",
          recommendations: [],
          totalPostings: typeof count === "number" && count > 0 ? count : 0,
          monthLabel,
        };
      }
    }
  } catch {
    // keep empty state
  }

  const hasData = report.totalPostings > 0 || report.gaps.length > 0 || report.strengths.length > 0;

  return (
    <main className="mx-auto max-w-[1280px] px-6 py-6">
      {hasData ? (
        <GapReportClient initialReport={report} />
      ) : (
        <div className="rounded-xl border border-dashed border-[#1E293B] bg-[#0F172A] p-12 text-center">
          <p className="text-sm text-[#64748B]">No gap report data available yet.</p>
          <p className="mt-2 text-xs text-[#475569]">The daily ingestion pipeline has not produced any rows, or no skills have been submitted for analysis. Once data is available, this page will populate automatically.</p>
        </div>
      )}
    </main>
  );
}
