import { describe, expect, it } from "vitest";
import sample from "./fixtures/pr-scan-report.sample.json";
import adversarial from "./fixtures/adversarial-pr/report.json";
import liveCi from "./fixtures/live/pr-scan-report.ci.json";
import {
  renderCheckRunSummary,
  renderCheckRunTitle,
  renderSummary,
} from "../src/render.js";
import {
  validateReport,
  type PrScanReport,
} from "../src/schema.js";
import {
  CHECK_RUN_MAX_BYTES,
  COMMENT_MAX_CHARS,
  utf8ByteLength,
} from "../src/truncate.js";
import { buildCheckRunRawText } from "../src/post.js";

const sampleReport = sample as unknown as PrScanReport;
const adversarialReport = adversarial as unknown as PrScanReport;
const liveCiReport = liveCi as unknown as PrScanReport;

/** Captured v1 sample render for DoD-6 byte-identical stability. */
const V1_SAMPLE_SUMMARY = `<!-- ledgerful-action:pr-comment -->

## Ledgerful PR Risk Report

**Risk level:** medium

**Changes:** 4 (base \`main\` → head \`HEAD\`)

**Why:** network call isolated in wrapper; new TypeScript surface touches token scope

**Files changed:**

- ➕ \`src/download\\.ts\` (added)
- 📝 \`src/index\\.ts\` (modified)
- ➕ \`src/post\\.ts\` (added)
- ➕ \`src/render\\.ts\` (added)

*Powered by the real Ledgerful engine binary in your runner — no server in the loop.*`;

describe("renderSummary", () => {
  it("renders the sample fixture deterministically", () => {
    const body = renderSummary(sampleReport);
    expect(body).toContain("## Ledgerful PR Risk Report");
    expect(body).toContain("**Risk level:** medium");
    expect(body).toContain("src/download\\.ts");
    expect(body).toContain("src/index\\.ts");
    expect(body).toContain("src/post\\.ts");
    expect(body).toContain("src/render\\.ts");
    expect(body).toContain("new TypeScript surface touches token scope");
    expect(body).toContain("network call isolated in wrapper");
    expect(body).toContain("<!-- ledgerful-action:pr-comment -->");
  });

  it("keeps v1 sample summary byte-identical with no empty v2 sections (DoD-6)", () => {
    const body = renderSummary(sampleReport);
    expect(body).toBe(V1_SAMPLE_SUMMARY);
    expect(body).not.toContain("Most-churned");
    expect(body).not.toContain("History walk was truncated");
  });

  it("orders changes deterministically", () => {
    const body = renderSummary(sampleReport);
    const downloadIndex = body.indexOf("src/download\\.ts");
    const indexIndex = body.indexOf("src/index\\.ts");
    const postIndex = body.indexOf("src/post\\.ts");
    const renderIndex = body.indexOf("src/render\\.ts");
    expect(downloadIndex).toBeLessThan(indexIndex);
    expect(indexIndex).toBeLessThan(postIndex);
    expect(postIndex).toBeLessThan(renderIndex);
  });

  it("escapes adversarial content including v2 optional fields", () => {
    const body = renderSummary(adversarialReport);
    expect(body).not.toContain("<script>");
    expect(body).not.toContain("${IFS}");
    expect(body).not.toContain("`rm -rf /`");
    expect(body).not.toContain("src/<!-- ledgerful-action:pr-comment -->");
    expect(body).not.toContain("<!--inject-->");
    expect(body).not.toContain("</script>");
    expect(body).not.toContain("<img src=x onerror=alert(1)>");
    expect(body).not.toContain("abc123;rm -rf /");
    // v2 adversarial fields must be escaped / stripped
    expect(body).not.toContain("\u202e");
    // Markdown link form is escaped so it is not a live link
    expect(body).not.toContain("](javascript:alert(1))");
    expect(body).toContain("Most-churned");
    // oldPath bidi stripped; rename form present
    expect(body).toContain("→");
  });

  it("strips bidi controls from paths in the rendered body", () => {
    const report: PrScanReport = {
      ...sampleReport,
      changeCount: 1,
      changes: [
        {
          path: "src/\u202eevil.ts",
          changeType: "modified",
        },
      ],
      riskReasons: ["reason\u061Cspoof"],
    };
    const body = renderSummary(report);
    expect(body).not.toContain("\u202e");
    expect(body).not.toContain("\u061C");
    expect(body).toContain("src/evil\\.ts");
    expect(body).toContain("reasonspoof");
  });

  it("truncates long file lists", () => {
    const report: PrScanReport = {
      ...sampleReport,
      changeCount: 40,
      changes: Array.from({ length: 40 }, (_, i) => ({
        path: `src/file-${String(i).padStart(2, "0")}.ts`,
        changeType: "modified",
      })),
    };
    const body = renderSummary(report);
    expect(body).toContain("...and 10 more.");
  });

  it("includes the artifact link when provided", () => {
    const body = renderSummary(sampleReport, "https://example.com/artifact");
    expect(body).toContain("[Full report artifact](https://example.com/artifact)");
  });

  it("shows old → new path form for renames with oldPath", () => {
    const report: PrScanReport = {
      ...sampleReport,
      changeCount: 1,
      changes: [
        {
          path: "src/new.ts",
          changeType: "renamed",
          oldPath: "src/old.ts",
        },
      ],
      riskReasons: [],
      analysisWarnings: [],
    };
    const body = renderSummary(report);
    expect(body).toContain("src/old\\.ts");
    expect(body).toContain("src/new\\.ts");
    expect(body).toMatch(/src\/old\\.ts` → `src\/new\\.ts/);
  });

  it("renders most-churned details when churn is present", () => {
    const report: PrScanReport = {
      ...sampleReport,
      schemaVersion: 2,
      historyWindowCommits: 1000,
      historyTruncated: true,
      changeCount: 2,
      changes: [
        {
          path: "src/hot.ts",
          changeType: "modified",
          churn: 40,
          lastCommitAt: "2026-07-01T00:00:00Z",
          isSensitive: true,
        },
        {
          path: "src/cold.ts",
          changeType: "modified",
          churn: 2,
          lastCommitAt: "2026-01-01T00:00:00Z",
        },
      ],
      riskReasons: [],
      analysisWarnings: [],
    };
    const body = renderSummary(report);
    expect(body).toContain("Most-churned files in this PR");
    expect(body).toContain("churn 40");
    expect(body).toContain("churn 2");
    expect(body).toContain("last commit 2026\\-07\\-01T00:00:00Z");
    expect(body).toContain("(sensitive)");
    expect(body).toContain("History walk was truncated");
    expect(body).toContain("window: 1000 commits");
    // Within the churn section, hot (churn 40) before cold (churn 2)
    const churnSection = body.slice(body.indexOf("Most-churned"));
    expect(churnSection.indexOf("hot")).toBeLessThan(churnSection.indexOf("cold"));
  });

  it("never prints the string null for live CI detached HEAD fixture", () => {
    validateReport(liveCiReport);
    const body = renderSummary(liveCiReport);
    // branchName was null — must not appear as the word null in the body
    expect(body).not.toMatch(/\bnull\b/);
    expect(body).toContain("## Ledgerful PR Risk Report");
  });
});

describe("render size guards (DoD-4)", () => {
  it("volume fixture: 200×4096 reasons + many changes stay under API limits", () => {
    const reason = "r".repeat(4096);
    const report: PrScanReport = {
      ...sampleReport,
      riskReasons: Array.from({ length: 200 }, () => reason),
      analysisWarnings: Array.from({ length: 200 }, () => "w".repeat(100)),
      changeCount: 10_000,
      changes: Array.from({ length: 10_000 }, (_, i) => ({
        path: `src/file-${String(i).padStart(5, "0")}.ts`,
        changeType: "modified" as const,
        churn: i % 50,
        lastCommitAt: "2026-07-26T00:00:00Z",
      })),
      historyTruncated: true,
      historyWindowCommits: 1000,
    };
    // Parse caps allow this payload
    validateReport(report);

    const body = renderSummary(report);
    expect(body.length).toBeLessThan(65_536);
    expect(body.length).toBeLessThanOrEqual(COMMENT_MAX_CHARS);
    expect(body).toContain("truncated");

    const summary = renderCheckRunSummary(report);
    expect(utf8ByteLength(summary)).toBeLessThan(65_535);
    expect(utf8ByteLength(summary)).toBeLessThanOrEqual(CHECK_RUN_MAX_BYTES);

    const raw = JSON.stringify(report);
    const text = buildCheckRunRawText(raw);
    expect(utf8ByteLength(text)).toBeLessThan(65_535);
    expect(utf8ByteLength(text)).toBeLessThanOrEqual(CHECK_RUN_MAX_BYTES);
    expect(text).toContain("<details>");
    expect(text).toContain("</details>");
    expect(text).toContain("```json");
    expect(text.trimEnd().endsWith("</details>")).toBe(true);
    // When truncated, marker present; volume raw is huge so expect truncation.
    expect(text).toContain("truncated");
  });

  it("encoding fixture: multi-byte under .length but over byte limit", () => {
    // "文" is .length 1 but 3 UTF-8 bytes — classic char-vs-byte trap.
    const unit = "文";
    // Single string: under 65536 by .length, over 65535 by byte length.
    const multiByteBlob = unit.repeat(30_000);
    expect(multiByteBlob.length).toBe(30_000);
    expect(multiByteBlob.length).toBeLessThan(65_536);
    expect(utf8ByteLength(multiByteBlob)).toBe(90_000);
    expect(utf8ByteLength(multiByteBlob)).toBeGreaterThan(65_535);

    // Within parse caps: 50 reasons × ~1200 multi-byte chars.
    const reason = unit.repeat(1200);
    expect(reason.length).toBeLessThanOrEqual(4096);
    const reasons = Array.from({ length: 50 }, () => reason);
    const report: PrScanReport = {
      ...sampleReport,
      riskReasons: reasons,
      analysisWarnings: [],
      changeCount: 30,
      changes: Array.from({ length: 30 }, (_, i) => ({
        path: `路径/${unit.repeat(20)}/${String(i)}.ts`,
        changeType: "modified" as const,
      })),
    };
    validateReport(report);

    const joined = reasons.join("; ");
    expect(joined.length).toBeLessThan(65_536);
    expect(utf8ByteLength(joined)).toBeGreaterThan(65_535);

    const body = renderSummary(report);
    expect(body.length).toBeLessThan(65_536);
    expect(body.length).toBeLessThanOrEqual(COMMENT_MAX_CHARS);
    expect(body).not.toContain("\uFFFD");

    const summary = renderCheckRunSummary(report);
    expect(utf8ByteLength(summary)).toBeLessThan(65_535);
    expect(utf8ByteLength(summary)).toBeLessThanOrEqual(CHECK_RUN_MAX_BYTES);
    expect(summary).not.toContain("\uFFFD");
    // Joined reasons alone exceed the byte cap → summary must truncate.
    expect(summary).toContain("truncated");

    // Oversized multi-byte raw dump for check text
    const fatJson = multiByteBlob + JSON.stringify(report);
    expect(fatJson.length).toBeLessThan(utf8ByteLength(fatJson));
    // Char length may sit under or over hard char cap; byte length is the trap.
    expect(utf8ByteLength(fatJson)).toBeGreaterThan(65_535);
    const text = buildCheckRunRawText(fatJson);
    expect(utf8ByteLength(text)).toBeLessThan(65_535);
    expect(utf8ByteLength(text)).toBeLessThanOrEqual(CHECK_RUN_MAX_BYTES);
    expect(text).not.toContain("\uFFFD");
    expect(text).toContain("<details>");
    expect(text).toContain("</details>");
    expect(text).toMatch(/```json/);
    expect(text.trimEnd().endsWith("</details>")).toBe(true);
    expect(text).toContain("truncated");
  });
});

describe("renderCheckRunSummary", () => {
  it("renders a concise check-run summary", () => {
    const text = renderCheckRunSummary(sampleReport);
    expect(text).toContain("Risk level: medium");
    expect(text).toContain("Changes: 4 (base main → head HEAD)");
  });

  it("escapes adversarial content", () => {
    const text = renderCheckRunSummary(adversarialReport);
    expect(text).not.toContain("<script>");
    expect(text).not.toContain("<!--inject-->");
    expect(text).not.toContain("</script>");
    expect(text).not.toContain("<img src=x onerror=alert(1)>");
    expect(text).not.toContain("abc123;rm -rf /");
  });
});

describe("renderCheckRunTitle", () => {
  it("includes risk level and change count", () => {
    expect(renderCheckRunTitle(sampleReport)).toBe(
      "Ledgerful risk: medium (4 changes)",
    );
  });
});
