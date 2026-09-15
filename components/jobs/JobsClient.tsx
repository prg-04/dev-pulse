"use client";

import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { JobsFilters } from "./JobsFilters";
import { JobCard, type CardJob } from "./JobCard";
import { JobDetail } from "./JobDetail";

export type JobsInitialJob = CardJob;

type ApiResponse = {
  jobs: CardJob[];
  total: number;
  hasMore: boolean;
};

type Stats = {
  total: number;
  bySource: Record<string, number>;
  lastUpdate: string | null;
};

const SOURCE_META: { id: string; label: string; color: string }[] = [
  { id: "hackernews", label: "HackerNews", color: "#FB923C" },
  { id: "himalayas", label: "Himalayas", color: "#A78BFA" },
  { id: "remotejobs", label: "RemoteJobs", color: "#2DD4BF" },
  { id: "remotive", label: "Remotive", color: "#F472B6" },
  { id: "arbeitnow", label: "Arbeitnow", color: "#38BDF8" },
  { id: "remoteok", label: "RemoteOK", color: "#F43F5E" },
  { id: "jobicy", label: "Jobicy", color: "#22C55E" },
  { id: "adzuna", label: "Adzuna", color: "#F59E0B" },
  { id: "jooble", label: "Jooble", color: "#6366F1" },
  { id: "themuse", label: "The Muse", color: "#06B6D4" },
];

export function JobsClient({
  initialJobs,
  initialTotal,
  stats,
  userSkills,
  gaps,
  initialSkill,
}: {
  initialJobs: JobsInitialJob[];
  initialTotal: number;
  stats: Stats;
  userSkills: string[];
  gaps: string[];
  initialSkill?: string;
}) {
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [source, setSource] = useState("all");
  const [archetype, setArchetype] = useState("all");
  const [sort, setSort] = useState<"profile_match" | "latest" | "comp_high_low">("latest");
  const [skill, setSkill] = useState<string | undefined>(initialSkill);
  const [jobs, setJobs] = useState<CardJob[]>(initialJobs);
  const [total, setTotal] = useState(initialTotal);
  const [selectedId, setSelectedId] = useState<string | null>(initialJobs[0]?.id ?? null);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(initialTotal > initialJobs.length);
  const [offset, setOffset] = useState(initialJobs.length);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  const selectedJob = useMemo(() => jobs.find((j) => j.id === selectedId) ?? jobs[0] ?? null, [jobs, selectedId]);

  const sourcesForFilter = useMemo(() => {
    return SOURCE_META.map((m) => ({
      id: m.id,
      label: m.label,
      color: m.color,
      count: stats.bySource[m.id] ?? 0,
    }));
  }, [stats.bySource]);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams();
    if (debouncedQ) params.set("q", debouncedQ);
    if (source !== "all") params.set("source", source);
    if (archetype !== "all") params.set("archetype", archetype);
    if (skill) params.set("skill", skill);
    params.set("sort", sort);
    params.set("limit", "20");
    params.set("offset", "0");

    // Skip fetch if initial state matches server-render (no filters)
    const isInitial = debouncedQ === "" && source === "all" && archetype === "all" && sort === "latest" && !skill;
    if (isInitial) {
      setJobs(initialJobs);
      setTotal(initialTotal);
      setHasMore(initialTotal > initialJobs.length);
      setOffset(initialJobs.length);
      if (!selectedId && initialJobs[0]) setSelectedId(initialJobs[0].id);
      return;
    }

    setLoading(true);
    fetch(`/api/jobs?${params.toString()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: ApiResponse | null) => {
        if (cancelled || !data) return;
        setJobs(data.jobs);
        setTotal(data.total);
        setHasMore(data.hasMore);
        setOffset(data.jobs.length);
        if (data.jobs.length > 0) setSelectedId(data.jobs[0].id);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedQ, source, archetype, sort, skill]);

  async function loadMore() {
    const params = new URLSearchParams();
    if (debouncedQ) params.set("q", debouncedQ);
    if (source !== "all") params.set("source", source);
    if (archetype !== "all") params.set("archetype", archetype);
    if (skill) params.set("skill", skill);
    params.set("sort", sort);
    params.set("limit", "20");
    params.set("offset", String(offset));
    const res = await fetch(`/api/jobs?${params.toString()}`);
    if (!res.ok) return;
    const data = (await res.json()) as ApiResponse;
    setJobs((prev) => [...prev, ...data.jobs]);
    setHasMore(data.hasMore);
    setOffset((prev) => prev + data.jobs.length);
  }

  const totalLive = stats.total || total || 0;

  function handleToggleSave(id: string, nextSaved: boolean) {
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, is_saved: nextSaved } : j)));
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-[18px] font-bold tracking-tight text-white">Live Job Postings &amp; Ingestion Stream</h1>
          <span className="rounded-full bg-[#0A2E2A] px-2.5 py-0.5 text-[11px] font-medium text-[#2DD4BF] border border-[#134E4A]/50">
            {totalLive.toLocaleString()} requisitions live
          </span>
          <span className="ml-auto hidden items-center gap-2 text-[11px] text-[#475569] lg:flex">
            <span className="h-1.5 w-1.5 rounded-full bg-[#22C55E] animate-pulse" /> Feed Ingestion: Healthy (10/10 nodes)
            <span className="text-[#1E293B]">/</span> Parser latency: 42ms
          </span>
        </div>
        <p className="mt-1 text-xs text-[#64748B]">Raw requisitions ingested continuously across 10 verified remote engineer sources. Monitored for stack requirements, compensation benchmarks, and semantic profile delta.</p>
      </div>

      <JobsFilters
        q={q}
        onQ={setQ}
        source={source}
        onSource={setSource}
        sources={sourcesForFilter}
        archetype={archetype}
        onArchetype={setArchetype}
        sort={sort}
        onSort={setSort}
        total={total}
        skill={skill}
        onSkillClear={() => setSkill(undefined)}
      />

      <div className="flex items-center justify-between text-[11px] text-[#475569]">
        <span>
          Showing <span className="font-semibold text-white">{total.toLocaleString()} matching roles</span> <span className="hidden sm:inline">· 14m ago</span>
        </span>
        <span className="inline-flex items-center gap-1 text-[#2DD4BF]">
          <span className="h-2 w-2 rounded-full border border-[#2DD4BF] flex items-center justify-center">
            <span className="h-1 w-1 rounded-full bg-[#2DD4BF]" />
          </span>
          Auto-sync
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[420px_1fr] gap-4">
        <div className="space-y-3 lg:max-h-[calc(100vh-240px)] lg:overflow-y-auto lg:pr-1 custom-scrollbar">
          <AnimatePresence mode="popLayout">
            {loading && jobs.length === 0 ? (
              <div className="space-y-3">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-40 animate-pulse rounded-xl border border-[#1E293B] bg-[#0F172A]" />
                ))}
              </div>
            ) : jobs.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[#1E293B] bg-[#0F172A] p-8 text-center">
                <p className="text-sm text-[#64748B]">No matching roles</p>
                <p className="mt-1 text-xs text-[#475569]">Try broadening your filters or run ingestion to populate live data.</p>
              </div>
            ) : (
              jobs.map((job, idx) => (
                <motion.div
                  key={job.id}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ delay: idx * 0.02, duration: 0.25 }}
                  layout
                >
                  <JobCard job={job} selected={job.id === selectedJob?.id} onSelect={() => setSelectedId(job.id)} />
                </motion.div>
              ))
            )}
          </AnimatePresence>

          {hasMore && jobs.length > 0 && (
            <button onClick={loadMore} className="w-full rounded-xl border border-[#1E293B] bg-[#0F172A] py-3 text-xs text-[#64748B] hover:border-[#334155] hover:text-white">
              ▾ Ingest Older Requisitions ({Math.max(0, total - jobs.length)} more)
            </button>
          )}
        </div>

        <div className="lg:sticky lg:top-[68px] lg:self-start lg:max-h-[calc(100vh-120px)] lg:overflow-y-auto">
          <JobDetail job={selectedJob} onToggleSave={handleToggleSave} />
        </div>
      </div>
    </div>
  );
}
