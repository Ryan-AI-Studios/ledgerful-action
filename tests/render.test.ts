import { describe, expect, it } from "vitest";
import sample from "./fixtures/pr-scan-report.sample.json";
import adversarial from "./fixtures/adversarial-pr/report.json";
import { renderCheckRunSummary, renderCheckRunTitle, renderSummary } from "../src/render.js";
import type { PrScanReport } from "../src/schema.js";

const sampleReport = sample as unknown as PrScanReport;
const adversarialReport = adversarial as unknown as PrScanReport;

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

  it("escapes adversarial content", () => {
    const body = renderSummary(adversarialReport);
    expect(body).not.toContain("<script>");
    expect(body).not.toContain("${IFS}");
    expect(body).not.toContain("`rm -rf /`");
    expect(body).not.toContain("src/<!-- ledgerful-action:pr-comment -->");
    expect(body).not.toContain("<!--inject-->");
    expect(body).not.toContain("</script>");
    expect(body).not.toContain("<img src=x onerror=alert(1)>");
    expect(body).not.toContain("abc123;rm -rf /");
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
