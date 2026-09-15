"use client";

import { Search, SlidersHorizontal, X } from "lucide-react";
import { cn } from "@/lib/utils";

type Source = { id: string; label: string; count: number; color: string };
type SortKey = "profile_match" | "latest" | "comp_high_low";

export function JobsFilters({
  q,
  onQ,
  source,
  onSource,
  sources,
  archetype,
  onArchetype,
  sort,
  onSort,
  total,
  skill,
  onSkillClear,
}: {
  q: string;
  onQ: (v: string) => void;
  source: string;
  onSource: (v: string) => void;
  sources: Source[];
  archetype: string;
  onArchetype: (v: string) => void;
  sort: SortKey;
  onSort: (v: SortKey) => void;
  total: number;
  skill?: string;
  onSkillClear?: () => void;
}) {
  const allCount = sources.reduce((a, b) => a + b.count, 0);
  const archetypes = ["senior fullstack", "backend", "frontend", "infra/devops", "US Remote ($160k+)"];
  const sortOptions: { id: SortKey; label: string }[] = [
    { id: "profile_match", label: "Profile Match: 74%+" },
    { id: "latest", label: "Latest Ingested" },
    { id: "comp_high_low", label: "Comp: High → Low" },
  ];

  return (
    <div className="rounded-xl border border-[#1E293B] bg-[#0F172A] p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#475569]" />
          <input
            value={q}
            onChange={(e) => onQ(e.target.value)}
            placeholder="fullstack typescript"
            className="h-9 w-full rounded-lg border border-[#1E293B] bg-[#070A14] pl-9 pr-12 text-sm text-white placeholder:text-[#475569] focus:border-[#334155] focus:outline-none"
          />
          <span className="absolute right-2 top-1/2 -translate-y-1/2 rounded bg-[#1E293B] px-1.5 py-0.5 text-[10px] text-[#64748B]">⌘K</span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {sortOptions.map((s) => (
            <button
              key={s.id}
              onClick={() => onSort(s.id)}
              className={cn(
                "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                sort === s.id ? "bg-[#0A2E2A] text-[#2DD4BF] border-[#134E4A]" : "bg-transparent text-[#64748B] border-[#1E293B] hover:border-[#334155] hover:text-white"
              )}
            >
              {s.label}
            </button>
          ))}
          <button className="inline-flex items-center gap-1.5 rounded-lg border border-[#1E293B] bg-transparent px-3 py-1.5 text-xs text-[#94A3B8] hover:border-[#334155] hover:text-white">
            <SlidersHorizontal className="h-3 w-3" />
            All Filters <span className="ml-1 rounded-full bg-[#14B8A6] px-1.5 py-0.5 text-[10px] font-bold text-[#070A14]">3</span>
          </button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {skill && (
          <span className="inline-flex items-center gap-1 rounded-full border border-[#14B8A6]/40 bg-[#0B1220] px-2.5 py-1 text-xs font-medium text-[#2DD4BF]">
            {skill}
            <button onClick={onSkillClear} aria-label={`Remove ${skill} filter`} className="rounded p-0.5 hover:bg-[#1E293B] text-[#2DD4BF]">
              <X className="h-3 w-3" />
            </button>
          </span>
        )}
        <span className="text-[11px] tracking-widest text-[#475569]">SOURCES:</span>
        <button
          onClick={() => onSource("all")}
          className={cn(
            "rounded-full border px-3 py-1 text-xs font-medium",
            source === "all" ? "bg-white text-[#070A14] border-white" : "bg-transparent text-[#94A3B8] border-[#1E293B] hover:border-[#334155]"
          )}
        >
          All Sources {allCount.toLocaleString()}
        </button>
        {sources.map((s) => {
          const active = source === s.id;
          return (
            <button
              key={s.id}
              onClick={() => onSource(s.id)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium",
                active ? "bg-[#1E293B] text-white border-[#334155]" : "bg-transparent text-[#94A3B8] border-[#1E293B] hover:border-[#334155]"
              )}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.color }} />
              {s.label} {s.count.toLocaleString()}
            </button>
          );
        })}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="text-[11px] tracking-widest text-[#475569]">ARCHETYPE:</span>
        {archetypes.map((a) => {
          const active = archetype === a;
          return (
            <button
              key={a}
              onClick={() => onArchetype(active ? "all" : a)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs",
                active ? "bg-[#0A2E2A] text-[#2DD4BF] border-[#134E4A]" : "bg-[#1E293B] text-[#64748B] border-[#1E293B] hover:border-[#334155] hover:text-[#94A3B8]",
                a.includes("US Remote") && active && "bg-[#12261E] text-[#22C55E] border-[#14532D]"
              )}
            >
              {a}
            </button>
          );
        })}
        <span className="ml-auto text-[11px] text-[#475569] hidden lg:inline">Showing {total.toLocaleString()} roles</span>
      </div>
    </div>
  );
}
