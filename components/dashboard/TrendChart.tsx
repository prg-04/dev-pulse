"use client";

import { useMemo, useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Sparkles } from "lucide-react";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { SKILL_COLORS } from "@/lib/skills-dictionary";
import { cn } from "@/lib/utils";

type Range = "3M" | "6M" | "12M";

type Props = {
  data: Record<string, string | number>[];
  skills: string[];
};

export function TrendChart({ data, skills }: Props) {
  const [range, setRange] = useState<Range>("6M");
  const [summary, setSummary] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const chartData = useMemo(() => {
    if (!data.length) return [];
    const sliceMap: Record<Range, number> = { "3M": 3, "6M": 6, "12M": 12 };
    const sliceLen = sliceMap[range];
    return data.slice(-sliceLen);
  }, [data, range]);

  useEffect(() => {
    if (skills.length === 0 || chartData.length === 0) return;
    let cancelled = false;
    async function fetchSummary() {
      setLoading(true);
      try {
        const res = await fetch("/api/trends-summary", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ skills, range, data: chartData }),
        });
        if (!res.ok) throw new Error("failed");
        const json = await res.json() as { summary?: string };
        if (!cancelled && json.summary) setSummary(json.summary);
      } catch {
        // keep previous summary or null
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    fetchSummary();
    return () => { cancelled = true; };
  }, [skills, range, chartData]);

  const colors = useMemo(() => {
    const out: Record<string, string> = {};
    skills.forEach((s) => {
      out[s] = SKILL_COLORS[s] ?? "#64748B";
    });
    return out;
  }, [skills]);

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
          <p className="text-[11px] text-[#64748B]">Top {skills.length} skills — click any skill above to compare</p>
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

      {summary && (
        <div className="mt-4 flex items-start gap-2 rounded-md border border-[#1E293B] bg-[#070A14]/60 px-3 py-2.5">
          <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#2DD4BF]" />
          <p className="text-xs italic leading-relaxed text-[#94A3B8]">
            {loading ? "Generating…" : summary}
          </p>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-3 text-[11px]">
        {skills.map((s) => (
          <span key={s} className="flex items-center gap-1.5 text-[#CBD5E1]">
            <span className="h-2 w-2 rounded-full" style={{ background: colors[s] }} />
            {s}
          </span>
        ))}
      </div>

      <div className="mt-4 h-[260px] w-full">
        <ChartContainer
          config={Object.fromEntries(skills.map((s) => [s, { label: s, color: colors[s] }]))}
          className="h-[260px] w-full"
        >
          <AreaChart data={chartData} margin={{ left: 8, right: 12, top: 10, bottom: 0 }}>
            <defs>
              {skills.map((s) => (
                <linearGradient key={s} id={`fill-${s}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={colors[s]} stopOpacity={0.35} />
                  <stop offset="95%" stopColor={colors[s]} stopOpacity={0.02} />
                </linearGradient>
              ))}
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
            {skills.map((s) => (
              <Area
                key={s}
                type="monotone"
                dataKey={s}
                stroke={colors[s]}
                strokeWidth={2}
                fill={`url(#fill-${s})`}
                dot={false}
              />
            ))}
          </AreaChart>
        </ChartContainer>
      </div>

      <div className="mt-3 hidden justify-between text-[11px] text-[#475569] md:flex">
        <span>{chartData[0]?.month ?? ""}</span>
        <span>{chartData[chartData.length - 1]?.month ?? ""} (Current)</span>
      </div>
    </motion.div>
  );
}
