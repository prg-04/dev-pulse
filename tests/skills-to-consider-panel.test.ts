import { describe, it, expect } from "vitest";
import { getTutorialPanelState } from "@/components/gap-report/SkillsToConsiderCard";

describe("getTutorialPanelState", () => {
  const settledEmpty = {
    isIndexing: false,
    hasIndexedData: false,
    catalogCount: 0,
    orphanCount: 0,
    loadingCatalog: false,
    loadingTutorials: false,
  };

  it("returns results when catalog is empty but orphan tutorials exist (regression: orphans must not be shadowed by the empty state)", () => {
    expect(
      getTutorialPanelState({ ...settledEmpty, orphanCount: 5 })
    ).toBe("results");
  });

  it("returns loading while tutorial-search is still in flight, not not-indexed", () => {
    expect(
      getTutorialPanelState({ ...settledEmpty, loadingTutorials: true })
    ).toBe("loading");
  });

  it("returns loading while the catalog fetch is still in flight", () => {
    expect(
      getTutorialPanelState({ ...settledEmpty, loadingCatalog: true })
    ).toBe("loading");
  });

  it("returns not-indexed only when both fetches settled and nothing renderable exists", () => {
    expect(getTutorialPanelState(settledEmpty)).toBe("not-indexed");
  });

  it("returns results when catalog videos exist", () => {
    expect(
      getTutorialPanelState({ ...settledEmpty, catalogCount: 10 })
    ).toBe("results");
  });

  it("returns indexing with precedence even when orphans are present", () => {
    expect(
      getTutorialPanelState({
        ...settledEmpty,
        isIndexing: true,
        orphanCount: 5,
      })
    ).toBe("indexing");
  });

  it("returns empty (not not-indexed) for a freshly enqueued skill with no rows yet", () => {
    expect(
      getTutorialPanelState({ ...settledEmpty, onDemandStatus: "enqueued" })
    ).toBe("empty");
  });

  it("returns no-videos when on-demand indexing found nothing", () => {
    expect(
      getTutorialPanelState({
        ...settledEmpty,
        onDemandStatus: "skipped_no_results",
      })
    ).toBe("no-videos");
  });

  it("returns results for indexed skills even with an empty catalog", () => {
    expect(
      getTutorialPanelState({
        ...settledEmpty,
        hasIndexedData: true,
        orphanCount: 3,
      })
    ).toBe("results");
  });
});
