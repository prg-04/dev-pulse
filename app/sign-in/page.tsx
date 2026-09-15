"use client";

import { useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Activity, Mail, ArrowRight, CheckCircle2 } from "lucide-react";

function SignInInner() {
  const searchParams = useSearchParams();
  const next = searchParams.get("next") || "/";

  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setStatus("sending");
    setErrorMsg(null);
    try {
      const supabase = createClient();
      const origin = window.location.origin;
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: `${origin}/api/auth/callback?next=${encodeURIComponent(next)}` },
      });
      if (error) throw error;
      setStatus("sent");
    } catch (err: unknown) {
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : "Failed to send magic link");
    }
  }

  return (
    <div className="min-h-screen bg-[#070A14] flex flex-col">
      <div className="mx-auto flex h-[52px] w-full max-w-[1280px] items-center gap-2 px-6 border-b border-[#1E293B]">
        <Activity className="h-5 w-5 text-[#14B8A6]" />
        <span className="text-sm font-bold tracking-tight text-white">DevPulse</span>
        <span className="ml-2 text-[11px] tracking-widest text-[#64748B]">SIGN IN</span>
      </div>
      <div className="flex flex-1 items-center justify-center px-6 py-12">
        <div className="w-full max-w-[420px] rounded-xl border border-[#1E293B] bg-[#0F172A] p-6 md:p-8">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#14B8A6]/15 ring-1 ring-[#14B8A6]/30">
            <Mail className="h-5 w-5 text-[#2DD4BF]" />
          </div>
          <h1 className="mt-4 font-[var(--font-heading)] text-[22px] font-bold tracking-tight text-white">Sign in to DevPulse</h1>
          <p className="mt-1.5 text-sm leading-relaxed text-[#94A3B8]">
            Passwordless magic link. We&apos;ll email you a one-time link — no password needed.
          </p>

          {status === "sent" ? (
            <div className="mt-6 rounded-lg border border-[#22C55E]/30 bg-[#22C55E]/10 p-4">
              <div className="flex gap-2 text-sm font-medium text-[#86EFAC]">
                <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
                Check your email
              </div>
              <p className="mt-1 text-xs leading-relaxed text-[#86EFAC]/80">
                We sent a magic link to <span className="font-medium text-[#86EFAC]">{email}</span>. Click it to sign in. The link expires in 1 hour.
              </p>
              <button onClick={() => setStatus("idle")} className="mt-3 text-xs text-[#64748B] hover:text-white transition-colors">
                Use a different email
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              <div>
                <label htmlFor="email" className="text-[11px] font-medium tracking-wide text-[#94A3B8]">
                  Email address
                </label>
                <input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  className="mt-1.5 w-full rounded-lg border border-[#1E293B] bg-[#070A14] px-3 py-2.5 text-sm text-white placeholder:text-[#475569] focus:border-[#14B8A6]/50 focus:outline-none focus:ring-1 focus:ring-[#14B8A6]/30"
                />
              </div>
              {status === "error" && errorMsg && <p className="text-xs text-[#F87171]">{errorMsg}</p>}
              <button
                type="submit"
                disabled={status === "sending"}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#14B8A6] px-4 py-2.5 text-sm font-medium text-black hover:bg-[#2DD4BF] disabled:opacity-60 transition-colors"
              >
                {status === "sending" ? "Sending..." : "Send magic link"}
                <ArrowRight className="h-4 w-4" />
              </button>
              <p className="text-center text-[11px] leading-relaxed text-[#475569]">
                By signing in, you agree to DevPulse&apos;s Terms. No password is ever stored — auth via Supabase Auth magic link (see AGENTS.md §3).
              </p>
            </form>
          )}
        </div>
      </div>
      <div className="border-t border-[#1E293B] py-4 text-center text-[11px] text-[#475569]">Data refreshed daily · Live market intelligence for remote developers</div>
    </div>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#070A14]" />}>
      <SignInInner />
    </Suspense>
  );
}
