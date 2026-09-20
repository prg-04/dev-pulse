import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// server-only is a build-time guard; silence it in the test environment
// ---------------------------------------------------------------------------
vi.mock("server-only", () => ({}));

// ---------------------------------------------------------------------------
// Mock lesson-generation so the cron route does not call the real AI pipeline
// ---------------------------------------------------------------------------
const mockGenerateLessonBatch = vi.fn();

vi.mock("@/lib/lesson-generation", () => ({
  generateLessonBatch: (...args: unknown[]) => mockGenerateLessonBatch(...args),
  LESSON_BATCH_SIZE: 3,
  WINDOW_CHAR_BUDGET: 13000,
}));

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
const mockRpc = vi.fn();

interface ServiceRoleMockOptions {
  chaptersError?: { message: string } | null;
  chunksError?: { message: string } | null;
  chaptersData?: { start_seconds: number }[];
  chunksData?: { start_seconds: number; chunk_text: string }[];
  pendingRows?: {
    video_id: string;
    sections: unknown[];
    summary: string | null;
    windows_total: number;
    next_window_index: number;
    generation_status: string;
    generation_error: string | null;
  }[];
}

const buildMockServiceRole = (opts: ServiceRoleMockOptions) => {
  const chaptersOrder = vi.fn(() => ({
    data: opts.chaptersData ?? [],
    error: opts.chaptersError ?? null,
  }));

  const chunksOrder = vi.fn(() => ({
    data: opts.chunksData ?? [],
    error: opts.chunksError ?? null,
  }));

  const chaptersEq = vi.fn(() => ({
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        order: chaptersOrder,
      })),
    })),
  }));

  const chunksEq = vi.fn(() => ({
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        order: chunksOrder,
      })),
    })),
  }));

  const from = vi.fn((table: string) => {
    if (table === "tutorial_chapters") return chaptersEq();
    if (table === "tutorial_chunks") return chunksEq();
    if (table === "video_lessons") {
      const limit = vi.fn(() => ({
        data: opts.pendingRows ?? [],
        error: null,
      }));
      const eq1 = vi.fn(() => ({ limit }));
      const select = vi.fn(() => ({ eq: eq1 }));

      const eq2 = vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            error: null,
          })),
        })),
      }));
      const update = vi.fn(() => ({ eq: eq2 }));

      const upsert = vi.fn(() => ({ error: null }));

      return { select, update, upsert };
    }
    const defaultEq = vi.fn(() => ({
      order: vi.fn(() => ({ data: [], error: null })),
    }));
    return { select: vi.fn(() => ({ eq: defaultEq })) };
  });

  return { from, rpc: mockRpc };
};

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("POST /api/cron/tutorial-lesson-step", () => {
  beforeEach(() => {
    vi.resetModules();
    mockRpc.mockClear();
    mockGenerateLessonBatch.mockClear();
  });

  it("returns retry status when chapters query fails, without marking lesson failed", async () => {
    const { createServiceRoleClient } = await import("@/lib/supabase/service-role");
    (createServiceRoleClient as ReturnType<typeof vi.fn>).mockReturnValue(
      buildMockServiceRole({
        chaptersError: { message: "network timeout" },
        chunksData: [{ start_seconds: 0, chunk_text: "chunk" }],
        pendingRows: [
          {
            video_id: "vid-1",
            sections: [],
            summary: null,
            windows_total: 1,
            next_window_index: 0,
            generation_status: "processing",
            generation_error: null,
          },
        ],
      })
    );

    process.env.CRON_SECRET = "secret";
    const { POST } = await import("@/app/api/cron/tutorial-lesson-step/route");

    const req = new Request("http://localhost/api/cron/tutorial-lesson-step", {
      headers: { authorization: "Bearer secret" },
    }) as unknown as NextRequest;

    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results[0].status).toBe("retry");
    expect(body.results[0].error).toBe("network timeout");
    expect(body.failed).toBe(0);
  });

  it("returns retry status when chunks query fails, without marking lesson failed", async () => {
    const { createServiceRoleClient } = await import("@/lib/supabase/service-role");
    (createServiceRoleClient as ReturnType<typeof vi.fn>).mockReturnValue(
      buildMockServiceRole({
        chaptersData: [{ start_seconds: 0 }],
        chunksError: { message: "connection reset" },
        pendingRows: [
          {
            video_id: "vid-2",
            sections: [],
            summary: null,
            windows_total: 1,
            next_window_index: 0,
            generation_status: "processing",
            generation_error: null,
          },
        ],
      })
    );

    process.env.CRON_SECRET = "secret";
    const { POST } = await import("@/app/api/cron/tutorial-lesson-step/route");

    const req = new Request("http://localhost/api/cron/tutorial-lesson-step", {
      headers: { authorization: "Bearer secret" },
    }) as unknown as NextRequest;

    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results[0].status).toBe("retry");
    expect(body.results[0].error).toBe("connection reset");
    expect(body.failed).toBe(0);
  });

  it("still marks lesson as failed when both queries succeed but return empty data", async () => {
    const { createServiceRoleClient } = await import("@/lib/supabase/service-role");
    (createServiceRoleClient as ReturnType<typeof vi.fn>).mockReturnValue(
      buildMockServiceRole({
        chaptersData: [],
        chunksData: [],
        pendingRows: [
          {
            video_id: "vid-3",
            sections: [],
            summary: null,
            windows_total: 1,
            next_window_index: 0,
            generation_status: "processing",
            generation_error: null,
          },
        ],
      })
    );

    process.env.CRON_SECRET = "secret";
    const { POST } = await import("@/app/api/cron/tutorial-lesson-step/route");

    const req = new Request("http://localhost/api/cron/tutorial-lesson-step", {
      headers: { authorization: "Bearer secret" },
    }) as unknown as NextRequest;

    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results[0].status).toBe("failed");
    expect(body.results[0].error).toBe("No chapters or chunks available for resume");
    expect(body.failed).toBe(1);
  });

  it("processes normally when both queries succeed with data", async () => {
    mockRpc.mockResolvedValue(undefined);
    mockGenerateLessonBatch.mockResolvedValue({
      summary: "Summary",
      sections: [{ start_seconds: 0, heading: "Section", key_points: ["point"] }],
      stats: {
        windowsTotal: 1,
        windowsSucceeded: 1,
        windowsSkipped: 0,
        windowsFallbackTimestamp: 0,
        windowsTruncated: 0,
        skipReasons: {},
      },
    });

    const { createServiceRoleClient } = await import("@/lib/supabase/service-role");
    (createServiceRoleClient as ReturnType<typeof vi.fn>).mockReturnValue(
      buildMockServiceRole({
        chaptersData: [{ start_seconds: 0 }],
        chunksData: [{ start_seconds: 0, chunk_text: "chunk" }],
        pendingRows: [
          {
            video_id: "vid-4",
            sections: [],
            summary: null,
            windows_total: 1,
            next_window_index: 0,
            generation_status: "processing",
            generation_error: null,
          },
        ],
      })
    );

    process.env.CRON_SECRET = "secret";
    const { POST } = await import("@/app/api/cron/tutorial-lesson-step/route");

    const req = new Request("http://localhost/api/cron/tutorial-lesson-step", {
      headers: { authorization: "Bearer secret" },
    }) as unknown as NextRequest;

    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    // Should not be retry or failed — processing continues
    expect(body.results[0].status).not.toBe("retry");
    expect(body.results[0].status).not.toBe("failed");
  });
});
