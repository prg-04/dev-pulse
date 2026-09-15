"use client";

import { useRef, useState } from "react";
import { LessonTheater } from "./LessonTheater";

type Tutorial = {
  video_id: string;
  video_title: string;
  channel_name: string;
  view_count: number | null;
  start_seconds: number;
  chapter_label?: string;
  starts_at?: string;
  duration_label?: string;
};

function formatViews(n: number | null) {
  if (!n) return "";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M views`;
  if (n >= 1_000) return `${Math.round(n / 1000)}K views`;
  return `${n} views`;
}

function formatMMSS(s: number) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export function TutorialCard({
  tutorial,
  defaultExpanded = false,
}: {
  tutorial: Tutorial;
  defaultExpanded?: boolean;
}) {
  const [theaterOpen, setTheaterOpen] = useState(defaultExpanded);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const thumb = `https://img.youtube.com/vi/${tutorial.video_id}/hqdefault.jpg`;
  const isChapter = Boolean(tutorial.chapter_label);

  const handleClose = () => {
    setTheaterOpen(false);
    setTimeout(() => triggerRef.current?.focus(), 50);
  };

  return (
    <>
      <div className="overflow-hidden rounded-lg border border-[#1E293B] bg-[#0F172A]">
        <button
          ref={triggerRef}
          onClick={() => setTheaterOpen(true)}
          className="flex w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-white/[0.03]"
          aria-haspopup="dialog"
        >
          <div className="relative h-12 w-20 shrink-0 overflow-hidden rounded bg-[#070A14]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={thumb} alt="" className="h-full w-full object-cover" />
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-[10px] text-white">▶</span>
            </span>
            {tutorial.duration_label && (
              <span className="absolute bottom-0.5 right-0.5 rounded bg-black/80 px-1 py-0.5 text-[9px] font-mono text-white">
                {tutorial.duration_label}
              </span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium text-white">{tutorial.video_title}</p>
            <p className="mt-0.5 truncate text-[11px] text-[#64748B]">
              {tutorial.channel_name} · {formatViews(tutorial.view_count)} · Starts at{" "}
              {tutorial.starts_at ?? formatMMSS(tutorial.start_seconds)}
            </p>
          </div>
          <span className="flex shrink-0 items-center gap-1.5">
            {isChapter && (
              <span className="hidden rounded border border-[#14B8A6]/30 bg-[#14B8A6]/15 px-1.5 py-0.5 text-[9px] font-medium text-[#2DD4BF] sm:inline">
                {tutorial.chapter_label}
              </span>
            )}
            <span className="text-[#475569]">›</span>
          </span>
        </button>
      </div>

      <LessonTheater tutorial={tutorial} open={theaterOpen} onClose={handleClose} />
    </>
  );
}
