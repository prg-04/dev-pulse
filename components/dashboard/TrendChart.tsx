"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Sparkles } from "lucide-react";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { mockTrendData } from "@/lib/mock/dashboard-data";
import { cn } from "@/lib/utils";

type Range = "3M" | "6M" | "12M";

const colors: Record<string, string> = {
  typescript: "#2DD4BF",
  react: "#60A5FA",
  python: "#34D399",
  "node.js": "#FB923C",
  postgresql: "#F472B6",
};

export function TrendChart() {
  const [range, setRange] = useState<Range>("6M");
  const data = mockTrendData[range];

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.15 }}
      className="rounded-xl border border-[#1E293B] bg-[#0F172A] p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-[var(--font-heading)] text-[15px] font-semibold text-white">Skill demand over time</h3>
          <p className="text-[11px] text-[#64748B]">Top 5 skills — click any skill above to compare</p>
        </div>
        <div className="flex gap-1 rounded-md border border-[#1E293B] bg-[#070A14] p-1">
          {(["3M", "6M", "12M"] as Range[]).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={cn(
                "rounded px-2.5 py-1 text-xs font-medium transition-colors",
                range === r ? "bg-[#14B8A6] text-black" : "text-[#64748B] hover:text-white"
              )}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 flex items-start gap-2 rounded-md border border-[#1E293B] bg-[#070A14]/60 px-3 py-2.5">
        <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#2DD4BF]" />
        <p className="text-xs italic leading-relaxed text-[#94A3B8]">
          TypeScript demand rose 34% over 6 months, driven by full-stack and backend roles — the largest gain of
          any tracked skill.
        </p>
      </div>

      <div className="mt-4 flex flex-wrap gap-3 text-[11px]">
        <span className="flex items-center gap-1.5 text-[#CBD5E1]">
          <span className="h-2 w-2 rounded-full" style={{ background: colors.typescript }} /> typescript
        </span>
        <span className="flex items-center gap-1.5 text-[#CBD5E1]">
          <span className="h-2 w-2 rounded-full" style={{ background: colors.react }} /> react
        </span>
        <span className="flex items-center gap-1.5 text-[#CBD5E1]">
          <span className="h-2 w-2 rounded-full" style={{ background: colors.python }} /> python
        </span>
        <span className="flex items-center gap-1.5 text-[#CBD5E1]">
          <span className="h-2 w-2 rounded-full" style={{ background: colors["node.js"] }} /> node.js
        </span>
        <span className="flex items-center gap-1.5 text-[#CBD5E1]">
          <span className="h-2 w-2 rounded-full" style={{ background: colors.postgresql }} /> postgresql
        </span>
      </div>

      <div className="mt-4 h-[260px] w-full">
        <ChartContainer
          config={{
            typescript: { label: "typescript", color: colors.typescript },
            react: { label: "react", color: colors.react },
            python: { label: "python", color: colors.python },
            "node.js": { label: "node.js", color: colors["node.js"] },
            postgresql: { label: "postgresql", color: colors.postgresql },
          }}
          className="h-[260px] w-full"
        >
          <AreaChart data={data} margin={{ left: 8, right: 12, top: 10, bottom: 0 }}>
            <defs>
              <linearGradient id="fillTs" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={colors.typescript} stopOpacity={0.35} />
                <stop offset="95%" stopColor={colors.typescript} stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="fillReact" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={colors.react} stopOpacity={0.25} />
                <stop offset="95%" stopColor={colors.react} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" vertical={false} />
            <XAxis
              dataKey="month"
              tick={{ fill: "#475569", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis hide />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Area
              type="monotone"
              dataKey="typescript"
              stroke={colors.typescript}
              strokeWidth={2}
              fill="url(#fillTs)"
              dot={false}
            />
            <Area type="monotone" dataKey="react" stroke={colors.react} strokeWidth={2} fill="url(#fillReact)" dot={false} />
            <Area type="monotone" dataKey="python" stroke={colors.python} strokeWidth={1.5} fillOpacity={0.08} fill={colors.python} dot={false} />
            <Area
              type="monotone"
              dataKey="node.js"
              stroke={colors["node.js"]}
              strokeWidth={1.5}
              strokeDasharray="5 5"
              fillOpacity={0.05}
              fill={colors["node.js"]}
              dot={false}
            />
            <Area type="monotone" dataKey="postgresql" stroke={colors.postgresql} strokeWidth={1.5} fillOpacity={0.08} fill={colors.postgresql} dot={false} />
          </AreaChart>
        </ChartContainer>
      </div>

      <div className="mt-3 hidden justify-between text-[11px] text-[#475569] md:flex">
        <span>Mar &apos;26</span>
        <span>Aug &apos;26 (Current)</span>
      </div>
    </motion.div>
  );
}
