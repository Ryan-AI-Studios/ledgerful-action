import * as fs from "node:fs";
import * as path from "node:path";
import * as core from "@actions/core";
import { installLedgerful } from "./download.js";
import { postSummary } from "./post.js";
import { runScan } from "./run.js";
import { assertSchemaVersion, type PrScanReport } from "./schema.js";

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

async function runWorkflowA(): Promise<void> {
  const version = core.getInput("ledgerful-version", { required: true });
  const checksum = core.getInput("ledgerful-checksum", { required: true });
  const githubToken = core.getInput("github-token");

  const binaryPath = await installLedgerful(version, checksum, githubToken);

  const baseRef = process.env.GITHUB_BASE_REF ?? "main";
  const headRef = process.env.GITHUB_HEAD_REF ?? "HEAD";
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
  const report: PrScanReport = JSON.parse(raw) as PrScanReport;
  assertSchemaVersion(report);

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
