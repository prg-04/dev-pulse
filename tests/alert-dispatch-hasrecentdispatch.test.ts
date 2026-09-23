import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { hasRecentDispatch } from "@/app/api/cron/alert-dispatch/route";

// ---------------------------------------------------------------------------
// Mock Supabase service-role so the route module can be imported without
// a real database connection.
// ---------------------------------------------------------------------------
vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: vi.fn(),
}));

/**
 * Build a mock Supabase client that supports the full query chain used by
 * `hasRecentDispatch` and records whether `.eq()` or `.is()` was used on
 * `reference_id`.
 *
 * Call chain:
 *   supabase.from("alert_dispatch_log")
 *     .select("id")
 *     .eq("user_id", ...)
 *     .eq("alert_type", ...)
 *     .gte("sent_at", ...)
 *     [.eq("reference_id", ...) | .is("reference_id", ...)]
 *     .limit(1)
 *     .maybeSingle()
 */
function createMockSupabaseClient(overrides: {
  data?: unknown | null;
  error?: { message: string } | null;
}) {
  const { data = null, error = null } = overrides;

  let referenceIdMethod: string | null = null;
  let referenceIdValue: unknown = null;

  // Every filter method returns a chainable query builder
  const queryBuilder = () => {
    const maybeSingleResult = { data, error };

    const builder: Record<string, unknown> = {
      maybeSingle: vi.fn(() => maybeSingleResult),
    };

    builder.limit = vi.fn(() => builder);
    builder.eq = vi.fn((col: string, val: unknown) => {
      if (col === "reference_id") {
        referenceIdMethod = "eq";
        referenceIdValue = val;
      }
      return builder;
    });
    builder.is = vi.fn((col: string, val: unknown) => {
      if (col === "reference_id") {
        referenceIdMethod = "is";
        referenceIdValue = val;
      }
      return builder;
    });
    builder.gte = vi.fn(() => builder);
    builder.select = vi.fn(() => builder);
    builder.from = vi.fn(() => builder);

    return builder;
  };

  return {
    client: { from: vi.fn(() => queryBuilder()) },
    referenceIdMethod: () => referenceIdMethod,
    referenceIdValue: () => referenceIdValue,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("hasRecentDispatch", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-22T23:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses .eq() for a non-null reference_id and returns true when a matching row exists", async () => {
    const mockSupabase = createMockSupabaseClient({
      data: { id: "dispatch-1" },
      error: null,
    });

    const result = await hasRecentDispatch(
      // @ts-ignore test mock
      mockSupabase.client,
      "user-123",
      "instant_match",
      24,
      "job-abc-123"
    );

    expect(result).toBe(true);
    // The critical assertion: .eq() must be used on reference_id, not .is()
    expect(mockSupabase.referenceIdMethod()).toBe("eq");
    expect(mockSupabase.referenceIdValue()).toBe("job-abc-123");
  });

  it("returns false when no matching row exists for the given reference_id", async () => {
    const mockSupabase = createMockSupabaseClient({
      data: null,
      error: null,
    });

    const result = await hasRecentDispatch(
      // @ts-ignore test mock
      mockSupabase.client,
      "user-123",
      "instant_match",
      24,
      "job-abc-999"
    );

    expect(result).toBe(false);
    expect(mockSupabase.referenceIdMethod()).toBe("eq");
    expect(mockSupabase.referenceIdValue()).toBe("job-abc-999");
  });

  it("skips the reference_id filter entirely when referenceId is null (weekly_digest path)", async () => {
    const mockSupabase = createMockSupabaseClient({
      data: null,
      error: null,
    });

    const result = await hasRecentDispatch(
      // @ts-ignore test mock
      mockSupabase.client,
      "user-123",
      "weekly_digest",
      7 * 24,
      null
    );

    expect(result).toBe(false);
    // Neither .eq() nor .is() should have been called on reference_id
    expect(mockSupabase.referenceIdMethod()).toBeNull();
  });

  it("skips the reference_id filter when referenceId is undefined (no argument passed)", async () => {
    const mockSupabase = createMockSupabaseClient({
      data: null,
      error: null,
    });

    const result = await hasRecentDispatch(
      // @ts-ignore test mock
      mockSupabase.client,
      "user-123",
      "weekly_digest",
      7 * 24
    );

    expect(result).toBe(false);
    expect(mockSupabase.referenceIdMethod()).toBeNull();
  });

  it("throws when the Supabase query returns an error", async () => {
    const mockSupabase = createMockSupabaseClient({
      data: null,
      error: { message: "relation alert_dispatch_log does not exist" },
    });

    await expect(
      // @ts-ignore test mock
      hasRecentDispatch(mockSupabase.client, "user-123", "instant_match", 24, "job-1")
    ).rejects.toThrow("Failed to check dispatch log: relation alert_dispatch_log does not exist");
  });
});
