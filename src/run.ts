import * as fs from "node:fs";
import * as path from "node:path";
import * as core from "@actions/core";
import { exec } from "@actions/exec";
import type { PrScanReport } from "./schema.js";
import { assertSchemaVersion } from "./schema.js";

export interface ScanOptions {
  binaryPath: string;
  baseRef: string;
  headRef: string;
  outputPath: string;
  cwd: string;
}

export async function runScan(options: ScanOptions): Promise<PrScanReport> {
  const { binaryPath, baseRef, headRef, outputPath, cwd } = options;

  const range = `${baseRef}...${headRef}`;
  const args = ["scan", "--pr", range, "--format", "json"];

  let stdout = "";
  let stderr = "";

  const exitCode = await exec(binaryPath, args, {
    cwd,
    env: {
      ...process.env,
      LEDGERFUL_NO_NETWORK: "1",
    },
    listeners: {
      stdout: (data: Buffer) => {
        stdout += data.toString("utf8");
      },
      stderr: (data: Buffer) => {
        stderr += data.toString("utf8");
      },
    },
    ignoreReturnCode: true,
  });

  if (exitCode !== 0) {
    const detail = stderr.trim() || stdout.trim();
    throw new Error(
      `ledgerful scan failed (exit ${exitCode}). ` +
        (detail.includes("base commit") || detail.includes("fetch-depth")
          ? "The base commit is missing; ensure actions/checkout uses fetch-depth: 0. "
          : "") +
        `Error output: ${detail.slice(0, 2000)}`,
    );
  }

  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  fs.writeFileSync(outputPath, stdout, "utf8");

  const report: PrScanReport = JSON.parse(stdout) as PrScanReport;
  assertSchemaVersion(report);
  core.info(
    `Ledgerful scan complete: ${report.changeCount} changes, risk=${report.riskLevel}`,
  );
  return report;
}
