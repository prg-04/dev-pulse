type Props = { sources: { name: string; count: number; pct: number; color: string }[] };

export function SourcesCard({ sources }: Props) {
  return (
    <div className="rounded-xl border border-[#1E293B] bg-[#0F172A] p-5">
      <div className="flex items-center justify-between">
        <h3 className="font-[var(--font-heading)] text-sm font-semibold text-white">Sources this month</h3>
        <span className="text-[11px] text-[#475569]">10 ingest pipelines</span>
      </div>
      <div className="mt-4 space-y-4">
        {sources.map((s) => (
          <div key={s.name}>
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-white">{s.name}</span>
              <span className="text-[#94A3B8] tabular-nums">
                {s.count.toLocaleString()} ({s.pct}%)
              </span>
            </div>
            <div className="mt-1.5 h-1.5 w-full rounded-full bg-[#1E293B]">
              <div
                className="h-1.5 rounded-full"
                style={{ width: `${s.pct}%`, background: s.color }}
              />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-5 flex items-center justify-between border-t border-[#1E293B] pt-3 text-[11px]">
        <span className="text-[#475569]">Aggregation protocol</span>
        <span className="font-mono text-[#2DD4BF]">v2.4.1-rc</span>
      </div>
    </div>
  );
}
