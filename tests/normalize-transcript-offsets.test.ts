import { describe, it, expect, vi } from "vitest";

// ---------------------------------------------------------------------------
// server-only is a build-time guard; silence it in the test environment
// (lib/video-indexing.ts pulls it in via lib/lesson-generation.ts)
// ---------------------------------------------------------------------------
vi.mock("server-only", () => ({}));

// Real production head values from tutorial_chunks for TtPXvEcE11E / react
// (integer milliseconds as returned by youtube-transcript's parseInt path).
const REAL_MS_HEAD = [480, 3120, 4880, 7839, 9760, 12800, 14480, 16560, 19119, 21520];
// A max well above the 100000 ms-detection threshold, matching the real
// video's ~11.5h length (stored max was 41512880).
const REAL_MS_MAX = 41512880;

type Cap = { offset: number; text: string };

function caps(offsets: unknown[]): Cap[] {
  return offsets.map((o, i) => ({ offset: o as number, text: `cap-${i}` }));
}

describe("normalizeTranscriptOffsets poison resistance (Step 2)", () => {
  it("drops a NaN entry; clean integer-ms offsets still divide by 1000", async () => {
    const { normalizeTranscriptOffsets } = await import("@/lib/video-indexing");
    const input = caps([...REAL_MS_HEAD, NaN]);
    (input[input.length - 1] as { text: string }).text = "poison";
    const out = normalizeTranscriptOffsets(input);
    // (a) poisoned entry excluded entirely
    expect(out).toHaveLength(REAL_MS_HEAD.length);
    expect(out.some((o) => o.text === "poison")).toBe(false);
    // (b) ms detected despite the poison: exact divisions
    expect(out[0].offset).toBe(0); // floor(480 / 1000)
    expect(out[1].offset).toBe(3); // floor(3120 / 1000)
    expect(out[9].offset).toBe(21); // floor(21520 / 1000)
    // (c) sane seconds scale, not millions-of-seconds garbage
    expect(Math.max(...out.map((o) => o.offset))).toBeLessThan(100);
  });

  it("drops an undefined entry; ms detection unaffected", async () => {
    const { normalizeTranscriptOffsets } = await import("@/lib/video-indexing");
    const input = caps([...REAL_MS_HEAD, undefined]);
    (input[input.length - 1] as { text: string }).text = "poison";
    const out = normalizeTranscriptOffsets(input);
    expect(out).toHaveLength(REAL_MS_HEAD.length);
    expect(out.some((o) => o.text === "poison")).toBe(false);
    expect(out[1].offset).toBe(3);
  });

  it("drops a negative entry; ms detection unaffected", async () => {
    const { normalizeTranscriptOffsets } = await import("@/lib/video-indexing");
    const input = caps([-500, ...REAL_MS_HEAD]);
    (input[0] as { text: string }).text = "poison";
    const out = normalizeTranscriptOffsets(input);
    expect(out).toHaveLength(REAL_MS_HEAD.length);
    expect(out.some((o) => o.text === "poison")).toBe(false);
    expect(out[0].offset).toBe(0);
    expect(Math.min(...out.map((o) => o.offset))).toBeGreaterThanOrEqual(0);
  });

  it("full production-scale range with poison collapses to seconds, not ms", async () => {
    const { normalizeTranscriptOffsets } = await import("@/lib/video-indexing");
    const input = caps([...REAL_MS_HEAD, REAL_MS_MAX, NaN]);
    const out = normalizeTranscriptOffsets(input);
    expect(out).toHaveLength(REAL_MS_HEAD.length + 1);
    // 41512880 ms -> 41512 s (~11.5h), NOT stored raw as 41.5M "seconds"
    expect(out[out.length - 1].offset).toBe(41512);
    expect(Math.max(...out.map((o) => o.offset))).toBeLessThan(100000);
  });

  it("genuine fractional-seconds input is still left alone (no regression)", async () => {
    const { normalizeTranscriptOffsets } = await import("@/lib/video-indexing");
    const out = normalizeTranscriptOffsets(
      caps([0, 1.23, 5.67]).map((c, i) => ({ ...c, text: `s-${i}` }))
    );
    expect(out.map((o) => o.offset)).toEqual([0, 1.23, 5.67]);
  });

  it("all-poisoned input returns empty instead of crashing", async () => {
    const { normalizeTranscriptOffsets } = await import("@/lib/video-indexing");
    expect(normalizeTranscriptOffsets(caps([NaN, undefined, -1]))).toEqual([]);
    expect(normalizeTranscriptOffsets([])).toEqual([]);
  });

  it("chunkTranscript merges poisoned ms input into ~60s windows, not per-caption chunks", async () => {
    const { chunkTranscript } = await import("@/lib/video-indexing");
    // ~12s of captions every ~2.5s in ms, plus one poison entry
    const offsets = [480, 3120, 4880, 7839, 9760, 12800, 14480, 16560, 19119, 21520, 24800, 27519, NaN];
    const chunks = chunkTranscript(caps(offsets));
    // All valid captions fall inside one 60s window after /1000
    expect(chunks.length).toBe(1);
    expect(chunks[0].start_seconds).toBe(0);
  });
});
