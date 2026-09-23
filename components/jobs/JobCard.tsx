"use client";

import { cn } from "@/lib/utils";
import { Globe, Building2, Clock } from "lucide-react";

export type CardJob = {
  id: string;
  source: string;
  company: string | null;
  title: string | null;
  description: string | null;
  comp_min: number | null;
  comp_max: number | null;
  comp_currency: string | null;
  liquidity_tier: string | null;
  contractor_type: string | null;
  location_text: string | null;
  external_id: string;
  external_url: string | null;
  posted_at: string | null;
  ingested_at: string | null;
  skills: string[];
  stack_match_pct?: number;
  stackMatch?: number;
  stack_match_label?: string;
  gap_skills?: string[];
  matched_skills?: string[];
  is_saved?: boolean;
};

function sourceBadge(source: string) {
  switch (source) {
    case "hackernews":
      return { label: "HackerNews 'Who is Hiring'", cls: "bg-[#7C3A0A]/20 text-[#FB923C] border-[#7C3A0A]/40" };
    case "himalayas":
      return { label: "Himalayas", cls: "bg-[#4C1D95]/20 text-[#A78BFA] border-[#6D28D9]/30" };
    case "remotejobs":
      return { label: "RemoteJobs", cls: "bg-[#0F766E]/20 text-[#2DD4BF] border-[#134E4A]/40" };
    case "remotive":
      return { label: "Remotive", cls: "bg-[#831843]/20 text-[#F472B6] border-[#9D174D]/30" };
    case "arbeitnow":
      return { label: "Arbeitnow", cls: "bg-[#0C4A6E]/20 text-[#38BDF8] border-[#0284C7]/30" };
    case "remoteok":
      return { label: "RemoteOK", cls: "bg-[#881337]/20 text-[#F43F5E] border-[#881337]/30" };
    case "jobicy":
      return { label: "Jobicy", cls: "bg-[#14532D]/20 text-[#22C55E] border-[#14532D]/30" };
    case "adzuna":
      return { label: "Adzuna", cls: "bg-[#7C2D12]/20 text-[#F59E0B] border-[#7C2D12]/30" };
    case "jooble":
      return { label: "Jooble", cls: "bg-[#4338CA]/20 text-[#818CF8] border-[#4338CA]/30" };
    case "themuse":
      return { label: "The Muse", cls: "bg-[#164E63]/20 text-[#06B6D4] border-[#164E63]/30" };
    default:
      return { label: source, cls: "bg-[#1E293B] text-[#64748B] border-[#334155]" };
  }
}

function timeAgo(iso: string | number | null): string {
  if (iso == null || iso === "") return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const diff = Date.now() - d.getTime();
  const h = Math.floor(diff / 3600000);
  if (h < 1) return "just now";
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days === 1) return "1d ago";
  return `${days}d ago`;
}

function compLabel(min: number | null, max: number | null, currency: string | null): string {
  if (min == null && max == null) return "Not disclosed";
  const fmt = (n: number) => `$${(n >= 1000 ? `${Math.round(n / 1000)}k` : String(n))}`;
  const cur = currency ?? "USD";
  if (min != null && max != null) return `${fmt(min)} — ${fmt(max)} ${cur}`;
  if (min != null) return `From ${fmt(min)} ${cur}`;
  return `Up to ${fmt(max!)} ${cur}`;
}

export function JobCard({ job, selected, onSelect }: { job: CardJob; selected: boolean; onSelect: () => void }) {
  const badge = sourceBadge(job.source);
  const gapSet = new Set((job.gap_skills ?? []).map((s) => s.toLowerCase()));

  return (
    <button
      onClick={onSelect}
      className={cn(
        "w-full text-left rounded-xl border bg-[#0F172A] p-4 transition-colors",
        selected ? "border-l-[3px] border-l-[#14B8A6] border-y-[#1E293B] border-r-[#1E293B]" : "border-[#1E293B] hover:border-[#334155]"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-semibold text-white">{job.company ?? "Unknown company"}</span>
          <span className={cn("rounded px-2 py-0.5 text-[10px] font-medium border", badge.cls)}>{badge.label}</span>
          {job.source === "adzuna" && (
            <a href="https://www.adzuna.com" target="_blank" rel="noopener noreferrer" className="rounded bg-[#7C2D12]/30 px-1.5 py-0.5 text-[9px] font-medium text-[#F59E0B] border border-[#7C2D12]/40 hover:underline">
              Jobs by Adzuna
            </a>
          )}
        </div>
        <span className="shrink-0 text-[11px] text-[#475569]">{timeAgo(job.posted_at) || timeAgo(job.ingested_at)}</span>
      </div>

      <h3 className="mt-1.5 text-[13px] font-semibold leading-snug text-white line-clamp-2">{job.title ?? "Untitled role"}</h3>

      <div className="mt-1.5 flex items-center gap-2 text-[11px]">
        <span className="text-[#2DD4BF]">{compLabel(job.comp_min, job.comp_max, job.comp_currency)}</span>
        {job.comp_min != null && job.comp_max != null && (
          <span className="text-[#475569] hidden sm:inline">· Equity 0.15% - 0.35%</span>
        )}
      </div>

      <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-[#64748B]">
        {job.source === "himalayas" ? <Building2 className="h-3 w-3" /> : <Globe className="h-3 w-3" />}
        <span className="truncate">{job.location_text ?? "Not disclosed"}</span>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {(job.skills.length > 0 ? job.skills.slice(0, 6) : ["No skills extracted"]).map((s) => {
          const isGap = gapSet.has(s.toLowerCase());
          return (
            <span
              key={`${job.id}-${s}`}
              className={cn(
                "rounded px-2 py-0.5 text-[11px] border",
                isGap
                  ? "bg-[#3A1A1A] text-[#FCA5A5] border-[#7F1D1D]"
                  : s === "No skills extracted"
                    ? "bg-[#1E293B] text-[#475569] border-[#334155]"
                    : "bg-[#12261E] text-[#2DD4BF] border-[#1A3A2F]"
              )}
            >
              {s}
              {isGap ? " !gap" : ""}
            </span>
          );
        })}
      </div>

      <div className="mt-3 flex items-center justify-between">
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium",
            job.stack_match_pct == null
              ? "bg-[#1E293B] text-[#64748B]"
              : job.stack_match_pct >= 80
                ? "bg-[#0A2E2A] text-[#2DD4BF] border border-[#134E4A]/50"
                : job.stack_match_pct >= 60
                  ? "bg-[#0A2E2A]/70 text-[#2DD4BF]"
                  : "bg-[#1E293B] text-[#94A3B8]"
          )}
        >
          {job.stack_match_pct == null ? (
            <Clock className="h-3 w-3" />
          ) : (
            <span className="h-3 w-3 rounded-full border border-current flex items-center justify-center text-[8px]">✓</span>
          )}
          {job.stack_match_label}
        </span>
        <span className="text-[10px] text-[#475569]">{job.source === "hackernews" ? `HN ID: #${job.external_id.replace("hn-", "")}` : job.source === "himalayas" ? "Verified Requisition" : `Sync: ${timeAgo(job.ingested_at)}`}</span>
      </div>
    </button>
  );
}
