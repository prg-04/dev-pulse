"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, Menu, X } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Dashboard", match: (p: string) => p === "/" },
  { href: "/trends", label: "Trends", match: (p: string) => p.startsWith("/trends") },
  { href: "/jobs", label: "Jobs", match: (p: string) => p.startsWith("/jobs") },
  { href: "/gap-report", label: "Gap Report", match: (p: string) => p.startsWith("/gap-report") },
  { href: "/profile", label: "Profile", match: (p: string) => p.startsWith("/profile") },
];

export function AppHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b border-[#1E293B] bg-[#070A14]/95 backdrop-blur">
      <div className="mx-auto flex h-[52px] max-w-[1280px] items-center justify-between px-6">
        <div className="flex items-center gap-8">
          <Link href="/" className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-[#14B8A6]" />
            <span className="text-sm font-bold tracking-tight text-white">DevPulse</span>
          </Link>
          <nav className="hidden items-center gap-6 md:flex" aria-label="Primary">
            {NAV.slice(0, 4).map((item) => {
              const active = item.match(pathname);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "relative py-3 text-sm transition-colors",
                    active ? "font-medium text-white after:absolute after:bottom-0 after:left-0 after:h-[2px] after:w-full after:bg-[#14B8A6] after:content-['']" : "text-[#64748B] hover:text-white"
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-3">
          <span className="hidden items-center gap-1.5 text-xs text-[#64748B] md:flex">
            <span className="h-1.5 w-1.5 rounded-full bg-[#22C55E] animate-pulse" /> Live
          </span>
          <div className="hidden h-4 w-px bg-[#1E293B] md:block" />
          <Link
            href="/profile"
            aria-label="Profile"
            className={cn(
              "hidden h-7 w-7 items-center justify-center rounded-full bg-[#0F172A] ring-1 md:flex",
              pathname.startsWith("/profile") ? "ring-[#14B8A6] text-[#14B8A6]" : "ring-[#1E293B] text-[#14B8A6]"
            )}
          >
            <Activity className="h-3.5 w-3.5" />
          </Link>

          <button className="md:hidden text-[#94A3B8]" onClick={() => setOpen(!open)} aria-label="Toggle menu">
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {open && (
        <div className="border-t border-[#1E293B] bg-[#070A14] px-6 py-3 md:hidden">
          <nav className="flex flex-col gap-2">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className={cn("py-1.5 text-sm", item.match(pathname) ? "text-white font-medium" : "text-[#64748B]")}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      )}
    </header>
  );
}
