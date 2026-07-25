import * as fs from "node:fs";
import * as core from "@actions/core";
import * as github from "@actions/github";
import type { PrScanReport } from "./schema.js";
import { escapeHtml } from "./escape.js";
import {
  COMMENT_ANCHOR,
  renderCheckRunSummary,
  renderCheckRunTitle,
  renderSummary,
} from "./render.js";

export interface PostContext {
  token: string;
  report: PrScanReport;
  reportPath: string;
  artifactUrl?: string;
  checkRunName: string;
}

interface WorkflowRunPayload {
  pull_requests?: Array<{ number: number }>;
  head_sha?: string;
}

interface PullRequestPayload {
  number?: number;
  head?: { sha?: string };
}

export interface GitHubPayload {
  workflow_run?: WorkflowRunPayload;
  pull_request?: PullRequestPayload;
}

type Octokit = ReturnType<typeof github.getOctokit>;

export async function postSummary(context: PostContext): Promise<void> {
  const { token, report, reportPath, artifactUrl, checkRunName } = context;

  if (!token) {
    throw new Error(
      "GITHUB_TOKEN is required to post the PR comment / check-run. " +
        "Workflow A (read-only) never receives this; Workflow B must pass github-token.",
    );
  }

  const octokit = github.getOctokit(token);
  const { repo, payload } = github.context;

  const typedPayload = payload as GitHubPayload;
  const pullRequestNumber = await resolvePullRequestNumber(
    report,
    typedPayload,
    octokit,
    repo,
  );

  const body = renderSummary(report, artifactUrl);
  await upsertComment(octokit, repo, pullRequestNumber, body);

  const headSha = await resolveHeadSha(octokit, repo, typedPayload, pullRequestNumber);
  if (headSha) {
    await upsertCheckRun(
      octokit,
      repo,
      headSha,
      checkRunName,
      report,
      reportPath,
    );
  } else {
    core.warning("Could not resolve head SHA for check-run; skipping check-run update.");
  }
}

/**
 * Resolve the PR number for Workflow B posting.
 *
 * Priority:
 * 1. `report.prNumber` (set by Workflow A from trusted pull_request event) — primary.
 * 2. `workflow_run.pull_requests[0]` / `pull_request.number` (same-repo PRs).
 * 3. `listPullRequestsAssociatedWithCommit` by head_sha (fork PRs, older reports).
 */
export async function resolvePullRequestNumber(
  report: PrScanReport,
  payload: GitHubPayload,
  octokit: Octokit,
  repo: { owner: string; repo: string },
): Promise<number> {
  if (
    typeof report.prNumber === "number" &&
    Number.isInteger(report.prNumber) &&
    report.prNumber > 0
  ) {
    return report.prNumber;
  }

  const fromPayload = getPullRequestNumberFromPayload(payload);
  if (fromPayload !== undefined) {
    return fromPayload;
  }

  const headSha = payload.workflow_run?.head_sha;
  if (headSha) {
    const fromApi = await resolvePrNumberFromCommit(
      octokit,
      repo,
      headSha,
    );
    if (fromApi !== undefined) {
      return fromApi;
    }
  }

  throw new Error(
    "Could not determine pull request number from workflow_run payload. " +
      "Ensure Workflow B is triggered by a pull_request Workflow A.",
  );
}

/** Synchronous payload-only resolution (no API). Exported for tests. */
export function getPullRequestNumberFromPayload(
  payload: GitHubPayload,
): number | undefined {
  const first = payload.workflow_run?.pull_requests?.[0];
  if (first && typeof first.number === "number" && first.number > 0) {
    return first.number;
  }
  if (
    typeof payload.pull_request?.number === "number" &&
    payload.pull_request.number > 0
  ) {
    return payload.pull_request.number;
  }
  return undefined;
}

async function resolvePrNumberFromCommit(
  octokit: Octokit,
  repo: { owner: string; repo: string },
  headSha: string,
): Promise<number | undefined> {
  const { data: prs } = await octokit.rest.repos.listPullRequestsAssociatedWithCommit({
    owner: repo.owner,
    repo: repo.repo,
    commit_sha: headSha,
  });

  if (!Array.isArray(prs) || prs.length === 0) {
    return undefined;
  }

  type AssociatedPr = (typeof prs)[number];
  // Plan/DoD: only open PRs — never guess a closed PR for a legacy report.
  const openExact = prs.filter(
    (pr: AssociatedPr) => pr.state === "open" && pr.head.sha === headSha,
  );
  if (openExact.length >= 1) {
    // Prefer open PRs with exact head SHA match (first if multiple).
    return openExact[0].number;
  }

  const openAny = prs.find((pr: AssociatedPr) => pr.state === "open");
  if (openAny) {
    return openAny.number;
  }

  return undefined;
}

async function resolveHeadSha(
  octokit: Octokit,
  repo: { owner: string; repo: string },
  payload: GitHubPayload,
  pullRequestNumber: number,
): Promise<string> {
  if (payload.workflow_run?.head_sha) {
    return payload.workflow_run.head_sha;
  }
  if (payload.pull_request?.head?.sha) {
    return payload.pull_request.head.sha;
  }
  const { data: pr } = await octokit.rest.pulls.get({
    ...repo,
    pull_number: pullRequestNumber,
  });
  return pr.head.sha;
}

async function upsertComment(
  octokit: Octokit,
  repo: { owner: string; repo: string },
  pullRequestNumber: number,
  body: string,
): Promise<void> {
  const { data: comments } = await octokit.rest.issues.listComments({
    ...repo,
    issue_number: pullRequestNumber,
  });
  const existing = comments.find((c) =>
    c.body?.includes(COMMENT_ANCHOR),
  );

  if (existing) {
    await octokit.rest.issues.updateComment({
      ...repo,
      comment_id: existing.id,
      body,
    });
    core.info(`Updated existing Ledgerful comment ${String(existing.id)}`);
  } else {
    await octokit.rest.issues.createComment({
      ...repo,
      issue_number: pullRequestNumber,
      body,
    });
    core.info("Created new Ledgerful comment");
  }
}

function riskLevelConclusion(
  riskLevel: string,
): "success" | "failure" | "neutral" {
  switch (riskLevel) {
    case "high":
      return "failure";
    case "medium":
      return "neutral";
    case "low":
    default:
      return "success";
  }
}

async function upsertCheckRun(
  octokit: Octokit,
  repo: { owner: string; repo: string },
  headSha: string,
  checkRunName: string,
  report: PrScanReport,
  reportPath: string,
): Promise<void> {
  const { data: existingRuns } = await octokit.rest.checks.listForRef({
    ...repo,
    ref: headSha,
    check_name: checkRunName,
  });
  const existing = existingRuns.check_runs.at(0);

  const summary = renderCheckRunSummary(report);
  // Raw dump: HTML-escape only — do NOT strip bidi (byte-content-preserving for inspection).
  const text = fs.existsSync(reportPath)
    ? `<details><summary>Raw PR scan report</summary>\n\n\`\`\`json\n${escapeHtml(fs.readFileSync(reportPath, "utf8").replace(/`/g, "\\`"))}\n\`\`\`\n</details>`
    : "Raw report not available.";

  const params = {
    ...repo,
    head_sha: headSha,
    name: checkRunName,
    status: "completed" as const,
    conclusion: riskLevelConclusion(report.riskLevel),
    output: {
      title: renderCheckRunTitle(report),
      summary,
      text,
    },
  };

  if (existing) {
    await octokit.rest.checks.update({
      ...repo,
      check_run_id: existing.id,
      ...params,
    });
    core.info(`Updated existing check-run ${String(existing.id)}`);
  } else {
    await octokit.rest.checks.create(params);
    core.info("Created new check-run");
  }
}
