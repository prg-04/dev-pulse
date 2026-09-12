import { mockMovers } from "@/lib/mock/dashboard-data";

export function BiggestMovers() {
  return (
    <div className="rounded-xl border border-[#1E293B] bg-[#0F172A] p-5">
      <div className="flex items-center justify-between">
        <h3 className="font-[var(--font-heading)] text-sm font-semibold text-white">Biggest movers</h3>
        <span className="text-[11px] text-[#475569]">MoM %</span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-4">
        <div>
          <p className="text-[11px] font-semibold tracking-widest text-[#22C55E]">RISING</p>
          <div className="mt-2 space-y-2">
            {mockMovers.rising.map((m) => (
              <div key={m.skill} className="flex items-center justify-between text-xs">
                <span className="text-white">{m.skill}</span>
                <span className="tabular-nums text-[#22C55E]">↑ {m.delta}%</span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <p className="text-[11px] font-semibold tracking-widest text-[#EF4444]">DECLINING</p>
          <div className="mt-2 space-y-2">
            {mockMovers.declining.map((m) => (
              <div key={m.skill} className="flex items-center justify-between text-xs">
                <span className="text-white">{m.skill}</span>
                <span className="tabular-nums text-[#EF4444]">↓ {Math.abs(m.delta)}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function SampleIntegrity() {
  return (
    <div className="rounded-xl border border-[#1E293B] bg-[#0F172A] p-5">
      <div className="flex items-center gap-2 text-xs font-medium text-[#94A3B8]">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#1E293B] text-[#2DD4BF]">◈</span>
        Sample Integrity
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-[#64748B]">
        Full deduplication active across HN Who Is Hiring threads and primary remote job boards. Outlier
        skills normalized against GitHub trending baseline.
      </p>
    </div>
  );
}
