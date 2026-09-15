"use client";

export function RecommendationsCard({ items }: { items: string[] }) {
  return (
    <div className="rounded-xl border border-[#134E4A] bg-[#0a2e2a] p-5">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-[13px] font-semibold text-[#2DD4BF]">
          <span className="flex h-4 w-4 items-center justify-center rounded-full border border-[#2DD4BF]/40 text-[10px]">◎</span>
          Recommendations
        </h3>
        <span className="text-[11px] tracking-widest text-[#2DD4BF]/70">ACTIONABLE NEXT STEPS</span>
      </div>

      <ol className="mt-4 space-y-3">
        {items.map((text, idx) => (
          <li key={idx} className="flex gap-3 text-xs leading-relaxed text-[#CBD5E1]">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-[#2DD4BF]/30 bg-[#134E4A] text-[11px] font-mono text-[#2DD4BF]">
              {idx + 1}
            </span>
            <span>{text}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
