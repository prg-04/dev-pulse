"use client";

import { motion } from "framer-motion";
import { mockStats } from "@/lib/mock/dashboard-data";

function CountUp({ value, format }: { value: number; format?: (n: number) => string }) {
  return (
    <motion.span
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      {format ? format(value) : value.toLocaleString()}
    </motion.span>
  );
}

export function StatCards() {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
      <div className="rounded-xl border border-[#1E293B] bg-[#0F172A] p-5 relative overflow-hidden">
        <div className="absolute inset-x-0 top-0 h-[2px] bg-[#14B8A6]" />
        <p className="text-[11px] tracking-wide text-[#64748B]">Jobs ingested this month</p>
        <p className="mt-2 font-[var(--font-heading)] text-2xl font-bold text-white">
          <CountUp value={mockStats.jobsIngested} />
        </p>
        <p className="mt-2 flex items-center gap-1 text-xs text-[#22C55E]">
          <span>↑</span> +{mockStats.jobsDelta.toLocaleString()} since yesterday
        </p>
      </div>

      <div className="rounded-xl border border-[#1E293B] bg-[#0F172A] p-5 relative overflow-hidden">
        <div className="absolute inset-x-0 top-0 h-[2px] bg-[#8B5CF6]" />
        <p className="text-[11px] tracking-wide text-[#64748B]">Skills tracked</p>
        <p className="mt-2 font-[var(--font-heading)] text-2xl font-bold text-white">
          <CountUp value={mockStats.skillsTracked} />
        </p>
        <p className="mt-2 flex items-center gap-1 text-xs text-[#22C55E]">
          <span>↑</span> +{mockStats.skillsDelta} new skills this month
        </p>
      </div>

      <div className="rounded-xl border border-[#1E293B] bg-[#0F172A] p-5 relative overflow-hidden">
        <div className="absolute inset-x-0 top-0 h-[2px] bg-[#22C55E]" />
        <p className="text-[11px] tracking-wide text-[#64748B]">Top skill this month</p>
        <p className="mt-2 text-[15px] font-medium text-[#5EEAD4]">{mockStats.topSkill}</p>
        <p className="mt-2 text-xs text-[#64748B]">{mockStats.topSkillCount.toLocaleString()} job postings</p>
      </div>

      <div className="rounded-xl border border-[#1E293B] bg-[#0F172A] p-5 relative overflow-hidden">
        <div className="absolute inset-x-0 top-0 h-[2px] bg-[#22C55E]" />
        <p className="text-[11px] tracking-wide text-[#64748B]">Last data update</p>
        <p className="mt-2 font-[var(--font-heading)] text-xl font-bold text-white">{mockStats.lastUpdate}</p>
        <p className="mt-2 flex items-center gap-1.5 text-xs text-[#22C55E]">
          <span className="h-1.5 w-1.5 rounded-full bg-[#22C55E]" /> Pipeline healthy
        </p>
      </div>
    </div>
  );
}
