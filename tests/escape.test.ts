import { describe, expect, it } from "vitest";
import {
  escapeHtml,
  escapeMarkdown,
  escapeShell,
  stripBidiControls,
} from "../src/escape.js";

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

  it("does not strip bidi controls (raw dump path stays content-preserving)", () => {
    const bidi = "safe\u202e\u061Cname";
    expect(escapeHtml(bidi)).toBe(bidi);
  });
});

describe("stripBidiControls", () => {
  it("strips RTL override U+202E", () => {
    expect(stripBidiControls("ab\u202ecd")).toBe("abcd");
  });

  it("strips Arabic Letter Mark U+061C", () => {
    expect(stripBidiControls("ab\u061Ccd")).toBe("abcd");
  });

  it("strips line separator U+2028", () => {
    expect(stripBidiControls("ab\u2028cd")).toBe("abcd");
  });

  it("strips paragraph separator U+2029 and full bidi set", () => {
    const input =
      "x\u202A\u202B\u202C\u202D\u202E\u2066\u2067\u2068\u2069\u200E\u200F\u061C\u2028\u2029y";
    expect(stripBidiControls(input)).toBe("xy");
  });
});

describe("escapeMarkdown", () => {
  it("escapes markdown formatting characters", () => {
    expect(escapeMarkdown("[link](url)")).toBe("\\[link\\]\\(url\\)");
  });

  it("escapes backticks", () => {
    expect(escapeMarkdown("`code`")).toBe("\\`code\\`");
  });

  it("strips bidi markers before escaping", () => {
    const bidi = "\u202e\u202d";
    expect(escapeMarkdown(bidi)).toBe("");
    expect(escapeMarkdown(`evil\u202efile`)).toBe("evilfile");
    expect(escapeMarkdown(`a\u061Cb\u2028c`)).toBe("abc");
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
