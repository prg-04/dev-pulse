import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Mocks — Resend is fully mocked: no live API calls can leave this process.
// ---------------------------------------------------------------------------
const { mockSend } = vi.hoisted(() => ({
  mockSend: vi.fn(() => Promise.resolve({ data: { id: "mock-email-id" }, error: null })),
}));

vi.mock("resend", () => ({
  Resend: vi.fn(function () {
    return { emails: { send: mockSend } };
  }),
}));

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Env must be set before the route module is (dynamically) imported,
// because it captures RESEND_API_KEY at module top level.
// ---------------------------------------------------------------------------
(process.env as Record<string, string | undefined>).CRON_SECRET = "test-secret";
(process.env as Record<string, string | undefined>).RESEND_API_KEY = "re_test_key";
(process.env as Record<string, string | undefined>).NODE_ENV = "test";

// ---------------------------------------------------------------------------
// Chainable Supabase mock: every link returns the query object itself, which
// is thenable (awaited directly) and terminates via maybeSingle()/insert().
// Canned per-table payloads simulate one opted-in user, one qualifying job,
// and an empty dispatch log (dedup = false).
// ---------------------------------------------------------------------------
const USER_ID = "user-1";
const USER_EMAIL = "evans@example.com";
const USER_NAME = "e2e Test";

function makeQuery(data: unknown, opts: { matchEq?: boolean } = {}) {
  const q: Record<string, (...args: unknown[]) => unknown> = {};
  const eqFilters: Array<[string, unknown]> = [];
  for (const m of ["select", "gte", "order", "limit", "in", "or", "not"]) {
    q[m] = () => q;
  }
  q.eq = (col: unknown, val: unknown) => {
    eqFilters.push([col as string, val]);
    return q;
  };
  const applyEq = (rows: unknown) =>
    opts.matchEq && Array.isArray(rows)
      ? rows.filter((r) =>
          eqFilters.every(([c, v]) => (r as Record<string, unknown>)[c] === v)
        )
      : rows;
  q.maybeSingle = () => {
    const rows = applyEq(data);
    return Promise.resolve(
      Array.isArray(rows) ? { data: rows[0] ?? null, error: null } : { data: rows, error: null }
    );
  };
  q.then = ((resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: applyEq(data), error: null }).then(resolve)) as (...args: unknown[]) => unknown;
  q.insert = () => Promise.resolve({ data: null, error: null });
  return q;
}

function createMockSupabase(opts: { dispatchLogRows?: unknown[] } = {}) {
  const tableData: Record<string, unknown> = {
    alert_preferences: [
      {
        user_id: USER_ID,
        instant_match_alert: true,
        instant_match_threshold: 50,
        weekly_digest: false,
        learning_gap_dispatch: false,
      },
    ],
    profiles: [
      {
        id: USER_ID,
        full_name: USER_NAME,
        monitored_sources: ["hackernews", "arbeitnow"],
      },
    ],
    user_skills: [{ skill: "typescript" }],
    ingestion_runs: [
      {
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        status: "success",
      },
    ],
    job_postings: [
      {
        id: "job-1",
        title: "Senior TypeScript Engineer",
        company: "Acme",
        external_url: "https://example.com/jobs/1",
        skill_mentions: [{ skill: "typescript" }],
      },
    ],
    alert_dispatch_log: opts.dispatchLogRows ?? [],
  };
  return {
    from: vi.fn((table: string) =>
      makeQuery(tableData[table] ?? null, { matchEq: table === "alert_dispatch_log" })
    ),
    auth: {
      admin: {
        getUserById: vi.fn((id: string) =>
          Promise.resolve({
            data: { user: id === USER_ID ? { email: USER_EMAIL } : null },
            error: null,
          })
        ),
      },
    },
  };
}

function cronRequest() {
  return new Request("http://localhost/api/cron/alert-dispatch", {
    headers: { Authorization: "Bearer test-secret" },
  }) as unknown as NextRequest;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("GET /api/cron/alert-dispatch (recipient honesty)", () => {
  beforeEach(() => {
    vi.resetModules();
    mockSend.mockClear();
  });

  it("sends instant-match email TO the verified auth email, not the display name", async () => {
    const mockSupabase = createMockSupabase();

    const { createServiceRoleClient } = await import("@/lib/supabase/service-role");
    (createServiceRoleClient as ReturnType<typeof vi.fn>).mockReturnValue(mockSupabase);

    const { GET } = await import("@/app/api/cron/alert-dispatch/route");
    const res = await GET(cronRequest());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.instantMatch.sent).toBe(1);

    // The regression assertion: `to` must be email-shaped, and specifically
    // the auth email — the old code passed profile.full_name ("e2e Test") here.
    expect(mockSend).toHaveBeenCalledTimes(1);
    const to = (mockSend.mock.calls[0] as Array<{ to: string }>)[0].to;
    expect(to).toBe(USER_EMAIL);
    expect(to).toMatch(/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
    expect(to).not.toBe(USER_NAME);

    // full_name is still used — as the greeting, not the recipient.
    const html = (mockSend.mock.calls[0] as Array<{ html: string }>)[0].html;
    expect(html).toContain(`Hi ${USER_NAME},`);
  });

  it("suppresses resend when the dispatch log already has this job (dedup=true path)", async () => {
    const mockSupabase = createMockSupabase({
      dispatchLogRows: [
        {
          id: "logged",
          user_id: USER_ID,
          alert_type: "instant_match",
          status: "sent",
          reference_id: "job-1",
          sent_at: new Date().toISOString(),
        },
      ],
    });

    const { createServiceRoleClient } = await import("@/lib/supabase/service-role");
    (createServiceRoleClient as ReturnType<typeof vi.fn>).mockReturnValue(mockSupabase);

    const { GET } = await import("@/app/api/cron/alert-dispatch/route");
    const res = await GET(cronRequest());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.instantMatch.sent).toBe(0);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("does not suppress delivery when the only prior row for the reference failed", async () => {
    const mockSupabase = createMockSupabase({
      dispatchLogRows: [
        {
          id: "failed-attempt",
          user_id: USER_ID,
          alert_type: "instant_match",
          status: "failed",
          reference_id: "job-1",
          sent_at: new Date().toISOString(),
        },
      ],
    });

    const { createServiceRoleClient } = await import("@/lib/supabase/service-role");
    (createServiceRoleClient as ReturnType<typeof vi.fn>).mockReturnValue(mockSupabase);

    const { GET } = await import("@/app/api/cron/alert-dispatch/route");
    const res = await GET(cronRequest());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.instantMatch.sent).toBe(1);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it("hasRecentDispatch uses .eq() for text references (no PostgREST parse error)", async () => {
    const throwingFrom = createMockSupabase();
    const { hasRecentDispatch } = await import("@/app/api/cron/alert-dispatch/route");

    // Empty log -> false, and crucially must NOT throw "failed to parse filter".
    await expect(
      hasRecentDispatch(throwingFrom as never, USER_ID, "instant_match", 24, "job-1")
    ).resolves.toBe(false);

    const loggedFrom = createMockSupabase({
      dispatchLogRows: [
        {
          id: "logged",
          user_id: USER_ID,
          alert_type: "instant_match",
          status: "sent",
          reference_id: "job-1",
          sent_at: new Date().toISOString(),
        },
      ],
    });
    await expect(
      hasRecentDispatch(loggedFrom as never, USER_ID, "instant_match", 24, "job-1")
    ).resolves.toBe(true);
  });
});
