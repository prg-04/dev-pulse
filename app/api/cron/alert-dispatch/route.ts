import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { Resend } from "resend";
import { stackMatchPct } from "@/lib/matching";

export const runtime = "nodejs";

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM = process.env.RESEND_FROM || "DevPulse <alerts@devpulse.io>";

// --- Types ---
interface AlertPreference {
  user_id: string;
  instant_match_alert: boolean;
  instant_match_threshold: number;
  weekly_digest: boolean;
  learning_gap_dispatch: boolean;
}

interface JobPosting {
  id: string;
  title: string;
  company: string;
  external_url: string;
  skill_mentions?: { skill: string }[];
}

type SupabaseClient = NonNullable<Awaited<ReturnType<typeof createServiceRoleClient>>>;

// --- Helpers ---
function getResendClient(): Resend {
  if (!RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY is not configured");
  }
  return new Resend(RESEND_API_KEY);
}

async function getLatestIngestionRun(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("ingestion_runs")
    .select("started_at, completed_at, status")
    .eq("status", "success")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return data as { started_at: string; completed_at: string; status: string };
}

async function getJobsSince(supabase: SupabaseClient, since: string) {
  const { data, error } = await supabase
    .from("job_postings")
    .select("id, title, company, external_url, skill_mentions(skill)")
    .gte("ingested_at", since)
    .order("ingested_at", { ascending: false });

  if (error) throw new Error(`Failed to fetch jobs: ${error.message}`);
  return (data ?? []) as JobPosting[];
}

async function getUserSkills(supabase: SupabaseClient, userId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("user_skills")
    .select("skill")
    .eq("user_id", userId);

  if (error) throw new Error(`Failed to fetch user skills: ${error.message}`);
  return (data ?? []).map((row) => row.skill);
}

async function hasRecentDispatch(
  supabase: SupabaseClient,
  userId: string,
  alertType: string,
  withinHours: number
): Promise<boolean> {
  const since = new Date();
  since.setHours(since.getHours() - withinHours);

  const { data, error } = await supabase
    .from("alert_dispatch_log")
    .select("id")
    .eq("user_id", userId)
    .eq("alert_type", alertType)
    .gte("sent_at", since.toISOString())
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`Failed to check dispatch log: ${error.message}`);
  return !!data;
}

async function logDispatch(
  supabase: SupabaseClient,
  userId: string,
  alertType: string,
  referenceId: string | null,
  status: "sent" | "failed",
  error?: string
) {
  await supabase.from("alert_dispatch_log").insert({
    user_id: userId,
    alert_type: alertType,
    reference_id: referenceId,
    status,
    error: error ?? null,
  });
}

async function sendEmail(to: string, subject: string, html: string, text: string) {
  const resend = getResendClient();
  await resend.emails.send({
    from: RESEND_FROM,
    to,
    subject,
    html,
    text,
  });
}

// --- Alert Types ---

async function processInstantMatchAlerts(
  supabase: SupabaseClient,
  jobs: JobPosting[],
  prefs: AlertPreference[],
  profiles: Map<string, { full_name: string }>
): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;

  for (const pref of prefs) {
    if (!pref.instant_match_alert) continue;

    const profile = profiles.get(pref.user_id);
    if (!profile?.full_name) continue;

    const alreadySent = await hasRecentDispatch(supabase, pref.user_id, "instant_match", 24);
    if (alreadySent) continue;

    const userSkills = await getUserSkills(supabase, pref.user_id);
    if (userSkills.length === 0) continue;

    const matchingJobs: Array<{ job: JobPosting; score: number }> = [];

    for (const job of jobs) {
      const jobSkills = (job.skill_mentions ?? []).map((m) => m.skill);
      const score = stackMatchPct(jobSkills, userSkills);
      if (score !== undefined && score >= pref.instant_match_threshold) {
        matchingJobs.push({ job, score });
      }
    }

    if (matchingJobs.length === 0) continue;

    try {
      const jobListHtml = matchingJobs
        .map(
          (j) =>
            `<li><strong>${j.job.title}</strong> at ${j.job.company} — ${j.score}% match<br/><a href="${j.job.external_url}">View posting</a></li>`
        )
        .join("");

      const html = `
        <h2>New jobs matching your skills</h2>
        <p>Hi ${profile.full_name},</p>
        <p>${matchingJobs.length} new job posting${matchingJobs.length > 1 ? "s" : ""} scored ${pref.instant_match_threshold}%+ match with your skills:</p>
        <ul>${jobListHtml}</ul>
        <p>— DevPulse</p>
      `;

      const text = `
New jobs matching your skills

Hi ${profile.full_name},

${matchingJobs.length} new job posting${matchingJobs.length > 1 ? "s" : ""} scored ${pref.instant_match_threshold}%+ match with your skills:

${matchingJobs.map((j) => `- ${j.job.title} at ${j.job.company} — ${j.score}% match\n  ${j.job.external_url}`).join("\n\n")}

— DevPulse
      `.trim();

      await sendEmail(profile.full_name, `🔥 ${matchingJobs.length} new job${matchingJobs.length > 1 ? "s" : ""} matching your skills`, html, text);
      await logDispatch(supabase, pref.user_id, "instant_match", null, "sent");
      sent++;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error(`[alert-dispatch] Instant match failed for ${pref.user_id}:`, errorMessage);
      await logDispatch(supabase, pref.user_id, "instant_match", null, "failed", errorMessage);
      failed++;
    }
  }

  return { sent, failed };
}

async function processWeeklyDigest(
  supabase: SupabaseClient,
  prefs: AlertPreference[],
  profiles: Map<string, { full_name: string }>,
  userSourcesMap: Map<string, string[]>
): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;

  const { data: topSkills } = await supabase
    .from("skill_demand_snapshots")
    .select("skill, mention_count, month, source")
    .order("mention_count", { ascending: false })
    .limit(50);

  if (!topSkills || topSkills.length === 0) return { sent, failed };

  const skillMap = new Map<string, { current: number; prev: number; source: string }>();
  for (const row of topSkills as { skill: string; mention_count: number; month: string; source: string }[]) {
    const existing = skillMap.get(row.skill) ?? { current: 0, prev: 0, source: row.source };
    if (row.month === getCurrentMonth()) {
      existing.current += row.mention_count;
    } else {
      existing.prev += row.mention_count;
    }
    existing.source = row.source;
    skillMap.set(row.skill, existing);
  }

  const movers = Array.from(skillMap.entries())
    .map(([skill, data]) => {
      const delta = data.prev === 0 ? (data.current > 0 ? 100 : 0) : Math.round(((data.current - data.prev) / data.prev) * 100);
      return { skill, delta, count: data.current, source: data.source };
    })
    .sort((a, b) => b.delta - a.delta);

  const rising = movers.filter((m) => m.delta > 0).slice(0, 3);
  const declining = movers.filter((m) => m.delta < 0).slice(0, 3);

  for (const pref of prefs) {
    if (!pref.weekly_digest) continue;

    const profile = profiles.get(pref.user_id);
    if (!profile?.full_name) continue;

    const alreadySent = await hasRecentDispatch(supabase, pref.user_id, "weekly_digest", 7 * 24);
    if (alreadySent) continue;

    const userSources = userSourcesMap.get(pref.user_id) ?? ["hackernews", "himalayas", "remotejobs", "remotive", "arbeitnow", "remoteok", "jobicy", "adzuna", "jooble", "themuse"];
    const filteredRising = rising.filter((m) => userSources.includes(m.source));
    const filteredDeclining = declining.filter((m) => userSources.includes(m.source));

    try {
      const risingHtml = filteredRising.map((m) => `<li>${m.skill}: +${m.delta}%</li>`).join("");
      const decliningHtml = filteredDeclining.map((m) => `<li>${m.skill}: ${m.delta}%</li>`).join("");

      const html = `
        <h2>Weekly Market Digest</h2>
        <p>Hi ${profile.full_name},</p>
        <p>Here's your weekly skill demand update:</p>
        <h3>Rising</h3>
        <ul>${risingHtml || "<li>No rising skills this week</li>"}</ul>
        <h3>Declining</h3>
        <ul>${decliningHtml || "<li>No declining skills this week</li>"}</ul>
        <p>— DevPulse</p>
      `;

      const text = `
Weekly Market Digest

Hi ${profile.full_name},

Here's your weekly skill demand update:

Rising:
${filteredRising.map((m) => `- ${m.skill}: +${m.delta}%`).join("\n") || "No rising skills this week"}

Declining:
${filteredDeclining.map((m) => `- ${m.skill}: ${m.delta}%`).join("\n") || "No declining skills this week"}

— DevPulse
      `.trim();

      await sendEmail(profile.full_name, "📊 Your weekly market digest", html, text);
      await logDispatch(supabase, pref.user_id, "weekly_digest", null, "sent");
      sent++;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error(`[alert-dispatch] Weekly digest failed for ${pref.user_id}:`, errorMessage);
      await logDispatch(supabase, pref.user_id, "weekly_digest", null, "failed", errorMessage);
      failed++;
    }
  }

  return { sent, failed };
}

async function processLearningGapDispatch(
  supabase: SupabaseClient,
  prefs: AlertPreference[],
  profiles: Map<string, { full_name: string }>,
  latestTutorialRun: { started_at: string } | null
): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;

  if (!latestTutorialRun) return { sent, failed };

  for (const pref of prefs) {
    if (!pref.learning_gap_dispatch) continue;

    const profile = profiles.get(pref.user_id);
    if (!profile?.full_name) continue;

    const alreadySent = await hasRecentDispatch(supabase, pref.user_id, "learning_gap", 24);
    if (alreadySent) continue;

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const { data: gapEvents } = await supabase
      .from("gap_report_events")
      .select("skill")
      .eq("user_id", pref.user_id)
      .gte("created_at", thirtyDaysAgo.toISOString());

    const gapSkills = new Set((gapEvents ?? []).map((e) => e.skill));
    if (gapSkills.size === 0) continue;

    const { data: recentlyIndexed } = await supabase
      .from("skill_index_status")
      .select("skill, last_indexed_at, total_chunks, total_chapters")
      .in("skill", Array.from(gapSkills))
      .gte("last_indexed_at", latestTutorialRun.started_at);

    const indexedSkills = (recentlyIndexed ?? []).filter(
      (row) => row.total_chunks > 0 || row.total_chapters > 0
    );

    if (indexedSkills.length === 0) continue;

    try {
      const skillsHtml = indexedSkills
        .map(
          (s) =>
            `<li><strong>${s.skill}</strong> — ${s.total_chunks} tutorial chunks, ${s.total_chapters} chaptered videos</li>`
        )
        .join("");

      const html = `
        <h2>New tutorials for your learning gaps</h2>
        <p>Hi ${profile.full_name},</p>
        <p>We've indexed new tutorials for ${indexedSkills.length} skill${indexedSkills.length > 1 ? "s" : ""} you flagged as gaps:</p>
        <ul>${skillsHtml}</ul>
        <p>Head to the Gap Report to explore them.</p>
        <p>— DevPulse</p>
      `;

      const text = `
New tutorials for your learning gaps

Hi ${profile.full_name},

We've indexed new tutorials for ${indexedSkills.length} skill${indexedSkills.length > 1 ? "s" : ""} you flagged as gaps:

${indexedSkills.map((s) => `- ${s.skill}: ${s.total_chunks} tutorial chunks, ${s.total_chapters} chaptered videos`).join("\n")}

Head to the Gap Report to explore them.

— DevPulse
      `.trim();

      await sendEmail(profile.full_name, `🎓 New tutorials for ${indexedSkills.length} learning gap${indexedSkills.length > 1 ? "s" : ""}`, html, text);
      await logDispatch(supabase, pref.user_id, "learning_gap", null, "sent");
      sent++;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error(`[alert-dispatch] Learning gap failed for ${pref.user_id}:`, errorMessage);
      await logDispatch(supabase, pref.user_id, "learning_gap", null, "failed", errorMessage);
      failed++;
    }
  }

  return { sent, failed };
}

function getCurrentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

// --- Main Handler ---
export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceRoleClient();
  if (!supabase) {
    return NextResponse.json({ error: "Missing Supabase env" }, { status: 500 });
  }

  if (!RESEND_API_KEY) {
    return NextResponse.json({ error: "RESEND_API_KEY is not configured" }, { status: 500 });
  }

  // 1. Fetch all alert preferences
  const alertPrefsResult = supabase
    .from("alert_preferences")
    .select("user_id, instant_match_alert, instant_match_threshold, weekly_digest, learning_gap_dispatch")
    .or("instant_match_alert.eq.true,weekly_digest.eq.true,learning_gap_dispatch.eq.true");

  const { data: alertPrefs, error: alertError } = await alertPrefsResult;
  if (alertError) {
    return NextResponse.json(
      { error: `Failed to fetch alert preferences: ${alertError.message}` },
      { status: 500 }
    );
  }

  const prefs = (alertPrefs ?? []) as AlertPreference[];
  if (prefs.length === 0) {
    return NextResponse.json({ ok: true, message: "No alert preferences found" });
  }

  // Build user ID -> profile map
  const userIds = prefs.map((p) => p.user_id);
  const { data: profilesData } = await supabase
    .from("profiles")
    .select("id, full_name")
    .in("id", userIds);

  const profiles = new Map<string, { full_name: string }>();
  for (const p of profilesData ?? []) {
    profiles.set(p.id, p as { full_name: string });
  }

  // Build user ID -> monitored_sources map
  const { data: profilesWithSources } = await supabase
    .from("profiles")
    .select("id, monitored_sources")
    .in("id", userIds);

  const userSourcesMap = new Map<string, string[]>();
  for (const p of profilesWithSources ?? []) {
    userSourcesMap.set(p.id, (p.monitored_sources as string[]) ?? ["hackernews", "himalayas", "remotejobs", "remotive", "arbeitnow", "remoteok", "jobicy", "adzuna", "jooble", "themuse"]);
  }

  // 2. Process Instant Match Alerts (if there are recent jobs)
  const latestRun = await getLatestIngestionRun(supabase);
  let instantMatchResult = { sent: 0, failed: 0 };

  if (latestRun) {
    const recentJobs = await getJobsSince(supabase, latestRun.started_at);
    if (recentJobs.length > 0) {
      instantMatchResult = await processInstantMatchAlerts(supabase, recentJobs, prefs, profiles);
    }
  }

  // 3. Process Weekly Digest
  const weeklyDigestResult = await processWeeklyDigest(supabase, prefs, profiles, userSourcesMap);

  // 4. Process Learning Gap Dispatch
  const tutorialRunResult = supabase
    .from("skill_index_status")
    .select("last_indexed_at")
    .order("last_indexed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: latestTutorialRun } = await tutorialRunResult;
  const learningGapResult = await processLearningGapDispatch(
    supabase,
    prefs,
    profiles,
    latestTutorialRun ? { started_at: latestTutorialRun.last_indexed_at } : null
  );

  return NextResponse.json({
    ok: true,
    instantMatch: instantMatchResult,
    weeklyDigest: weeklyDigestResult,
    learningGap: learningGapResult,
  });
}
