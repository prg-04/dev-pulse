"use client";

import { RefreshCw } from "lucide-react";

type Props = {
  skills: string[];
  onRemove?: (skill: string) => void;
  onReanalyse?: () => void;
  totalPostings?: number;
  monthLabel?: string;
};

export function YourSkillsPanel({ skills, onRemove, onReanalyse, totalPostings = 42891, monthLabel = "August 2026" }: Props) {
  return (
    <div className="rounded-xl border border-[#1E293B] bg-[#0F172A] p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-[13px] font-semibold text-white">Your skills</h2>
        <span className="rounded border border-[#14B8A6]/30 bg-[#14B8A6]/10 px-2 py-0.5 text-[10px] font-medium tracking-widest text-[#2DD4BF]">
          ACTIVE PROFILE
        </span>
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5 rounded-lg border border-[#1E293B] bg-[#070A14]/60 p-3">
        {skills.map((s) => (
          <span
            key={s}
            className="inline-flex items-center gap-1 rounded bg-[#1E293B] px-2 py-1 text-[11px] text-[#94A3B8]"
          >
            {s}
            <button
              onClick={() => onRemove?.(s)}
              className="ml-1 text-[#64748B] hover:text-white"
              aria-label={`Remove ${s}`}
            >
              ×
            </button>
          </span>
        ))}
        <button className="px-2 py-1 text-[11px] text-[#475569] hover:text-[#94A3B8]">+ add skill…</button>
      </div>

      <div className="mt-3 flex justify-between text-[10px] text-[#475569]">
        <span>{skills.length} skills evaluated</span>
        <span>max: 16</span>
      </div>

      <button
        onClick={onReanalyse}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg border border-[#1E293B] bg-[#0B1220] py-2.5 text-xs font-medium text-[#CBD5E1] hover:border-[#334155] hover:text-white transition-colors"
      >
        <RefreshCw className="h-3.5 w-3.5" />
        Re-analyse
      </button>

      <p className="mt-3 text-center text-[11px] text-[#475569]">
        Compared against <span className="text-[#94A3B8]">{totalPostings.toLocaleString()}</span> postings · {monthLabel} data
      </p>

      <div className="mt-5 border-t border-[#1E293B] pt-4">
        <div className="flex items-center justify-between">
          <span className="text-[10px] tracking-widest text-[#475569]">TELEMETRIC SAMPLE</span>
          <span className="text-[10px] font-semibold tracking-widest text-[#14B8A6]">LIVE FEED</span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div className="rounded border border-[#1E293B] bg-[#070A14] p-3">
            <p className="text-[10px] tracking-widest text-[#475569]">US REMOTE</p>
            <p className="mt-1 font-mono text-sm font-semibold text-white">61.4%</p>
          </div>
          <div className="rounded border border-[#1E293B] bg-[#070A14] p-3">
            <p className="text-[10px] tracking-widest text-[#475569]">CONFIDENCE</p>
            <p className="mt-1 font-mono text-sm font-semibold text-[#22C55E]">99.2%</p>
          </div>
        </div>
      </div>
    </div>
  );
}
