import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// server-only is a build-time guard; silence it in the test environment
// ---------------------------------------------------------------------------
vi.mock("server-only", () => ({}));

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
const mockRpc = vi.fn();

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
  rpcResult?: unknown;
  rpcError?: { message: string } | null;
}) {
  const { rpcResult = null, rpcError = null } = config;

  return {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        })),
      })),
      upsert: vi.fn(() => ({ error: null })),
      delete: vi.fn(() => ({
        eq: vi.fn(() => ({ error: null })),
      })),
    })),
    rpc: vi.fn(() => {
      if (rpcError) {
        return Promise.resolve({ data: null, error: rpcError });
      }
      return Promise.resolve({ data: rpcResult, error: null });
    }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("POST /api/cron/tutorial-index/ondemand (thin enqueue)", () => {
  beforeEach(() => {
    vi.resetModules();
    mockRpc.mockClear();
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

    const { POST } = await import("@/app/api/cron/tutorial-index/ondemand/route");

    const req = new Request("http://localhost/api/cron/tutorial-index/ondemand", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skill: "typescript" }),
    }) as unknown as NextRequest;

    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("enqueues a known skill via RPC and returns ok:true", async () => {
    const mockSupabase = createMockSupabase({ rpcResult: null });

    const { createClient } = await import("@/lib/supabase/server");
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1", email: "test@example.com" } } }),
      },
    });

    const { createServiceRoleClient } = await import("@/lib/supabase/service-role");
    (createServiceRoleClient as ReturnType<typeof vi.fn>).mockReturnValue(mockSupabase);

    const { POST } = await import("@/app/api/cron/tutorial-index/ondemand/route");

    const req = new Request("http://localhost/api/cron/tutorial-index/ondemand", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skill: "typescript" }),
    }) as unknown as NextRequest;

    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.enqueued).toBe(true);
    expect(body.skill).toBe("typescript");
    expect(mockSupabase.rpc).toHaveBeenCalledWith("enqueue_discovery_request", {
      p_skill: "typescript",
    });
  });

  it("returns 500 when the enqueue RPC fails instead of reporting success", async () => {
    const mockSupabase = createMockSupabase({ rpcError: { message: "function does not exist" } });

    const { createClient } = await import("@/lib/supabase/server");
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1", email: "test@example.com" } } }),
      },
    });

    const { createServiceRoleClient } = await import("@/lib/supabase/service-role");
    (createServiceRoleClient as ReturnType<typeof vi.fn>).mockReturnValue(mockSupabase);

    const { POST } = await import("@/app/api/cron/tutorial-index/ondemand/route");

    const req = new Request("http://localhost/api/cron/tutorial-index/ondemand", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skill: "typescript" }),
    }) as unknown as NextRequest;

    const res = await POST(req);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("function does not exist");
    expect(body.enqueued).toBeUndefined();
  });

  it("rejects unknown skills with 400", async () => {
    const { createClient } = await import("@/lib/supabase/server");
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1", email: "test@example.com" } } }),
      },
    });

    const { POST } = await import("@/app/api/cron/tutorial-index/ondemand/route");

    const req = new Request("http://localhost/api/cron/tutorial-index/ondemand", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skill: "not-a-real-skill" }),
    }) as unknown as NextRequest;

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("returns 500 when Supabase service-role client is missing", async () => {
    const { createClient } = await import("@/lib/supabase/server");
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1", email: "test@example.com" } } }),
      },
    });

    const { createServiceRoleClient } = await import("@/lib/supabase/service-role");
    (createServiceRoleClient as ReturnType<typeof vi.fn>).mockReturnValue(null);

    const { POST } = await import("@/app/api/cron/tutorial-index/ondemand/route");

    const req = new Request("http://localhost/api/cron/tutorial-index/ondemand", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skill: "typescript" }),
    }) as unknown as NextRequest;

    const res = await POST(req);
    expect(res.status).toBe(500);
  });
});
