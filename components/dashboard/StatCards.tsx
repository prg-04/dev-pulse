"use client";

import { motion } from "framer-motion";

type Stats = {
  jobsIngested: number;
  jobsDelta: number;
  skillsTracked: number;
  skillsDelta: number;
  topSkill: string;
  topSkillCount: number;
  lastUpdate: string;
  monthLabel: string;
  postingsLabel: string;
};

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

export function StatCards({ stats }: { stats: Stats }) {
  const hasData = stats.jobsIngested > 0 || stats.skillsTracked > 0;

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
      <div className="rounded-xl border border-[#1E293B] bg-[#0F172A] p-5 relative overflow-hidden">
        <div className="absolute inset-x-0 top-0 h-[2px] bg-[#14B8A6]" />
        <p className="text-[11px] tracking-wide text-[#64748B]">Jobs ingested this month</p>
        <p className="mt-2 font-[var(--font-heading)] text-2xl font-bold text-white">
          <CountUp value={stats.jobsIngested} />
        </p>
        <p className="mt-2 flex items-center gap-1 text-xs text-[#22C55E]">
          <span>↑</span> +{stats.jobsDelta.toLocaleString()} since yesterday
        </p>
      </div>

      <div className="rounded-xl border border-[#1E293B] bg-[#0F172A] p-5 relative overflow-hidden">
        <div className="absolute inset-x-0 top-0 h-[2px] bg-[#8B5CF6]" />
        <p className="text-[11px] tracking-wide text-[#64748B]">Skills tracked</p>
        <p className="mt-2 font-[var(--font-heading)] text-2xl font-bold text-white">
          <CountUp value={stats.skillsTracked} />
        </p>
        <p className="mt-2 flex items-center gap-1 text-xs text-[#22C55E]">
          <span>↑</span> +{stats.skillsDelta} new skills this month
        </p>
      </div>

      <div className="rounded-xl border border-[#1E293B] bg-[#0F172A] p-5 relative overflow-hidden">
        <div className="absolute inset-x-0 top-0 h-[2px] bg-[#22C55E]" />
        <p className="text-[11px] tracking-wide text-[#64748B]">Top skill this month</p>
        <p className="mt-2 text-[15px] font-medium text-[#5EEAD4]">{hasData ? stats.topSkill : "—"}</p>
        <p className="mt-2 text-xs text-[#64748B]">
          {hasData ? `${stats.topSkillCount.toLocaleString()} job postings` : "No data yet"}
        </p>
      </div>

      <div className="rounded-xl border border-[#1E293B] bg-[#0F172A] p-5 relative overflow-hidden">
        <div className="absolute inset-x-0 top-0 h-[2px] bg-[#22C55E]" />
        <p className="text-[11px] tracking-wide text-[#64748B]">Last data update</p>
        <p className="mt-2 font-[var(--font-heading)] text-xl font-bold text-white">
          {hasData ? stats.lastUpdate : "No data"}
        </p>
        <p className="mt-2 flex items-center gap-1.5 text-xs text-[#22C55E]">
          <span className="h-1.5 w-1.5 rounded-full bg-[#22C55E]" /> Pipeline healthy
        </p>
      </div>
    </div>
  );
}
