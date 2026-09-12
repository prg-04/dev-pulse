"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity } from "lucide-react";
import { cn } from "@/lib/utils";

export function DashboardHeader() {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);
  return (
    <header className="sticky top-0 z-50 border-b border-[#1E293B] bg-[#070A14]/95 backdrop-blur">
      <div className="mx-auto flex h-[52px] max-w-[1280px] items-center justify-between px-6">
        <div className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-[#14B8A6]" />
          <span className="text-sm font-bold tracking-tight text-white">DevPulse</span>
        </div>
        <nav className="hidden items-center gap-6 md:flex">
          <Link
            href="/"
            className={cn(
              "relative py-3 text-sm transition-colors",
              isActive("/")
                ? "font-medium text-white after:absolute after:bottom-0 after:left-0 after:h-[2px] after:w-full after:bg-[#14B8A6] after:content-['']"
                : "text-[#64748B] hover:text-white"
            )}
          >
            Dashboard
          </Link>
          <Link
            href="/trends"
            className={cn(
              "relative py-3 text-sm transition-colors",
              isActive("/trends")
                ? "font-medium text-white after:absolute after:bottom-0 after:left-0 after:h-[2px] after:w-full after:bg-[#14B8A6] after:content-['']"
                : "text-[#64748B] hover:text-white"
            )}
          >
            Trends
          </Link>
          <Link href="#" className="py-3 text-sm text-[#64748B] hover:text-white transition-colors">
            Gap Report
          </Link>
        </nav>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-xs text-[#64748B]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#22C55E] animate-pulse" />
            Live
          </span>
          <div className="hidden h-4 w-px bg-[#1E293B] md:block" />
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[#0F172A] ring-1 ring-[#1E293B]">
            <Activity className="h-3.5 w-3.5 text-[#14B8A6]" />
          </div>
        </div>
      </div>
    </header>
  );
}
