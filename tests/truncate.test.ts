import { describe, expect, it } from "vitest";
import {
  CHECK_RUN_MAX_BYTES,
  CHECK_RUN_TRUNCATION_MARKER,
  COMMENT_MAX_CHARS,
  COMMENT_TRUNCATION_MARKER,
  sliceUtf8ToBudget,
  truncateToCharLimit,
  truncateToUtf8Bytes,
  utf8ByteLength,
} from "../src/truncate.js";

describe("truncate constants (margins)", () => {
  it("budgets comment under 65536 chars with margin 536", () => {
    expect(COMMENT_MAX_CHARS).toBe(65_000);
    expect(65_536 - COMMENT_MAX_CHARS).toBe(536);
  });

  it("budgets check-run under 65535 bytes with margin 535", () => {
    expect(CHECK_RUN_MAX_BYTES).toBe(65_000);
    expect(65_535 - CHECK_RUN_MAX_BYTES).toBe(535);
  });
});

describe("utf8ByteLength", () => {
  it("counts ASCII as 1 byte per char", () => {
    expect(utf8ByteLength("abc")).toBe(3);
  });

  it("counts multi-byte UTF-8 correctly", () => {
    // emoji 🔒 is 4 bytes; CJK 文 is 3 bytes
    expect(utf8ByteLength("🔒")).toBe(4);
    expect(utf8ByteLength("文")).toBe(3);
    expect(utf8ByteLength("a文b")).toBe(1 + 3 + 1);
  });
});

describe("truncateToCharLimit", () => {
  it("returns input when under limit", () => {
    expect(truncateToCharLimit("hello", 100, COMMENT_TRUNCATION_MARKER)).toBe(
      "hello",
    );
  });

  it("includes marker and stays within maxChars", () => {
    const input = "x".repeat(100);
    const out = truncateToCharLimit(input, 50, COMMENT_TRUNCATION_MARKER);
    expect(out.length).toBeLessThanOrEqual(50);
    expect(out.endsWith(COMMENT_TRUNCATION_MARKER)).toBe(true);
    expect(out).toContain("truncated");
  });
});

describe("sliceUtf8ToBudget / truncateToUtf8Bytes mid-character safety", () => {
  it("does not split a 3-byte CJK character", () => {
    // "文" is E6 96 87 (3 bytes)
    const s = "aa文bb";
    for (let budget = 1; budget <= utf8ByteLength(s); budget++) {
      const sliced = sliceUtf8ToBudget(s, budget);
      expect(sliced).not.toContain("\uFFFD");
      expect(utf8ByteLength(sliced)).toBeLessThanOrEqual(budget);
    }
  });

  it("does not split a 4-byte emoji", () => {
    const s = "x🔒y";
    for (let budget = 1; budget <= utf8ByteLength(s); budget++) {
      const sliced = sliceUtf8ToBudget(s, budget);
      expect(sliced).not.toContain("\uFFFD");
      expect(utf8ByteLength(sliced)).toBeLessThanOrEqual(budget);
    }
  });

  it("truncateToUtf8Bytes never emits replacement char at the cut", () => {
    // Build a string whose byte length exceeds budget mid-emoji.
    const unit = "路径🔒";
    const s = unit.repeat(100);
    const maxBytes = 50;
    const out = truncateToUtf8Bytes(s, maxBytes, CHECK_RUN_TRUNCATION_MARKER);
    expect(out).not.toContain("\uFFFD");
    expect(utf8ByteLength(out)).toBeLessThanOrEqual(maxBytes);
    expect(out).toContain("truncated");
  });

  it("keeps complete multi-byte sequences when they fully fit", () => {
    // "A" + "文" (3 bytes) = 4 bytes total
    const s = "A文";
    expect(sliceUtf8ToBudget(s, 4)).toBe(s);
    expect(sliceUtf8ToBudget(s, 3)).toBe("A");
    expect(sliceUtf8ToBudget(s, 1)).toBe("A");
    expect(sliceUtf8ToBudget(s, 0)).toBe("");
  });

  it("returns input when under byte budget", () => {
    expect(
      truncateToUtf8Bytes("short", 1000, CHECK_RUN_TRUNCATION_MARKER),
    ).toBe("short");
  });
});
