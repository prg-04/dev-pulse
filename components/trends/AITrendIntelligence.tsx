"use client";

import { useEffect, useState, useMemo } from "react";
import { Sparkles } from "lucide-react";

type Props = {
  skills: string[];
  range: "3M" | "6M" | "12M";
  data: Record<string, string | number>[];
  defaultSkills: string[];
  marketMovers: { rising: { skill: string; delta: number }[]; declining: { skill: string; delta: number }[] };
};

export function AITrendIntelligence({ skills, range, data, defaultSkills, marketMovers }: Props) {
  const [summary, setSummary] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const isMarketView = useMemo(
    () => skills.length === defaultSkills.length && skills.every((s, i) => s === defaultSkills[i]),
    [skills, defaultSkills]
  );
  const mode = isMarketView ? "market" : "custom";

  useEffect(() => {
    let cancelled = false;
    async function fetchSummary() {
      setLoading(true);
      try {
        const res = await fetch("/api/trends-summary", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ skills, range, data, mode, marketMovers }),
        });
        if (!res.ok) throw new Error("failed");
        const json = await res.json() as { summary?: string; confidence?: number };
        if (!cancelled && json.summary) {
          setSummary(json.summary);
        }
      } catch {
        // fallback remains
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchSummary();
    return () => {
      cancelled = true;
    };
  }, [skills, range, data, mode, marketMovers]);

  const fallback =
    "Market data is still loading. Summary will appear once trend data is available.";

  // render with colored deltas inline if using fallback
  const renderSummary = (text: string) => {
    // simple highlight for deltas like +34% / -2%
    const parts = text.split(/(\+\d+%|-\d+%)/g);
    return parts.map((p, i) => {
      if (/^\+\d+%$/.test(p)) return <span key={i} className="text-[#22C55E]">{p}</span>;
      if (/^-\d+%$/.test(p)) return <span key={i} className="text-[#EF4444]">{p}</span>;
      return <span key={i}>{p}</span>;
    });
  };

  return (
    <div className="rounded-xl border border-[#1E293B] bg-[#0F172A] p-4">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-[#2DD4BF]" />
        <span className="text-sm font-semibold text-white">AI Trend Intelligence</span>
        {loading && <span className="text-[11px] text-[#475569]">Generating…</span>}
      </div>
      <p className="mt-3 text-sm leading-relaxed text-[#94A3B8]">
        {renderSummary(summary ?? fallback)}
      </p>
      <div className="mt-4 flex flex-col gap-1 border-t border-[#1E293B] pt-3 text-[11px] text-[#475569] sm:flex-row sm:items-center sm:justify-between">
        <span>Generated from {range === "3M" ? "3" : range === "6M" ? "6" : "12"} months of job posting data · Updated daily</span>
      </div>
    </div>
  );
}
