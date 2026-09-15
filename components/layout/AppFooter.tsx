export function AppFooter({ lastUpdate }: { lastUpdate?: string | null }) {
  const label = lastUpdate ? new Date(lastUpdate).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "2 hours ago";
  return (
    <footer className="mt-8 border-t border-[#1E293B] py-4">
      <div className="mx-auto flex max-w-[1280px] flex-col items-center justify-between gap-1 px-6 text-[11px] text-[#475569] md:flex-row">
        <span>Data refreshed daily · Last update: {label} · 10 sources</span>
        <span>DevPulse Terminal v2.4.0</span>
      </div>
    </footer>
  );
}
