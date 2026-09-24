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
  duration_label?: string;
};

type SkillIndexStatus = {
  total_chunks: number;
  total_chapters: number;
  last_run_status: string | null;
  last_error: string | null;
};

type Props = {
  gaps: Gap[];
  skillIndexStatus?: Record<string, SkillIndexStatus>;
  indexingSkills?: Set<string>;
};

type OnDemandResult = {
  status: "enqueued" | "indexed" | "skipped_no_results" | "skipped_recent" | "failed";
  error?: string;
};

type CatalogVideo = {
  video_id: string;
  title: string;
  channel_name: string;
  thumbnail_url: string;
  duration_seconds: number | null;
  view_count: bigint | null;
  published_at: string | null;
  rank: number;
  source: string;
  fetched_at: string;
};

function formatMMSS(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export function SkillsToConsiderCard({ gaps, skillIndexStatus = {}, indexingSkills = new Set() }: Props) {
  const [selectedSkill, setSelectedSkill] = useState<string>(gaps[0]?.skill ?? "kubernetes");
  const [catalogVideos, setCatalogVideos] = useState<CatalogVideo[]>([]);
  const [tutorials, setTutorials] = useState<Tutorial[]>([]);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [loadingTutorials, setLoadingTutorials] = useState(false);
  const [onDemandResults, setOnDemandResults] = useState<Record<string, OnDemandResult>>({});
  const [enqueuing, setEnqueuing] = useState(false);

  // If the explicitly selected skill is no longer in the current gaps list,
  // fall back to the first available gap instead of showing a stale selection.
  const effectiveSkill = gaps.some((g) => g.skill.toLowerCase() === selectedSkill.toLowerCase())
    ? selectedSkill
    : gaps[0]?.skill ?? selectedSkill;

  const fetchCatalog = useCallback(async (skill: string) => {
    if (!skill) return;
    setLoadingCatalog(true);
    try {
      const res = await fetch(`/api/catalog/videos?skill=${encodeURIComponent(skill)}`);
      if (!res.ok) throw new Error("failed");
      const json = (await res.json()) as { videos?: CatalogVideo[] };
      setCatalogVideos(json.videos ?? []);
    } catch {
      setCatalogVideos([]);
    } finally {
      setLoadingCatalog(false);
    }
  }, []);

  const fetchTutorials = useCallback(async (skill: string) => {
    if (!skill) return;
    setLoadingTutorials(true);
    try {
      const res = await fetch("/api/tutorial-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skill }),
      });
      if (!res.ok) throw new Error("failed");
      const json = (await res.json()) as { results?: Tutorial[] };
      setTutorials(json.results ?? []);
    } catch {
      setTutorials([]);
    } finally {
      setLoadingTutorials(false);
    }
  }, []);

  const triggerOnDemand = useCallback(async (skill: string) => {
    setEnqueuing(true);
    // Optimistic enqueued state — the thin endpoint returns { ok, enqueued, skill }
    // with no `result` field. We distinguish enqueued from failed purely by status.
    setOnDemandResults((prev) => ({ ...prev, [skill]: { status: "enqueued" } }));
    try {
      const res = await fetch("/api/cron/tutorial-index/ondemand", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skill }),
      });

      if (!res.ok) {
        // Try to extract the server's error message before falling back
        let serverMsg = "On-demand enqueue failed";
        try {
          const errBody = (await res.json()) as { error?: string };
          if (errBody.error) serverMsg = errBody.error;
        } catch {
          // ignore parse error, use generic message
        }
        throw new Error(serverMsg);
      }

      const json = (await res.json()) as { ok: boolean; enqueued: boolean; skill: string };
      if (json.ok && json.enqueued) {
        setOnDemandResults((prev) => ({ ...prev, [skill]: { status: "enqueued" } }));
      } else {
        throw new Error("Enqueue did not succeed");
      }
      // Refresh catalog after enqueue so the user sees progress if the cron has run
      await fetchCatalog(skill);
    } catch (err) {
      setOnDemandResults((prev) => ({
        ...prev,
        [skill]: { status: "failed", error: err instanceof Error ? err.message : "Unknown error" },
      }));
    } finally {
      setEnqueuing(false);
    }
  }, [fetchCatalog]);

  const handleSkillSelect = useCallback((skill: string) => {
    setSelectedSkill(skill);
  }, []);

  // Eagerly fetch catalog and tutorials when the effective skill changes
  useEffect(() => {
    fetchCatalog(effectiveSkill);
    fetchTutorials(effectiveSkill);
  }, [effectiveSkill, fetchCatalog, fetchTutorials]);

  const status = skillIndexStatus[effectiveSkill];
  const hasIndexedData = (status?.total_chunks ?? 0) > 0 || (status?.total_chapters ?? 0) > 0;
  const isIndexing = indexingSkills.has(effectiveSkill);
  const onDemandResult = onDemandResults[effectiveSkill];
  const showNoVideos = !isIndexing && !hasIndexedData && catalogVideos.length === 0 && onDemandResult?.status === "skipped_no_results";

  // Build tutorial overlay map: video_id -> best tutorial hit
  const tutorialOverlayMap = new Map<string, Tutorial>();
  for (const t of tutorials) {
    if (!tutorialOverlayMap.has(t.video_id)) {
      tutorialOverlayMap.set(t.video_id, t);
    }
  }

  // Merge catalog videos with tutorial overlays
  const mergedVideos: (CatalogVideo & { overlay?: Tutorial; duration_label?: string })[] = catalogVideos.map((v) => {
    const overlay = tutorialOverlayMap.get(v.video_id);
    return {
      ...v,
      overlay,
      duration_label: v.duration_seconds ? formatMMSS(v.duration_seconds) : undefined,
    };
  });

  // Tutorial results that have no matching catalog video (shouldn't happen often,
  // but keep them visible so chapter-only hits aren't silently dropped)
  const orphanTutorials = tutorials.filter((t) => !catalogVideos.some((v) => v.video_id === t.video_id));

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
              : enqueuing
                ? "Enqueuing…"
                : loadingCatalog || loadingTutorials
                  ? "Loading…"
                  : mergedVideos.length > 0
                    ? `${mergedVideos.length} videos in catalog`
                    : showNoVideos
                      ? "No videos found"
                      : hasIndexedData
                        ? `${tutorials.length} targeted timestamps extracted`
                        : onDemandResult?.status === "enqueued"
                          ? "Enqueued — cron will index soon"
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
                disabled={enqueuing}
                className="rounded border border-[#334155] bg-[#0F172A] px-3 py-1.5 text-[11px] font-medium text-[#94A3B8] hover:text-white hover:border-[#475569] disabled:opacity-50"
              >
                {enqueuing ? "Enqueuing…" : "Try again"}
              </button>
            </div>
          ) : !hasIndexedData && mergedVideos.length === 0 && !loadingCatalog && onDemandResult?.status !== "enqueued" ? (
            <div className="rounded-lg border border-dashed border-[#1E293B] bg-[#0F172A] px-3 py-6 text-center text-xs text-[#64748B]">
              <p className="mb-2">No tutorials indexed yet for this skill</p>
              <button
                type="button"
                onClick={() => triggerOnDemand(effectiveSkill)}
                disabled={enqueuing}
                className="rounded border border-[#334155] bg-[#0F172A] px-3 py-1.5 text-[11px] font-medium text-[#94A3B8] hover:text-white hover:border-[#475569] disabled:opacity-50"
              >
                {enqueuing ? "Enqueuing…" : "Find a lesson"}
              </button>
            </div>
          ) : loadingCatalog || loadingTutorials ? (
            <p className="rounded-lg border border-dashed border-[#1E293B] bg-[#0F172A] px-3 py-6 text-center text-xs text-[#475569]">
              Searching tutorials…
            </p>
          ) : mergedVideos.length === 0 && orphanTutorials.length === 0 ? (
            <p className="rounded-lg border border-dashed border-[#1E293B] bg-[#0F172A] px-3 py-6 text-center text-xs text-[#475569]">
              {onDemandResult?.status === "enqueued"
                ? "Enqueued — cron will index soon"
                : "No videos found for this skill"}
            </p>
          ) : (
            <>
              {mergedVideos.map((v) => (
                <TutorialCard
                  key={v.video_id}
                  tutorial={{
                    video_id: v.video_id,
                    video_title: v.title,
                    channel_name: v.channel_name,
                    view_count: v.view_count ? Number(v.view_count) : null,
                    start_seconds: v.overlay?.start_seconds ?? 0,
                    chapter_label: v.overlay?.chapter_label,
                    starts_at: v.overlay?.starts_at,
                    duration_label: v.duration_label,
                  }}
                  defaultExpanded={false}
                />
              ))}
              {orphanTutorials.map((t, idx) => (
                <TutorialCard key={`${t.video_id}-${idx}`} tutorial={t} defaultExpanded={idx === 0} />
              ))}
            </>
          )}
        </div>
      </div>

      <p className="mt-3 text-xs leading-relaxed text-[#94A3B8]">
        Adding <span className="text-white">{gaps[0]?.skill ?? "this skill"}</span> would expand your eligibility to{" "}
        <span className="text-white">{gaps[0]?.count ? Math.round(gaps[0]?.count * 1.5) : 0}%</span> of senior DevOps-adjacent fullstack roles.
      </p>
    </div>
  );
}
