import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// server-only is a build-time guard; silence it in the test environment
// ---------------------------------------------------------------------------
vi.mock("server-only", () => ({}));

// ---------------------------------------------------------------------------
// Mocks — must be at top level so vitest can hoist them
// ---------------------------------------------------------------------------
const mockGenerateObject = vi.fn();
const mockGenerateText = vi.fn();

vi.mock("ai", () => ({
  generateObject: mockGenerateObject,
  generateText: mockGenerateText,
}));

vi.mock("@/lib/ai/provider", () => ({
  createTextModel: vi.fn().mockResolvedValue({}),
  getProviderMeta: vi.fn().mockReturnValue({ model: "openai/gpt-4o-mini" }),
}));

// ---------------------------------------------------------------------------
// LESSON_BATCH_SIZE parsing
// ---------------------------------------------------------------------------
describe("LESSON_BATCH_SIZE", () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...OLD_ENV };
    delete process.env.LESSON_BATCH_SIZE;
  });

  it("defaults to 3 when unset", async () => {
    const { LESSON_BATCH_SIZE } = await import("@/lib/lesson-generation");
    expect(LESSON_BATCH_SIZE).toBe(3);
  });

  it("parses a valid positive integer", async () => {
    process.env.LESSON_BATCH_SIZE = "5";
    const { LESSON_BATCH_SIZE } = await import("@/lib/lesson-generation");
    expect(LESSON_BATCH_SIZE).toBe(5);
  });

  it("falls back to 3 for empty string", async () => {
    process.env.LESSON_BATCH_SIZE = "";
    const { LESSON_BATCH_SIZE } = await import("@/lib/lesson-generation");
    expect(LESSON_BATCH_SIZE).toBe(3);
  });

  it("falls back to 3 for non-numeric input", async () => {
    process.env.LESSON_BATCH_SIZE = "abc";
    const { LESSON_BATCH_SIZE } = await import("@/lib/lesson-generation");
    expect(LESSON_BATCH_SIZE).toBe(3);
  });

  it("falls back to 3 for zero", async () => {
    process.env.LESSON_BATCH_SIZE = "0";
    const { LESSON_BATCH_SIZE } = await import("@/lib/lesson-generation");
    expect(LESSON_BATCH_SIZE).toBe(3);
  });

  it("falls back to 3 for negative values", async () => {
    process.env.LESSON_BATCH_SIZE = "-1";
    const { LESSON_BATCH_SIZE } = await import("@/lib/lesson-generation");
    expect(LESSON_BATCH_SIZE).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// generateLessonBatch — section and summary accumulation
// ---------------------------------------------------------------------------
describe("generateLessonBatch accumulation", () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    vi.resetModules();
    mockGenerateObject.mockClear();
    mockGenerateText.mockClear();
    process.env = { ...OLD_ENV };
    process.env.LESSON_BATCH_SIZE = "3";
    process.env.AI_PROVIDER = "openrouter";
    process.env.AI_MODEL = "openai/gpt-4o-mini";
    process.env.AI_API_KEY = "test-key";
  });

  it("preserves and extends existing sections across batches", async () => {
    mockGenerateObject.mockResolvedValue({
      object: {
        summary: "Window 2 summary",
        sections: [
          { start_seconds: 200, heading: "New Section", key_points: ["point"] },
        ],
      },
    });

    const { generateLessonBatch } = await import("@/lib/lesson-generation");

    // Use start_seconds 0 for the existing section so it survives
    // filterToAllowedTimestamps (allowed set is {0, 200}).
    const existingSection = { start_seconds: 0, heading: "Old Section", key_points: ["old point"] };
    const chunks = [
      { start_seconds: 0, chunk_text: "First window transcript content here with enough text to pass the minimum length checks for processing." },
      { start_seconds: 200, chunk_text: "Second window transcript content here with enough text to pass the minimum length checks for processing." },
    ];

    const result = await generateLessonBatch({
      videoId: "test123",
      videoTitle: "Test Video",
      channelName: "Test Channel",
      allowedTimestamps: [0, 200],
      chunks,
      startWindowIndex: 0,
      batchSize: 3,
      existingSections: [existingSection],
      existingSummary: "Previous summary",
    });

    expect(result).not.toBeNull();
    expect(result!.sections).toContainEqual(existingSection);
    expect(result!.sections.length).toBeGreaterThanOrEqual(2);
  });

  it("returns existing summary as summaries[0] when provided", async () => {
    mockGenerateObject.mockResolvedValue({
      object: {
        summary: "Window summary",
        sections: [
          { start_seconds: 0, heading: "Section", key_points: ["point"] },
        ],
      },
    });

    const { generateLessonBatch } = await import("@/lib/lesson-generation");

    // Use a chunk with enough text to avoid empty_transcript skip
    const chunks = [
      { start_seconds: 0, chunk_text: "Window transcript content here with enough text to pass the minimum length checks for processing." },
    ];

    const result = await generateLessonBatch({
      videoId: "test456",
      videoTitle: "Test Video",
      channelName: "Test Channel",
      allowedTimestamps: [0],
      chunks,
      startWindowIndex: 0,
      batchSize: 3,
      existingSections: [],
      existingSummary: "Preserved summary",
    });

    expect(result).not.toBeNull();
    // summaries[0] is the existing summary; new summaries are appended after
    expect(result!.summary).toBe("Preserved summary");
  });

  it("returns accumulated state when startWindowIndex exceeds windowsTotal", async () => {
    mockGenerateObject.mockClear();
    mockGenerateText.mockClear();

    const { generateLessonBatch } = await import("@/lib/lesson-generation");

    const result = await generateLessonBatch({
      videoId: "test789",
      videoTitle: "Test Video",
      channelName: "Test Channel",
      allowedTimestamps: [0],
      chunks: [{ start_seconds: 0, chunk_text: "content here with enough text to pass minimum length checks for processing." }],
      startWindowIndex: 10,
      batchSize: 3,
      existingSections: [],
    });

    // When startWindowIndex >= windowsTotal, the function returns the
    // accumulated state (existing sections + stats) rather than null.
    expect(result).not.toBeNull();
    expect(result!.sections).toEqual([]);
    expect(result!.summary).toBeNull();
    expect(result!.stats.windowsTotal).toBeGreaterThanOrEqual(1);
  });
});
