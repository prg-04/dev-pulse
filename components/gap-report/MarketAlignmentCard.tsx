"use client";

import { motion } from "framer-motion";

type Props = {
  pct: number;
  index: number;
  deltaSinceQuarter?: number;
  targetBaseline?: number;
  topTierThreshold?: number;
};

export function MarketAlignmentCard({
  pct,
  index,
  deltaSinceQuarter = 6.8,
  targetBaseline = 60,
  topTierThreshold = 80,
}: Props) {
  return (
    <div className="rounded-xl border border-[#1E293B] bg-[#0F172A] p-5">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-[13px] font-semibold text-white">Market alignment</h3>
          <span className="rounded bg-[#1E293B] px-1.5 py-0.5 text-[10px] font-mono text-[#64748B]">
            INDEX: {index.toFixed(3)}
          </span>
        </div>
        <span className="flex items-center gap-1.5 text-[11px] text-[#64748B]">
          High competitive fit
          <span className="h-1.5 w-1.5 rounded-full bg-[#22C55E]" />
        </span>
      </div>

      <div className="mt-4 flex items-baseline gap-2">
        <span className="font-[var(--font-heading)] text-[42px] font-bold leading-none text-[#2DD4BF] tabular-nums">
          {pct}%
        </span>
        <span className="text-xs text-[#64748B]">+{deltaSinceQuarter.toFixed(1)}% since last quarter update</span>
      </div>

      <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-[#1E293B]">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="h-2 rounded-full bg-[#14B8A6]"
        />
      </div>
      <div className="mt-1.5 flex justify-between text-[10px] text-[#475569]">
        <span>Target baseline: {targetBaseline}%</span>
        <span>Top tier threshold: {topTierThreshold}%</span>
      </div>
    </div>
  );
}
