"use client";

/* eslint-disable react-hooks/set-state-in-effect -- theater state sync on open/mount is intentional */
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";

type Tutorial = {
  video_id: string;
  video_title: string;
  channel_name: string;
  view_count: number | null;
  start_seconds: number;
  chapter_label?: string;
  duration_label?: string;
};

type LessonSection = {
  start_seconds: number;
  heading: string;
  key_points: string[];
  code_example?: string | null;
};

type VideoLesson = {
  video_id: string;
  sections: LessonSection[];
  summary: string | null;
  generated_at: string;
  model: string;
};

function formatMMSS(s: number) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

declare global {
  interface Window {
    YT?: {
      Player: new (
        elementId: string,
        options: { events?: { onReady?: (e: { target: YTPlayer }) => void } }
      ) => YTPlayer;
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

type YTPlayer = {
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  getCurrentTime: () => number;
};

let ytApiPromise: Promise<void> | null = null;

function loadYouTubeIframeAPI(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.YT?.Player) return Promise.resolve();
  if (ytApiPromise) return ytApiPromise;
  ytApiPromise = new Promise<void>((resolve) => {
    const existing = document.querySelector('script[src="https://www.youtube.com/iframe_api"]');
    if (existing) {
      const check = setInterval(() => {
        if (window.YT?.Player) {
          clearInterval(check);
          resolve();
        }
      }, 100);
      return;
    }
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (prev) prev();
      resolve();
    };
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    s.async = true;
    document.head.appendChild(s);
  });
  return ytApiPromise;
}

const lessonCache = new Map<string, VideoLesson>();
const lessonErrorCache = new Map<string, string>();

export function LessonTheater({
  tutorial,
  open,
  onClose,
}: {
  tutorial: Tutorial;
  open: boolean;
  onClose: () => void;
}) {
  const [lesson, setLesson] = useState<VideoLesson | null>(null);
  const [lessonLoading, setLessonLoading] = useState(false);
  const [lessonError, setLessonError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(tutorial.start_seconds);
  const [mounted, setMounted] = useState(false);
  const [videoUnavailable, setVideoUnavailable] = useState(false);

  const playerRef = useRef<YTPlayer | null>(null);
  const uid = useId();
  const iframeId = `yt-theater-${tutorial.video_id}-${uid.replace(/:/g, "")}`;
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const thumb = `https://img.youtube.com/vi/${tutorial.video_id}/hqdefault.jpg`;

  const isChapter = Boolean(tutorial.chapter_label);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    const prevPaddingRight = document.body.style.paddingRight;
    const scrollbarW = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = "hidden";
    if (scrollbarW > 0) document.body.style.paddingRight = `${scrollbarW}px`;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleEsc);
    // focus close button for accessibility
    setTimeout(() => closeBtnRef.current?.focus(), 100);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.body.style.paddingRight = prevPaddingRight;
      window.removeEventListener("keydown", handleEsc);
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [open, onClose]);

  const fetchLesson = useCallback(async () => {
    if (lessonCache.has(tutorial.video_id)) {
      setLesson(lessonCache.get(tutorial.video_id)!);
      setLessonError(null);
      return;
    }
    if (lessonErrorCache.has(tutorial.video_id)) {
      setLessonError(lessonErrorCache.get(tutorial.video_id)!);
      return;
    }
    setLessonLoading(true);
    setLessonError(null);
    try {
      const res = await fetch(`/api/tutorial-lessons/${tutorial.video_id}`);
      if (res.status === 404) {
        const msg = "Notes not available for this video";
        lessonErrorCache.set(tutorial.video_id, msg);
        setLessonError(msg);
        setLesson(null);
        return;
      }
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error((j as { error?: string }).error ?? `Failed: ${res.status}`);
      }
      const data = (await res.json()) as VideoLesson;
      lessonCache.set(tutorial.video_id, data);
      setLesson(data);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load lesson";
      lessonErrorCache.set(tutorial.video_id, msg);
      setLessonError(msg);
    } finally {
      setLessonLoading(false);
    }
  }, [tutorial.video_id]);

  useEffect(() => {
    if (open) {
      setCurrentTime(tutorial.start_seconds);
      void fetchLesson();
    }
  }, [open, tutorial.start_seconds, fetchLesson]);

  useEffect(() => {
    if (!open) {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
      return;
    }
    let cancelled = false;
    loadYouTubeIframeAPI()
      .then(() => {
        if (cancelled || !window.YT?.Player) return;
        try {
          playerRef.current = new window.YT.Player(iframeId, {
            events: { onReady: (e) => { playerRef.current = e.target; } },
          });
        } catch {
          playerRef.current = null;
        }
      })
      .catch(() => {});
    pollRef.current = setInterval(() => {
      try {
        const p = playerRef.current;
        if (p?.getCurrentTime) {
          const t = p.getCurrentTime();
          if (Number.isFinite(t) && t > 0) setCurrentTime(Math.floor(t));
        }
      } catch {}
    }, 700);
    return () => {
      cancelled = true;
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [open, iframeId]);

  const handleSeek = useCallback(
    (seconds: number) => {
      try {
        const p = playerRef.current;
        if (p?.seekTo) {
          p.seekTo(seconds, true);
          setCurrentTime(seconds);
          return;
        }
      } catch {}
      const iframe = document.getElementById(iframeId) as HTMLIFrameElement | null;
      if (iframe?.contentWindow) {
        iframe.contentWindow.postMessage(
          JSON.stringify({ event: "command", func: "seekTo", args: [seconds, true] }),
          "https://www.youtube.com"
        );
        setCurrentTime(seconds);
        return;
      }
      const el = document.getElementById(iframeId) as HTMLIFrameElement | null;
      if (el) {
        const url = new URL(el.src);
        url.searchParams.set("start", String(seconds));
        el.src = url.toString();
        setCurrentTime(seconds);
      }
    },
    [iframeId]
  );

  const activeSectionIdx = (() => {
    if (!lesson?.sections?.length) return -1;
    let idx = -1;
    for (let i = 0; i < lesson.sections.length; i++) {
      if (currentTime >= lesson.sections[i].start_seconds) idx = i;
      else break;
    }
    return idx;
  })();

  const embedSrc = `https://www.youtube.com/embed/${tutorial.video_id}?start=${tutorial.start_seconds}&autoplay=1&enablejsapi=1${origin ? `&origin=${encodeURIComponent(origin)}` : ""}`;

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-50 flex flex-col bg-[#020617]"
          aria-modal="true"
          role="dialog"
        >
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="flex h-[100dvh] w-screen flex-col overflow-hidden bg-[#020617]"
          >
            <div className="flex items-center justify-between border-b border-[#1E293B] px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-white">{tutorial.video_title}</p>
                <p className="truncate text-xs text-[#64748B]">
                  {tutorial.channel_name} {isChapter ? `· ${tutorial.chapter_label}` : ""}
                </p>
              </div>
              <button
                ref={closeBtnRef}
                onClick={onClose}
                aria-label="Close theater"
                className="ml-3 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#1E293B] bg-[#1E293B] text-[#94A3B8] transition-colors hover:bg-[#0F172A] hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="grid min-h-0 flex-1 grid-cols-1 gap-0 lg:grid-cols-[1.55fr_0.95fr]">
              <div className="flex min-h-0 min-w-0 flex-col overflow-y-auto overflow-x-hidden bg-[#020617]">
                <div className="relative aspect-video w-full shrink-0 bg-black">
                  {!videoUnavailable ? (
                    <iframe
                      id={iframeId}
                      src={embedSrc}
                      title={tutorial.video_title}
                      allow="autoplay; encrypted-media"
                      allowFullScreen
                      className="absolute inset-0 h-full w-full"
                      onError={() => setVideoUnavailable(true)}
                    />
                  ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#0F172A] p-6 text-center">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={thumb} alt="" className="h-20 w-36 rounded object-cover opacity-60" />
                      <p className="text-sm font-medium text-white">Video unavailable</p>
                      <p className="max-w-sm text-xs leading-relaxed text-[#94A3B8]">This YouTube video is unavailable or has been removed. The AI notes below were generated from its transcript before removal and remain viewable.</p>
                      <a href={`https://www.youtube.com/watch?v=${tutorial.video_id}`} target="_blank" rel="noopener noreferrer" className="rounded-full border border-[#1E293B] bg-[#020617] px-3 py-1 text-xs text-[#94A3B8] hover:text-white">Open on YouTube</a>
                    </div>
                  )}
                  {isChapter && (
                    <span className="pointer-events-none absolute bottom-3 left-3 rounded border border-[#14B8A6]/30 bg-black/60 px-2 py-1 text-[11px] font-medium text-[#2DD4BF] backdrop-blur">
                      {tutorial.chapter_label}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 border-t border-[#1E293B] bg-[#0F172A] px-3 py-2 text-[11px] text-[#94A3B8]">
                  <span className="font-mono text-white">{formatMMSS(currentTime)}</span>
                  <span className="text-[#475569]">/ --:--</span>
                  {isChapter && (
                    <span className="ml-2 rounded border border-[#14B8A6]/30 bg-[#14B8A6]/15 px-1.5 py-0.5 text-[10px] font-medium text-[#2DD4BF]">
                      {tutorial.chapter_label}
                    </span>
                  )}
                  <span className="ml-auto hidden items-center gap-1 text-[10px] text-[#64748B] sm:flex">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#22C55E]" /> SYNCED
                  </span>
                </div>
                <div className="hidden border-t border-[#1E293B] bg-[#0F172A] p-3 lg:block">
                  <div className="flex items-center gap-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={thumb} alt="" className="h-10 w-16 rounded object-cover" />
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium text-white">{tutorial.video_title}</p>
                      <p className="truncate text-[11px] text-[#64748B]">{tutorial.channel_name}</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex min-h-0 min-w-0 flex-col overflow-hidden border-t border-[#1E293B] bg-[#0B1220] lg:border-l lg:border-t-0">
                <div className="shrink-0 border-b border-[#1E293B] bg-[#0F172A] px-4 py-3">
                  <p className="text-xs font-semibold tracking-wide text-white">AI Lesson Notes</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-[#64748B]">
                    Grounded in this video&apos;s transcript — click a timestamp to seek. Code blocks appear only when the transcript contains a real example.
                  </p>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-4">
                  {lessonLoading && (
                    <div className="space-y-3">
                      <div className="h-4 w-3/4 animate-pulse rounded bg-[#1E293B]" />
                      <div className="h-3 w-full animate-pulse rounded bg-[#1E293B]/60" />
                      <div className="h-3 w-5/6 animate-pulse rounded bg-[#1E293B]/60" />
                      <div className="pt-2 space-y-2">
                        <div className="h-16 animate-pulse rounded bg-[#1E293B]/40" />
                        <div className="h-16 animate-pulse rounded bg-[#1E293B]/40" />
                      </div>
                    </div>
                  )}
                  {lessonError && !lessonLoading && (
                    <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-4">
                      <p className="text-xs font-medium text-amber-200">{lessonError}</p>
                      <p className="mt-1 text-[11px] text-amber-200/70">
                        This video has not been indexed yet or the lesson generation failed. It will be available after the next weekly tutorial-index run.
                      </p>
                    </div>
                  )}
                  {lesson && !lessonLoading && (
                    <div className="min-w-0 space-y-4">
                      {lesson.summary && <p className="break-words text-xs leading-relaxed text-[#CBD5E1]">{lesson.summary}</p>}
                      <div className="min-w-0 space-y-2.5">
                        {lesson.sections.map((sec, idx) => {
                          const isActive = idx === activeSectionIdx;
                          return (
                            <button
                              key={`${sec.start_seconds}-${idx}`}
                              onClick={() => handleSeek(sec.start_seconds)}
                              className={`w-full min-w-0 overflow-hidden rounded-lg border px-3 py-3 text-left transition-colors ${isActive ? "border-[#14B8A6]/40 bg-[#14B8A6]/10" : "border-[#1E293B] bg-[#0F172A] hover:border-[#334155] hover:bg-[#111B2F]"}`}
                            >
                              <div className="flex min-w-0 items-center gap-2">
                                <span className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[11px] ${isActive ? "bg-[#14B8A6]/20 text-[#2DD4BF]" : "bg-[#1E293B] text-[#94A3B8]"}`}>
                                  {formatMMSS(sec.start_seconds)}
                                </span>
                                <span className={`min-w-0 truncate text-xs font-medium ${isActive ? "text-white" : "text-[#E2E8F0]"}`}>{sec.heading}</span>
                                {isActive && <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-[#2DD4BF]" />}
                              </div>
                              <ul className="mt-2 list-disc space-y-1 pl-5">
                                {sec.key_points.map((pt, i) => (
                                  <li key={i} className="break-words text-[11px] leading-relaxed text-[#94A3B8]">
                                    {pt}
                                  </li>
                                ))}
                              </ul>
                              {sec.code_example && (
                                <pre className="mt-2.5 max-w-full overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-[#020617] px-3 py-2 font-mono text-[11px] leading-relaxed text-[#2DD4BF]">
                                  {sec.code_example}
                                </pre>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
