import { createClient } from "@/lib/supabase/server";
import { ProfileClient } from "@/components/profile/ProfileClient";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  let profile = null;
  let skills: { skill: string; years: number | null; depth_tier: string | null; source: string }[] = [];
  let gapExpansion: string[] = [];
  let alertPrefs = { instant_match_alert: false, instant_match_threshold: 90, weekly_digest: false, learning_gap_dispatch: false, delivery_method: "email" as "email" | "webhook" };
  let apiKeyPrefix: string | null = null;

  try {
    const supabase = await createClient();
    if (supabase) {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        const [profileRes, skillsRes, gapRes, alertRes, keyRes] = await Promise.all([
          supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
          supabase.from("user_skills").select("skill, years, depth_tier, source").eq("user_id", user.id),
          supabase.from("gap_report_events").select("skill").eq("user_id", user.id).order("created_at", { ascending: false }).limit(20),
          supabase.from("alert_preferences").select("*").eq("user_id", user.id).maybeSingle(),
          supabase.from("api_keys").select("key_prefix").eq("user_id", user.id).is("revoked_at", null).order("created_at", { ascending: false }).limit(1).maybeSingle(),
        ]);

        const p = profileRes.data as Record<string, unknown> | null;
        if (p) {
          profile = {
            full_name: (p.full_name as string | null) ?? null,
            email: user.email ?? null,
            location_text: (p.location_text as string | null) ?? null,
            timezone: (p.timezone as string | null) ?? null,
            github_username: (p.github_username as string | null) ?? null,
            auto_git_sync: (p.auto_git_sync as boolean) ?? false,
            target_role: (p.target_role as string | null) ?? null,
            target_tier: (p.target_tier as string | null) ?? null,
            comp_floor: (p.comp_floor as number | null) ?? null,
            comp_ceiling: (p.comp_ceiling as number | null) ?? null,
            include_equity: (p.include_equity as boolean) ?? false,
            contractor_pref: (p.contractor_pref as string | null) ?? null,
            monitored_sources: (p.monitored_sources as string[] | null) ?? ["hackernews", "himalayas", "remotejobs", "remotive", "arbeitnow", "remoteok", "jobicy", "adzuna", "jooble", "themuse"],
          };
        } else {
          profile = {
            full_name: null,
            email: user.email ?? null,
            location_text: null,
            timezone: null,
            github_username: null,
            auto_git_sync: false,
            target_role: null,
            target_tier: null,
            comp_floor: null,
            comp_ceiling: null,
            include_equity: false,
            contractor_pref: null,
            monitored_sources: ["hackernews", "himalayas", "remotejobs", "remotive", "arbeitnow", "remoteok", "jobicy", "adzuna", "jooble", "themuse"],
          };
        }

        if (skillsRes.data) skills = skillsRes.data as typeof skills;
        if (gapRes.data) gapExpansion = gapRes.data.map((r: { skill: string }) => r.skill);

        const ap = alertRes.data as Record<string, unknown> | null;
        if (ap) {
          alertPrefs = {
            instant_match_alert: (ap.instant_match_alert as boolean) ?? false,
            instant_match_threshold: (ap.instant_match_threshold as number) ?? 90,
            weekly_digest: (ap.weekly_digest as boolean) ?? false,
            learning_gap_dispatch: (ap.learning_gap_dispatch as boolean) ?? false,
            delivery_method: ((ap.delivery_method as "email" | "webhook") ?? "email") as "email" | "webhook",
          };
        }

        const k = keyRes.data as { key_prefix?: string } | null;
        if (k?.key_prefix) apiKeyPrefix = k.key_prefix;
      }
    }
  } catch {
    // render empty state if env is missing
  }

  const initialData = {
    profile: profile || {
      full_name: null,
      email: null,
      location_text: null,
      timezone: null,
      github_username: null,
      auto_git_sync: false,
      target_role: null,
      target_tier: null,
      comp_floor: null,
      comp_ceiling: null,
      include_equity: false,
      contractor_pref: null,
      monitored_sources: ["hackernews", "himalayas", "remotejobs", "remotive", "arbeitnow", "remoteok", "jobicy", "adzuna", "jooble", "themuse"],
    },
    skills,
    gapExpansion,
    alertPrefs,
    apiKeyPrefix,
  };

  return <ProfileClient initialData={initialData} />;
}
