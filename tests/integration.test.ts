import { beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { postSummary } from "../src/post.js";
import adversarial from "./fixtures/adversarial-pr/report.json";
import type { PrScanReport } from "../src/schema.js";

const adversarialReport = adversarial as unknown as PrScanReport;

function createOctokit(comments: { id: number; body?: string }[] = [], checkRuns: { id: number }[] = []) {
  const rest = {
    issues: {
      listComments: vi.fn().mockResolvedValue({ data: comments }),
      createComment: vi.fn().mockResolvedValue({ data: { id: 1 } }),
      updateComment: vi.fn().mockResolvedValue({ data: { id: comments[0]?.id ?? 1 } }),
    },
    checks: {
      listForRef: vi.fn().mockResolvedValue({ data: { check_runs: checkRuns } }),
      create: vi.fn().mockResolvedValue({ data: { id: 2 } }),
      update: vi.fn().mockResolvedValue({ data: { id: checkRuns[0]?.id ?? 2 } }),
    },
  };
  return { rest };
}

vi.mock("@actions/github", async () => {
  const actual = await vi.importActual<typeof import("@actions/github")>("@actions/github");
  return {
    ...actual,
    getOctokit: vi.fn(),
    context: {
      repo: { owner: "test-org", repo: "test-repo" },
      payload: {
        workflow_run: {
          id: 42,
          pull_requests: [{ number: 7 }],
          head_sha: "head-sha-abc",
        },
      },
    },
  };
});

vi.mock("@actions/core", async () => {
  const actual = await vi.importActual<typeof import("@actions/core")>("@actions/core");
  return {
    ...actual,
    info: vi.fn(),
    warning: vi.fn(),
  };
});

const github = await import("@actions/github");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Workflow B integration", () => {
  it("downloads an artifact report and posts a comment + check-run", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ledgerful-int-"));
    const reportPath = path.join(dir, "ledgerful-pr-report.json");
    fs.writeFileSync(reportPath, JSON.stringify(adversarialReport), "utf8");

    const octokit = createOctokit([], []) as unknown as ReturnType<typeof github.getOctokit>;
    vi.mocked(github.getOctokit).mockReturnValue(octokit);

    await postSummary({
      token: "test-token",
      report: adversarialReport,
      reportPath,
      artifactUrl: "https://example.com/artifact",
      checkRunName: "Ledgerful PR Risk Report",
    });

    expect(octokit.rest.issues.createComment).toHaveBeenCalled();
    const commentCall = vi.mocked(octokit.rest.issues.createComment).mock.calls[0]?.[0];
    if (!commentCall) throw new Error("createComment was not called");
    expect(commentCall.body).toContain("## Ledgerful PR Risk Report");
    expect(commentCall.body).toContain("[Full report artifact](https://example.com/artifact)");
    expect(commentCall.body).not.toContain("<script>");

    expect(octokit.rest.checks.create).toHaveBeenCalled();
    const checkRunCall = vi.mocked(octokit.rest.checks.create).mock.calls[0]?.[0];
    if (!checkRunCall?.output) throw new Error("checks.create was not called with output");
    expect(checkRunCall.output.title).toContain("Ledgerful risk: high");
    expect(checkRunCall.output.summary).toContain("Risk level: high");
    expect(checkRunCall.output.text).toContain("Raw PR scan report");
    expect(checkRunCall.output.text).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(checkRunCall.output.text).not.toContain("</details>\n\n```json");
    expect(checkRunCall.head_sha).toBe("head-sha-abc");
    expect(checkRunCall.conclusion).toBe("failure");

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("escapes raw report JSON injected with HTML-breaking sequences", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ledgerful-int-html-"));
    const reportPath = path.join(dir, "ledgerful-pr-report.json");
    const tampered = JSON.stringify({
      ...adversarialReport,
      analysisWarnings: ["</details></code></pre>"],
    });
    fs.writeFileSync(reportPath, tampered, "utf8");

    const octokit = createOctokit([], []) as unknown as ReturnType<typeof github.getOctokit>;
    vi.mocked(github.getOctokit).mockReturnValue(octokit);

    await postSummary({
      token: "test-token",
      report: { ...adversarialReport, analysisWarnings: ["</details></code></pre>"] },
      reportPath,
      checkRunName: "Ledgerful PR Risk Report",
    });

    const checkRunCall = vi.mocked(octokit.rest.checks.create).mock.calls[0]?.[0];
    if (!checkRunCall?.output) throw new Error("checks.create was not called with output");
    expect(checkRunCall.output.text).toContain("&lt;/details&gt;&lt;/code&gt;&lt;/pre&gt;");
    expect(checkRunCall.output.text).not.toContain("</details></code></pre>");

    fs.rmSync(dir, { recursive: true, force: true });
  });
});
