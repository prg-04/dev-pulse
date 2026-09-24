import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/supabase/env";

// Mirrors the Zod constraints on profiles.github_username in
// app/api/profile/route.ts (max 39 chars, ^[a-zA-Z0-9-]*$).
const GITHUB_HANDLE_PATTERN = /^[a-zA-Z0-9-]*$/;
const GITHUB_HANDLE_MAX = 39;

function githubHandleFromMetadata(metadata: unknown): string | null {
  if (typeof metadata !== "object" || metadata === null) return null;
  const record = metadata as Record<string, unknown>;
  const raw = record.preferred_username ?? record.user_name;
  if (typeof raw !== "string") return null;
  const handle = raw.trim();
  if (!handle || handle.length > GITHUB_HANDLE_MAX || !GITHUB_HANDLE_PATTERN.test(handle)) return null;
  return handle;
}

function safeNext(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

async function backfillGithubUsername(supabase: SupabaseClient): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.user_metadata?.devpulse_github_prefilled) return;
  const handle = githubHandleFromMetadata(user.user_metadata);
  if (!handle) return;
  const { data: profile } = await supabase
    .from("profiles")
    .select("github_username")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile || profile.github_username) return;
  const { error: updateError } = await supabase
    .from("profiles")
    .update({ github_username: handle })
    .eq("id", user.id);
  if (updateError) return;
  await supabase.auth.updateUser({
    data: { ...user.user_metadata, devpulse_github_prefilled: true },
  });
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next"));

  if (code) {
    const url = getSupabaseUrl();
    const anonKey = getSupabaseAnonKey();
    if (url && anonKey) {
      const cookieStore = await cookies();
      const supabase = createServerClient(url, anonKey, {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
            } catch {
              // ignore
            }
          },
        },
      });
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (!error) {
        try {
          await backfillGithubUsername(supabase);
        } catch {
          // Prefill is best-effort convenience: a failure here must never
          // block sign-in, and the next sign-in retries it automatically.
        }
        const forwardedHost = request.headers.get("x-forwarded-host");
        const isLocalEnv = process.env.NODE_ENV === "development";
        if (isLocalEnv) return NextResponse.redirect(`${origin}${next}`);
        if (forwardedHost) return NextResponse.redirect(`https://${forwardedHost}${next}`);
        return NextResponse.redirect(`${origin}${next}`);
      }
    }
  }
  return NextResponse.redirect(`${origin}/sign-in?error=auth_code_error`);
}
