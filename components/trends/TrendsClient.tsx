"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { SkillSelector } from "./SkillSelector";
import { TrendChartArea } from "./TrendChartArea";
import { TrendStatCards } from "./TrendStatCards";
import { AITrendIntelligence } from "./AITrendIntelligence";
import { cn } from "@/lib/utils";

type Range = "3M" | "6M" | "12M";

type Props = {
  initialData: {
    "3M": Record<string, string | number>[];
    "6M": Record<string, string | number>[];
    "12M": Record<string, string | number>[];
  };
};



function sliceForRange(range: Range, data: Props["initialData"], skills: string[]) {
  return data[range].map((row) => {
    const out: Record<string, string | number> = { month: row.month };
    skills.forEach((s) => {
      out[s] = row[s] as number;
    });
    return out;
  });
}

export function TrendsClient({ initialData }: Props) {
  const [selected, setSelected] = useState<string[]>(["typescript", "react", "python"]);
  const [range, setRange] = useState<Range>("6M");

  const chartData = useMemo(() => sliceForRange(range, initialData, selected), [range, initialData, selected]);

  // Build cards from latest month data
  const cards = useMemo(() => {
    const latest = chartData[chartData.length - 1];
    const prev = chartData[chartData.length - 2];
    if (!latest) return [];
    return selected.map((skill, idx) => {
      const count = (latest[skill] as number) ?? 0;
      const prevCount = (prev?.[skill] as number) ?? count;
      const delta = prevCount ? Math.round(((count - prevCount) / prevCount) * 100) : 0;
      // spark data
      const spark = chartData.map((r) => ({ v: (r[skill] as number) ?? 0 }));
      const peakIdx = spark.reduce((maxIdx, cur, i, arr) => (cur.v > arr[maxIdx].v ? i : maxIdx), 0);
      const peakMonth = (chartData[peakIdx]?.month as string) ?? "Aug";
      // mock vol score based on count
      const vol = skill === "typescript" ? "94.2" : skill === "react" ? "88.1" : "80.4";
      return {
        skill,
        rank: idx + 1,
        count,
        delta,
        peak: `${peakMonth} 2026`,
        vol,
        spark,
      };
    });
  }, [chartData, selected]);

  return (
    <div className="space-y-6">
      {/* Skill selector + range toggle row */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex-1 lg:max-w-[620px]">
          <SkillSelector selected={selected} onChange={setSelected} max={5} />
        </div>
        <div className="flex items-center gap-2 self-start rounded-lg border border-[#1E293B] bg-[#0F172A] p-1">
          {(["3M", "6M", "12M"] as Range[]).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                range === r
                  ? "bg-[#14B8A6]/20 text-[#2DD4BF] ring-1 ring-[#14B8A6]/40"
                  : "text-[#64748B] hover:text-white"
              )}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      {/* Chart card */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="rounded-xl border border-[#1E293B] bg-[#0F172A] p-4 md:p-5"
      >
        <TrendChartArea data={chartData} skills={selected} />
      </motion.div>

      {/* Stat cards */}
      <TrendStatCards cards={cards} />

      {/* AI intelligence */}
      <AITrendIntelligence skills={selected} range={range} data={chartData} />
    </div>
  );
}
