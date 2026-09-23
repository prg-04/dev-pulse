"use client";

import { useEffect, useState } from "react";
import { Bookmark, ExternalLink, DollarSign, MapPin, Clock, Check } from "lucide-react";
import type { CardJob } from "./JobCard";
import { cn } from "@/lib/utils";
import { stripHtml } from "@/lib/sanitize";

type Summary = {
  about_company: string | null;
  the_role: string | null;
  what_you_will_do: string[];
  requirements: string[];
  cached?: boolean;
};

function compLabel(min: number | null, max: number | null, cur: string | null) {
  if (min == null && max == null) return "Not disclosed";
  const fmt = (n: number) => `$${n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)}`;
  const c = cur ?? "USD";
  if (min != null && max != null) return `${fmt(min)} — ${fmt(max)} ${c}`;
  if (min != null) return `From ${fmt(min)} ${c}`;
  return `Up to ${fmt(max!)} ${c}`;
}

export function JobDetail({ job, onToggleSave }: { job: CardJob | null; onToggleSave?: (id: string, nextSaved: boolean) => void }) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(job?.is_saved ?? false);

  useEffect(() => {
    setSaved(job?.is_saved ?? false);
  }, [job?.id, job?.is_saved]);

  useEffect(() => {
    if (!job) {
      setSummary(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetch(`/api/jobs/${job.id}/summary`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        if (data && !data.error) setSummary(data as Summary);
        else setSummary(null);
      })
      .catch(() => {
        if (!cancelled) setSummary(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [job?.id]);

  if (!job) {
    return (
      <div className="rounded-xl border border-[#1E293B] bg-[#0F172A] p-12 text-center">
        <p className="text-sm text-[#64748B]">Select a role to view details</p>
        <p className="mt-1 text-xs text-[#475569]">Market intelligence extraction will appear here</p>
      </div>
    );
  }

  const matchPct = job.stack_match_pct;

  async function handleSave() {
    const next = !saved;
    setSaved(next);
    try {
      if (next) {
        await fetch("/api/saved-jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ job_id: job!.id }) });
      } else {
        await fetch(`/api/saved-jobs?job_id=${job!.id}`, { method: "DELETE" });
      }
      onToggleSave?.(job!.id, next);
    } catch {
      setSaved(!next);
    }
  }

  return (
    <div className="rounded-xl border border-[#1E293B] bg-[#0F172A] overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1E293B] bg-[#0F172A] px-4 py-3">
        <div className="flex items-center gap-2 text-[11px] text-[#64748B]">
          <span className="inline-flex items-center gap-1.5 rounded bg-[#7C3A0A]/15 px-2 py-1 text-[#FB923C] border border-[#7C3A0A]/30">
            <ExternalLink className="h-3 w-3" />
            {job.source === "hackernews" ? `HN Source ID: ${job.external_id.replace("hn-", "")}` : `${job.source} · ${job.external_id}`}
          </span>
          <span>Parsed 2h ago</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleSave}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
              saved ? "bg-[#14B8A6] text-[#070A14] border-[#14B8A6]" : "bg-transparent text-[#94A3B8] border-[#1E293B] hover:border-[#334155] hover:text-white"
            )}
          >
            <Bookmark className={cn("h-3.5 w-3.5", saved && "fill-current")} />
            {saved ? "Saved" : "Save Role"}
          </button>
          {job.external_url ? (
            <a
              href={job.external_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#2DD4BF] px-3.5 py-1.5 text-xs font-semibold text-[#070A14] hover:bg-[#14B8A6]"
            >
              Apply Directly <ExternalLink className="h-3 w-3" />
            </a>
          ) : (
            <span className="rounded-lg bg-[#1E293B] px-3.5 py-1.5 text-xs text-[#475569]">No external link</span>
          )}
        </div>
      </div>

      <div className="p-6">
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <span className="text-[13px] font-semibold text-white">{job.company ?? "Unknown"}</span>
          {job.liquidity_tier ? (
            <span className="rounded bg-[#1E293B] px-2 py-0.5 text-[#94A3B8] border border-[#334155] capitalize">{job.liquidity_tier}</span>
          ) : (
            <span className="rounded bg-[#1E293B] px-2 py-0.5 text-[#475569] border border-[#1E293B]">Not disclosed</span>
          )}
          {job.contractor_type ? (
            <span className="rounded bg-[#12261E] px-2 py-0.5 text-[#2DD4BF] border border-[#1A3A2F] capitalize">{job.contractor_type}</span>
          ) : null}
          <span className="ml-auto text-[#475569]">Requisition #{job.external_id.slice(0, 8).toUpperCase()}</span>
        </div>

        <h1 className="mt-3 text-[22px] font-bold leading-tight text-white">{job.title ?? "Untitled role"}</h1>

        <div className="mt-3 flex flex-wrap gap-2">
          <span className="inline-flex items-center gap-1 rounded-full bg-[#0A2E2A] px-2.5 py-1 text-[11px] font-medium text-[#2DD4BF] border border-[#134E4A]/50">
            <DollarSign className="h-3 w-3" />
            {compLabel(job.comp_min, job.comp_max, job.comp_currency)}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-[#1E293B] px-2.5 py-1 text-[11px] text-[#94A3B8] border border-[#334155]">
            <MapPin className="h-3 w-3" />
            {job.location_text ?? "Not disclosed"}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-[#1E293B] px-2.5 py-1 text-[11px] text-[#94A3B8] border border-[#334155]">
            <Clock className="h-3 w-3" />
            Full-time Requisition
          </span>
        </div>

        <div className="mt-4 flex items-center gap-2 rounded-lg border border-[#134E4A]/30 bg-[#0A2E2A]/40 px-3 py-2.5">
          <div className="h-6 w-0.5 bg-[#14B8A6]" />
          <span className="text-[11px] font-semibold tracking-widest text-[#94A3B8]">DevPulse Market Intelligence Extraction</span>
          <span
            className={cn(
              "ml-auto rounded px-2 py-0.5 text-[11px] font-semibold",
              matchPct == null ? "bg-[#1E293B] text-[#64748B]" : "bg-[#0A2E2A] text-[#2DD4BF] border border-[#14B8A6]/30"
            )}
          >
            {matchPct == null ? "Not enough data" : `${matchPct}% Profile Alignment (${job.skills.length ? `${(job.matched_skills ?? []).length}/${[...new Set(job.skills.map((s) => s.toLowerCase()))].length} Matched` : "No skills"})`}
          </span>
        </div>

        <section className="mt-6">
          <h2 className="text-[14px] font-semibold text-white">About {job.company ?? "the Company"}</h2>
          {loading ? (
            <div className="mt-2 h-16 animate-pulse rounded bg-[#1E293B]/60" />
          ) : summary?.about_company ? (
            <p className="mt-2 whitespace-pre-wrap text-[12.5px] leading-6 text-[#94A3B8]">{summary.about_company}</p>
          ) : (
            <p className="mt-2 whitespace-pre-wrap text-[12.5px] leading-6 text-[#94A3B8]">
              {stripHtml(job.description).slice(0, 400) || "Not disclosed — the source posting did not include a company description."}
            </p>
          )}
        </section>

        <section className="mt-6">
          <h2 className="text-[14px] font-semibold text-white">The Role</h2>
          {loading ? (
            <div className="mt-2 h-12 animate-pulse rounded bg-[#1E293B]/60" />
          ) : summary?.the_role ? (
            <p className="mt-2 whitespace-pre-wrap text-[12.5px] leading-6 text-[#94A3B8]">{summary.the_role}</p>
          ) : (
            <p className="mt-2 whitespace-pre-wrap text-[12.5px] leading-6 text-[#475569]">
              {stripHtml(job.description).slice(0, 200) || "No role summary available for this listing."}
            </p>
          )}
        </section>

        <section className="mt-6">
          <h2 className="text-[14px] font-semibold text-white">What You&apos;ll Do</h2>
          {loading ? (
            <div className="mt-2 space-y-2">
              <div className="h-4 animate-pulse rounded bg-[#1E293B]/60" />
              <div className="h-4 animate-pulse rounded bg-[#1E293B]/60" />
            </div>
          ) : summary?.what_you_will_do && summary.what_you_will_do.length > 0 ? (
            <ul className="mt-2 list-disc space-y-2 pl-5 text-[12.5px] leading-6 text-[#94A3B8]">
              {summary.what_you_will_do.map((b, i) => (
                <li key={i} className="marker:text-[#14B8A6]">
                  {b}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-[12.5px] leading-6 text-[#475569]">Not disclosed by the employer in this listing.</p>
          )}
        </section>

        <section className="mt-6">
          <h2 className="text-[14px] font-semibold text-white">Requirements &amp; Qualifications</h2>
          {loading ? (
            <div className="mt-2 h-12 animate-pulse rounded bg-[#1E293B]/60" />
          ) : summary?.requirements && summary.requirements.length > 0 ? (
            <ul className="mt-2 space-y-2 text-[12.5px] leading-6 text-[#94A3B8]">
              {summary.requirements.map((r, i) => (
                <li key={i} className="flex gap-2">
                  <Check className="mt-1 h-3.5 w-3.5 shrink-0 text-[#22C55E]" />
                  <span>{r}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-[12.5px] leading-6 text-[#475569]">Not disclosed by the employer in this listing.</p>
          )}
        </section>

        <div className="mt-6 rounded-lg border border-[#1E293B] bg-[#070A14]/50 px-3 py-2.5">
          <p className="text-[11px] font-semibold text-[#64748B]">DevPulse Market Intelligence Extraction</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {job.skills.length > 0 ? (
              job.skills.map((s) => {
                const isMatch = (job as unknown as { matched_skills?: string[] }).matched_skills?.map((x) => x.toLowerCase()).includes(s.toLowerCase());
                const isGap = (job as unknown as { gap_skills?: string[] }).gap_skills?.map((x) => x.toLowerCase()).includes(s.toLowerCase());
                return (
                  <span
                    key={`detail-${s}`}
                    className={cn(
                      "rounded px-2 py-0.5 text-[11px] border",
                      isGap ? "bg-[#3A1A1A] text-[#FCA5A5] border-[#7F1D1D]" : isMatch ? "bg-[#0A2E2A] text-[#2DD4BF] border-[#134E4A]" : "bg-[#1E293B] text-[#64748B] border-[#334155]"
                    )}
                  >
                    {s}
                    {isGap ? " !gap" : ""}
                  </span>
                );
              })
            ) : (
              <span className="text-xs text-[#475569]">No skills extracted — {matchPct == null ? "Not enough data for match" : ""}</span>
            )}
          </div>
          <p className="mt-2 text-[10px] text-[#475569]">Liquidity: {job.liquidity_tier ?? "Not disclosed"} · Contractor: {job.contractor_type ?? "Not disclosed"} · Currency: {job.comp_currency ?? "Not disclosed"}</p>
        </div>
      </div>
    </div>
  );
}
