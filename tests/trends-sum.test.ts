import { describe, it, expect } from "vitest";
import { getTrendsData } from "@/lib/queries/trends";

function mockSupabase(rows: Array<{ skill: string; month: string; mention_count: number }>) {
  const chain = {
    select: () => chain,
    in: () => chain,
    order: () => Promise.resolve({ data: rows, error: null }),
  };
  return { from: () => chain };
}

// Regression guard: per-source snapshot rows for one skill+month must SUM,
// not overwrite (last row wins was silently undercounting multi-source skills).
describe("getTrendsData (cross-source summation)", () => {
  it("sums mention_count across sources for the same skill+month", async () => {
    const supabase = mockSupabase([
      { skill: "c++", month: "2026-09", mention_count: 19 },
      { skill: "c++", month: "2026-09", mention_count: 12 },
      { skill: "c++", month: "2026-09", mention_count: 3 },
      { skill: "c++", month: "2026-08", mention_count: 4 },
      { skill: "c#", month: "2026-09", mention_count: 20 },
    ]);

    const { rows } = await getTrendsData(supabase as never, ["c++", "c#"], ["2026-08", "2026-09"]);
    const sep = rows.find((r) => r.month === "Sep '26");
    const aug = rows.find((r) => r.month === "Aug '26");
    // 19 + 12 + 3 = 34, not the last row's 3.
    expect(sep!["c++"]).toBe(34);
    expect(sep!["c#"]).toBe(20);
    expect(aug!["c++"]).toBe(4);
    expect(aug!["c#"]).toBe(0);
  });

  it("returns zeros for months/skills with no rows", async () => {
    const supabase = mockSupabase([]);
    const { rows } = await getTrendsData(supabase as never, ["go"], ["2026-08", "2026-09"]);
    expect(rows).toHaveLength(2);
    expect(rows[0]["go"]).toBe(0);
    expect(rows[1]["go"]).toBe(0);
  });
});
