"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { YourSkillsPanel } from "./YourSkillsPanel";
import { MarketAlignmentCard } from "./MarketAlignmentCard";
import { StrengthsCard } from "./StrengthsCard";
import { SkillsToConsiderCard } from "./SkillsToConsiderCard";
import { RisingCard } from "./RisingCard";
import { DecliningCard } from "./DecliningCard";
import { RecommendationsCard } from "./RecommendationsCard";
import { triggerOnDemandIndexing } from "@/app/actions";

type GapSkill = { skill: string; count: number };
type DeltaSkill = { skill: string; delta: number };

type Report = {
  marketAlignmentPct: number;
  index: number;
  targetBaseline: number;
  topTierThreshold: number;
  deltaSinceQuarter: number;
  strengths: GapSkill[];
  strengthsSummary: string;
  gaps: GapSkill[];
  rising: DeltaSkill[];
  risingSummary: string;
  declining: DeltaSkill[];
  decliningSummary: string;
  recommendations: string[];
  yourSkills: string[];
  totalPostings: number;
  monthLabel: string;
  skillIndexStatus: Record<string, { total_chunks: number; total_chapters: number; last_run_status: string | null; last_error: string | null; on_demand_requested_at: string | null }>;
};

export function GapReportClient({ initialReport }: { initialReport: Report }) {
  const router = useRouter();
  const [report, setReport] = useState<Report>(initialReport);
  const [skills, setSkills] = useState<string[]>(initialReport.yourSkills);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [indexingSkills, setIndexingSkills] = useState<Set<string>>(new Set());

  // Automatically trigger on-demand indexing for gap skills that have no
  // indexed data yet. This replaces the manual "Find a lesson" button with
  // an automatic, server-side trigger (no user click needed).
  useEffect(() => {
    const skillsToIndex = report.gaps
      .filter((g) => {
        const status = report.skillIndexStatus[g.skill];
        const hasData = (status?.total_chunks ?? 0) > 0 || (status?.total_chapters ?? 0) > 0;
        const recentlyRequested = status?.on_demand_requested_at
          ? Date.now() - new Date(status.on_demand_requested_at).getTime() < 30 * 60 * 1000
          : false;
        return !hasData && !recentlyRequested;
      })
      .map((g) => g.skill);

    if (skillsToIndex.length === 0) return;

    skillsToIndex.forEach((skill) => {
      setIndexingSkills((prev) => new Set(prev).add(skill));
      triggerOnDemandIndexing(skill)
        .then((res) => {
          if (res.result) {
            setReport((prev) => ({
              ...prev,
              skillIndexStatus: {
                ...prev.skillIndexStatus,
                [skill]: {
                  total_chunks: res.result.chunks,
                  total_chapters: res.result.chapters,
                  last_run_status: res.result.status === "indexed" ? "success" : res.result.status === "skipped_no_results" ? "skipped_no_results" : "failed",
                  last_error: res.result.error ?? null,
                  on_demand_requested_at: new Date().toISOString(),
                },
              },
            }));
          }
        })
        .catch((err) => {
          console.error(`[GapReportClient] Auto-index failed for ${skill}:`, err);
        })
        .finally(() => {
          setIndexingSkills((prev) => {
            const next = new Set(prev);
            next.delete(skill);
            return next;
          });
        });
    });
  }, [report.gaps, report.skillIndexStatus]);

  const handleRemove = (skill: string) => {
    setSkills((prev) => prev.filter((s) => s !== skill));
  };

  const handleReanalyse = useCallback(
    async (overrideSkills?: string[]) => {
      const target = overrideSkills ?? skills;
      if (target.length === 0) return;
      setLoading(true);
      try {
        const res = await fetch("/api/gap-report", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ skills: target }),
        });
        if (res.ok) {
          const data = await res.json();
          setReport((prev) => ({
            ...prev,
            marketAlignmentPct: data.market_alignment_pct ?? prev.marketAlignmentPct,
            index: data.index ?? prev.index,
            strengths: data.strengths ?? prev.strengths,
            strengthsSummary: data.strengths_summary ?? prev.strengthsSummary,
            gaps: data.gaps ?? prev.gaps,
            rising: data.rising ?? prev.rising,
            declining: data.declining ?? prev.declining,
            recommendations: data.recommendations ?? prev.recommendations,
            skillIndexStatus: data.skill_index_status ?? prev.skillIndexStatus,
          }));
          if (overrideSkills) setSkills(overrideSkills);
        }
      } catch {
        // keep previous on error
      } finally {
        setLoading(false);
      }
    },
    [skills],
  );

  const handleSyncFromProfile = useCallback(async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/profile/skills");
      if (res.ok) {
        const json = (await res.json()) as { skills?: { skill: string }[] };
        const fresh = (json.skills ?? []).map((s) => s.skill);
        const normalized = [...new Set(fresh.map((s) => s.toLowerCase()))];
        if (normalized.length > 0) {
          await handleReanalyse(normalized);
          router.refresh();
        }
      }
    } catch {
      // keep previous on error
    } finally {
      setSyncing(false);
    }
  }, [handleReanalyse, router]);

  return (
    <div className="grid grid-cols-12 gap-6">
      {/* Left */}
      <div className="col-span-12 lg:col-span-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-[11px] text-[#475569]">Profile sync</span>
          <button
            type="button"
            onClick={handleSyncFromProfile}
            disabled={syncing || loading}
            className="rounded-md border border-[#1E293B] bg-[#0F172A] px-2.5 py-1 text-[11px] font-medium text-[#94A3B8] hover:text-white hover:border-[#334155] disabled:opacity-50"
          >
            {syncing ? "Syncing…" : "↻ Sync from profile"}
          </button>
        </div>
        <YourSkillsPanel
          skills={skills}
          onRemove={handleRemove}
          onReanalyse={() => handleReanalyse()}
          totalPostings={report.totalPostings}
          monthLabel={report.monthLabel}
        />
        {loading && <p className="mt-3 text-center text-xs text-[#475569]">Re-analysing…</p>}
      </div>

      {/* Right */}
      <div className="col-span-12 space-y-4 lg:col-span-8">
        <MarketAlignmentCard
          pct={report.marketAlignmentPct}
          index={report.index}
          deltaSinceQuarter={report.deltaSinceQuarter}
          targetBaseline={report.targetBaseline}
          topTierThreshold={report.topTierThreshold}
        />

        <StrengthsCard strengths={report.strengths} summary={report.strengthsSummary} />

        <SkillsToConsiderCard gaps={report.gaps} skillIndexStatus={report.skillIndexStatus} indexingSkills={indexingSkills} />

        <RisingCard items={report.rising} summary={report.risingSummary} />

        <DecliningCard items={report.declining} summary={report.decliningSummary} />

        <RecommendationsCard items={report.recommendations} />
      </div>
    </div>
  );
}
