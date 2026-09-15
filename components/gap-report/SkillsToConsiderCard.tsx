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

type Props = {
  gaps: Gap[];
};

export function SkillsToConsiderCard({ gaps }: Props) {
  const [selectedSkill, setSelectedSkill] = useState<string>(gaps[0]?.skill ?? "kubernetes");
  const [tutorials, setTutorials] = useState<Tutorial[]>([]);
  const [loading, setLoading] = useState(false);

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

  const handleSkillSelect = useCallback((skill: string) => {
    setSelectedSkill(skill);
  }, []);

  // Eagerly fetch tutorials when the effective skill changes so the panel
  // is populated on first render and whenever gaps refresh.
  useEffect(() => {
    fetchTutorials(effectiveSkill);
  }, [effectiveSkill, fetchTutorials]);

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
          <span>{loading ? "Searching…" : `${tutorials.length} targeted timestamps extracted`}</span>
        </div>

        <div className="mt-3 space-y-3">
          {loading ? (
            <p className="rounded-lg border border-dashed border-[#1E293B] bg-[#0F172A] px-3 py-6 text-center text-xs text-[#475569]">
              Searching tutorials…
            </p>
          ) : tutorials.length === 0 ? (
            <p className="rounded-lg border border-dashed border-[#1E293B] bg-[#0F172A] px-3 py-6 text-center text-xs text-[#64748B]">
              no tutorials indexed yet for this skill
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
