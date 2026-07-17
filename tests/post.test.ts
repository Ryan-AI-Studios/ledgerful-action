import { beforeEach, describe, expect, it, vi } from "vitest";
import sample from "./fixtures/pr-scan-report.sample.json";
import { postSummary } from "../src/post.js";
import type { PrScanReport } from "../src/schema.js";

const sampleReport = sample as unknown as PrScanReport;

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
    pulls: {
      get: vi.fn().mockResolvedValue({
        data: { head: { sha: "head-sha-abc" } },
      }),
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

const github = await import("@actions/github");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("postSummary", () => {
  it("creates a new comment when none exists", async () => {
    const octokit = createOctokit([], []) as unknown as ReturnType<typeof github.getOctokit>;
    vi.mocked(github.getOctokit).mockReturnValue(octokit);

    await postSummary({
      token: "token",
      report: sampleReport,
      reportPath: "ledgerful-pr-report.json",
      artifactUrl: "https://example.com/artifact",
      checkRunName: "Ledgerful PR Risk Report",
    });

    expect(octokit.rest.issues.createComment).toHaveBeenCalled();
    expect(octokit.rest.issues.updateComment).not.toHaveBeenCalled();
    expect(octokit.rest.checks.create).toHaveBeenCalled();
  });

  it("updates an existing comment", async () => {
    const octokit = createOctokit(
      [{ id: 99, body: "<!-- ledgerful-action:pr-comment --> old" }],
      [],
    ) as unknown as ReturnType<typeof github.getOctokit>;
    vi.mocked(github.getOctokit).mockReturnValue(octokit);

    await postSummary({
      token: "token",
      report: sampleReport,
      reportPath: "ledgerful-pr-report.json",
      checkRunName: "Ledgerful PR Risk Report",
    });

    expect(octokit.rest.issues.updateComment).toHaveBeenCalledWith(
      expect.objectContaining({ comment_id: 99 }),
    );
    expect(octokit.rest.issues.createComment).not.toHaveBeenCalled();
  });

  it("updates an existing check-run", async () => {
    const octokit = createOctokit([], [{ id: 55 }]) as unknown as ReturnType<typeof github.getOctokit>;
    vi.mocked(github.getOctokit).mockReturnValue(octokit);

    await postSummary({
      token: "token",
      report: sampleReport,
      reportPath: "ledgerful-pr-report.json",
      checkRunName: "Ledgerful PR Risk Report",
    });

    expect(octokit.rest.checks.update).toHaveBeenCalledWith(
      expect.objectContaining({ check_run_id: 55 }),
    );
    expect(octokit.rest.checks.create).not.toHaveBeenCalled();
  });

  it("throws when token is missing", async () => {
    await expect(
      postSummary({
        token: "",
        report: sampleReport,
        reportPath: "ledgerful-pr-report.json",
        checkRunName: "Ledgerful PR Risk Report",
      }),
    ).rejects.toThrow(/GITHUB_TOKEN/);
  });

  it("throws when PR number is missing", async () => {
    vi.mocked(github.getOctokit).mockReturnValue(
      createOctokit() as unknown as ReturnType<typeof github.getOctokit>,
    );
    const previous = github.context.payload;
    github.context.payload = {};
    await expect(
      postSummary({
        token: "token",
        report: sampleReport,
        reportPath: "ledgerful-pr-report.json",
        checkRunName: "Ledgerful PR Risk Report",
      }),
    ).rejects.toThrow(/pull request number/);
    github.context.payload = previous;
  });
});
