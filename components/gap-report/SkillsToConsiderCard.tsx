"use client";

import { useState, useCallback, useEffect } from "react";
import { TutorialCard } from "./TutorialCard";

type Gap = { skill: string; count: number };

type Tutorial = {
  video_id: string;
  video_title: string;
  channel_name: string;
  view_count: number | null;
  start_seconds: number;
  chapter_label?: string;
  starts_at?: string;
};

type SkillIndexStatus = {
  total_chunks: number;
  total_chapters: number;
  last_run_status: string | null;
  last_error: string | null;
  on_demand_requested_at: string | null;
};

type Props = {
  gaps: Gap[];
  skillIndexStatus?: Record<string, SkillIndexStatus>;
  indexingSkills?: Set<string>;
};

type OnDemandResult = {
  status: "indexed" | "skipped_no_results" | "skipped_recent" | "failed";
  error?: string;
};

export function SkillsToConsiderCard({ gaps, skillIndexStatus = {}, indexingSkills = new Set() }: Props) {
  const [selectedSkill, setSelectedSkill] = useState<string>(gaps[0]?.skill ?? "kubernetes");
  const [tutorials, setTutorials] = useState<Tutorial[]>([]);
  const [loading, setLoading] = useState(false);
  const [onDemandResults, setOnDemandResults] = useState<Record<string, OnDemandResult>>({});

  // If the explicitly selected skill is no longer in the current gaps list,
  // fall back to the first available gap instead of showing a stale selection.
  const effectiveSkill = gaps.some((g) => g.skill.toLowerCase() === selectedSkill.toLowerCase())
    ? selectedSkill
    : gaps[0]?.skill ?? selectedSkill;

  const fetchTutorials = useCallback(async (skill: string) => {
    if (!skill) return;
    setLoading(true);
    try {
      const res = await fetch("/api/tutorial-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skill }),
      });
      if (!res.ok) throw new Error("failed");
      const json = await res.json() as { results?: Tutorial[] };
      setTutorials(json.results ?? []);
    } catch {
      setTutorials([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const triggerOnDemand = useCallback(async (skill: string) => {
    setLoading(true);
    setOnDemandResults((prev) => ({ ...prev, [skill]: { status: "indexed" } }));
    try {
      const res = await fetch("/api/cron/tutorial-index/ondemand", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skill }),
      });
      if (!res.ok) throw new Error("On-demand indexing failed");
      const json = await res.json() as { result?: OnDemandResult };
      const result = json.result ?? { status: "failed" as const };
      setOnDemandResults((prev) => ({ ...prev, [skill]: result }));
      await fetchTutorials(skill);
    } catch (err) {
      setOnDemandResults((prev) => ({
        ...prev,
        [skill]: { status: "failed", error: err instanceof Error ? err.message : "Unknown error" },
      }));
    } finally {
      setLoading(false);
    }
  }, [fetchTutorials]);

  const handleSkillSelect = useCallback((skill: string) => {
    setSelectedSkill(skill);
  }, []);

  // Eagerly fetch tutorials when the effective skill changes so the panel
  // is populated on first render and whenever gaps refresh.
  useEffect(() => {
    fetchTutorials(effectiveSkill);
  }, [effectiveSkill, fetchTutorials]);

  const status = skillIndexStatus[effectiveSkill];
  const hasIndexedData = (status?.total_chunks ?? 0) > 0 || (status?.total_chapters ?? 0) > 0;
  const isIndexing = indexingSkills.has(effectiveSkill);
  const onDemandResult = onDemandResults[effectiveSkill];
  const showNoVideos = !isIndexing && !hasIndexedData && onDemandResult?.status === "skipped_no_results";

  return (
    <div className="rounded-xl border border-[#1E293B] bg-[#0F172A] p-5 border-l-2 border-l-[#EF4444] border-y-[#1E293B] border-r-[#1E293B]">
      <div className="flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-[#EF4444]">
          <span className="text-[#EF4444]">⚠</span> Skills to consider
          <span className="rounded border border-[#1E293B] bg-[#070A14] px-1.5 py-0.5 text-[10px] font-normal tracking-widest text-[#475569]">
            v1.1 TUTORIALS ACTIVE
          </span>
        </h3>
        <span className="hidden text-[11px] text-[#475569] sm:block">Click a skill to preview deep-linked learning</span>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {gaps.map((g) => {
          const isActive = g.skill.toLowerCase() === effectiveSkill.toLowerCase();
          return (
            <button
              key={g.skill}
              onClick={() => handleSkillSelect(g.skill)}
              className={
                isActive
                  ? "inline-flex items-center gap-1 rounded border border-[#14B8A6]/40 bg-[#14B8A6]/15 px-2 py-1 text-[11px] text-[#2DD4BF]"
                  : "inline-flex items-center gap-1 rounded border border-[#7F1D1D]/40 bg-[#7F1D1D]/20 px-2 py-1 text-[11px] text-[#FCA5A5]"
              }
            >
              {g.skill} <span className="opacity-70">({g.count.toLocaleString()})</span>
              <span className="ml-1 text-[10px]">{isActive ? "▾" : "▸"}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-4 rounded-lg border border-[#1E293B] bg-[#070A14]/40 p-3">
        <div className="flex items-center justify-between text-[11px] text-[#475569]">
          <span>
            {effectiveSkill} — tutorials
          </span>
          <span>
            {isIndexing
              ? "Finding you a lesson…"
              : loading
                ? "Searching…"
                : tutorials.length > 0
                  ? `${tutorials.length} targeted timestamps extracted`
                  : showNoVideos
                    ? "No videos found"
                    : hasIndexedData
                      ? `${tutorials.length} targeted timestamps extracted`
                      : "Not indexed yet"}
          </span>
        </div>

        <div className="mt-3 space-y-3">
          {isIndexing ? (
            <p className="rounded-lg border border-dashed border-[#1E293B] bg-[#0F172A] px-3 py-6 text-center text-xs text-[#475569]">
              Finding you a lesson…
            </p>
          ) : showNoVideos ? (
            <div className="rounded-lg border border-dashed border-[#1E293B] bg-[#0F172A] px-3 py-6 text-center text-xs text-[#64748B]">
              <p className="mb-2">No videos found for this skill</p>
              <button
                type="button"
                onClick={() => triggerOnDemand(effectiveSkill)}
                className="rounded border border-[#334155] bg-[#0F172A] px-3 py-1.5 text-[11px] font-medium text-[#94A3B8] hover:text-white hover:border-[#475569]"
              >
                Try again
              </button>
            </div>
          ) : !hasIndexedData && !loading && tutorials.length === 0 ? (
            <div className="rounded-lg border border-dashed border-[#1E293B] bg-[#0F172A] px-3 py-6 text-center text-xs text-[#64748B]">
              <p className="mb-2">No tutorials indexed yet for this skill</p>
              <button
                type="button"
                onClick={() => triggerOnDemand(effectiveSkill)}
                disabled={indexingSkills.has(effectiveSkill)}
                className="rounded border border-[#334155] bg-[#0F172A] px-3 py-1.5 text-[11px] font-medium text-[#94A3B8] hover:text-white hover:border-[#475569] disabled:opacity-50"
              >
                Find a lesson
              </button>
            </div>
          ) : loading ? (
            <p className="rounded-lg border border-dashed border-[#1E293B] bg-[#0F172A] px-3 py-6 text-center text-xs text-[#475569]">
              Searching tutorials…
            </p>
          ) : tutorials.length === 0 ? (
            <p className="rounded-lg border border-dashed border-[#1E293B] bg-[#0F172A] px-3 py-6 text-center text-xs text-[#475569]">
              Searching tutorials…
            </p>
          ) : (
            tutorials.map((t, idx) => (
              <TutorialCard key={`${t.video_id}-${idx}`} tutorial={t} defaultExpanded={idx === 0} />
            ))
          )}
        </div>
      </div>

      <p className="mt-3 text-xs leading-relaxed text-[#94A3B8]">
        Adding <span className="text-white">{gaps[0]?.skill ?? "this skill"}</span> would expand your eligibility to{" "}
        <span className="text-white">{gaps[0]?.count ? Math.round(gaps[0].count * 1.5) : 0}%</span> of senior DevOps-adjacent fullstack roles.
      </p>
    </div>
  );
}
