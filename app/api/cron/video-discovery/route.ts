import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  createYouTubeClient,
  YouTubeQuotaExhaustedError,
  QuotaBudgetExceededError,
} from "@/lib/youtube/client";
import { ALL_SKILLS } from "@/lib/skills-dictionary";
import { indexVideoForSkill, type IndexVideoInput, selectTopCandidate } from "@/lib/video-indexing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// --- Config ---
const CRON_SECRET = process.env.CRON_SECRET;
const VIDEO_DISCOVERY_BATCH = Number(process.env.VIDEO_DISCOVERY_BATCH ?? "10");
const VIDEO_DISCOVERY_MAX_RESULTS = Number(process.env.VIDEO_DISCOVERY_MAX_RESULTS ?? "10");
const WALL_CLOCK_LIMIT_MS = Number(process.env.VIDEO_DISCOVERY_WALL_CLOCK_LIMIT_MS ?? "90000"); // 90s — must fit inside maxDuration (120s) with headroom for an in-flight index call
const YOUTUBE_DAILY_UNIT_CEILING = Number(process.env.YOUTUBE_DAILY_UNIT_CEILING ?? "3000");
const DAILY_GENERATE_LIMIT = Number(process.env.DAILY_GENERATE_LIMIT ?? "90");

// --- Types ---
interface UsageRow {
  usage_date: string;
  units_consumed: number;
  search_calls: number;
  list_calls: number;
}

interface AiUsageRow {
  generate_calls: number;
}

interface DiscoveryRequestRow {
  skill: string;
  request_count: number;
  requested_at: string;
}

interface SkillIndexStatusRow {
  skill: string;
  gap_mentions_30d: number;
}

interface CatalogSkillRow {
  skill: string;
  fetched_at: string;
}

interface SkillVideoCatalogRow {
  skill: string;
  video_id: string;
  rank: number;
  title: string;
  channel_name: string;
  thumbnail_url: string;
  duration_seconds: number | null;
  view_count: bigint | null;
  published_at: string | null;
  source: string;
  fetched_at: string;
}

export async function GET(req: Request) {
  // Auth
  const authHeader = req.headers.get("authorization");
  if (!CRON_SECRET || authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceRoleClient();
  if (!supabase) {
    return NextResponse.json({ error: "Missing Supabase env" }, { status: 500 });
  }

  const youtubeApiKey = process.env.YOUTUBE_API_KEY;
  if (!youtubeApiKey) {
    return NextResponse.json({ error: "YOUTUBE_API_KEY is not configured" }, { status: 500 });
  }

  const startTime = Date.now();
  const skillsProcessed: string[] = [];
  const skillsSkippedBudget: string[] = [];
  const skillsFailed: { skill: string; error: string }[] = [];
  let unitsUsedThisRun = 0;
  let unitsRemainingToday = YOUTUBE_DAILY_UNIT_CEILING;

  // Read today's Pacific-date usage
  const todayPacific = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
  }).format(new Date());

  const { data: usageRow, error: usageError } = await supabase
    .from("youtube_daily_usage")
    .select("units_consumed, search_calls, list_calls")
    .eq("usage_date", todayPacific)
    .maybeSingle<UsageRow>();

  if (usageError) {
    return NextResponse.json(
      { error: `Failed to fetch youtube_daily_usage: ${usageError.message}` },
      { status: 500 }
    );
  }

  const unitsConsumed = usageRow?.units_consumed ?? 0;
  unitsRemainingToday = Math.max(0, YOUTUBE_DAILY_UNIT_CEILING - unitsConsumed);

  // --- Batch selection ---
  const batch = await selectBatch(supabase!, VIDEO_DISCOVERY_BATCH);

  if (batch.length === 0) {
    return NextResponse.json({
      ok: true,
      skills_processed: [],
      skills_skipped_budget: [],
      skills_failed: [],
      units_used_this_run: 0,
      units_remaining_today: unitsRemainingToday,
    });
  }

  const youtubeClient = createYouTubeClient();

  for (const skill of batch) {
    // Wall-clock guard for catalog discovery
    if (Date.now() - startTime > WALL_CLOCK_LIMIT_MS) {
      console.warn(`[video-discovery] Wall-clock limit reached, stopping before skill: ${skill}`);
      skillsSkippedBudget.push(skill);
      continue;
    }

    // Budget pre-check: need at least 101 units for one search + one list
    if (unitsRemainingToday < 101) {
      console.warn(
        `[video-discovery] Insufficient budget for ${skill}: remaining=${unitsRemainingToday}`
      );
      skillsSkippedBudget.push(skill);
      continue;
    }

    try {
      const candidates = await youtubeClient.searchVideos(skill, VIDEO_DISCOVERY_MAX_RESULTS);

      // Refresh usage after YouTube call to capture actual units consumed (including retries)
      const { data: updatedUsage } = await supabase
        .from("youtube_daily_usage")
        .select("units_consumed")
        .eq("usage_date", todayPacific)
        .maybeSingle<UsageRow>();

      const newUnitsConsumed = updatedUsage?.units_consumed ?? unitsConsumed;
      unitsUsedThisRun = newUnitsConsumed - unitsConsumed;
      unitsRemainingToday = Math.max(0, YOUTUBE_DAILY_UNIT_CEILING - newUnitsConsumed);

      // If no candidates, leave existing catalog untouched and continue
      if (candidates.length === 0) {
        console.warn(`[video-discovery] No YouTube results for ${skill}, leaving existing catalog untouched`);
        skillsProcessed.push(skill);
        continue;
      }

      // --- Upsert new rows FIRST ---
      const rows = candidates.map((c, index) => ({
        skill,
        video_id: c.video_id,
        rank: index + 1,
        title: c.title,
        channel_name: c.channel_name,
        thumbnail_url: `https://img.youtube.com/vi/${c.video_id}/hqdefault.jpg`,
        duration_seconds: c.duration_seconds,
        view_count: c.view_count,
        published_at: c.published_at,
        source: "youtube_api" as const,
        fetched_at: new Date().toISOString(),
      }));

      const { error: upsertError } = await supabase
        .from("skill_video_catalog")
        .upsert(rows, { onConflict: "skill,video_id" });

      if (upsertError) {
        throw new Error(`Failed to upsert skill_video_catalog: ${upsertError.message}`);
      }

      // --- Remove stale youtube_api rows only after successful upsert ---
      // .not() takes raw PostgREST syntax (unlike .in(), it does not format
      // arrays), so build the parenthesized, quoted list explicitly.
      const videoIds = candidates.map((c) => c.video_id);
      const notInList = `(${videoIds.map((id) => `"${id}"`).join(",")})`;
      const { error: deleteError } = await supabase
        .from("skill_video_catalog")
        .delete()
        .eq("skill", skill)
        .eq("source", "youtube_api")
        .not("video_id", "in", notInList);

      if (deleteError) {
        console.error(`[video-discovery] Failed to delete stale catalog rows for ${skill}:`, deleteError);
      }

      // --- Best-effort transcript indexing for the quality-filtered top candidate ---
      // `selectTopCandidate` applies the shared MIN_VIEW_COUNT / MIN_DURATION_SECONDS
      // / TITLE_EXCLUDE_PATTERN filter from lib/video-indexing.ts, so this indexes
      // the first candidate to survive the shared quality filter — NOT raw search
      // rank 1, and NOT a quality-ranked pick.
      // Separate time budget: once 60% of wall-clock budget has elapsed,
      // skip indexing for remaining skills so catalog discovery always finishes.
      const indexingTimeBudget = WALL_CLOCK_LIMIT_MS * 0.6;
      if (Date.now() - startTime <= indexingTimeBudget) {
        const topCandidate = selectTopCandidate(candidates);
        if (topCandidate && topCandidate.description) {
          try {
            // Skip if this video is already indexed for this skill
            const { data: existingChunk } = await supabase
              .from("tutorial_chunks")
              .select("video_id")
              .eq("video_id", topCandidate.video_id)
              .eq("skill_tag", skill)
              .limit(1)
              .maybeSingle();

            if (!existingChunk) {
              // Check AI generate quota before attempting indexing
              const today = new Date().toISOString().slice(0, 10);
              const { data: aiUsage } = await supabase
                .from("ai_daily_usage")
                .select("generate_calls")
                .eq("usage_date", today)
                .maybeSingle<AiUsageRow>();

              const generateCalls = (aiUsage as AiUsageRow | null)?.generate_calls ?? 0;
              if (generateCalls < DAILY_GENERATE_LIMIT) {
                const videoInput: IndexVideoInput = {
                  video_id: topCandidate.video_id,
                  title: topCandidate.title,
                  channel_name: topCandidate.channel_name,
                  view_count: topCandidate.view_count,
                  published_at: topCandidate.published_at,
                  description: topCandidate.description,
                };

                const indexResult = await indexVideoForSkill(supabase, skill, videoInput);

                // Atomically increment ai_daily_usage for windows processed
                const windowsProcessed = Math.max(1, indexResult.chunks);
                if (windowsProcessed > 0) {
                  const today = new Date().toISOString().slice(0, 10);
                  const { error: usageError } = await supabase.rpc("increment_generate_calls", {
                    p_usage_date: today,
                    p_delta: windowsProcessed,
                  });
                  if (usageError) {
                    console.error(
                      `[video-discovery] increment_generate_calls failed for ${skill}:`,
                      usageError.message
                    );
                  }
                }

                console.info(
                  `[video-discovery] Indexed top video for ${skill}: ${topCandidate.video_id} ` +
                  `chapters=${indexResult.chapters} chunks=${indexResult.chunks} lesson=${indexResult.lessonInitialized}`
                );
              } else {
                console.warn(
                  `[video-discovery] Skipping transcript indexing for ${skill}: ` +
                  `AI generate quota exhausted (${generateCalls}/${DAILY_GENERATE_LIMIT})`
                );
              }
            } else {
              console.info(
                `[video-discovery] Top video for ${skill} already indexed, skipping transcript step`
              );
            }
          } catch (indexErr) {
            const indexMsg = indexErr instanceof Error ? indexErr.message : String(indexErr);
            console.error(`[video-discovery] Transcript indexing failed for ${skill}:`, indexMsg);
            // Do not fail the discovery run; the catalog is already populated
          }
        }
      } else {
        console.warn(
          `[video-discovery] Skipping transcript indexing for ${skill}: indexing time budget exhausted`
        );
      }

      // Remove from discovery_requests only on success
      const { error: removeError } = await supabase
        .from("discovery_requests")
        .delete()
        .eq("skill", skill);

      if (removeError) {
        console.error(`[video-discovery] Failed to remove discovery request for ${skill}:`, removeError);
      }

      skillsProcessed.push(skill);
      console.info(`[video-discovery] Processed ${skill}: ${candidates.length} videos`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);

      // Quota errors stop the entire run immediately
      if (err instanceof YouTubeQuotaExhaustedError || err instanceof QuotaBudgetExceededError) {
        console.error(`[video-discovery] Quota error on ${skill}, stopping run:`, msg);
        // Mark all remaining unprocessed skills as skipped due to budget
        const remaining = batch.filter(
          (s) =>
            !skillsProcessed.includes(s) &&
            !skillsSkippedBudget.includes(s) &&
            !skillsFailed.some((f) => f.skill === s)
        );
        skillsSkippedBudget.push(...remaining);
        break;
      }

      // Non-quota error: log and continue
      console.error(`[video-discovery] Skill "${skill}" failed:`, msg);
      skillsFailed.push({ skill, error: msg });
    }
  }

  return NextResponse.json({
    ok: true,
    skills_processed: skillsProcessed,
    skills_skipped_budget: skillsSkippedBudget,
    skills_failed: skillsFailed,
    units_used_this_run: unitsUsedThisRun,
    units_remaining_today: unitsRemainingToday,
  });
}

/**
 * Select up to `batchSize` skills in priority order:
 *   A. Queued discovery_requests (request_count desc, requested_at asc)
 *   B. Dictionary skills with zero rows in skill_video_catalog
 *   C. Skills ordered by stalest skill_video_catalog.fetched_at,
 *      tie-broken by skill_index_status.gap_mentions_30d desc
 * Deduplicated across groups.
 */
async function selectBatch(
  supabase: NonNullable<ReturnType<typeof createServiceRoleClient>>,
  batchSize: number
): Promise<string[]> {
  const seen = new Set<string>();
  const batch: string[] = [];

  // --- Group A: queued discovery_requests ---
  const { data: queued } = await supabase
    .from("discovery_requests")
    .select("skill, request_count, requested_at")
    .order("request_count", { ascending: false })
    .order("requested_at", { ascending: true })
    .limit(batchSize);

  for (const row of (queued ?? []) as DiscoveryRequestRow[]) {
    if (!seen.has(row.skill)) {
      seen.add(row.skill);
      batch.push(row.skill);
    }
  }

  if (batch.length >= batchSize) return batch.slice(0, batchSize);

  // --- Group B: dictionary skills with zero skill_video_catalog rows ---
  const { data: catalogSkills } = await supabase
    .from("skill_video_catalog")
    .select("skill");

  const skillsWithCatalog = new Set((catalogSkills ?? []).map((r) => (r as { skill: string }).skill));
  const dictSkillsWithoutCatalog = ALL_SKILLS.filter((s) => !skillsWithCatalog.has(s));

  for (const skill of dictSkillsWithoutCatalog) {
    if (!seen.has(skill)) {
      seen.add(skill);
      batch.push(skill);
    }
  }

  if (batch.length >= batchSize) return batch.slice(0, batchSize);

  // --- Group C: skills with catalog rows, ordered by stalest fetched_at ---
  const { data: statusRows } = await supabase
    .from("skill_index_status")
    .select("skill, gap_mentions_30d");

  const gapMap = new Map(
    (statusRows ?? []).map((r) => [
      (r as SkillIndexStatusRow).skill,
      (r as SkillIndexStatusRow).gap_mentions_30d,
    ])
  );

  const { data: catalogRows } = await supabase
    .from("skill_video_catalog")
    .select("skill, fetched_at")
    .order("fetched_at", { ascending: true });

  const oldestFetchedBySkill = new Map<string, string>();
  for (const row of (catalogRows ?? []) as CatalogSkillRow[]) {
    const current = oldestFetchedBySkill.get(row.skill);
    if (!current || row.fetched_at < current) {
      oldestFetchedBySkill.set(row.skill, row.fetched_at);
    }
  }

  const catalogSkillsOrdered = Array.from(oldestFetchedBySkill.entries())
    .map(([skill, fetchedAt]) => ({
      skill,
      fetchedAt,
      gap_mentions_30d: gapMap.get(skill) ?? 0,
    }))
    .sort((a, b) => {
      if (a.fetchedAt !== b.fetchedAt) {
        return a.fetchedAt.localeCompare(b.fetchedAt);
      }
      return b.gap_mentions_30d - a.gap_mentions_30d;
    });

  for (const { skill } of catalogSkillsOrdered) {
    if (!seen.has(skill)) {
      seen.add(skill);
      batch.push(skill);
    }
  }

  return batch.slice(0, batchSize);
}
