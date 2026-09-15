"use client";

import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import { ChevronDown } from "lucide-react";

export type SkillRow = {
  rank: number;
  skill: string;
  count: number;
  delta: number;
};

type Props = {
  skills: SkillRow[];
  onSkillSelect?: (skill: string) => void;
};

export function TopSkillsTable({ skills, onSkillSelect }: Props) {
  const [expanded, setExpanded] = useState(false);

  const maxCount = useMemo(() => Math.max(...skills.map((s) => s.count)), [skills]);
  const visible = expanded ? skills : skills.slice(0, 11);

  if (skills.length === 0) {
    return (
      <div className="rounded-xl border border-[#1E293B] bg-[#0F172A] p-5">
        <h3 className="font-[var(--font-heading)] text-[15px] font-semibold text-white">Top 50 skills</h3>
        <p className="text-[11px] text-[#64748B]">Ranked by mentions this month</p>
        <div className="mt-6 text-center text-xs text-[#475569]">No skill demand data available yet.</div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[#1E293B] bg-[#0F172A] p-5">
      <div>
        <div>
          <h3 className="font-[var(--font-heading)] text-[15px] font-semibold text-white">Top 50 skills</h3>
          <p className="text-[11px] text-[#64748B]">Ranked by mentions this month</p>
        </div>
      </div>

      <div className="mt-4 overflow-x-auto">
        <div className="min-w-[520px]">
          <div className="grid grid-cols-[48px_1fr_220px_80px_90px] gap-2 border-y border-[#1E293B] py-2 text-[10px] tracking-widest text-[#475569]">
            <span>RANK</span>
            <span>SKILL</span>
            <span>RELATIVE VOLUME</span>
            <span className="text-right">COUNT</span>
            <span className="text-right">DELTA (MOM)</span>
          </div>

          <div className="divide-y divide-[#1E293B]/60">
            {visible.map((row, idx) => {
              const pct = (row.count / maxCount) * 100;
              const rankColor = row.rank <= 3 ? "text-[#2DD4BF]" : "text-[#475569]";
              const deltaColor =
                row.delta > 10
                  ? "text-[#22C55E]"
                  : row.delta > 0
                    ? "text-[#22C55E]"
                    : row.delta < 0
                      ? "text-[#EF4444]"
                      : "text-[#F59E0B]";
              return (
                <div
                  key={`${row.rank}-${row.skill}`}
                  onClick={() => onSkillSelect?.(row.skill)}
                  className="grid cursor-pointer grid-cols-[48px_1fr_220px_80px_90px] items-center gap-2 py-2.5 hover:bg-white/[0.02] transition-colors"
                >
                  <span className={`text-xs font-bold tabular-nums ${rankColor}`}>#{row.rank}</span>
                  <span className="text-xs font-medium text-white">{row.skill}</span>
                  <div className="h-1.5 w-full rounded-full bg-[#1E293B]">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${pct}%` }}
                      transition={{ duration: 0.6, delay: idx * 0.03, ease: "easeOut" }}
                      className="h-1.5 rounded-full bg-[#14B8A6]"
                    />
                  </div>
                  <span className="text-right text-xs tabular-nums text-[#94A3B8]">{row.count.toLocaleString()}</span>
                  <span className={`text-right text-xs tabular-nums ${deltaColor}`}>
                    {row.delta > 0 ? "+" : ""}
                    {row.delta.toFixed(1)}%
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {!expanded && skills.length > 11 && (
        <button
          onClick={() => setExpanded(true)}
          className="mx-auto mt-4 flex items-center gap-1 text-xs text-[#475569] hover:text-white transition-colors"
        >
          Show 25 more <ChevronDown className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}
