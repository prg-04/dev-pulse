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

type OndemandLogRow = { id: string; user_id: string; skill: string; created_at: string };

interface MockQuery {
  select: (...args: unknown[]) => MockQuery;
  eq: (col: string, val: unknown) => MockQuery;
  gte: (col: string, val: string) => MockQuery;
  limit: (n: number) => MockQuery;
  maybeSingle: () => Promise<{ data: unknown; error: null }>;
  insert: (row: unknown) => Promise<{ data: null; error: null }>;
  upsert: (...args: unknown[]) => { error: null };
  delete: (...args: unknown[]) => MockQuery;
  then: (resolve: (v: { data: unknown; error: null }) => unknown) => Promise<unknown>;
}

function makeQuery(rows: Array<Record<string, unknown>> | null, opts: { matchEq?: boolean } = {}): MockQuery {
  const eqFilters: Array<[string, unknown]> = [];
  let gteFilter: [string, string] | null = null;
  let limitN: number | null = null;
  const apply = () => {
    let out = (rows ?? []).slice();
    if (opts.matchEq) out = out.filter((r) => eqFilters.every(([c, v]) => r[c] === v));
    if (gteFilter) {
      const [c, v] = gteFilter;
      out = out.filter((r) => String(r[c]) >= v);
    }
    if (limitN != null) out = out.slice(0, limitN);
    return out;
  };
  const q: MockQuery = {
    select: () => q,
    eq: (col, val) => {
      eqFilters.push([col, val]);
      return q;
    },
    gte: (col, val) => {
      gteFilter = [col, val];
      return q;
    },
    limit: (n) => {
      limitN = n;
      return q;
    },
    maybeSingle: () => {
      const out = apply();
      return Promise.resolve({ data: out[0] ?? null, error: null });
    },
    insert: (row) => {
      if (Array.isArray(rows) && typeof row === "object" && row !== null) {
        rows.push(row as Record<string, unknown>);
      }
      return Promise.resolve({ data: null, error: null });
    },
    upsert: () => ({ error: null }),
    delete: () => q,
    then: (resolve) => Promise.resolve({ data: apply(), error: null }).then(resolve),
  };
  return q;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function createMockSupabase(config: {
  rpcResult?: unknown;
  rpcError?: { message: string } | null;
  ondemandLogRows?: OndemandLogRow[];
}) {
  const { rpcResult = null, rpcError = null, ondemandLogRows = [] } = config;
  const logRows = ondemandLogRows as Array<Record<string, unknown>>;

  return {
    from: vi.fn((table: string) => {
      if (table === "tutorial_ondemand_requests") {
        return makeQuery(logRows, { matchEq: true });
      }
      return makeQuery(null);
    }),
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

describe("POST /api/cron/tutorial-index/ondemand (per-user rate limit)", () => {
  const now = () => new Date().toISOString();

  async function postAsUser(skill: string, userId = "user-1") {
    const { createClient } = await import("@/lib/supabase/server");
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: userId, email: "test@example.com" } } }),
      },
    });

    const { POST } = await import("@/app/api/cron/tutorial-index/ondemand/route");
    const req = new Request("http://localhost/api/cron/tutorial-index/ondemand", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skill }),
    }) as unknown as NextRequest;
    return POST(req);
  }

  beforeEach(() => {
    vi.resetModules();
    (process.env as Record<string, string | undefined>).NEXT_PUBLIC_ENV = "development";
    (process.env as Record<string, string | undefined>).NODE_ENV = "test";
  });

  it("returns 429 when the user already made 5 requests in the last hour", async () => {
    const logRows: OndemandLogRow[] = ["typescript", "react", "python", "go", "rust"].map(
      (skill, i) => ({ id: `r${i}`, user_id: "user-1", skill, created_at: now() })
    );
    const mockSupabase = createMockSupabase({ ondemandLogRows: logRows });

    const { createServiceRoleClient } = await import("@/lib/supabase/service-role");
    (createServiceRoleClient as ReturnType<typeof vi.fn>).mockReturnValue(mockSupabase);

    const res = await postAsUser("kubernetes");
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toMatch(/Rate limit exceeded/);
    expect(mockSupabase.rpc).not.toHaveBeenCalled();
  });

  it("dedupes when the same user already requested the skill (no duplicate, no RPC)", async () => {
    const logRows: OndemandLogRow[] = [
      { id: "r0", user_id: "user-1", skill: "typescript", created_at: now() },
    ];
    const mockSupabase = createMockSupabase({ ondemandLogRows: logRows });

    const { createServiceRoleClient } = await import("@/lib/supabase/service-role");
    (createServiceRoleClient as ReturnType<typeof vi.fn>).mockReturnValue(mockSupabase);

    const res = await postAsUser("typescript");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.enqueued).toBe(false);
    expect(body.deduped).toBe(true);
    expect(mockSupabase.rpc).not.toHaveBeenCalled();
    expect(logRows).toHaveLength(1);
  });

  it("does not share rate-limit buckets between users", async () => {
    const logRows: OndemandLogRow[] = ["typescript", "react", "python", "go", "rust"].map(
      (skill, i) => ({ id: `other${i}`, user_id: "user-2", skill, created_at: now() })
    );
    const mockSupabase = createMockSupabase({ ondemandLogRows: logRows });

    const { createServiceRoleClient } = await import("@/lib/supabase/service-role");
    (createServiceRoleClient as ReturnType<typeof vi.fn>).mockReturnValue(mockSupabase);

    const res = await postAsUser("kubernetes", "user-1");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.enqueued).toBe(true);
    expect(mockSupabase.rpc).toHaveBeenCalledWith("enqueue_discovery_request", {
      p_skill: "kubernetes",
    });
    expect(logRows).toHaveLength(6);
    expect(logRows[5]).toMatchObject({ user_id: "user-1", skill: "kubernetes" });
  });
});
