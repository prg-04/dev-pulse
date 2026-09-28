import { describe, it, expect, vi } from "vitest";

// Route module pulls resend + service clients at import time — mock them.
// No email is sent here; only the pure movers computation is exercised.
vi.mock("resend", () => ({
  Resend: vi.fn(function () {
    return { emails: { send: vi.fn() } };
  }),
}));

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: vi.fn(),
}));

import { computeSkillMovers } from "@/app/api/cron/alert-dispatch/route";

// ---------------------------------------------------------------------------
// Regression guard for the month-mixing bug: fixture replicates the live
// contamination pattern (a stale third month alongside the two target
// months). The stale rows must not affect any reported delta.
// ---------------------------------------------------------------------------
describe("computeSkillMovers (weekly digest two-month guard)", () => {
  const CURRENT = "2026-09";
  const PREV = "2026-08";
  const STALE = "2026-07";

  const rows = [
    // go — mirrors the live contamination: Sep 101+33+27, Aug 24+6, Jul 16.
    { skill: "go", mention_count: 101, month: CURRENT, source: "hackernews" },
    { skill: "go", mention_count: 33, month: CURRENT, source: "remoteok" },
    { skill: "go", mention_count: 27, month: CURRENT, source: "arbeitnow" },
    { skill: "go", mention_count: 24, month: PREV, source: "hackernews" },
    { skill: "go", mention_count: 6, month: PREV, source: "remoteok" },
    { skill: "go", mention_count: 16, month: STALE, source: "hackernews" },
    // clean two-month skill, no stale rows.
    { skill: "python", mention_count: 200, month: CURRENT, source: "hackernews" },
    { skill: "python", mention_count: 100, month: PREV, source: "hackernews" },
    // stale-only skill: must not produce a nonzero delta.
    { skill: "cobol", mention_count: 50, month: STALE, source: "hackernews" },
  ];

  it("computes go at +437% (Sep vs Aug only), not the contaminated +250%", () => {
    const movers = computeSkillMovers(rows, CURRENT, PREV);
    const go = movers.find((m) => m.skill === "go");
    expect(go).toBeDefined();
    // Correct: (161 - 30) / 30 = 436.67% -> 437.
    // Buggy (Jul 16 folded into prev=46): (161 - 46) / 46 = 250%.
    expect(go!.count).toBe(161);
    expect(go!.delta).toBe(437);
    expect(go!.delta).not.toBe(250);
  });

  it("computes clean skills normally and ignores stale-only skills", () => {
    const movers = computeSkillMovers(rows, CURRENT, PREV);
    const python = movers.find((m) => m.skill === "python");
    expect(python!.delta).toBe(100);
    const cobol = movers.find((m) => m.skill === "cobol");
    expect(cobol!.delta).toBe(0);
    // Neither rising (delta > 0) nor declining (delta < 0) includes cobol.
    expect(movers.filter((m) => m.delta > 0).some((m) => m.skill === "cobol")).toBe(false);
    expect(movers.filter((m) => m.delta < 0).some((m) => m.skill === "cobol")).toBe(false);
  });

  it("returns movers sorted by delta descending", () => {
    const movers = computeSkillMovers(rows, CURRENT, PREV);
    const deltas = movers.map((m) => m.delta);
    expect([...deltas].sort((a, b) => b - a)).toEqual(deltas);
  });
});
