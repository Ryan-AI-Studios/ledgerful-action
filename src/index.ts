import * as fs from "node:fs";
import * as path from "node:path";
import * as core from "@actions/core";
import { installLedgerful } from "./download.js";
import { postSummary } from "./post.js";
import { runScan } from "./run.js";
import { type PrScanReport, validateReport } from "./schema.js";

function isWorkflowB(): boolean {
  const eventName = process.env.GITHUB_EVENT_NAME ?? "";
  return eventName === "workflow_run";
}

function getArtifactUrlFromWorkflowRun(): string | undefined {
  // In a workflow_run event, GITHUB_EVENT_PATH points to the event payload JSON.
  // The payload contains `workflow_run.html_url` — the URL of Workflow A's run
  // (where the artifact was uploaded), NOT Workflow B's own run.
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) return undefined;
  try {
    const event = JSON.parse(fs.readFileSync(eventPath, "utf8")) as {
      workflow_run?: { html_url?: string };
    };
    return event.workflow_run?.html_url;
  } catch {
    return undefined;
  }
}

/**
 * Resolve the git range for `scan --pr`.
 *
 * Prefer commit SHAs from the `pull_request` event payload. Branch names from
 * `GITHUB_BASE_REF` / `GITHUB_HEAD_REF` (e.g. `main`) are often not present as
 * local refs after `actions/checkout`, even with `fetch-depth: 0` — that caused
 * "base commit 'main' is not present in the local clone" on the Action's own CI.
 *
 * On `push` events, GitHub sets BASE/HEAD_REF to empty strings (not unset), so
 * `??` alone is wrong — treat empty as missing. Fall back to
 * `github.event.before...github.sha` when present, else `HEAD~1...HEAD`.
 */
export function resolvePrRange(): { baseRef: string; headRef: string } {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (eventPath) {
    try {
      const event = JSON.parse(fs.readFileSync(eventPath, "utf8")) as {
        pull_request?: { base?: { sha?: string }; head?: { sha?: string } };
        before?: string;
        after?: string;
      };
      const baseSha = event.pull_request?.base?.sha?.trim();
      const headSha = event.pull_request?.head?.sha?.trim();
      if (baseSha && headSha) {
        return { baseRef: baseSha, headRef: headSha };
      }
      // push event: before is the previous tip (zeros on new branch create)
      const before = event.before?.trim();
      const after =
        event.after?.trim() ||
        process.env.GITHUB_SHA?.trim() ||
        "";
      const zero = "0000000000000000000000000000000000000000";
      if (before && before !== zero && after) {
        return { baseRef: before, headRef: after };
      }
    } catch {
      // fall through
    }
  }
  const baseEnv = process.env.GITHUB_BASE_REF?.trim();
  const headEnv = process.env.GITHUB_HEAD_REF?.trim();
  return {
    baseRef: baseEnv || "HEAD~1",
    headRef: headEnv || process.env.GITHUB_SHA?.trim() || "HEAD",
  };
}

/**
 * Read PR number from the pull_request event payload (Workflow A).
 * Returns undefined when absent or not a positive integer.
 */
export function resolvePrNumberFromEvent(): number | undefined {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) return undefined;
  try {
    const event = JSON.parse(fs.readFileSync(eventPath, "utf8")) as {
      pull_request?: { number?: number };
    };
    const n = event.pull_request?.number;
    if (typeof n === "number" && Number.isInteger(n) && n > 0) {
      return n;
    }
  } catch {
    // ignore malformed event path
  }
  return undefined;
}

async function runWorkflowA(): Promise<void> {
  const version = core.getInput("ledgerful-version", { required: true });
  const checksum = core.getInput("ledgerful-checksum", { required: true });
  const githubToken = core.getInput("github-token");

  const binaryPath = await installLedgerful(version, checksum, githubToken);

  const { baseRef, headRef } = resolvePrRange();
  const cwd = process.env.GITHUB_WORKSPACE ?? process.cwd();

  const reportPath =
    core.getInput("report-path") ||
    process.env.LEDGERFUL_REPORT_PATH ||
    "ledgerful-pr-report.json";

  const report = await runScan({
    binaryPath,
    baseRef,
    headRef,
    outputPath: reportPath,
    cwd,
  });

  // Engine does not emit prNumber; stamp it from the trusted pull_request event
  // so Workflow B can resolve fork PRs without listPullRequestsAssociatedWithCommit.
  const prNumber = resolvePrNumberFromEvent();
  if (prNumber !== undefined) {
    report.prNumber = prNumber;
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    core.info(`Stamped report.prNumber=${String(prNumber)} for Workflow B`);
  }

  if (report.changeCount === 0) {
    core.info("No changes detected in PR scan.");
  }

  core.setOutput("report-path", reportPath);
  core.setOutput("risk-level", report.riskLevel);

  const failOn = core.getInput("fail-on").toLowerCase();
  if (failOn && shouldFail(report.riskLevel, failOn)) {
    core.setFailed(
      `PR risk level ${report.riskLevel} meets fail-on threshold ${failOn}.`,
    );
  }
}

function shouldFail(riskLevel: string, failOn: string): boolean {
  const levels = ["low", "medium", "high"];
  const riskIndex = levels.indexOf(riskLevel);
  const failIndex = levels.indexOf(failOn);
  return failIndex !== -1 && riskIndex >= failIndex;
}

function resolveReportPath(): string {
  const raw =
    core.getInput("report-path") ||
    process.env.LEDGERFUL_REPORT_PATH ||
    "ledgerful-pr-report.json";
  const workspace = process.env.GITHUB_WORKSPACE ?? process.cwd();
  const absolute = path.isAbsolute(raw) ? raw : path.resolve(workspace, raw);
  const relativeToWorkspace = path.relative(workspace, absolute);

  if (
    path.isAbsolute(raw) ||
    raw.startsWith("..") ||
    relativeToWorkspace.startsWith("..") ||
    relativeToWorkspace.includes("..")
  ) {
    throw new Error(
      `Invalid report-path "${raw}". ` +
        `The path must be relative and stay within GITHUB_WORKSPACE (${workspace}).`,
    );
  }
  return absolute;
}

async function runWorkflowB(): Promise<void> {
  const token = core.getInput("github-token", { required: true });
  const reportPath = resolveReportPath();

  const raw = fs.readFileSync(reportPath, "utf8");
  const parsed: unknown = JSON.parse(raw);
  // Fail closed: full runtime schema check (not a TypeScript cast).
  validateReport(parsed);
  const report: PrScanReport = parsed;

  await postSummary({
    token,
    report,
    reportPath,
    artifactUrl: getArtifactUrlFromWorkflowRun(),
    checkRunName: "Ledgerful PR Risk Report",
  });
}

async function run(): Promise<void> {
  if (isWorkflowB()) {
    core.info("Running in Workflow B mode (workflow_run) — posting report.");
    await runWorkflowB();
  } else {
    core.info("Running in Workflow A mode (scan) — executing engine offline.");
    await runWorkflowA();
  }
}

run().catch((err: unknown) => {
  if (err instanceof Error) {
    core.setFailed(err.message);
  } else {
    core.setFailed(String(err));
  }
});

export { run, getArtifactUrlFromWorkflowRun };
