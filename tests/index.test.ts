import { beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const runModule = await import("../src/index.js");

vi.mock("../src/download.js", () => {
  return {
    installLedgerful: vi.fn().mockResolvedValue("/fake/ledgerful"),
  };
});

vi.mock("../src/run.js", () => {
  return {
    runScan: vi.fn().mockResolvedValue({
      schemaVersion: 1,
      generatedAt: "2026-07-17T21:05:24Z",
      baseRef: "main",
      headRef: "HEAD",
      headHash: "abc123",
      branchName: "feature/test",
      treeClean: true,
      changeCount: 0,
      changes: [],
      riskLevel: "low",
      riskReasons: [],
      analysisWarnings: [],
    }),
  };
});

vi.mock("../src/post.js", () => {
  return {
    postSummary: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("@actions/core", async () => {
  const actual = await vi.importActual<typeof import("@actions/core")>("@actions/core");
  return {
    ...actual,
    getInput: vi.fn(),
    setOutput: vi.fn(),
    setFailed: vi.fn(),
    info: vi.fn(),
  };
});

const core = await import("@actions/core");

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.GITHUB_EVENT_NAME;
  delete process.env.GITHUB_WORKSPACE;
  delete process.env.LEDGERFUL_REPORT_PATH;
});

describe("resolveReportPath", () => {
  it("accepts a relative path under the workspace", async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "ledgerful-ws-"));
    process.env.GITHUB_WORKSPACE = workspace;
    process.env.GITHUB_EVENT_NAME = "workflow_run";
    const reportPath = path.join(workspace, "ledgerful-pr-report.json");
    fs.writeFileSync(
      reportPath,
      JSON.stringify({
        schemaVersion: 1,
        generatedAt: "2026-07-17T21:05:24Z",
        baseRef: "main",
        headRef: "HEAD",
        headHash: "abc123",
        branchName: "feature/test",
        treeClean: true,
        changeCount: 0,
        changes: [],
        riskLevel: "low",
        riskReasons: [],
        analysisWarnings: [],
      }),
      "utf8",
    );

    vi.mocked(core.getInput).mockImplementation((name: string) => {
      if (name === "github-token") return "token";
      if (name === "report-path") return "ledgerful-pr-report.json";
      if (name === "ledgerful-version") return "v0.1.9";
      if (name === "ledgerful-checksum") return "dummy";
      if (name === "fail-on") return "";
      return "";
    });

    await runModule.run();

    fs.rmSync(workspace, { recursive: true, force: true });
  });

  it("rejects absolute paths", async () => {
    process.env.GITHUB_EVENT_NAME = "workflow_run";
    vi.mocked(core.getInput).mockImplementation((name: string) => {
      if (name === "github-token") return "token";
      if (name === "report-path") return "/etc/passwd";
      return "";
    });

    await expect(runModule.run()).rejects.toThrow(/Invalid report-path/);
  });

  it("rejects traversal outside the workspace", async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "ledgerful-ws-"));
    process.env.GITHUB_WORKSPACE = workspace;
    process.env.GITHUB_EVENT_NAME = "workflow_run";
    vi.mocked(core.getInput).mockImplementation((name: string) => {
      if (name === "github-token") return "token";
      if (name === "report-path") return "../etc/passwd";
      return "";
    });

    await expect(runModule.run()).rejects.toThrow(/Invalid report-path/);

    fs.rmSync(workspace, { recursive: true, force: true });
  });

  it("revents traversal hidden in a relative segment", async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "ledgerful-ws-"));
    process.env.GITHUB_WORKSPACE = workspace;
    process.env.GITHUB_EVENT_NAME = "workflow_run";
    vi.mocked(core.getInput).mockImplementation((name: string) => {
      if (name === "github-token") return "token";
      if (name === "report-path") return "output/../../etc/passwd";
      return "";
    });

    await expect(runModule.run()).rejects.toThrow(/Invalid report-path/);

    fs.rmSync(workspace, { recursive: true, force: true });
  });
});

describe("getArtifactUrlFromWorkflowRun", () => {
  beforeEach(() => {
    delete process.env.GITHUB_EVENT_PATH;
  });

  it("returns the workflow_run html_url from the event payload", async () => {
    const tmpEvent = path.join(os.tmpdir(), `ledgerful-event-${Date.now()}.json`);
    fs.writeFileSync(
      tmpEvent,
      JSON.stringify({
        workflow_run: {
          html_url: "https://github.com/Ryan-AI-Studios/Ledgerful/actions/runs/12345",
        },
      }),
      "utf8",
    );
    process.env.GITHUB_EVENT_PATH = tmpEvent;

    const mod = await import("../src/index.js");
    const url = (mod as unknown as { getArtifactUrlFromWorkflowRun: () => string | undefined }).getArtifactUrlFromWorkflowRun();
    expect(url).toBe("https://github.com/Ryan-AI-Studios/Ledgerful/actions/runs/12345");

    fs.rmSync(tmpEvent, { force: true });
  });

  it("returns undefined when GITHUB_EVENT_PATH is absent", async () => {
    const mod = await import("../src/index.js");
    const url = (mod as unknown as { getArtifactUrlFromWorkflowRun: () => string | undefined }).getArtifactUrlFromWorkflowRun();
    expect(url).toBeUndefined();
  });

  it("returns undefined when the event payload is malformed", async () => {
    const tmpEvent = path.join(os.tmpdir(), `ledgerful-event-${Date.now()}.json`);
    fs.writeFileSync(tmpEvent, "{ not valid json", "utf8");
    process.env.GITHUB_EVENT_PATH = tmpEvent;

    const mod = await import("../src/index.js");
    const url = (mod as unknown as { getArtifactUrlFromWorkflowRun: () => string | undefined }).getArtifactUrlFromWorkflowRun();
    expect(url).toBeUndefined();

    fs.rmSync(tmpEvent, { force: true });
  });
});
