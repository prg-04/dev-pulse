import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  YouTubeClient,
  QuotaBudgetExceededError,
  YouTubeQuotaExhaustedError,
  createYouTubeClient,
} from "@/lib/youtube/client";

// ---------------------------------------------------------------------------
// server-only is a build-time guard; silence it in the test environment
// ---------------------------------------------------------------------------
vi.mock("server-only", () => ({}));

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
const mockRpc = vi.fn();

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: vi.fn(),
}));

describe("YouTubeClient", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockRpc.mockClear();
  });

  it("throws QuotaBudgetExceededError when reservation is denied, without calling fetch", async () => {
    const { createServiceRoleClient } = await import("@/lib/supabase/service-role");
    (createServiceRoleClient as ReturnType<typeof vi.fn>).mockReturnValue({
      rpc: mockRpc,
    });
    mockRpc.mockResolvedValue({ data: false, error: null });

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const client = new YouTubeClient({ apiKey: "test-key", ceiling: 3000 });
    await expect(client.searchVideos("typescript", 14)).rejects.toThrow(QuotaBudgetExceededError);

    expect(mockRpc).toHaveBeenCalledWith("reserve_youtube_units", {
      p_units: 100,
      p_ceiling: 3000,
      p_call_type: "search",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws YouTubeQuotaExhaustedError on 403 quotaExceeded without retry", async () => {
    const { createServiceRoleClient } = await import("@/lib/supabase/service-role");
    (createServiceRoleClient as ReturnType<typeof vi.fn>).mockReturnValue({
      rpc: mockRpc,
    });
    mockRpc.mockResolvedValue({ data: true, error: null });

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ error: { code: 403, message: "quotaExceeded", errors: [{ reason: "quotaExceeded" }] } }),
        { status: 403, statusText: "Forbidden" }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new YouTubeClient({ apiKey: "test-key", ceiling: 3000 });
    try {
      await client.searchVideos("typescript", 14);
      expect(true).toBe(false);
    } catch (err) {
      expect((err as Error).name).toBe("YouTubeQuotaExhaustedError");
      expect((err as Error).message).toBe("YouTube API quota exhausted or rate-limited");
    }

    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws YouTubeQuotaExhaustedError on 403 rateLimitExceeded without retry", async () => {
    const { createServiceRoleClient } = await import("@/lib/supabase/service-role");
    (createServiceRoleClient as ReturnType<typeof vi.fn>).mockReturnValue({
      rpc: mockRpc,
    });
    mockRpc.mockResolvedValue({ data: true, error: null });

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ error: { code: 403, message: "rateLimitExceeded", errors: [{ reason: "rateLimitExceeded" }] } }),
        { status: 403, statusText: "Forbidden" }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new YouTubeClient({ apiKey: "test-key", ceiling: 3000 });
    try {
      await client.searchVideos("typescript", 14);
      expect(true).toBe(false);
    } catch (err) {
      expect((err as Error).name).toBe("YouTubeQuotaExhaustedError");
      expect((err as Error).message).toBe("YouTube API quota exhausted or rate-limited");
    }

    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries 5xx once with a fresh reservation", async () => {
    const { createServiceRoleClient } = await import("@/lib/supabase/service-role");
    (createServiceRoleClient as ReturnType<typeof vi.fn>).mockReturnValue({
      rpc: mockRpc,
    });

    mockRpc
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: true, error: null });

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        new Response("Internal Server Error", {
          status: 500,
          statusText: "Internal Server Error",
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ items: [] }), {
          status: 200,
          statusText: "OK",
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    const client = new YouTubeClient({ apiKey: "test-key", ceiling: 3000 });
    const result = await client.searchVideos("typescript", 14);

    expect(result).toEqual([]);
    expect(mockRpc).toHaveBeenCalledTimes(2);
    expect(mockRpc).toHaveBeenNthCalledWith(1, "reserve_youtube_units", {
      p_units: 100,
      p_ceiling: 3000,
      p_call_type: "search",
    });
    expect(mockRpc).toHaveBeenNthCalledWith(2, "reserve_youtube_units", {
      p_units: 100,
      p_ceiling: 3000,
      p_call_type: "search",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("batches videos.list into one request for up to 50 IDs", async () => {
    const { createServiceRoleClient } = await import("@/lib/supabase/service-role");
    (createServiceRoleClient as ReturnType<typeof vi.fn>).mockReturnValue({
      rpc: mockRpc,
    });
    mockRpc.mockResolvedValue({ data: true, error: null });

    const videoItems = Array.from({ length: 50 }, (_, i) => ({
      id: `vid${i}`,
      snippet: {
        title: `Video ${i}`,
        channelTitle: `Channel ${i}`,
        description: "Description",
        publishedAt: "2024-01-01T00:00:00Z",
      },
      contentDetails: { duration: "PT1H2M3S" },
      statistics: { viewCount: "100000" },
    }));

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ items: videoItems.map((v) => ({ id: { videoId: v.id } })) }),
          { status: 200, statusText: "OK" }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ items: videoItems }), {
          status: 200,
          statusText: "OK",
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    const client = new YouTubeClient({ apiKey: "test-key", ceiling: 3000 });
    const result = await client.searchVideos("typescript", 14);

    expect(result).toHaveLength(50);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const videosCall = fetchMock.mock.calls[1][0];
    expect(videosCall).toContain("videos");
    expect(videosCall).toContain("vid0");
    expect(videosCall).toContain("vid49");
    // Should not contain vid50 since we only have 50 IDs total
    expect(videosCall).not.toContain("vid50");
  });

  it("splits videos.list into multiple batches when over 50 IDs", async () => {
    const { createServiceRoleClient } = await import("@/lib/supabase/service-role");
    (createServiceRoleClient as ReturnType<typeof vi.fn>).mockReturnValue({
      rpc: mockRpc,
    });
    mockRpc.mockResolvedValue({ data: true, error: null });

    const videoItems = Array.from({ length: 75 }, (_, i) => ({
      id: `vid${i}`,
      snippet: {
        title: `Video ${i}`,
        channelTitle: `Channel ${i}`,
        description: "Description",
        publishedAt: "2024-01-01T00:00:00Z",
      },
      contentDetails: { duration: "PT1H2M3S" },
      statistics: { viewCount: "100000" },
    }));

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ items: videoItems.map((v) => ({ id: { videoId: v.id } })) }),
          { status: 200, statusText: "OK" }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ items: videoItems.slice(0, 50) }), {
          status: 200,
          statusText: "OK",
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ items: videoItems.slice(50, 75) }), {
          status: 200,
          statusText: "OK",
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    const client = new YouTubeClient({ apiKey: "test-key", ceiling: 3000 });
    const result = await client.searchVideos("typescript", 14);

    expect(result).toHaveLength(75);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const batch1 = fetchMock.mock.calls[1][0];
    const batch2 = fetchMock.mock.calls[2][0];
    expect(batch1).toContain("vid0");
    expect(batch1).toContain("vid49");
    expect(batch1).not.toContain("vid50");
    expect(batch2).toContain("vid50");
    expect(batch2).toContain("vid74");
  });

  it("throws for empty skill", async () => {
    const client = new YouTubeClient({ apiKey: "test-key", ceiling: 3000 });
    await expect(client.searchVideos("", 14)).rejects.toThrow("skill must be a non-empty string");
    await expect(client.searchVideos("   ", 14)).rejects.toThrow("skill must be a non-empty string");
  });
});

describe("createYouTubeClient", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockRpc.mockClear();
    process.env = { ...originalEnv };
  });

  it("throws when YOUTUBE_API_KEY is missing", async () => {
    delete process.env.YOUTUBE_API_KEY;
    const { createYouTubeClient } = await import("@/lib/youtube/client");
    expect(() => createYouTubeClient()).toThrow("YOUTUBE_API_KEY is not configured");
  });

  it("uses default ceiling 3000 when env is empty", async () => {
    process.env.YOUTUBE_API_KEY = "test-key";
    delete process.env.YOUTUBE_DAILY_UNIT_CEILING;
    const { createYouTubeClient } = await import("@/lib/youtube/client");
    const client = createYouTubeClient();

    const { createServiceRoleClient } = await import("@/lib/supabase/service-role");
    (createServiceRoleClient as ReturnType<typeof vi.fn>).mockReturnValue({
      rpc: mockRpc,
    });
    mockRpc.mockResolvedValue({ data: true, error: null });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ error: { code: 403, message: "quotaExceeded", errors: [{ reason: "quotaExceeded" }] } }),
        { status: 403, statusText: "Forbidden" }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    try {
      await client.searchVideos("typescript", 14);
      expect(true).toBe(false);
    } catch (err) {
      expect((err as Error).name).toBe("YouTubeQuotaExhaustedError");
      expect((err as Error).message).toBe("YouTube API quota exhausted or rate-limited");
    }
    expect(mockRpc).toHaveBeenCalledWith("reserve_youtube_units", {
      p_units: 100,
      p_ceiling: 3000,
      p_call_type: "search",
    });
  });

  it("falls back to 3000 for NaN ceiling", async () => {
    process.env.YOUTUBE_API_KEY = "test-key";
    process.env.YOUTUBE_DAILY_UNIT_CEILING = "NaN";
    const { createYouTubeClient } = await import("@/lib/youtube/client");
    const client = createYouTubeClient();

    const { createServiceRoleClient } = await import("@/lib/supabase/service-role");
    (createServiceRoleClient as ReturnType<typeof vi.fn>).mockReturnValue({
      rpc: mockRpc,
    });
    mockRpc.mockResolvedValue({ data: true, error: null });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ error: { code: 403, message: "quotaExceeded", errors: [{ reason: "quotaExceeded" }] } }),
        { status: 403, statusText: "Forbidden" }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    try {
      await client.searchVideos("typescript", 14);
      expect(true).toBe(false);
    } catch (err) {
      expect((err as Error).name).toBe("YouTubeQuotaExhaustedError");
      expect((err as Error).message).toBe("YouTube API quota exhausted or rate-limited");
    }
    expect(mockRpc).toHaveBeenCalledWith("reserve_youtube_units", {
      p_units: 100,
      p_ceiling: 3000,
      p_call_type: "search",
    });
  });

  it("falls back to 3000 for negative ceiling", async () => {
    process.env.YOUTUBE_API_KEY = "test-key";
    process.env.YOUTUBE_DAILY_UNIT_CEILING = "-5";
    const { createYouTubeClient } = await import("@/lib/youtube/client");
    const client = createYouTubeClient();

    const { createServiceRoleClient } = await import("@/lib/supabase/service-role");
    (createServiceRoleClient as ReturnType<typeof vi.fn>).mockReturnValue({
      rpc: mockRpc,
    });
    mockRpc.mockResolvedValue({ data: true, error: null });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ error: { code: 403, message: "quotaExceeded", errors: [{ reason: "quotaExceeded" }] } }),
        { status: 403, statusText: "Forbidden" }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    try {
      await client.searchVideos("typescript", 14);
      expect(true).toBe(false);
    } catch (err) {
      expect((err as Error).name).toBe("YouTubeQuotaExhaustedError");
      expect((err as Error).message).toBe("YouTube API quota exhausted or rate-limited");
    }
    expect(mockRpc).toHaveBeenCalledWith("reserve_youtube_units", {
      p_units: 100,
      p_ceiling: 3000,
      p_call_type: "search",
    });
  });

  it("clamps ceiling to 9000 maximum", async () => {
    process.env.YOUTUBE_API_KEY = "test-key";
    process.env.YOUTUBE_DAILY_UNIT_CEILING = "99999";
    const { createYouTubeClient } = await import("@/lib/youtube/client");
    const client = createYouTubeClient();

    const { createServiceRoleClient } = await import("@/lib/supabase/service-role");
    (createServiceRoleClient as ReturnType<typeof vi.fn>).mockReturnValue({
      rpc: mockRpc,
    });
    mockRpc.mockResolvedValue({ data: true, error: null });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ error: { code: 403, message: "quotaExceeded", errors: [{ reason: "quotaExceeded" }] } }),
        { status: 403, statusText: "Forbidden" }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    try {
      await client.searchVideos("typescript", 14);
      expect(true).toBe(false);
    } catch (err) {
      expect((err as Error).name).toBe("YouTubeQuotaExhaustedError");
      expect((err as Error).message).toBe("YouTube API quota exhausted or rate-limited");
    }
    expect(mockRpc).toHaveBeenCalledWith("reserve_youtube_units", {
      p_units: 100,
      p_ceiling: 9000,
      p_call_type: "search",
    });
  });

  it("parses valid ceiling", async () => {
    process.env.YOUTUBE_API_KEY = "test-key";
    process.env.YOUTUBE_DAILY_UNIT_CEILING = "5000";
    const { createYouTubeClient } = await import("@/lib/youtube/client");
    const client = createYouTubeClient();

    const { createServiceRoleClient } = await import("@/lib/supabase/service-role");
    (createServiceRoleClient as ReturnType<typeof vi.fn>).mockReturnValue({
      rpc: mockRpc,
    });
    mockRpc.mockResolvedValue({ data: true, error: null });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ error: { code: 403, message: "quotaExceeded", errors: [{ reason: "quotaExceeded" }] } }),
        { status: 403, statusText: "Forbidden" }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    try {
      await client.searchVideos("typescript", 14);
      expect(true).toBe(false);
    } catch (err) {
      expect((err as Error).name).toBe("YouTubeQuotaExhaustedError");
      expect((err as Error).message).toBe("YouTube API quota exhausted or rate-limited");
    }
    expect(mockRpc).toHaveBeenCalledWith("reserve_youtube_units", {
      p_units: 100,
      p_ceiling: 5000,
      p_call_type: "search",
    });
  });
});
