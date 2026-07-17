import { describe, expect, it } from "vitest";
import { escapeHtml, escapeMarkdown, escapeShell } from "../src/escape.js";

describe("escapeHtml", () => {
  it("escapes HTML tag characters", () => {
    expect(escapeHtml("<script>alert(1)</script>")).toBe(
      "&lt;script&gt;alert(1)&lt;/script&gt;",
    );
  });

  it("escapes ampersand", () => {
    expect(escapeHtml("a & b")).toBe("a &amp; b");
  });

  it("escapes quotes", () => {
    expect(escapeHtml('"quoted"')).toBe("&quot;quoted&quot;");
  });
});

describe("escapeMarkdown", () => {
  it("escapes markdown formatting characters", () => {
    expect(escapeMarkdown("[link](url)")).toBe("\\[link\\]\\(url\\)");
  });

  it("escapes backticks", () => {
    expect(escapeMarkdown("`code`")).toBe("\\`code\\`");
  });

  it("escapes bidi markers", () => {
    const bidi = "\u202e\u202d";
    expect(escapeMarkdown(bidi)).toBe("\u202e\u202d");
  });
});

describe("escapeShell", () => {
  it("escapes backticks", () => {
    expect(escapeShell("`rm -rf /`")).toBe("\\`rm -rf /\\`");
  });

  it("escapes IFS", () => {
    expect(escapeShell("${IFS}env")).toBe("\\$\\{IFS\\}env");
  });

  it("escapes pipes", () => {
    expect(escapeShell("a | b")).toBe("a \\| b");
  });
});
