import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

// ---------------------------------------------------------------------------
// server-only is a build-time guard; silence it in the test environment
// ---------------------------------------------------------------------------
vi.mock("server-only", () => ({}));

// ---------------------------------------------------------------------------
// Mocks — must be at top level so vitest can hoist them
// ---------------------------------------------------------------------------
let maybeSingleMock: ReturnType<typeof vi.fn>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockServiceRole: any = {
  from: vi.fn(() => ({
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        maybeSingle: vi.fn(),
      })),
    })),
  })),
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }) },
  }),
}));

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: vi.fn().mockReturnValue(mockServiceRole),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("GET /api/tutorial-lessons/[video_id]", () => {
  beforeEach(() => {
    vi.resetModules();
    maybeSingleMock = vi.fn();
    mockServiceRole.from.mockClear();
    mockServiceRole.from.mockReturnValue({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: maybeSingleMock,
        })),
      })),
    });
  });

  it("returns 500 for generation_status = 'failed'", async () => {
    const { GET } = await import("@/app/api/tutorial-lessons/[video_id]/route");
    maybeSingleMock.mockResolvedValue({
      data: {
        video_id: "ABCDEFGHIJK",
        sections: [],
        summary: null,
        generated_at: "2026-01-01T00:00:00Z",
        model: "openai/gpt-4o-mini",
        generation_status: "failed",
        generation_error: "Model quota exhausted",
      },
      error: null,
    });

    const req = new Request("http://localhost/api/tutorial-lessons/ABCDEFGHIJK") as unknown as NextRequest;
    const res = await GET(req, { params: Promise.resolve({ video_id: "ABCDEFGHIJK" }) });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Lesson generation failed");
    expect(body.status).toBe("failed");
    expect(body.reason).toBe("Model quota exhausted");
  });

  it("returns 202 for generation_status = 'processing'", async () => {
    const { GET } = await import("@/app/api/tutorial-lessons/[video_id]/route");
    maybeSingleMock.mockResolvedValue({
      data: {
        video_id: "KJIHGFEDCBA",
        sections: [],
        summary: null,
        generated_at: null,
        model: "openai/gpt-4o-mini",
        generation_status: "processing",
        generation_error: null,
      },
      error: null,
    });

    const req = new Request("http://localhost/api/tutorial-lessons/KJIHGFEDCBA") as unknown as NextRequest;
    const res = await GET(req, { params: Promise.resolve({ video_id: "KJIHGFEDCBA" }) });

    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.error).toBe("Notes are still being generated");
    expect(body.status).toBe("processing");
  });

  it("returns 200 for generation_status = 'completed'", async () => {
    const { GET } = await import("@/app/api/tutorial-lessons/[video_id]/route");
    maybeSingleMock.mockResolvedValue({
      data: {
        video_id: "12345678901",
        sections: [{ start_seconds: 0, heading: "Intro", key_points: ["point"] }],
        summary: "Summary text",
        generated_at: "2026-01-01T00:00:00Z",
        model: "openai/gpt-4o-mini",
        generation_status: "completed",
        generation_error: null,
      },
      error: null,
    });

    const req = new Request("http://localhost/api/tutorial-lessons/12345678901") as unknown as NextRequest;
    const res = await GET(req, { params: Promise.resolve({ video_id: "12345678901" }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.video_id).toBe("12345678901");
    expect(body.sections).toHaveLength(1);
    expect(body.summary).toBe("Summary text");
  });
});
