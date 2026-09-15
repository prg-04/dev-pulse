"use client";

type Strength = { skill: string; count: number };

export function StrengthsCard({ strengths, summary }: { strengths: Strength[]; summary: string }) {
  return (
    <div className="rounded-xl border border-[#1E293B] bg-[#0F172A] p-5 border-l-2 border-l-[#22C55E] border-y-[#1E293B] border-r-[#1E293B]">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-[#22C55E]">
          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[#22C55E]/20 text-[10px]">✔</span>
          Your strengths
        </h3>
        <span className="text-[11px] text-[#475569]">{strengths.length} verified core matches</span>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {strengths.map((s, index) => (
          <span
            key={`${s.skill}-${index}`}
            className="rounded border border-[#22C55E]/30 bg-[#22C55E]/15 px-2 py-1 text-[11px] text-[#86EFAC]"
          >
            {s.skill} <span className="text-[#22C55E]">({s.count.toLocaleString()})</span>
          </span>
        ))}
      </div>

      <p className="mt-3 text-xs leading-relaxed text-[#94A3B8]">{summary}</p>
    </div>
  );
}
