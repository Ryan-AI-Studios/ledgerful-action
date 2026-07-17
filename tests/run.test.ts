import { describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { exec } from "@actions/exec";
import { runScan } from "../src/run.js";

vi.mock("@actions/exec", () => {
  return {
    exec: vi.fn(),
  };
});

const mockedExec = vi.mocked(exec);

describe("runScan", () => {
  it("parses a valid scan output", async () => {
    const stdout = JSON.stringify({
      schemaVersion: 1,
      generatedAt: "2026-01-01T00:00:00Z",
      baseRef: "main",
      headRef: "HEAD",
      headHash: "abc",
      branchName: "feature/x",
      treeClean: true,
      changeCount: 0,
      changes: [],
      riskLevel: "low",
      riskReasons: [],
      analysisWarnings: [],
    });

    mockedExec.mockImplementation(async (_cmd, _args, options) => {
      options?.listeners?.stdout?.(Buffer.from(stdout));
      return 0;
    });

    const outputPath = path.join(os.tmpdir(), `ledgerful-run-${Date.now()}.json`);
    const report = await runScan({
      binaryPath: "/tmp/ledgerful",
      baseRef: "main",
      headRef: "HEAD",
      outputPath,
      cwd: "/tmp",
    });

    expect(report.riskLevel).toBe("low");
    expect(fs.existsSync(outputPath)).toBe(true);
    fs.unlinkSync(outputPath);
  });

  it("throws on non-zero exit", async () => {
    mockedExec.mockImplementation(async (_cmd, _args, options) => {
      options?.listeners?.stderr?.(
        Buffer.from("base commit not found; set fetch-depth: 0"),
      );
      return 1;
    });

    await expect(
      runScan({
        binaryPath: "/tmp/ledgerful",
        baseRef: "main",
        headRef: "HEAD",
        outputPath: path.join(os.tmpdir(), `ledgerful-run-fail-${Date.now()}.json`),
        cwd: "/tmp",
      }),
    ).rejects.toThrow(/fetch-depth: 0/);
  });
});
