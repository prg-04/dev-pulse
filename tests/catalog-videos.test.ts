import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// server-only is a build-time guard; silence it in the test environment
// ---------------------------------------------------------------------------
vi.mock("server-only", () => ({}));

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function createMockSupabase(config: {
  catalogRows?: Array<{
    video_id: string;
    title: string;
    channel_name: string;
    thumbnail_url: string;
    duration_seconds: number | null;
    view_count: bigint | null;
    published_at: string | null;
    rank: number;
    source: string;
    fetched_at: string;
  }>;
  queryError?: { message: string } | null;
}) {
  const { catalogRows = [], queryError = null } = config;

  return {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          order: vi.fn(() => ({
            data: catalogRows,
            error: queryError,
          })),
        })),
      })),
    })),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("GET /api/catalog/videos", () => {
  beforeEach(() => {
    vi.resetModules();
    (process.env as Record<string, string | undefined>).NEXT_PUBLIC_ENV = "development";
    (process.env as Record<string, string | undefined>).NODE_ENV = "test";
  });

  it("returns 401 when not authenticated and not in dev bypass", async () => {
    (process.env as Record<string, string | undefined>).NEXT_PUBLIC_ENV = "production";
    const { createClient } = await import("@/lib/supabase/server");
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
      },
    });

    const { GET } = await import("@/app/api/catalog/videos/route");

    const req = new Request("http://localhost/api/catalog/videos?skill=typescript", {
      headers: {},
    });

    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it("returns catalog videos ordered by rank for a known skill", async () => {
    const mockSupabase = createMockSupabase({
      catalogRows: [
        {
          video_id: "vid1",
          title: "TypeScript Tutorial",
          channel_name: "Channel One",
          thumbnail_url: "https://img.youtube.com/vi/vid1/hqdefault.jpg",
          duration_seconds: 600,
          view_count: BigInt(100000),
          published_at: "2024-01-01T00:00:00Z",
          rank: 1,
          source: "youtube_api",
          fetched_at: "2024-01-01T00:00:00Z",
        },
        {
          video_id: "vid2",
          title: "Advanced TypeScript",
          channel_name: "Channel Two",
          thumbnail_url: "https://img.youtube.com/vi/vid2/hqdefault.jpg",
          duration_seconds: 1200,
          view_count: BigInt(50000),
          published_at: "2024-01-02T00:00:00Z",
          rank: 2,
          source: "youtube_api",
          fetched_at: "2024-01-01T00:00:00Z",
        },
      ],
    });

    const { createClient } = await import("@/lib/supabase/server");
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1", email: "test@example.com" } } }),
      },
    });

    const { createServiceRoleClient } = await import("@/lib/supabase/service-role");
    (createServiceRoleClient as ReturnType<typeof vi.fn>).mockReturnValue(mockSupabase);

    const { GET } = await import("@/app/api/catalog/videos/route");

    const req = new Request("http://localhost/api/catalog/videos?skill=typescript", {
      headers: {},
    });

    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.videos).toHaveLength(2);
    expect(body.videos[0].video_id).toBe("vid1");
    expect(body.videos[0].rank).toBe(1);
    expect(body.videos[1].video_id).toBe("vid2");
    expect(body.videos[1].rank).toBe(2);
  });

  it("returns empty array for a known skill with no catalog rows", async () => {
    const mockSupabase = createMockSupabase({ catalogRows: [] });

    const { createClient } = await import("@/lib/supabase/server");
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1", email: "test@example.com" } } }),
      },
    });

    const { createServiceRoleClient } = await import("@/lib/supabase/service-role");
    (createServiceRoleClient as ReturnType<typeof vi.fn>).mockReturnValue(mockSupabase);

    const { GET } = await import("@/app/api/catalog/videos/route");

    const req = new Request("http://localhost/api/catalog/videos?skill=typescript", {
      headers: {},
    });

    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.videos).toHaveLength(0);
  });

  it("rejects unknown skills with 400", async () => {
    const { createClient } = await import("@/lib/supabase/server");
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1", email: "test@example.com" } } }),
      },
    });

    const { GET } = await import("@/app/api/catalog/videos/route");

    const req = new Request("http://localhost/api/catalog/videos?skill=not-a-real-skill", {
      headers: {},
    }) as unknown as NextRequest;

    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 when skill query param is missing", async () => {
    const { createClient } = await import("@/lib/supabase/server");
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1", email: "test@example.com" } } }),
      },
    });

    const { GET } = await import("@/app/api/catalog/videos/route");

    const req = new Request("http://localhost/api/catalog/videos", {
      headers: {},
    }) as unknown as NextRequest;

    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it("returns 500 when service-role client is missing", async () => {
    const { createClient } = await import("@/lib/supabase/server");
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1", email: "test@example.com" } } }),
      },
    });

    const { createServiceRoleClient } = await import("@/lib/supabase/service-role");
    (createServiceRoleClient as ReturnType<typeof vi.fn>).mockReturnValue(null);

    const { GET } = await import("@/app/api/catalog/videos/route");

    const req = new Request("http://localhost/api/catalog/videos?skill=typescript", {
      headers: {},
    });

    const res = await GET(req);
    expect(res.status).toBe(500);
  });

  it("returns 500 on query error", async () => {
    const mockSupabase = createMockSupabase({
      queryError: { message: "database error" },
    });

    const { createClient } = await import("@/lib/supabase/server");
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1", email: "test@example.com" } } }),
      },
    });

    const { createServiceRoleClient } = await import("@/lib/supabase/service-role");
    (createServiceRoleClient as ReturnType<typeof vi.fn>).mockReturnValue(mockSupabase);

    const { GET } = await import("@/app/api/catalog/videos/route");

    const req = new Request("http://localhost/api/catalog/videos?skill=typescript", {
      headers: {},
    });

    const res = await GET(req);
    expect(res.status).toBe(500);
  });
});
