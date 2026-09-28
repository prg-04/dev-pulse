import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { NextRequest } from "next/server";
import { mockGapReport } from "@/lib/mock/gap-report";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

type TableResult = {
  data: unknown;
  count?: number | null;
  error?: string | null;
};

function makeQuery(result: TableResult) {
  const q: Record<string, (...args: unknown[]) => unknown> = {};
  for (const m of ["select", "eq", "order", "limit", "in"]) {
    q[m] = () => q;
  }
  q.then = ((resolve: (v: unknown) => unknown) =>
    Promise.resolve({
      data: result.data,
      count: result.count ?? null,
      error: result.error ? { message: result.error } : null,
    }).then(resolve)) as (...args: unknown[]) => unknown;
  return q;
}

function mockSupabaseFor(tables: Record<string, TableResult | TableResult[]>, insertError: string | null = null) {
  const take = (table: string): TableResult => {
    const v = tables[table];
    if (Array.isArray(v)) return v.length > 0 ? v.shift()! : { data: null };
    return v ?? { data: null };
  };
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1", email: "test@example.com" } } }),
    },
    from: vi.fn((table: string) => ({
      select: (...args: unknown[]) => makeQuery(take(table)),
      insert: vi.fn(() =>
        Promise.resolve({ data: null, error: insertError ? { message: insertError } : null })
      ),
    })),
  };
}

function currentAndPrevMonth(): [string, string] {
  const now = new Date();
  const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  return [fmt(now), fmt(new Date(now.getFullYear(), now.getMonth() - 1, 1))];
}

async function postSkills(skills: string[]) {
  const { POST } = await import("@/app/api/gap-report/route");
  const req = new Request("http://localhost/api/gap-report", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ skills }),
  }) as unknown as NextRequest;
  return POST(req);
}

describe("POST /api/gap-report (DB failure vs empty-data handling)", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    (process.env as Record<string, string | undefined>).NEXT_PUBLIC_ENV = "development";
    (process.env as Record<string, string | undefined>).NODE_ENV = "test";
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("(a) a DB read failure returns a controlled error, NOT mock fallback data", async () => {
    const mockSupabase = mockSupabaseFor({
      skill_demand_snapshots: { data: null, error: "connection refused" },
    });

    const { createClient } = await import("@/lib/supabase/server");
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(mockSupabase);

    const res = await postSkills(["typescript"]);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error?.code).toBe("DATA_UNAVAILABLE");
    // Must not look like a real report: no alignment score from mock data.
    expect(body.market_alignment_pct).toBeUndefined();
    expect(body.gaps).toBeUndefined();
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it("(b) a genuinely empty dataset still returns the legitimate empty state", async () => {
    const mockSupabase = mockSupabaseFor({
      skill_demand_snapshots: { data: [] },
    });

    const { createClient } = await import("@/lib/supabase/server");
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(mockSupabase);

    const res = await postSkills(["typescript"]);
    expect(res.status).toBe(200);
    const body = await res.json();
    // Unchanged empty-state behavior: mock defaults, no error code.
    expect(body.market_alignment_pct).toBe(mockGapReport.marketAlignmentPct);
    expect(body.gaps).toEqual(mockGapReport.gaps);
    expect(body.error).toBeUndefined();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it("(c) a write-path failure still serves the report AND logs loudly", async () => {
    const [cur, prev] = currentAndPrevMonth();
    const mockSupabase = mockSupabaseFor(
      {
        skill_demand_snapshots: {
          data: [
            { skill: "typescript", mention_count: 100, month: cur },
            { skill: "typescript", mention_count: 50, month: prev },
            { skill: "python", mention_count: 50, month: cur },
            { skill: "python", mention_count: 60, month: prev },
          ],
        },
        job_postings: { data: null, count: 42 },
        skill_index_status: { data: [] },
      },
      "permission denied"
    );

    const { createClient } = await import("@/lib/supabase/server");
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(mockSupabase);

    const res = await postSkills(["typescript"]);
    expect(res.status).toBe(200);
    const body = await res.json();
    // Real computed report, not fallback: python is a genuine gap.
    expect(body.gaps.map((g: { skill: string }) => g.skill)).toContain("python");
    expect(body.total_postings).toBe(42);
    // Loud structured logging for both failed inserts.
    const logged: string[] = consoleErrorSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(logged.some((m) => m.includes("user_skill_profiles") && m.includes("user-1"))).toBe(true);
    expect(logged.some((m) => m.includes("gap_report_events") && m.includes("user-1"))).toBe(true);
  });

  it("(d) the prod missing-column case degrades: index-status failure still serves 200", async () => {
    const [cur, prev] = currentAndPrevMonth();
    const mockSupabase = mockSupabaseFor({
      skill_demand_snapshots: [
        {
          data: [
            { skill: "typescript", mention_count: 100, month: cur },
            { skill: "python", mention_count: 50, month: cur },
          ],
        },
        {
          data: [
            { skill: "typescript", mention_count: 100, month: cur },
            { skill: "typescript", mention_count: 50, month: prev },
            { skill: "python", mention_count: 50, month: cur },
            { skill: "python", mention_count: 60, month: prev },
          ],
        },
      ],
      job_postings: { data: null, count: 42 },
      // Exact prod failure: migration 013's column was never applied.
      skill_index_status: {
        data: null,
        error: "column skill_index_status.on_demand_requested_at does not exist",
      },
    });

    const { createClient } = await import("@/lib/supabase/server");
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(mockSupabase);

    const res = await postSkills(["typescript"]);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.gaps.map((g: { skill: string }) => g.skill)).toContain("python");
    expect(body.skill_index_status).toEqual({});
    const logged: string[] = consoleErrorSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(logged.some((m) => m.includes("skill_index_status") && m.includes("user-1"))).toBe(true);
  });

  it("(e) a history-query failure still returns the hard 500", async () => {
    const [cur] = currentAndPrevMonth();
    const mockSupabase = mockSupabaseFor({
      skill_demand_snapshots: [
        { data: [{ skill: "typescript", mention_count: 100, month: cur }] },
        { data: null, error: "history query exploded" },
      ],
    });

    const { createClient } = await import("@/lib/supabase/server");
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(mockSupabase);

    const res = await postSkills(["typescript"]);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error?.code).toBe("DATA_UNAVAILABLE");
    expect(body.market_alignment_pct).toBeUndefined();
  });

  it("(f) a postings-count failure still returns the hard 500", async () => {
    const [cur, prev] = currentAndPrevMonth();
    const mockSupabase = mockSupabaseFor({
      skill_demand_snapshots: [
        { data: [{ skill: "typescript", mention_count: 100, month: cur }] },
        {
          data: [
            { skill: "typescript", mention_count: 100, month: cur },
            { skill: "typescript", mention_count: 50, month: prev },
          ],
        },
      ],
      job_postings: { data: null, count: null, error: "count query exploded" },
    });

    const { createClient } = await import("@/lib/supabase/server");
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(mockSupabase);

    const res = await postSkills(["typescript"]);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error?.code).toBe("DATA_UNAVAILABLE");
    expect(body.market_alignment_pct).toBeUndefined();
  });
});
