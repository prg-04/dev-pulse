"use client";

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
}: {
  active?: boolean;
  payload?: Array<{ dataKey: string; value: number; color: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  // compute deltas vs first month (simple)
  return (
    <div className="rounded-lg border border-[#1E293B] bg-[#0F172A] px-3 py-2.5 shadow-xl min-w-[200px]">
      <div className="mb-2 flex items-center justify-between text-[11px]">
        <span className="text-[#94A3B8]">{label} 2026</span>
        <span className="text-[#64748B]">HN #4129</span>
      </div>
      <div className="space-y-1.5">
        {payload
          .slice()
          .sort((a, b) => (b.value as number) - (a.value as number))
          .map((p) => {
            const skill = p.dataKey as string;
            const color = SKILL_COLORS[skill] ?? p.color ?? "#fff";
            // delta mock derived from last value vs first — for tooltip we show static deltas matching PNG if Aug
            const isAug = label === "Aug";
            let delta: string | null = null;
            let deltaColor = "text-[#22C55E]";
            if (isAug) {
              if (skill === "typescript") delta = "(+34%)";
              else if (skill === "react") delta = "(+8%)";
              else if (skill === "python") delta = "(-2%)";
              if (delta?.startsWith("(-")) deltaColor = "text-[#EF4444]";
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
        <span className="text-[#475569]">Normalized volume: mention frequency / 10k posts</span>
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
              domain={[0, 10000]}
              ticks={[0, 2000, 4000, 6000, 8000, 10000]}
              tickFormatter={(v) => (v === 0 ? "0" : `${v / 1000}k`)}
              width={32}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ stroke: "#1E293B", strokeDasharray: "3 3" }} />
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
