"use client";

type Item = { skill: string; delta: number };

export function DecliningCard({ items, summary }: { items: Item[]; summary: string }) {
  return (
    <div className="rounded-xl border border-[#1E293B] bg-[#0F172A] p-5 border-l-2 border-l-[#F59E0B]">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-[#F59E0B]">
          <span className="text-[#F59E0B]">↘</span> Declining in demand
        </h3>
        <span className="text-[11px] text-[#475569]">Legacy substitution trend</span>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {items.map((r) => (
          <span
            key={r.skill}
            className="rounded border border-[#F59E0B]/30 bg-[#F59E0B]/15 px-2 py-1 text-[11px] text-[#FCD34D]"
          >
            {r.skill} <span className="text-[#F59E0B]">({r.delta}%)</span>
          </span>
        ))}
      </div>

      <p className="mt-3 text-xs leading-relaxed text-[#94A3B8]">{summary}</p>
    </div>
  );
}
