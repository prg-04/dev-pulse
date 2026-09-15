"use client";

import { useMemo, useEffect, useState } from "react";
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
  initialSkills: string[];
  marketMovers: { rising: { skill: string; delta: number }[]; declining: { skill: string; delta: number }[] };
};

type FetchedPayload = {
  rows: Record<string, string | number>[];
  months: string[];
};

function sliceForRange(range: Range, rows: Record<string, string | number>[], skills: string[]) {
  return rows.map((row) => {
    const out: Record<string, string | number> = { month: row.month };
    skills.forEach((s) => {
      out[s] = row[s] as number;
    });
    return out;
  });
}

export function TrendsClient({ initialData, initialSkills, marketMovers }: Props) {
  const [selected, setSelected] = useState<string[]>(initialSkills);
  const [range, setRange] = useState<Range>("6M");
  const [data, setData] = useState<FetchedPayload>({ rows: initialData["12M"], months: [] });
  const [loading, setLoading] = useState(false);
  const [lastSkills, setLastSkills] = useState<string[]>(initialSkills);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLastSkills(selected);

    const params = new URLSearchParams();
    params.set("skills", selected.join(","));
    const url = `/api/trends?${params.toString()}`;
    console.log("[trends] fetch", url, "skills=", selected);
    fetch(url)
      .then((r) => {
        console.log("[trends] response status", r.status, r.statusText);
        return r.ok ? r.json() : null;
      })
      .then((json: FetchedPayload | null) => {
        if (cancelled || !json) return;
        console.log("[trends] received rows", json.rows.length, "skills in first row", Object.keys(json.rows[0] ?? {}));
        setData(json);
      })
      .catch((err) => {
        console.log("[trends] fetch error", err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selected]);

  const chartData = useMemo(() => sliceForRange(range, data.rows, selected), [range, data.rows, selected]);

  // Build cards from latest month data
  const cards = useMemo(() => {
    const latest = chartData[chartData.length - 1];
    const prev = chartData[chartData.length - 2];
    if (!latest) return [];
    const maxCount = Math.max(...selected.map((s) => (latest[s] as number) ?? 0));
    return selected.map((skill, idx) => {
      const count = (latest[skill] as number) ?? 0;
      const prevCount = (prev?.[skill] as number) ?? count;
      const delta = prevCount ? Math.round(((count - prevCount) / prevCount) * 100) : 0;
      const spark = chartData.map((r) => ({ v: (r[skill] as number) ?? 0 }));
      const peakIdx = spark.reduce((maxIdx, cur, i, arr) => (cur.v > arr[maxIdx].v ? i : maxIdx), 0);
      const peakMonth = (chartData[peakIdx]?.month as string) ?? "Aug";
      const vol = maxCount > 0 ? Math.round((count / maxCount) * 100) : 0;
      return {
        skill,
        rank: idx + 1,
        count,
        delta,
        peak: `${peakMonth}`,
        vol: `${vol}`,
        spark,
      };
    });
  }, [chartData, selected]);

  return (
    <div className="space-y-6">
      {/* Skill selector + range toggle row */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex-1 lg:max-w-[620px]">
          <SkillSelector selected={selected} onChange={setSelected} max={15} />
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
        {loading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-40 animate-pulse rounded-xl border border-[#1E293B] bg-[#0F172A]" />
            ))}
          </div>
        ) : (
          <TrendChartArea data={chartData} skills={selected} />
        )}
      </motion.div>

      {/* Stat cards */}
      <TrendStatCards cards={cards} />

      {/* AI intelligence */}
      <AITrendIntelligence
        skills={selected}
        range={range}
        data={chartData}
        defaultSkills={initialSkills}
        marketMovers={marketMovers}
      />
    </div>
  );
}
