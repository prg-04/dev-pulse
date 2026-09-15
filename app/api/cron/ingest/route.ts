import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { SKILLS_DICTIONARY } from "@/lib/skills-dictionary";
import { stripHtml } from "@/lib/sanitize";

export const runtime = "nodejs";

// --- Types ---
interface RawJob {
  external_id: string;
  source: string;
  company?: string;
  title: string;
  description: string;
  comp_min?: number;
  comp_max?: number;
  comp_currency?: string;
  liquidity_tier?: string | null;
  contractor_type?: string | null;
  location_text?: string;
  external_url?: string;
  posted_at?: string;
}

// --- Helpers ---
function deriveMonth(dateStr: string | undefined): string {
  if (!dateStr) {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  }
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function extractSkills(text: string): string[] {
  const lower = text.toLowerCase();
  const found = new Set<string>();

  for (const entry of Object.values(SKILLS_DICTIONARY)) {
    for (const alias of entry.aliases) {
      const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(`\\b${escaped}\\b`, "i");
      if (regex.test(lower)) {
        found.add(entry.canonical);
        break;
      }
    }
  }

  return [...found];
}

function extractComp(text: string): { min?: number; max?: number; currency?: string } {
  const match = text.match(/(\d{2,3}(?:,\d{3})*)\s*(k|K)?\s*(?:[-–]|to)\s*(\d{2,3}(?:,\d{3})*)\s*(k|K)?/i);
  if (!match) return {};

  const toNum = (s: string, kGroup: string | undefined) => {
    const num = parseInt(s.replace(/,/g, ""), 10);
    return num * (kGroup ? 1000 : 1);
  };

  return {
    min: toNum(match[1], match[2]),
    max: toNum(match[3], match[4]),
    currency: "USD",
  };
}

function extractLiquidityTier(text: string): string | null {
  const lower = text.toLowerCase();
  const seriesMatch = lower.match(/series\s*([a-e])/i);
  if (seriesMatch) return `series ${seriesMatch[1].toLowerCase()}`;
  if (/\bseed\b/i.test(lower)) return "seed";
  if (/\bpre-seed\b/i.test(lower)) return "pre-seed";
  if (/\bipo\b/i.test(lower)) return "ipo";
  if (/\bpublic\b/i.test(lower)) return "public";
  if (/\bprivate\b/i.test(lower)) return "private";
  return null;
}

function extractContractorType(text: string): string | null {
  const lower = text.toLowerCase();
  if (/\bw8-ben\b/i.test(lower)) return "w8-ben";
  if (/\bdeel\b/i.test(lower)) return "deel";
  if (/\beor\b/i.test(lower)) return "eor";
  if (/\bcontractor\b/i.test(lower)) return "contractor";
  if (/\b1099\b/i.test(lower)) return "1099";
  if (/\bw2\b/i.test(lower)) return "w2";
  if (/\bfull-time\b/i.test(lower)) return "full-time";
  return null;
}

// --- Source fetchers ---
async function fetchHackerNews(): Promise<RawJob[]> {
  const results: RawJob[] = [];

  try {
    // Use search_by_date to get MOST RECENT threads (relevance sort returns 2020 threads)
    const searchUrl = new URL("https://hn.algolia.com/api/v1/search_by_date");
    searchUrl.searchParams.set("query", "Ask HN: Who is hiring");
    searchUrl.searchParams.set("tags", "story");
    searchUrl.searchParams.set("hitsPerPage", "5");

    const searchRes = await fetch(searchUrl.toString());
    if (!searchRes.ok) throw new Error(`HN search failed: ${searchRes.status}`);

    const searchData = await searchRes.json();
    // Filter to stories whose title contains "Who is hiring"
    const stories: { objectID: string; title: string }[] = (searchData.hits ?? [])
      .filter((h: { title?: string }) => (h.title ?? "").toLowerCase().includes("who is hiring"))
      .slice(0, 2);

    // Fallback: if filter yields nothing, take first 2 hits
    const targetStories = stories.length > 0 ? stories : (searchData.hits ?? []).slice(0, 2);

    for (const story of targetStories) {
      if (!story?.objectID) continue;
      try {
        const threadUrl = new URL(`https://hn.algolia.com/api/v1/items/${story.objectID}`);
        const threadRes = await fetch(threadUrl.toString());
        if (!threadRes.ok) continue;
        const threadData = await threadRes.json();
        const comments = threadData.children ?? [];
        for (const comment of comments) {
          if (!comment?.text) continue;
          const titleMatch = comment.text.match(/^([^\n]+)/);
          const title = titleMatch ? titleMatch[1].slice(0, 200) : `HN Posting #${comment.id}`;
          results.push({
            external_id: `hn-${comment.id}`,
            source: "hackernews",
            title,
            description: comment.text,
            location_text: comment.author || undefined,
            external_url: `https://news.ycombinator.com/item?id=${comment.id}`,
            posted_at: comment.created_at,
          });
        }
      } catch {
        // per-thread failure should not abort other threads
        continue;
      }
    }
  } catch (err) {
    console.error("[ingest] HackerNews failed:", err);
  }

  return results;
}

async function fetchHimalayas(): Promise<RawJob[]> {
  const results: RawJob[] = [];

  try {
    let cursor: string | null = null;
    let page = 0;
    const maxPages = 3;

    while (page < maxPages) {
      const url = new URL("https://himalayas.app/jobs/api");
      url.searchParams.set("limit", "20");
      if (cursor) url.searchParams.set("cursor", cursor);

      const res = await fetch(url.toString());
      if (!res.ok) throw new Error(`Himalayas failed: ${res.status}`);

      const data = await res.json();
      const jobs = data.jobs ?? [];

      for (const job of jobs) {
        const guid: string = job.guid || job.applicationLink || `${job.companySlug}-${job.title}-${page}`;
        const pubDate = job.pubDate
          ? typeof job.pubDate === "number"
            ? new Date(job.pubDate * 1000).toISOString()
            : String(job.pubDate)
          : undefined;
        const loc = Array.isArray(job.locationRestrictions)
          ? job.locationRestrictions.join(", ")
          : job.locationRestrictions ?? undefined;
        results.push({
          external_id: `himalayas-${guid}`,
          source: "himalayas",
          company: job.companyName,
          title: job.title,
          description: job.description ?? job.excerpt ?? "",
          comp_min: job.minSalary ?? undefined,
          comp_max: job.maxSalary ?? undefined,
          comp_currency: job.currency ?? "USD",
          location_text: loc,
          external_url: job.applicationLink ?? job.guid,
          posted_at: pubDate,
        });
      }

      cursor = data.nextCursor ?? null;
      if (!cursor) break;
      page++;
    }
  } catch (err) {
    console.error("[ingest] Himalayas failed:", err);
  }

  return results;
}

async function fetchRemoteJobs(): Promise<RawJob[]> {
  const results: RawJob[] = [];

  try {
    for (let page = 1; page <= 2; page++) {
      const url = new URL("https://remotejobs.org/api/v1/jobs");
      url.searchParams.set("page", String(page));
      const res = await fetch(url.toString());
      if (!res.ok) throw new Error(`RemoteJobs failed: ${res.status}`);
      const data = await res.json();
      const jobs: unknown[] = Array.isArray(data) ? data : (data.data ?? data.jobs ?? []);
      if (!Array.isArray(jobs) || jobs.length === 0) break;
      for (const j of jobs as {
        id: string;
        title: string;
        description?: string;
        url?: string;
        apply_url?: string;
        company?: { name?: string } | string;
        salary_min?: number;
        salary_max?: number;
        salary_currency?: string;
        location?: string;
        posted_at?: string;
      }[]) {
        const companyName = typeof j.company === "string" ? j.company : j.company?.name;
        results.push({
          external_id: `remotejobs-${j.id}`,
          source: "remotejobs",
          company: companyName,
          title: j.title,
          description: j.description ?? "",
          comp_min: j.salary_min ?? undefined,
          comp_max: j.salary_max ?? undefined,
          comp_currency: j.salary_currency ?? "USD",
          location_text: j.location,
          external_url: j.apply_url ?? j.url,
          posted_at: j.posted_at,
        });
      }
      if ((jobs as unknown[]).length < 20) break;
    }
  } catch (err) {
    console.error("[ingest] RemoteJobs failed:", err);
  }

  return results;
}

async function fetchRemotive(): Promise<RawJob[]> {
  const results: RawJob[] = [];

  try {
    const res = await fetch("https://remotive.com/api/remote-jobs");
    if (!res.ok) throw new Error(`Remotive failed: ${res.status}`);
    const data = await res.json();
    const jobs = data.jobs ?? [];
    for (const job of jobs as {
      id: number | string;
      title: string;
      description?: string;
      company_name?: string;
      url?: string;
      candidate_required_location?: string;
      publication_date?: string;
    }[]) {
      results.push({
        external_id: `remotive-${job.id}`,
        source: "remotive",
        company: job.company_name,
        title: job.title,
        description: job.description ?? "",
        location_text: job.candidate_required_location,
        external_url: job.url,
        posted_at: job.publication_date,
      });
    }
  } catch (err) {
    console.error("[ingest] Remotive failed:", err);
  }

  return results;
}

async function fetchArbeitnow(): Promise<RawJob[]> {
  const results: RawJob[] = [];
  try {
    const res = await fetch("https://www.arbeitnow.com/api/job-board-api");
    if (!res.ok) throw new Error(`Arbeitnow failed: ${res.status}`);
    const data = await res.json();
    const jobs: unknown[] = Array.isArray(data) ? data : (data.data ?? []);
    for (const job of jobs as {
      slug: string;
      company_name?: string;
      title: string;
      description?: string;
      location?: string;
      remote?: boolean;
      created_at?: string;
      url?: string;
    }[]) {
      if (!job.slug || !job.title) continue;
      results.push({
        external_id: `arbeitnow-${job.slug}`,
        source: "arbeitnow",
        company: job.company_name,
        title: job.title,
        description: job.description ?? "",
        location_text: job.location,
        external_url: job.url ?? `https://www.arbeitnow.com/jobs/${job.slug}`,
        posted_at: job.created_at,
      });
    }
  } catch (err) {
    console.error("[ingest] Arbeitnow failed:", err);
  }
  return results;
}

async function fetchRemoteOK(): Promise<RawJob[]> {
  const results: RawJob[] = [];
  try {
    const res = await fetch("https://remoteok.com/api", {
      headers: { "User-Agent": "DevPulse/1.0 (job ingestion)" },
    });
    if (!res.ok) throw new Error(`RemoteOK failed: ${res.status}`);
    const data = await res.json();
    const jobs: unknown[] = Array.isArray(data) ? data : [];
    // First element is legal notice if API returns it
    const filtered = jobs.filter((j: unknown) => {
      const o = j as { id?: string | number; title?: string };
      return o && o.id != null && typeof o.title === "string";
    });
    for (const job of filtered as {
      id: string | number;
      company?: string;
      position?: string;
      title?: string;
      description?: string;
      tags?: string[];
      location?: string;
      url?: string;
      date?: string;
    }[]) {
      const title = job.position ?? job.title ?? "Untitled";
      const desc = job.description ?? (job.tags ? job.tags.join(", ") : "");
      results.push({
        external_id: `remoteok-${String(job.id)}`,
        source: "remoteok",
        company: job.company,
        title,
        description: desc,
        location_text: job.location,
        external_url: job.url,
        posted_at: job.date,
      });
    }
  } catch (err) {
    console.error("[ingest] RemoteOK failed:", err);
  }
  return results;
}

async function fetchJobicy(): Promise<RawJob[]> {
  const results: RawJob[] = [];
  try {
    const url = new URL("https://jobicy.com/api/v2/remote-jobs");
    url.searchParams.set("industry", "engineering");
    url.searchParams.set("count", "200");
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`Jobicy failed: ${res.status}`);
    const data = await res.json();
    const jobs: unknown[] = Array.isArray(data) ? data : (data.jobs ?? data.data ?? []);
    for (const job of jobs as {
      id: string | number;
      jobTitle?: string;
      title?: string;
      companyName?: string;
      jobDescription?: string;
      description?: string;
      jobGeo?: string;
      location?: string;
      pubDate?: string;
      url?: string;
    }[]) {
      const jid = job.id;
      if (jid == null) continue;
      results.push({
        external_id: `jobicy-${String(jid)}`,
        source: "jobicy",
        company: job.companyName,
        title: job.jobTitle ?? job.title ?? "Untitled",
        description: job.jobDescription ?? job.description ?? "",
        location_text: job.jobGeo ?? job.location,
        external_url: job.url,
        posted_at: job.pubDate,
      });
    }
  } catch (err) {
    console.error("[ingest] Jobicy failed:", err);
  }
  return results;
}

async function fetchAdzuna(): Promise<RawJob[]> {
  const results: RawJob[] = [];
  const appId = process.env.ADZUNA_APP_ID;
  const appKey = process.env.ADZUNA_APP_KEY;
  if (!appId || !appKey) {
    console.log("[ingest] Adzuna skipped: missing ADZUNA_APP_ID/ADZUNA_APP_KEY");
    return results;
  }
  try {
    const countries = ["us", "gb"];
    for (const country of countries) {
      for (let page = 1; page <= 2; page++) {
        const url = new URL(`https://api.adzuna.com/v1/api/jobs/${country}/search/${page}`);
        url.searchParams.set("app_id", appId);
        url.searchParams.set("app_key", appKey);
        url.searchParams.set("results_per_page", "20");
        url.searchParams.set("content-type", "application/json");
        const res = await fetch(url.toString());
        if (res.status === 429) {
          console.error("[ingest] Adzuna quota exhausted (429) for", country, "page", page);
          break;
        }
        if (!res.ok) throw new Error(`Adzuna ${country} p${page} failed: ${res.status}`);
        const data = await res.json();
        const jobs = data.results ?? [];
        for (const job of jobs as {
          id: string | number;
          title: string;
          description?: string;
          company?: { display_name?: string };
          location?: { display_name?: string };
          created?: string;
          salary_min?: number;
          salary_max?: number;
          salary_is_predicted?: string | number | boolean;
          redirect_url?: string;
        }[]) {
          const isPredicted = job.salary_is_predicted === true || job.salary_is_predicted === 1 || job.salary_is_predicted === "1";
          results.push({
            external_id: `adzuna-${String(job.id)}`,
            source: "adzuna",
            company: job.company?.display_name,
            title: job.title,
            description: job.description ?? "",
            comp_min: isPredicted ? undefined : (typeof job.salary_min === "number" ? job.salary_min : undefined),
            comp_max: isPredicted ? undefined : (typeof job.salary_max === "number" ? job.salary_max : undefined),
            comp_currency: "USD",
            location_text: job.location?.display_name,
            external_url: job.redirect_url,
            posted_at: job.created,
          });
        }
        if (!Array.isArray(jobs) || jobs.length < 20) break;
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("429") || msg.includes("quota")) {
      console.error("[ingest] Adzuna quota exhausted:", msg);
    } else {
      console.error("[ingest] Adzuna failed:", err);
    }
  }
  return results;
}

async function fetchJooble(): Promise<RawJob[]> {
  const results: RawJob[] = [];
  const apiKey = process.env.JOOBLE_API_KEY;
  if (!apiKey) {
    console.log("[ingest] Jooble skipped: missing JOOBLE_API_KEY");
    return results;
  }
  try {
    // Key is in URL path — never log full URL
    const url = `https://jooble.org/api/${apiKey}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keywords: "developer", location: "remote", page: 1 }),
    });
    if (res.status === 429) {
      console.error("[ingest] Jooble quota exhausted (429)");
      return results;
    }
    if (!res.ok) throw new Error(`Jooble failed: ${res.status}`);
    const data = await res.json();
    const jobs: unknown[] = data.jobs ?? data.data ?? (Array.isArray(data) ? data : []);
    for (const job of jobs as {
      id?: string | number;
      title: string;
      snippet?: string;
      description?: string;
      company?: string;
      location?: string;
      updated?: string;
      salary?: string;
      link?: string;
      url?: string;
    }[]) {
      const jid = job.id ?? job.link ?? job.title;
      if (!jid) continue;
      // Salary string may contain range — try extract via existing helper pattern later, but store raw location
      results.push({
        external_id: `jooble-${String(jid).slice(0, 120)}`,
        source: "jooble",
        company: job.company,
        title: job.title,
        description: job.snippet ?? job.description ?? "",
        location_text: job.location,
        external_url: job.link ?? job.url,
        posted_at: job.updated,
      });
    }
  } catch (err) {
    // Redact key from error if present
    const msg = err instanceof Error ? err.message.replace(apiKey, "[REDACTED]") : String(err).replace(apiKey, "[REDACTED]");
    console.error("[ingest] Jooble failed:", msg);
  }
  return results;
}

async function fetchTheMuse(): Promise<RawJob[]> {
  const results: RawJob[] = [];
  try {
    const apiKey = process.env.THEMUSE_API_KEY;
    const url = new URL("https://www.themuse.com/api/public/jobs");
    url.searchParams.set("category", "Software Engineer");
    url.searchParams.set("page", "1");
    if (apiKey) url.searchParams.set("api_key", apiKey);
    const res = await fetch(url.toString());
    if (res.status === 429) {
      console.error("[ingest] The Muse quota exhausted (429)");
      return results;
    }
    if (!res.ok) throw new Error(`The Muse failed: ${res.status}`);
    const data = await res.json();
    const jobs: unknown[] = data.results ?? data.data ?? [];
    for (const job of jobs as {
      id: string | number;
      name?: string;
      title?: string;
      company?: { name?: string };
      locations?: { name?: string }[];
      publication_date?: string;
      contents?: string;
      description?: string;
      refs?: { landing_page?: string };
      refs_landing_page?: string;
      url?: string;
    }[]) {
      const jid = job.id;
      if (jid == null) continue;
      results.push({
        external_id: `themuse-${String(jid)}`,
        source: "themuse",
        company: job.company?.name,
        title: job.name ?? job.title ?? "Untitled",
        description: job.contents ?? job.description ?? "",
        location_text: job.locations?.[0]?.name,
        external_url: job.refs?.landing_page ?? job.refs_landing_page ?? job.url,
        posted_at: job.publication_date,
      });
    }
  } catch (err) {
    console.error("[ingest] The Muse failed:", err);
  }
  return results;
}

// --- Main ---
export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceRoleClient();
  console.log("[ingest] Supabase client created:", !!supabase, "url:", process.env.NEXT_PUBLIC_SUPABASE_URL ? "set" : "missing", "serviceRole:", process.env.SUPABASE_SERVICE_ROLE_KEY ? "set" : "missing");
  if (!supabase) {
    return NextResponse.json({ error: "Missing Supabase env" }, { status: 500 });
  }

  // 1. Create ingestion run
  const { data: run, error: runError } = await supabase
    .from("ingestion_runs")
    .insert({ status: "running" })
    .select("id")
    .single();

  if (runError || !run) {
    return NextResponse.json(
      { error: runError?.message ?? "Failed to create ingestion run" },
      { status: 500 }
    );
  }

  let jobsIngested = 0;
  const errors: string[] = [];
  let postingIds = new Map<string, string>();
  let mentionsToInsert: { job_id: string; skill: string; month: string; source: string }[] = [];
  let snapshotCounts = new Map<string, number>();

  try {
    // 2. Fetch all sources in parallel; individual failures do not block others
    const sourceResults = await Promise.allSettled([
      fetchHackerNews(),
      fetchHimalayas(),
      fetchRemoteJobs(),
      fetchRemotive(),
      fetchArbeitnow(),
      fetchRemoteOK(),
      fetchJobicy(),
      fetchAdzuna(),
      fetchJooble(),
      fetchTheMuse(),
    ]);

    const sourceNames = ["hackernews", "himalayas", "remotejobs", "remotive", "arbeitnow", "remoteok", "jobicy", "adzuna", "jooble", "themuse"];
    const allJobs: RawJob[] = [];

    sourceResults.forEach((result, index) => {
      if (result.status === "fulfilled") {
        allJobs.push(...result.value);
      } else {
        const err = result.reason instanceof Error ? result.reason.message : String(result.reason);
        errors.push(`${sourceNames[index]}: ${err}`);
      }
    });

    if (allJobs.length === 0) {
      await supabase
        .from("ingestion_runs")
        .update({ status: "success", jobs_ingested: 0, completed_at: new Date().toISOString() })
        .eq("id", run.id);
      return NextResponse.json({ ok: true, runId: run.id, jobsIngested: 0, message: "No jobs found from any source" });
    }

    // 3. Deduplicate locally then against existing external_id (chunked to avoid PostgREST limits)
    const dedupedMap = new Map<string, RawJob>();
    for (const j of allJobs) if (!dedupedMap.has(j.external_id)) dedupedMap.set(j.external_id, j);
    const dedupedAllJobs = [...dedupedMap.values()];
    const externalIds = dedupedAllJobs.map((j) => j.external_id);
    const existingIds = new Set<string>();
    const EXISTING_CHUNK = 100;
    for (let i = 0; i < externalIds.length; i += EXISTING_CHUNK) {
      const chunk = externalIds.slice(i, i + EXISTING_CHUNK);
      const { data: existing } = await supabase.from("job_postings").select("external_id").in("external_id", chunk);
      for (const r of (existing as { external_id: string }[] | null) ?? []) existingIds.add(r.external_id);
    }
    const { count: existingCount } = await supabase.from("job_postings").select("*", { count: "exact", head: true });
    console.log("[ingest] job_postings total count:", existingCount, "existingIds in this batch:", existingIds.size);
    const newJobs = dedupedAllJobs.filter((j) => !existingIds.has(j.external_id));

    if (newJobs.length === 0) {
      const { count: totalJobCount } = await supabase.from("job_postings").select("*", { count: "exact", head: true });
      console.log("[ingest] early return: newJobs=0, total job_postings count:", totalJobCount);
      await supabase
        .from("ingestion_runs")
        .update({ status: "success", jobs_ingested: 0, completed_at: new Date().toISOString() })
        .eq("id", run.id);
      return NextResponse.json({ ok: true, runId: run.id, jobsIngested: 0, message: "All jobs already ingested" });
    }

    // 4. Prepare postings with extracted skills and best-effort fields
    const now = new Date();
    const postingsToInsert = newJobs.map((job) => {
      const cleanDescription = stripHtml(job.description);
      const combinedText = `${job.title}\n${cleanDescription}`;

      // Best-effort extraction only if not already provided by the source API
      const compFromText = extractComp(cleanDescription ?? job.title);
      const liquidityTier = job.liquidity_tier ?? extractLiquidityTier(combinedText);
      const contractorType = job.contractor_type ?? extractContractorType(combinedText);

      const toInt = (v: number | undefined): number | undefined => (typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : undefined);

      return {
        external_id: job.external_id,
        source: job.source,
        company: job.company,
        title: job.title,
        description: cleanDescription,
        comp_min: toInt(job.comp_min ?? compFromText.min),
        comp_max: toInt(job.comp_max ?? compFromText.max),
        comp_currency: job.comp_currency ?? compFromText.currency,
        liquidity_tier: liquidityTier ?? null,
        contractor_type: contractorType ?? null,
        location_text: job.location_text,
        external_url: job.external_url,
        posted_at: job.posted_at ?? now.toISOString(),
        ingested_at: now.toISOString(),
      };
    });

    // 5. Batch insert job postings and retrieve IDs
    const BATCH_SIZE = 100;
    postingIds = new Map<string, string>();

    for (let i = 0; i < postingsToInsert.length; i += BATCH_SIZE) {
      const batch = postingsToInsert.slice(i, i + BATCH_SIZE);
      const { data: inserted, error: postingsError } = await supabase
        .from("job_postings")
        .upsert(batch, { onConflict: "external_id", ignoreDuplicates: false })
        .select("id, external_id");

      if (postingsError) {
        console.error("[ingest] Batch upsert failed:", postingsError.message);
        errors.push(`batch at ${i}: ${postingsError.message}`);
        // Fallback: try to fetch ids for this batch via select
        const ids = batch.map((b) => b.external_id);
        const { data: fallback } = await supabase.from("job_postings").select("id, external_id").in("external_id", ids);
        for (const p of (fallback as { id: string; external_id: string }[] | null) ?? []) postingIds.set(p.external_id, p.id);
        continue;
      }

      console.log("[ingest] Batch upsert ok:", inserted?.length ?? 0, "rows");
      for (const p of inserted ?? []) {
        postingIds.set(p.external_id, p.id);
      }
    }

    // 6. Build skill mentions and snapshot counts
    mentionsToInsert = [];
    snapshotCounts = new Map<string, number>();

    for (const job of newJobs) {
      const jobId = postingIds.get(job.external_id);
      if (!jobId) continue;

      const combinedText = `${job.title}\n${stripHtml(job.description)}`;
      const skills = extractSkills(combinedText);
      const month = deriveMonth(job.posted_at);

      for (const skill of skills) {
        mentionsToInsert.push({
          job_id: jobId,
          skill,
          month,
          source: job.source,
        });

        const key = `${skill}|${month}|${job.source}`;
        snapshotCounts.set(key, (snapshotCounts.get(key) ?? 0) + 1);
      }
    }
    console.log("[ingest] newJobs:", newJobs.length, "postingIds:", postingIds.size, "mentionsToInsert:", mentionsToInsert.length);

    // 7. Batch insert skill mentions
    for (let i = 0; i < mentionsToInsert.length; i += BATCH_SIZE) {
      const batch = mentionsToInsert.slice(i, i + BATCH_SIZE);
      const { error: mentionsError } = await supabase
        .from("skill_mentions")
        .insert(batch);

      if (mentionsError) {
        console.error("[ingest] Failed to insert skill mentions:", mentionsError);
        errors.push(`skill_mentions insert failed at ${i}: ${mentionsError.message}`);
      } else {
        console.log("[ingest] skill_mentions batch ok:", batch.length);
      }
    }

    // 8. Upsert skill_demand_snapshots (read-modify-write to preserve counts on re-runs)
    if (snapshotCounts.size > 0) {
      const months = [...new Set([...snapshotCounts.keys()].map((k) => k.split("|")[1]))];
      const sources = [...new Set([...snapshotCounts.keys()].map((k) => k.split("|")[2]))];

      const { data: existingSnapshots } = await supabase
        .from("skill_demand_snapshots")
        .select("skill, mention_count, month, source")
        .in("month", months)
        .in("source", sources);

      const existingMap = new Map<string, { mention_count: number }>();
      for (const s of existingSnapshots ?? []) {
        const row = s as { skill: string; mention_count: number; month: string; source: string };
        existingMap.set(`${row.skill}|${row.month}|${row.source}`, { mention_count: row.mention_count });
      }

      console.log("[ingest] snapshotCounts:", snapshotCounts.size, "existingSnapshots:", existingSnapshots?.length ?? 0);

      const snapshotRows = [...snapshotCounts.entries()].map(([key, count]) => {
        const [skill, month, source] = key.split("|");
        const existing = existingMap.get(key);
        return {
          skill,
          month,
          source,
          mention_count: (existing?.mention_count ?? 0) + count,
        };
      });

      for (let i = 0; i < snapshotRows.length; i += BATCH_SIZE) {
        const batch = snapshotRows.slice(i, i + BATCH_SIZE);
        const { error: snapshotError } = await supabase
          .from("skill_demand_snapshots")
          .upsert(batch, { onConflict: "skill,month,source" });

        if (snapshotError) {
          console.error("[ingest] Failed to upsert skill_demand_snapshots:", snapshotError);
          errors.push(`snapshot upsert failed at ${i}: ${snapshotError.message}`);
        } else {
          console.log("[ingest] skill_demand_snapshots batch ok:", batch.length);
        }
      }
    }

    jobsIngested = newJobs.length;

    console.log("[ingest] Debug: newJobs=", newJobs.length, "postingIds=", postingIds.size, "mentionsToInsert=", mentionsToInsert.length, "snapshotCounts=", snapshotCounts.size);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[ingest] Run failed:", msg);
    errors.push(msg);
  } finally {
    // 9. Update ingestion run
    const finalStatus = errors.length > 0 && jobsIngested === 0 ? "failed" : "success";
    await supabase
      .from("ingestion_runs")
      .update({
        status: finalStatus,
        jobs_ingested: jobsIngested,
        completed_at: new Date().toISOString(),
        error: errors.length > 0 ? errors.join("; ") : null,
      })
      .eq("id", run.id);
  }

  return NextResponse.json({
    ok: true,
    runId: run.id,
    jobsIngested,
    errors: errors.length > 0 ? errors : undefined,
    debug: {
      postingIds: postingIds.size,
      mentionsToInsert: mentionsToInsert.length,
      snapshotCounts: snapshotCounts.size,
    }
  });
}
