import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import { escapeHtml, sanitizeHttpUrl } from "@/lib/sanitize";

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

(process.env as Record<string, string | undefined>).CRON_SECRET = "test-secret";
(process.env as Record<string, string | undefined>).RESEND_API_KEY = "re_test_key";
(process.env as Record<string, string | undefined>).NODE_ENV = "test";

// ---------------------------------------------------------------------------
// Chainable Supabase mock (same shape as alert-dispatch.test.ts).
// ---------------------------------------------------------------------------
const USER_ID = "user-1";
const USER_EMAIL = "evans@example.com";

const EVIL_TITLE = `<script>alert('xss')</script> Senior Engineer`;
const EVIL_COMPANY = `<img src=x onerror=alert(1)>EvilCorp`;
const EVIL_URL = `javascript:alert(1)`;
const EVIL_NAME = `<b>Evans</b>`;

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

function createMockSupabase() {
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
        full_name: EVIL_NAME,
        monitored_sources: ["hackernews"],
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
        id: "job-evil",
        title: EVIL_TITLE,
        company: EVIL_COMPANY,
        external_url: EVIL_URL,
        skill_mentions: [{ skill: "typescript" }],
      },
    ],
    alert_dispatch_log: [],
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
describe("alert-dispatch email HTML escaping (issue #8)", () => {
  beforeEach(() => {
    vi.resetModules();
    mockSend.mockClear();
  });

  it("escapes title/company/name and strips non-http(s) URLs in HTML, leaves plaintext untouched", async () => {
    const mockSupabase = createMockSupabase();

    const { createServiceRoleClient } = await import("@/lib/supabase/service-role");
    (createServiceRoleClient as ReturnType<typeof vi.fn>).mockReturnValue(mockSupabase);

    const { GET } = await import("@/app/api/cron/alert-dispatch/route");
    const res = await GET(cronRequest());

    expect(res.status).toBe(200);
    expect(mockSend).toHaveBeenCalledTimes(1);
    const sent = mockSend.mock.calls[0] as Array<{ html: string; text: string }>;
    const html = sent[0].html;
    const text = sent[0].text;

    // HTML is safe: escaped entities present, raw markup/URIs absent.
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;img");
    expect(html).toContain("Hi &lt;b&gt;Evans&lt;/b&gt;,");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("<a href");

    // Plaintext body follows different rules: raw values preserved as text.
    expect(text).toContain(EVIL_TITLE);
    expect(text).toContain(EVIL_URL);
  });

  it("escapeHtml covers the five HTML-special characters", () => {
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(undefined)).toBe("");
  });

  it("sanitizeHttpUrl allowlists http/https only", () => {
    expect(sanitizeHttpUrl("https://example.com/jobs/1")).toBe("https://example.com/jobs/1");
    expect(sanitizeHttpUrl("http://example.com/x")).toBe("http://example.com/x");
    expect(sanitizeHttpUrl("  HTTPS://example.com/y  ")).toBe("HTTPS://example.com/y");
    expect(sanitizeHttpUrl("javascript:alert(1)")).toBeNull();
    expect(sanitizeHttpUrl("data:text/html,<h1>x</h1>")).toBeNull();
    expect(sanitizeHttpUrl("ftp://example.com/f")).toBeNull();
    expect(sanitizeHttpUrl("//example.com/protocol-relative")).toBeNull();
    expect(sanitizeHttpUrl(null)).toBeNull();
    expect(sanitizeHttpUrl("")).toBeNull();
  });
});
