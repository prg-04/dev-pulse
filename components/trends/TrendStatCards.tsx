"use client";

import { motion } from "framer-motion";
import { Area, AreaChart, ResponsiveContainer } from "recharts";
import { SKILL_COLORS } from "@/lib/skills-dictionary";

type CardData = {
  skill: string;
  rank: number;
  count: number;
  delta: number;
  peak: string;
  vol: string;
  spark: { v: number }[];
};

type Props = {
  cards: CardData[];
};

export function TrendStatCards({ cards }: Props) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      {cards.map((c, idx) => {
        const color = SKILL_COLORS[c.skill] ?? "#2DD4BF";
        const isPositive = c.delta >= 0;
        return (
          <motion.div
            key={c.skill}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: idx * 0.08 }}
            className="rounded-xl border border-[#1E293B] bg-[#0F172A] p-4"
            style={{ borderTopColor: color, borderTopWidth: 2 }}
          >
            <div className="flex items-start justify-between">
              <span className="text-xs font-medium" style={{ color }}>
                {c.skill}
              </span>
              <span className="text-[11px] text-[#475569]">Rank #{c.rank}</span>
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="font-[var(--font-heading)] text-[22px] font-bold text-white">
                {c.count.toLocaleString()}
              </span>
              <span className="text-[11px] text-[#64748B]">mentions this month</span>
            </div>
            <div className={`mt-1 flex items-center gap-1 text-xs ${isPositive ? "text-[#22C55E]" : "text-[#EF4444]"}`}>
              <span className="text-[10px]">{isPositive ? "▲" : "▼"}</span>
              <span>
                {isPositive ? "+" : ""}
                {c.delta}% vs last month
              </span>
            </div>
            <div className="mt-3 h-[36px] w-full border-t border-[#1E293B] pt-2">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={c.spark}>
                  <defs>
                    <linearGradient id={`spark-${c.skill}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={color} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={color} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <Area
                    type="monotone"
                    dataKey="v"
                    stroke={color}
                    strokeWidth={1.5}
                    fill={`url(#spark-${c.skill})`}
                    dot={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-2 flex justify-between text-[11px] text-[#475569]">
              <span>Peak: {c.peak}</span>
              <span>Vol: {c.vol}/100</span>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}
