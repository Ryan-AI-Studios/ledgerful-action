import { beforeEach, describe, expect, it, vi } from "vitest";
import sample from "./fixtures/pr-scan-report.sample.json";
import { postSummary } from "../src/post.js";
import type { PrScanReport } from "../src/schema.js";

const sampleReport = sample as unknown as PrScanReport;

function createOctokit(
  comments: { id: number; body?: string }[] = [],
  checkRuns: { id: number }[] = [],
  associatedPrs: Array<{
    number: number;
    state: string;
    head?: { sha?: string };
  }> = [],
) {
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
    repos: {
      listPullRequestsAssociatedWithCommit: vi.fn().mockResolvedValue({
        data: associatedPrs,
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
  // Restore default payload used by most tests
  github.context.payload = {
    workflow_run: {
      id: 42,
      pull_requests: [{ number: 7 }],
      head_sha: "head-sha-abc",
    },
  };
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

  it("throws when PR number is missing and API fallback returns nothing", async () => {
    const octokit = createOctokit([], [], []) as unknown as ReturnType<
      typeof github.getOctokit
    >;
    vi.mocked(github.getOctokit).mockReturnValue(octokit);
    github.context.payload = {
      workflow_run: {
        head_sha: "head-sha-abc",
        pull_requests: [],
      },
    };
    await expect(
      postSummary({
        token: "token",
        report: sampleReport,
        reportPath: "ledgerful-pr-report.json",
        checkRunName: "Ledgerful PR Risk Report",
      }),
    ).rejects.toThrow(/pull request number/);
    expect(
      octokit.rest.repos.listPullRequestsAssociatedWithCommit,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: "test-org",
        repo: "test-repo",
        commit_sha: "head-sha-abc",
      }),
    );
  });

  it("uses report.prNumber as primary path without calling the commit API", async () => {
    const octokit = createOctokit([], []) as unknown as ReturnType<typeof github.getOctokit>;
    vi.mocked(github.getOctokit).mockReturnValue(octokit);
    // No PR in payload (fork PR case)
    github.context.payload = {
      workflow_run: {
        head_sha: "head-sha-abc",
        pull_requests: [],
      },
    };

    const reportWithPr: PrScanReport = {
      ...sampleReport,
      prNumber: 123,
    };

    await postSummary({
      token: "token",
      report: reportWithPr,
      reportPath: "ledgerful-pr-report.json",
      checkRunName: "Ledgerful PR Risk Report",
    });

    expect(octokit.rest.issues.createComment).toHaveBeenCalledWith(
      expect.objectContaining({ issue_number: 123 }),
    );
    expect(
      octokit.rest.repos.listPullRequestsAssociatedWithCommit,
    ).not.toHaveBeenCalled();
  });

  it("falls back to listPullRequestsAssociatedWithCommit when prNumber absent and pull_requests empty", async () => {
    const octokit = createOctokit(
      [],
      [],
      [
        {
          number: 55,
          state: "open",
          head: { sha: "head-sha-abc" },
        },
      ],
    ) as unknown as ReturnType<typeof github.getOctokit>;
    vi.mocked(github.getOctokit).mockReturnValue(octokit);
    github.context.payload = {
      workflow_run: {
        head_sha: "head-sha-abc",
        pull_requests: [],
      },
    };

    await postSummary({
      token: "token",
      report: sampleReport,
      reportPath: "ledgerful-pr-report.json",
      checkRunName: "Ledgerful PR Risk Report",
    });

    expect(
      octokit.rest.repos.listPullRequestsAssociatedWithCommit,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        commit_sha: "head-sha-abc",
      }),
    );
    expect(octokit.rest.issues.createComment).toHaveBeenCalledWith(
      expect.objectContaining({ issue_number: 55 }),
    );
  });

  it("prefers open PR with exact head.sha when multiple PRs are associated", async () => {
    const octokit = createOctokit(
      [],
      [],
      [
        {
          number: 10,
          state: "closed",
          head: { sha: "head-sha-abc" },
        },
        {
          number: 20,
          state: "open",
          head: { sha: "other-sha" },
        },
        {
          number: 30,
          state: "open",
          head: { sha: "head-sha-abc" },
        },
        {
          number: 40,
          state: "open",
          head: { sha: "head-sha-abc" },
        },
      ],
    ) as unknown as ReturnType<typeof github.getOctokit>;
    vi.mocked(github.getOctokit).mockReturnValue(octokit);
    github.context.payload = {
      workflow_run: {
        head_sha: "head-sha-abc",
        pull_requests: [],
      },
    };

    await postSummary({
      token: "token",
      report: sampleReport,
      reportPath: "ledgerful-pr-report.json",
      checkRunName: "Ledgerful PR Risk Report",
    });

    // First open + exact head.sha match wins (PR 30, not closed 10 or open-other-sha 20).
    expect(octokit.rest.issues.createComment).toHaveBeenCalledWith(
      expect.objectContaining({ issue_number: 30 }),
    );
  });

  it("does not select a closed PR when only closed associations exist", async () => {
    const octokit = createOctokit(
      [],
      [],
      [
        {
          number: 10,
          state: "closed",
          head: { sha: "head-sha-abc" },
        },
        {
          number: 11,
          state: "closed",
          head: { sha: "other-sha" },
        },
      ],
    ) as unknown as ReturnType<typeof github.getOctokit>;
    vi.mocked(github.getOctokit).mockReturnValue(octokit);
    github.context.payload = {
      workflow_run: {
        head_sha: "head-sha-abc",
        pull_requests: [],
      },
    };

    await expect(
      postSummary({
        token: "token",
        report: sampleReport,
        reportPath: "ledgerful-pr-report.json",
        checkRunName: "Ledgerful PR Risk Report",
      }),
    ).rejects.toThrow(/pull request number/);
    expect(octokit.rest.issues.createComment).not.toHaveBeenCalled();
  });

  it("throws a clear error when commit association list is empty", async () => {
    const octokit = createOctokit([], [], []) as unknown as ReturnType<
      typeof github.getOctokit
    >;
    vi.mocked(github.getOctokit).mockReturnValue(octokit);
    github.context.payload = {
      workflow_run: {
        head_sha: "head-sha-abc",
        pull_requests: [],
      },
    };

    await expect(
      postSummary({
        token: "token",
        report: sampleReport,
        reportPath: "ledgerful-pr-report.json",
        checkRunName: "Ledgerful PR Risk Report",
      }),
    ).rejects.toThrow(/Could not determine pull request number/);
  });
});
