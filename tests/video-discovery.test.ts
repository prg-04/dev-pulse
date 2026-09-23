import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// server-only is a build-time guard; silence it in the test environment
// ---------------------------------------------------------------------------
vi.mock("server-only", () => ({}));

// ---------------------------------------------------------------------------
// Local error classes (avoid top-level import from mocked module)
// ---------------------------------------------------------------------------
class YouTubeQuotaExhaustedError extends Error {
  constructor() {
    super("YouTube API quota exhausted or rate-limited");
    this.name = "YouTubeQuotaExhaustedError";
  }
}

class QuotaBudgetExceededError extends Error {
  constructor(
    public readonly requested: number,
    public readonly remaining: number
  ) {
    super(`Quota budget exceeded: requested ${requested}, ceiling ${remaining}`);
    this.name = "QuotaBudgetExceededError";
  }
}

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
const mockRpc = vi.fn();

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: vi.fn(),
}));

vi.mock("@/lib/youtube/client", () => ({
  createYouTubeClient: vi.fn(),
  YouTubeQuotaExhaustedError,
  QuotaBudgetExceededError,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const ALL_SKILLS = [
  "typescript",
  "javascript",
  "react",
  "next.js",
  "vue",
  "angular",
  "svelte",
  "node.js",
  "python",
  "go",
  "rust",
  "java",
  "c++",
  "swift",
  "kotlin",
  "flutter",
  "django",
  "laravel",
  "elixir",
  "graphql",
  "tailwindcss",
  "postgresql",
  "mongodb",
  "redis",
  "docker",
  "kubernetes",
  "aws",
];

function createMockSupabase(config: {
  usageRow?: { units_consumed: number } | null;
  discoveryRequests?: Array<{ skill: string; request_count: number; requested_at: string }>;
  catalogSkills?: string[];
  catalogRows?: Array<{ skill: string; fetched_at: string }>;
  statusRows?: Array<{ skill: string; gap_mentions_30d: number }>;
  upsertError?: { message: string } | null;
  deleteError?: { message: string } | null;
}) {
  const {
    usageRow = { units_consumed: 0 },
    discoveryRequests = [],
    catalogSkills = [],
    catalogRows = [],
    statusRows = [],
    upsertError = null,
    deleteError = null,
  } = config;

  const capturedDeleteCalls: Array<{ skill: string; source: string; notIn?: string[] }> = [];
  const capturedUpsertCalls: Array<{ skill: string; count: number }> = [];

  const from = vi.fn((table: string) => {
    if (table === "youtube_daily_usage") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn().mockResolvedValue({ data: usageRow, error: null }),
          })),
        })),
      };
    }

    if (table === "discovery_requests") {
      const orderChain = {
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: discoveryRequests, error: null }),
      };

      return {
        select: vi.fn(() => ({
          order: vi.fn(() => orderChain),
        })),
        delete: vi.fn(() => ({
          eq: vi.fn(() => ({ error: null })),
        })),
      };
    }

    if (table === "skill_video_catalog") {
      return {
        select: vi.fn(() => ({
          order: vi.fn(() => ({
            data: catalogRows,
            error: null,
          })),
          data: catalogSkills.map((s) => ({ skill: s })),
          error: null,
        })),
        delete: vi.fn(() => {
          let eqSkill = vi.fn(() => {
            let eqSource = vi.fn(() => {
              const notMock = vi.fn((_column: string, _op: string, value: unknown) => {
                // Capture the not-in argument as an array when passed natively
                if (Array.isArray(value)) {
                  capturedDeleteCalls.push({ skill: "typescript", source: "youtube_api", notIn: value });
                }
                return { error: deleteError ?? null };
              });
              return {
                not: notMock,
                error: null,
              };
            });
            return {
              eq: eqSource,
            };
          });
          return {
            eq: eqSkill,
          };
        }),
        upsert: vi.fn((data: unknown) => {
          capturedUpsertCalls.push({ skill: "typescript", count: Array.isArray(data) ? data.length : 0 });
          return upsertError ? { error: upsertError } : { error: null };
        }),
      };
    }

    if (table === "skill_index_status") {
      return {
        select: vi.fn(() => ({
          data: statusRows,
          error: null,
        })),
      };
    }

    return {
      select: vi.fn(() => ({ data: [], error: null })),
      delete: vi.fn(() => ({
        eq: vi.fn(() => ({ error: null })),
      })),
      upsert: vi.fn(() => ({ error: null })),
    };
  });

  return { from, rpc: mockRpc, capturedDeleteCalls, capturedUpsertCalls };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("GET /api/cron/video-discovery", () => {
  beforeEach(() => {
    vi.resetModules();
    mockRpc.mockClear();
    process.env.CRON_SECRET = "cron-secret";
    process.env.YOUTUBE_API_KEY = "test-youtube-key";
    process.env.YOUTUBE_DAILY_UNIT_CEILING = "3000";
    process.env.VIDEO_DISCOVERY_BATCH = "10";
    process.env.VIDEO_DISCOVERY_MAX_RESULTS = "10";
    process.env.VIDEO_DISCOVERY_WALL_CLOCK_LIMIT_MS = "300000";
  });

  it("returns 401 without correct CRON_SECRET", async () => {
    const { createServiceRoleClient } = await import("@/lib/supabase/service-role");
    (createServiceRoleClient as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn(),
    });

    const { GET } = await import("@/app/api/cron/video-discovery/route");

    const req = new Request("http://localhost/api/cron/video-discovery", {
      headers: { authorization: "Bearer wrong" },
    }) as unknown as NextRequest;

    const res = await GET(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("falls back to Group C when no discovery requests and all skills have catalog rows", async () => {
    const mockSupabase = createMockSupabase({
      usageRow: { units_consumed: 0 },
      discoveryRequests: [],
      catalogSkills: ALL_SKILLS,
      catalogRows: [
        { skill: "typescript", fetched_at: "2024-01-01T00:00:00Z" },
        { skill: "react", fetched_at: "2024-01-02T00:00:00Z" },
      ],
    });

    const { createServiceRoleClient } = await import("@/lib/supabase/service-role");
    (createServiceRoleClient as ReturnType<typeof vi.fn>).mockReturnValue(mockSupabase);

    const mockYouTube = {
      searchVideos: vi.fn().mockResolvedValue([
        {
          video_id: "vid1",
          title: "Test",
          channel_name: "Channel",
          view_count: 100000,
          duration_seconds: 600,
          published_at: "2024-01-01T00:00:00Z",
          description: "Desc",
        },
      ]),
    };

    const { createYouTubeClient } = await import("@/lib/youtube/client");
    (createYouTubeClient as ReturnType<typeof vi.fn>).mockReturnValue(mockYouTube);

    const { GET } = await import("@/app/api/cron/video-discovery/route");

    const req = new Request("http://localhost/api/cron/video-discovery", {
      headers: { authorization: "Bearer cron-secret" },
    }) as unknown as NextRequest;

    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    // When all skills have catalog rows, Group B is empty; Group C returns the stalest skills
    expect(body.skills_processed.length).toBeGreaterThan(0);
    expect(body.skills_processed[0]).toBe("typescript");
  });

  it("selects batch in priority order: queued > no-catalog > stalest", async () => {
    const mockSupabase = createMockSupabase({
      usageRow: { units_consumed: 0 },
      discoveryRequests: [
        { skill: "react", request_count: 5, requested_at: "2024-01-02T00:00:00Z" },
        { skill: "typescript", request_count: 3, requested_at: "2024-01-01T00:00:00Z" },
      ],
      // All skills have catalog rows so Group B is empty
      catalogSkills: ALL_SKILLS,
      catalogRows: [
        { skill: "react", fetched_at: "2024-01-03T00:00:00Z" },
        { skill: "typescript", fetched_at: "2024-01-04T00:00:00Z" },
      ],
    });

    const { createServiceRoleClient } = await import("@/lib/supabase/service-role");
    (createServiceRoleClient as ReturnType<typeof vi.fn>).mockReturnValue(mockSupabase);

    const mockYouTube = {
      searchVideos: vi.fn().mockResolvedValue([
        {
          video_id: "vid1",
          title: "Test",
          channel_name: "Channel",
          view_count: 100000,
          duration_seconds: 600,
          published_at: "2024-01-01T00:00:00Z",
          description: "Desc",
        },
      ]),
    };

    const { createYouTubeClient } = await import("@/lib/youtube/client");
    (createYouTubeClient as ReturnType<typeof vi.fn>).mockReturnValue(mockYouTube);

    const { GET } = await import("@/app/api/cron/video-discovery/route");

    const req = new Request("http://localhost/api/cron/video-discovery", {
      headers: { authorization: "Bearer cron-secret" },
    }) as unknown as NextRequest;

    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    // Group A first (ordered by request_count desc)
    expect(body.skills_processed).toEqual(["react", "typescript"]);
  });

  it("quota error stops the run without marking skipped skill as failed", async () => {
    const mockSupabase = createMockSupabase({
      usageRow: { units_consumed: 0 },
      discoveryRequests: [
        { skill: "react", request_count: 1, requested_at: "2024-01-01T00:00:00Z" },
        { skill: "typescript", request_count: 1, requested_at: "2024-01-01T00:00:00Z" },
      ],
      catalogSkills: ALL_SKILLS,
    });

    const { createServiceRoleClient } = await import("@/lib/supabase/service-role");
    (createServiceRoleClient as ReturnType<typeof vi.fn>).mockReturnValue(mockSupabase);

    const mockYouTube = {
      searchVideos: vi
        .fn()
        .mockRejectedValueOnce(new QuotaBudgetExceededError(100, 3000))
        .mockResolvedValueOnce([
          {
            video_id: "vid1",
            title: "Test",
            channel_name: "Channel",
            view_count: 100000,
            duration_seconds: 600,
            published_at: "2024-01-01T00:00:00Z",
            description: "Desc",
          },
        ]),
    };

    const { createYouTubeClient } = await import("@/lib/youtube/client");
    (createYouTubeClient as ReturnType<typeof vi.fn>).mockReturnValue(mockYouTube);

    const { GET } = await import("@/app/api/cron/video-discovery/route");

    const req = new Request("http://localhost/api/cron/video-discovery", {
      headers: { authorization: "Bearer cron-secret" },
    }) as unknown as NextRequest;

    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.skills_processed).toEqual([]);
    // typescript should be in skipped_budget, not failed
    expect(body.skills_skipped_budget).toContain("typescript");
    expect(body.skills_failed).toEqual([]);
  });

  it("non-quota error on one skill does not abort the rest", async () => {
    const mockSupabase = createMockSupabase({
      usageRow: { units_consumed: 0 },
      discoveryRequests: [
        { skill: "react", request_count: 1, requested_at: "2024-01-01T00:00:00Z" },
        { skill: "typescript", request_count: 1, requested_at: "2024-01-01T00:00:00Z" },
      ],
      catalogSkills: ALL_SKILLS,
    });

    const { createServiceRoleClient } = await import("@/lib/supabase/service-role");
    (createServiceRoleClient as ReturnType<typeof vi.fn>).mockReturnValue(mockSupabase);

    const mockYouTube = {
      searchVideos: vi
        .fn()
        .mockRejectedValueOnce(new Error("Network timeout"))
        .mockResolvedValueOnce([
          {
            video_id: "vid1",
            title: "Test",
            channel_name: "Channel",
            view_count: 100000,
            duration_seconds: 600,
            published_at: "2024-01-01T00:00:00Z",
            description: "Desc",
          },
        ]),
    };

    const { createYouTubeClient } = await import("@/lib/youtube/client");
    (createYouTubeClient as ReturnType<typeof vi.fn>).mockReturnValue(mockYouTube);

    const { GET } = await import("@/app/api/cron/video-discovery/route");

    const req = new Request("http://localhost/api/cron/video-discovery", {
      headers: { authorization: "Bearer cron-secret" },
    }) as unknown as NextRequest;

    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.skills_processed).toEqual(["typescript"]);
    expect(body.skills_failed).toEqual([{ skill: "react", error: "Network timeout" }]);
    expect(body.skills_skipped_budget).toEqual([]);
  });

  it("removes stale youtube_api rows on refresh while preserving seed rows", async () => {
    const mockSupabase = createMockSupabase({
      usageRow: { units_consumed: 0 },
      discoveryRequests: [],
      catalogSkills: ALL_SKILLS,
      catalogRows: [{ skill: "typescript", fetched_at: "2024-01-01T00:00:00Z" }],
      deleteError: null,
    });

    const { createServiceRoleClient } = await import("@/lib/supabase/service-role");
    (createServiceRoleClient as ReturnType<typeof vi.fn>).mockReturnValue(mockSupabase);

    const mockYouTube = {
      searchVideos: vi.fn().mockResolvedValue([
        {
          video_id: "new-vid-1",
          title: "New Video",
          channel_name: "Channel",
          view_count: 100000,
          duration_seconds: 600,
          published_at: "2024-01-01T00:00:00Z",
          description: "Desc",
        },
        {
          video_id: "new-vid-2",
          title: "New Video 2",
          channel_name: "Channel",
          view_count: 50000,
          duration_seconds: 300,
          published_at: "2024-01-02T00:00:00Z",
          description: "Desc",
        },
      ]),
    };

    const { createYouTubeClient } = await import("@/lib/youtube/client");
    (createYouTubeClient as ReturnType<typeof vi.fn>).mockReturnValue(mockYouTube);

    const { GET } = await import("@/app/api/cron/video-discovery/route");

    const req = new Request("http://localhost/api/cron/video-discovery", {
      headers: { authorization: "Bearer cron-secret" },
    }) as unknown as NextRequest;

    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.skills_processed).toEqual(["typescript"]);

    // Verify stale youtube_api rows were deleted with correct not-in clause (array form)
    const deleteCall = mockSupabase.capturedDeleteCalls.find((c) => c.skill === "typescript");
    expect(deleteCall).toBeDefined();
    expect(deleteCall!.source).toBe("youtube_api");
    expect(deleteCall!.notIn).toEqual(["new-vid-1", "new-vid-2"]);
  });

  it("zero candidates leaves existing catalog rows untouched and does not call delete", async () => {
    const mockSupabase = createMockSupabase({
      usageRow: { units_consumed: 0 },
      discoveryRequests: [],
      catalogSkills: ALL_SKILLS,
      catalogRows: [{ skill: "typescript", fetched_at: "2024-01-01T00:00:00Z" }],
    });

    const { createServiceRoleClient } = await import("@/lib/supabase/service-role");
    (createServiceRoleClient as ReturnType<typeof vi.fn>).mockReturnValue(mockSupabase);

    const mockYouTube = {
      searchVideos: vi.fn().mockResolvedValue([]),
    };

    const { createYouTubeClient } = await import("@/lib/youtube/client");
    (createYouTubeClient as ReturnType<typeof vi.fn>).mockReturnValue(mockYouTube);

    const { GET } = await import("@/app/api/cron/video-discovery/route");

    const req = new Request("http://localhost/api/cron/video-discovery", {
      headers: { authorization: "Bearer cron-secret" },
    }) as unknown as NextRequest;

    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.skills_processed).toEqual(["typescript"]);

    // No delete or upsert should have been called for skill_video_catalog
    expect(mockSupabase.capturedDeleteCalls.length).toBe(0);
    expect(mockSupabase.capturedUpsertCalls.length).toBe(0);
  });

  it("upsert-then-delete order: a failed upsert never triggers a delete", async () => {
    const mockSupabase = createMockSupabase({
      usageRow: { units_consumed: 0 },
      discoveryRequests: [],
      catalogSkills: ALL_SKILLS,
      catalogRows: [{ skill: "typescript", fetched_at: "2024-01-01T00:00:00Z" }],
      upsertError: { message: "upsert failed" },
    });

    const { createServiceRoleClient } = await import("@/lib/supabase/service-role");
    (createServiceRoleClient as ReturnType<typeof vi.fn>).mockReturnValue(mockSupabase);

    const mockYouTube = {
      searchVideos: vi.fn().mockResolvedValue([
        {
          video_id: "new-vid-1",
          title: "New Video",
          channel_name: "Channel",
          view_count: 100000,
          duration_seconds: 600,
          published_at: "2024-01-01T00:00:00Z",
          description: "Desc",
        },
      ]),
    };

    const { createYouTubeClient } = await import("@/lib/youtube/client");
    (createYouTubeClient as ReturnType<typeof vi.fn>).mockReturnValue(mockYouTube);

    const { GET } = await import("@/app/api/cron/video-discovery/route");

    const req = new Request("http://localhost/api/cron/video-discovery", {
      headers: { authorization: "Bearer cron-secret" },
    }) as unknown as NextRequest;

    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.skills_failed).toEqual([{ skill: "typescript", error: "Failed to upsert skill_video_catalog: upsert failed" }]);

    // Upsert was called
    expect(mockSupabase.capturedUpsertCalls.length).toBe(1);
    // Delete was never called because upsert threw first
    expect(mockSupabase.capturedDeleteCalls.length).toBe(0);
  });

  it("budget check uses refreshed unitsRemainingToday without double-subtracting", async () => {
    // Simulate: first skill uses some units, second skill should still be processed
    // as long as refreshed unitsRemainingToday >= 101, not unitsRemainingToday - unitsUsedThisRun
    let usageConsumer: ((table: string) => unknown) | null = null;
    let usageCallCount = 0;

    const mockSupabase = createMockSupabase({
      usageRow: { units_consumed: 2899 },
      discoveryRequests: [
        { skill: "react", request_count: 1, requested_at: "2024-01-01T00:00:00Z" },
        { skill: "typescript", request_count: 1, requested_at: "2024-01-01T00:00:00Z" },
      ],
      catalogSkills: ALL_SKILLS,
    });

    // Capture the from function so we can override the usage chain dynamically
    usageConsumer = mockSupabase.from;

    // Override the from function to inject dynamic maybeSingle for usage reads
    // @ts-ignore - override for dynamic usage simulation
    mockSupabase.from = vi.fn((table: string) => {
      if (table === "youtube_daily_usage") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn().mockImplementation(async () => {
                usageCallCount++;
                if (usageCallCount === 1) {
                  // Initial read: 2899 consumed, 101 remaining (exactly at threshold)
                  return { data: { units_consumed: 2899 }, error: null };
                }
                // After first search (100 units), refreshed read: 2999 consumed, 1 remaining
                return { data: { units_consumed: 2999 }, error: null };
              }),
            })),
          })),
        };
      }
      return usageConsumer!(table);
    });

    const { createServiceRoleClient } = await import("@/lib/supabase/service-role");
    (createServiceRoleClient as ReturnType<typeof vi.fn>).mockReturnValue(mockSupabase);

    const mockYouTube = {
      searchVideos: vi.fn().mockResolvedValue([
        {
          video_id: "vid1",
          title: "Test",
          channel_name: "Channel",
          view_count: 100000,
          duration_seconds: 600,
          published_at: "2024-01-01T00:00:00Z",
          description: "Desc",
        },
      ]),
    };

    const { createYouTubeClient } = await import("@/lib/youtube/client");
    (createYouTubeClient as ReturnType<typeof vi.fn>).mockReturnValue(mockYouTube);

    const { GET } = await import("@/app/api/cron/video-discovery/route");

    const req = new Request("http://localhost/api/cron/video-discovery", {
      headers: { authorization: "Bearer cron-secret" },
    }) as unknown as NextRequest;

    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    // First skill (react) should process because initial remaining = 101 >= 101
    // Second skill (typescript) should be skipped_budget because refreshed remaining = 1 < 101
    expect(body.skills_processed).toEqual(["react"]);
    expect(body.skills_skipped_budget).toContain("typescript");
    expect(body.skills_failed).toEqual([]);
  });
});
