import { createServiceRoleClient } from "@/lib/supabase/service-role";

const YOUTUBE_API_KEY_HEADER = "x-goog-api-key";
const YOUTUBE_AUTH_MODE: "header" | "query" = "header";
const DEFAULT_CEILING = 3000;
const MAX_CEILING = 9000;

export class QuotaBudgetExceededError extends Error {
  constructor(
    public readonly requested: number,
    public readonly remaining: number
  ) {
    super(`Quota budget exceeded: requested ${requested}, ceiling ${remaining}`);
    this.name = "QuotaBudgetExceededError";
  }
}

export class YouTubeQuotaExhaustedError extends Error {
  constructor() {
    super("YouTube API quota exhausted or rate-limited");
    this.name = "YouTubeQuotaExhaustedError";
  }
}

export interface YouTubeVideoCandidate {
  video_id: string;
  title: string;
  channel_name: string;
  view_count: number;
  duration_seconds: number;
  published_at: string | null;
  description: string;
}

export interface YouTubeClientOptions {
  apiKey: string;
  ceiling: number;
}

export function createYouTubeClient(): YouTubeClient {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    throw new Error("YOUTUBE_API_KEY is not configured");
  }

  const rawCeiling = parseInt(process.env.YOUTUBE_DAILY_UNIT_CEILING ?? String(DEFAULT_CEILING), 10);
  const ceiling = Number.isFinite(rawCeiling) && rawCeiling > 0 ? Math.min(rawCeiling, MAX_CEILING) : DEFAULT_CEILING;

  return new YouTubeClient({ apiKey, ceiling });
}

export class YouTubeClient {
  constructor(private readonly options: YouTubeClientOptions) {}

  private buildRequest(url: URL): { url: URL; init: RequestInit } {
    if (YOUTUBE_AUTH_MODE === "header") {
      return {
        url,
        init: { headers: { [YOUTUBE_API_KEY_HEADER]: this.options.apiKey } },
      };
    }
    url.searchParams.set("key", this.options.apiKey);
    return { url, init: {} };
  }

  private async reserve(units: number, callType: "search" | "list"): Promise<boolean> {
    const supabase = createServiceRoleClient();
    if (!supabase) {
      throw new Error("Missing Supabase env for quota reservation");
    }
    const { data, error } = await supabase.rpc("reserve_youtube_units", {
      p_units: units,
      p_ceiling: this.options.ceiling,
      p_call_type: callType,
    });
    if (error) {
      throw new Error(`reserve_youtube_units failed: ${error.message}`);
    }
    return data === true;
  }

  private async fetchWithQuota(url: URL, units: number, callType: "search" | "list"): Promise<Response> {
    const reserved = await this.reserve(units, callType);
    if (!reserved) {
      throw new QuotaBudgetExceededError(units, this.options.ceiling);
    }

    const { url: reqUrl, init } = this.buildRequest(url);
    let res = await fetch(reqUrl.toString(), init);

    if (res.status >= 500 && res.status < 600) {
      await new Promise((r) => setTimeout(r, 1000));
      const retryReserved = await this.reserve(units, callType);
      if (!retryReserved) {
        throw new QuotaBudgetExceededError(units, this.options.ceiling);
      }
      res = await fetch(reqUrl.toString(), init);
    }

    return res;
  }

  async searchVideos(skill: string, maxResults: number): Promise<YouTubeVideoCandidate[]> {
    if (!skill || typeof skill !== "string" || skill.trim() === "") {
      throw new Error("skill must be a non-empty string");
    }

    const searchUrl = new URL("https://www.googleapis.com/youtube/v3/search");
    searchUrl.searchParams.set("q", `${skill} complete tutorial course`);
    searchUrl.searchParams.set("type", "video");
    searchUrl.searchParams.set("order", "relevance");
    searchUrl.searchParams.set("publishedAfter", getPublishedAfter());
    searchUrl.searchParams.set("maxResults", String(maxResults));
    // API key sent via x-goog-api-key header in fetchWithQuota when YOUTUBE_AUTH_MODE === "header"

    const searchRes = await this.fetchWithQuota(searchUrl, 100, "search");
    if (!searchRes.ok) {
      const body = await searchRes.text();
      const err = new Error(
        `YouTube search failed: ${searchRes.status} ${searchRes.statusText}${body ? ` — ${body.slice(0, 200)}` : ""}`
      );
      if (searchRes.status === 403) {
        const isQuota = body.includes("quotaExceeded") || body.includes("rateLimitExceeded");
        if (isQuota) {
          throw new YouTubeQuotaExhaustedError();
        }
      }
      throw err;
    }

    const searchData = await searchRes.json();
    const items = searchData.items ?? [];
    if (items.length === 0) return [];

    const videoIds = items
      .map((item: Record<string, unknown>) => {
        const idObj = item.id as { videoId?: string } | string | undefined;
        const vid = typeof idObj === "string" ? idObj : idObj?.videoId;
        return typeof vid === "string" ? vid : null;
      })
      .filter((id: string | null): id is string => id !== null);

    if (videoIds.length === 0) return [];

    const BATCH_SIZE = 50;
    const candidates: YouTubeVideoCandidate[] = [];

    for (let i = 0; i < videoIds.length; i += BATCH_SIZE) {
      const batch = videoIds.slice(i, i + BATCH_SIZE);
      const videosUrl = new URL("https://www.googleapis.com/youtube/v3/videos");
      videosUrl.searchParams.set("id", batch.join(","));
      videosUrl.searchParams.set("part", "contentDetails,snippet,statistics");
      // API key sent via x-goog-api-key header in fetchWithQuota when YOUTUBE_AUTH_MODE === "header"

      const videosRes = await this.fetchWithQuota(videosUrl, 1, "list");
      if (!videosRes.ok) {
        const body = await videosRes.text();
        const err = new Error(
          `YouTube videos fetch failed: ${videosRes.status} ${videosRes.statusText}${body ? ` — ${body.slice(0, 200)}` : ""}`
        );
        if (videosRes.status === 403) {
          const isQuota = body.includes("quotaExceeded") || body.includes("rateLimitExceeded");
          if (isQuota) {
            throw new YouTubeQuotaExhaustedError();
          }
        }
        throw err;
      }

      const videosData = await videosRes.json();
      for (const video of videosData.items ?? []) {
        const iso8601Duration = video.contentDetails?.duration ?? "";
        const durationSeconds = parseISO8601Duration(iso8601Duration);
        const viewCount = Number(video.statistics?.viewCount ?? 0);
        const publishedAt = video.snippet?.publishedAt ?? null;

        candidates.push({
          video_id: video.id,
          title: video.snippet?.title ?? "",
          channel_name: video.snippet?.channelTitle ?? "",
          view_count: viewCount,
          duration_seconds: durationSeconds,
          published_at: publishedAt,
          description: video.snippet?.description ?? "",
        });
      }
    }

    return candidates;
  }
}

function parseISO8601Duration(duration: string): number {
  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;

  const hours = match[1] ? parseInt(match[1], 10) : 0;
  const minutes = match[2] ? parseInt(match[2], 10) : 0;
  const seconds = match[3] ? parseInt(match[3], 10) : 0;
  return hours * 3600 + minutes * 60 + seconds;
}

function getPublishedAfter(): string {
  const date = new Date();
  date.setFullYear(date.getFullYear() - 2);
  return date.toISOString();
}
