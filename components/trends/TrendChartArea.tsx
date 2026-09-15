"use client";

import { useMemo } from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis, Tooltip } from "recharts";
import { ChartContainer } from "@/components/ui/chart";
import { SKILL_COLORS } from "@/lib/skills-dictionary";

type Props = {
  data: Record<string, string | number>[];
  skills: string[];
};

function CustomTooltip({
  active,
  payload,
  label,
  data,
}: {
  active?: boolean;
  payload?: Array<{ dataKey: string; value: number; color: string }>;
  label?: string;
  data: Record<string, string | number>[];
}) {
  if (!active || !payload?.length) return null;
  const firstRow = data[0];
  return (
    <div className="rounded-lg border border-[#1E293B] bg-[#0F172A] px-3 py-2.5 shadow-xl min-w-[200px]">
      <div className="mb-2 flex items-center justify-between text-[11px]">
        <span className="text-[#94A3B8]">{label} 2026</span>
        <span className="text-[#475569]">HN #4129</span>
      </div>
      <div className="space-y-1.5">
        {payload
          .slice()
          .sort((a, b) => (b.value as number) - (a.value as number))
          .map((p) => {
            const skill = p.dataKey as string;
            const color = SKILL_COLORS[skill] ?? p.color ?? "#fff";
            const firstVal = (firstRow?.[skill] as number) ?? 0;
            const currentVal = p.value as number;
            let delta: string | null = null;
            let deltaColor = "text-[#22C55E]";
            if (firstVal > 0) {
              const pct = Math.round(((currentVal - firstVal) / firstVal) * 100);
              delta = `${pct >= 0 ? "+" : ""}${pct}%`;
              if (pct < 0) deltaColor = "text-[#EF4444]";
            }
            return (
              <div key={skill} className="flex items-center justify-between gap-4 text-xs">
                <span className="flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
                  <span style={{ color }}>{skill}</span>
                </span>
                <span className="flex items-center gap-1.5 font-mono text-white">
                  {Number(p.value).toLocaleString()} {delta && <span className={deltaColor}>{delta}</span>}
                </span>
              </div>
            );
          })}
      </div>
    </div>
  );
}

export function TrendChartArea({ data, skills }: Props) {
  const maxValue = useMemo(() => {
    let max = 0;
    for (const row of data) {
      for (const s of skills) {
        const v = Number(row[s] ?? 0);
        if (v > max) max = v;
      }
    }
    return max;
  }, [data, skills]);

  const yDomain = useMemo<[number, number]>(() => {
    if (maxValue <= 0) return [0, 10];
    const ceiling = Math.ceil(maxValue * 1.15);
    const niceCeiling = Math.max(10, Math.ceil(ceiling / 10) * 10);
    return [0, niceCeiling];
  }, [maxValue]);

  const yTicks = useMemo(() => {
    const [min, max] = yDomain;
    if (max <= 10) return [0, max];
    const step = Math.max(1, Math.round(max / 5 / 10) * 10);
    const ticks: number[] = [];
    for (let v = 0; v <= max; v += step) ticks.push(v);
    if (ticks[ticks.length - 1] !== max) ticks.push(max);
    return ticks;
  }, [yDomain]);

  return (
    <div className="relative w-full">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3 text-[11px]">
        <div className="flex flex-wrap gap-3">
          {skills.map((s) => (
            <span key={s} className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ background: SKILL_COLORS[s] ?? "#64748B" }} />
              <span style={{ color: SKILL_COLORS[s] ?? "#CBD5E1" }}>{s}</span>
            </span>
          ))}
        </div>
        <span className="text-[#475569]">Mention count this month</span>
      </div>
      <div className="h-[300px] w-full">
        <ChartContainer
          config={Object.fromEntries(skills.map((s) => [s, { label: s, color: SKILL_COLORS[s] ?? "#fff" }]))}
          className="h-[300px] w-full"
        >
          <AreaChart data={data} margin={{ left: 8, right: 12, top: 10, bottom: 0 }}>
            <defs>
              {skills.map((s) => (
                <linearGradient key={s} id={`fill-${s}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={SKILL_COLORS[s] ?? "#64748B"} stopOpacity={0.35} />
                  <stop offset="95%" stopColor={SKILL_COLORS[s] ?? "#64748B"} stopOpacity={0.03} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" vertical={false} />
            <XAxis
              dataKey="month"
              tick={{ fill: "#475569", fontSize: 11 }}
              axisLine={{ stroke: "#1E293B" }}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: "#475569", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              domain={yDomain}
              ticks={yTicks}
              width={36}
            />
            <Tooltip content={<CustomTooltip data={data} />} cursor={{ stroke: "#1E293B", strokeDasharray: "3 3" }} />
            {skills.map((s) => (
              <Area
                key={s}
                type="monotone"
                dataKey={s}
                stroke={SKILL_COLORS[s] ?? "#64748B"}
                strokeWidth={2}
                fill={`url(#fill-${s})`}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, fill: "#070A14", stroke: SKILL_COLORS[s] }}
              />
            ))}
          </AreaChart>
        </ChartContainer>
      </div>
    </div>
  );
}
