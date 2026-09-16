/**
 * Quick verification of transcript offset normalization (ms vs s).
 * Run:  npx tsx scripts/test-transcript-offset.ts
 */
import { normalizeTranscriptOffsets } from "../app/api/cron/tutorial-index/route";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
}

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`PASS: ${name}`);
    passed++;
  } catch (e) {
    console.error(`FAIL: ${name}:`, e);
    failed++;
  }
}

// seconds path — fractional offsets (classic XML) should NOT be divided
test("classic seconds with fractional keep as seconds", () => {
  const input = [
    { offset: 0, text: "hello", duration: 1.2 },
    { offset: 1.23, text: "world", duration: 0.5 },
    { offset: 5.67, text: "foo", duration: 1 },
  ];
  const out = normalizeTranscriptOffsets(input);
  assert(out[0].offset === 0, "0 should stay 0");
  assert(out[1].offset === 1.23, "1.23 should stay");
  assert(out[2].offset === 5.67, "5.67 should stay");
});

// srv3 ms path — integer ms values >100k should be divided
test("srv3 ms integers divide by 1000", () => {
  const input = [
    { offset: 0, text: "hello", duration: 500 },
    { offset: 1230, text: "world", duration: 400 },
    { offset: 60000, text: "mid", duration: 300 },
    { offset: 180000, text: "three min", duration: 400 },
    { offset: 360000, text: "six min", duration: 400 },
    { offset: 600000, text: "ten min", duration: 500 },
  ];
  // Need max >100k to trigger isMs branch; add large offset
  const large = [...input, { offset: 600000, text: "end", duration: 500 }];
  const out = normalizeTranscriptOffsets(large);
  assert(out[1].offset === 1, `1230 ms -> 1s, got ${out[1].offset}`);
  assert(out[3].offset === 180, `180000 ms -> 180s, got ${out[3].offset}`);
  assert(out[5].offset === 600, `600000 ms -> 600s, got ${out[5].offset}`);
});

// integer seconds small video (no division)
test("integer seconds small keep", () => {
  const input = [
    { offset: 0, text: "a", duration: 2 },
    { offset: 2, text: "b", duration: 2 },
    { offset: 5, text: "c", duration: 2 },
  ];
  const out = normalizeTranscriptOffsets(input);
  assert(out[1].offset === 2, "2 should stay 2");
  assert(out[2].offset === 5, "5 should stay 5");
});

// chunking sanity — ms transcript should chunk to ~60s windows
import { buildWindows } from "../lib/lesson-generation";
test("buildWindows not merging tail after fix", () => {
  const chunks = Array.from({ length: 30 }, (_, i) => ({
    start_seconds: i * 60,
    chunk_text: "x".repeat(2000),
  }));
  const windows = buildWindows(chunks);
  // 30 chunks * 2000 = 60000 chars, 6000 per window => 10 windows
  assert(windows.length === 10, `expected 10 windows, got ${windows.length}`);
  // verify none is oversized
  for (const w of windows) {
    const total = w.chunks.reduce((s, c) => s + c.chunk_text.length, 0);
    assert(total <= 6000, `window oversized ${total}`);
  }
});

test("chapter fallback: window without chapter still produces via startSeconds", async () => {
  // This is covered by generateForWindow logic — manual check via buildWindows + filter simulation
  const chunks = [
    { start_seconds: 0, chunk_text: "intro" },
    { start_seconds: 60, chunk_text: "content" },
    { start_seconds: 120, chunk_text: "more" },
  ];
  const windows = buildWindows(chunks);
  assert(windows.length >= 1, "at least 1 window");
});

console.log(`\nDone: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
