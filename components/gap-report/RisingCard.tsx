"use client";

type Item = { skill: string; delta: number };

export function RisingCard({ items, summary }: { items: Item[]; summary: string }) {
  return (
    <div className="rounded-xl border border-[#1E293B] bg-[#0F172A] p-5 border-l-2 border-l-[#14B8A6]">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-[#14B8A6]">
          <span className="text-[#14B8A6]">↗</span> Rising in demand
        </h3>
        <span className="text-[11px] text-[#475569]">Q3 velocity index</span>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {items.map((r) => (
          <span
            key={r.skill}
            className="rounded border border-[#22C55E]/30 bg-[#22C55E]/15 px-2 py-1 text-[11px] text-[#86EFAC]"
          >
            {r.skill} <span className="text-[#22C55E]">(+{r.delta}%)</span>
          </span>
        ))}
      </div>

      <p className="mt-3 text-xs leading-relaxed text-[#94A3B8]">{summary}</p>
    </div>
  );
}
