"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, Menu, X } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Dashboard", match: (p: string) => p === "/" },
  { href: "/trends", label: "Trends", match: (p: string) => p.startsWith("/trends") },
  { href: "/jobs", label: "Jobs", match: (p: string) => p.startsWith("/jobs") },
  { href: "/gap-report", label: "Gap Report", match: (p: string) => p.startsWith("/gap-report") },
  { href: "/profile", label: "Profile", match: (p: string) => p.startsWith("/profile") },
];

// Initials for the avatar fallback: full_name first/last initials when present,
// otherwise the first two alphanumerics of the auth email local-part.
function initialsFor(name: string | null | undefined, email: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  const local = (email ?? "").split("@")[0].replace(/[^a-zA-Z0-9]/g, "");
  return (local.slice(0, 2) || "?").toUpperCase();
}

export function AppHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  // undefined = still loading (show placeholder, avoid layout shift);
  // string = handle on file; null = none (or fetch failed)
  const [githubUsername, setGithubUsername] = useState<string | null | undefined>(undefined);
  const [imgFailed, setImgFailed] = useState(false);
  const [fallbackInitials, setFallbackInitials] = useState("?");

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      fetch("/api/profile")
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (cancelled) return;
          const typed = data as {
            profile?: { github_username?: string | null; full_name?: string | null } | null;
            email?: string | null;
          } | null;
          const handle = typed?.profile?.github_username ?? null;
          setGithubUsername(handle || null);
          setFallbackInitials(initialsFor(typed?.profile?.full_name, typed?.email));
        })
        .catch(() => {
          if (!cancelled) setGithubUsername(null);
        });
    };
    refresh();
    // Re-fetch after ProfileClient saves (header otherwise shows stale
    // handle/initials until a full reload).
    window.addEventListener("devpulse:profile-updated", refresh);
    return () => {
      cancelled = true;
      window.removeEventListener("devpulse:profile-updated", refresh);
    };
  }, []);

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
              "hidden h-7 w-7 items-center justify-center overflow-hidden rounded-full bg-[#0F172A] ring-1 md:flex",
              pathname.startsWith("/profile") ? "ring-[#14B8A6] text-[#14B8A6]" : "ring-[#1E293B] text-[#14B8A6]"
            )}
          >
            {githubUsername && !imgFailed ? (
              <img
                src={`https://github.com/${encodeURIComponent(githubUsername)}.png`}
                alt="Profile"
                className="h-7 w-7 rounded-full object-cover"
                onError={() => setImgFailed(true)}
              />
            ) : (
              <span
                aria-hidden="true"
                className="flex h-7 w-7 items-center justify-center rounded-full bg-[#14B8A6]/15 text-[10px] font-bold tracking-wide text-[#2DD4BF] ring-1 ring-inset ring-[#14B8A6]/30"
              >
                {fallbackInitials}
              </span>
            )}
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
