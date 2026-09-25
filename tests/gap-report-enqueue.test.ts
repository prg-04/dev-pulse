import { describe, it, expect } from "vitest";
import { shouldEnqueueSkill } from "@/components/gap-report/GapReportClient";

describe("shouldEnqueueSkill", () => {
  const baseStatus = {
    total_chunks: 0,
    total_chapters: 0,
    last_run_status: null,
    last_error: null,
    on_demand_requested_at: null,
  };

  it("returns true when skill has no indexed data and is not in the enqueued set", () => {
    expect(shouldEnqueueSkill("kubernetes", baseStatus, new Set())).toBe(true);
  });

  it("returns false when skill already has chunks", () => {
    const status = { ...baseStatus, total_chunks: 10 };
    expect(shouldEnqueueSkill("kubernetes", status, new Set())).toBe(false);
  });

  it("returns false when skill already has chapters", () => {
    const status = { ...baseStatus, total_chapters: 5 };
    expect(shouldEnqueueSkill("kubernetes", status, new Set())).toBe(false);
  });

  it("returns false when skill is already in the enqueued set", () => {
    const enqueued = new Set(["kubernetes"]);
    expect(shouldEnqueueSkill("kubernetes", baseStatus, enqueued)).toBe(false);
  });

  it("returns true for a different skill not in the enqueued set", () => {
    const enqueued = new Set(["docker"]);
    expect(shouldEnqueueSkill("kubernetes", baseStatus, enqueued)).toBe(true);
  });

  it("returns false when any guard condition blocks it", () => {
    const status = { ...baseStatus, total_chunks: 1 };
    const enqueued = new Set(["kubernetes"]);
    expect(shouldEnqueueSkill("kubernetes", status, enqueued)).toBe(false);
  });
});
