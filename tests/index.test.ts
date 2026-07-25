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

describe("Workflow B fail-closed before postSummary", () => {
  it("does not call postSummary when report fails schema validation (bad riskLevel)", async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "ledgerful-ws-"));
    process.env.GITHUB_WORKSPACE = workspace;
    process.env.GITHUB_EVENT_NAME = "workflow_run";
    const reportPath = path.join(workspace, "ledgerful-pr-report.json");
    const attacker = "attacker-payload-should-not-appear";
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
        riskLevel: attacker,
        riskReasons: [],
        analysisWarnings: [],
      }),
      "utf8",
    );

    vi.mocked(core.getInput).mockImplementation((name: string) => {
      if (name === "github-token") return "token";
      if (name === "report-path") return "ledgerful-pr-report.json";
      return "";
    });

    const post = await import("../src/post.js");

    await expect(runModule.run()).rejects.toThrow(/riskLevel/);
    expect(post.postSummary).not.toHaveBeenCalled();

    try {
      await runModule.run();
    } catch (err) {
      expect(String(err)).not.toContain(attacker);
    }

    fs.rmSync(workspace, { recursive: true, force: true });
  });

  it("does not call postSummary when report root is an array", async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "ledgerful-ws-"));
    process.env.GITHUB_WORKSPACE = workspace;
    process.env.GITHUB_EVENT_NAME = "workflow_run";
    const reportPath = path.join(workspace, "ledgerful-pr-report.json");
    fs.writeFileSync(reportPath, JSON.stringify([{ evil: true }]), "utf8");

    vi.mocked(core.getInput).mockImplementation((name: string) => {
      if (name === "github-token") return "token";
      if (name === "report-path") return "ledgerful-pr-report.json";
      return "";
    });

    const post = await import("../src/post.js");

    await expect(runModule.run()).rejects.toThrow(/expected a JSON object/);
    expect(post.postSummary).not.toHaveBeenCalled();

    fs.rmSync(workspace, { recursive: true, force: true });
  });
});

describe("resolvePrNumberFromEvent", () => {
  beforeEach(() => {
    delete process.env.GITHUB_EVENT_PATH;
  });

  it("returns pull_request.number on happy path", () => {
    const eventPath = path.join(os.tmpdir(), `ledgerful-prnum-${Date.now()}.json`);
    fs.writeFileSync(
      eventPath,
      JSON.stringify({ pull_request: { number: 42 } }),
      "utf8",
    );
    process.env.GITHUB_EVENT_PATH = eventPath;

    expect(runModule.resolvePrNumberFromEvent()).toBe(42);

    fs.unlinkSync(eventPath);
    delete process.env.GITHUB_EVENT_PATH;
  });

  it("returns undefined when GITHUB_EVENT_PATH is missing", () => {
    delete process.env.GITHUB_EVENT_PATH;
    expect(runModule.resolvePrNumberFromEvent()).toBeUndefined();
  });

  it("returns undefined for non-positive or non-integer numbers", () => {
    for (const number of [0, -1, 1.5, null, "7"]) {
      const eventPath = path.join(
        os.tmpdir(),
        `ledgerful-prnum-bad-${Date.now()}-${String(number)}.json`,
      );
      fs.writeFileSync(
        eventPath,
        JSON.stringify({ pull_request: { number } }),
        "utf8",
      );
      process.env.GITHUB_EVENT_PATH = eventPath;

      expect(runModule.resolvePrNumberFromEvent()).toBeUndefined();

      fs.unlinkSync(eventPath);
    }
    delete process.env.GITHUB_EVENT_PATH;
  });

  it("returns undefined when event JSON is malformed", () => {
    const eventPath = path.join(os.tmpdir(), `ledgerful-prnum-badjson-${Date.now()}.json`);
    fs.writeFileSync(eventPath, "{ not valid", "utf8");
    process.env.GITHUB_EVENT_PATH = eventPath;

    expect(runModule.resolvePrNumberFromEvent()).toBeUndefined();

    fs.unlinkSync(eventPath);
    delete process.env.GITHUB_EVENT_PATH;
  });

  it("stamps prNumber onto the report file in Workflow A", async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "ledgerful-ws-a-"));
    process.env.GITHUB_WORKSPACE = workspace;
    process.env.GITHUB_EVENT_NAME = "pull_request";
    const eventPath = path.join(workspace, "event.json");
    fs.writeFileSync(
      eventPath,
      JSON.stringify({
        pull_request: {
          number: 99,
          base: { sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
          head: { sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
        },
      }),
      "utf8",
    );
    process.env.GITHUB_EVENT_PATH = eventPath;

    const reportPath = path.join(workspace, "ledgerful-pr-report.json");
    vi.mocked(core.getInput).mockImplementation((name: string) => {
      if (name === "github-token") return "token";
      if (name === "report-path") return "ledgerful-pr-report.json";
      if (name === "ledgerful-version") return "v0.1.9";
      if (name === "ledgerful-checksum") return "dummy";
      if (name === "fail-on") return "";
      return "";
    });

    // runScan mock returns report without prNumber; Workflow A must stamp it.
    const runJs = await import("../src/run.js");
    vi.mocked(runJs.runScan).mockResolvedValueOnce({
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
    });

    // runScan writes nothing; Workflow A writes after stamp only when prNumber set.
    // Ensure cwd-relative report path resolves under workspace.
    const prevCwd = process.cwd();
    process.chdir(workspace);
    try {
      await runModule.run();
      expect(fs.existsSync(reportPath)).toBe(true);
      const stamped = JSON.parse(fs.readFileSync(reportPath, "utf8")) as {
        prNumber?: number;
      };
      expect(stamped.prNumber).toBe(99);
    } finally {
      process.chdir(prevCwd);
      fs.rmSync(workspace, { recursive: true, force: true });
      delete process.env.GITHUB_EVENT_PATH;
      delete process.env.GITHUB_EVENT_NAME;
      delete process.env.GITHUB_WORKSPACE;
    }
  });
});

describe("resolvePrRange", () => {
  it("prefers pull_request base/head SHAs from the event payload", () => {
    const eventPath = path.join(os.tmpdir(), `ledgerful-event-${Date.now()}.json`);
    fs.writeFileSync(
      eventPath,
      JSON.stringify({
        pull_request: {
          base: { sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
          head: { sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" },
        },
      }),
      "utf8",
    );
    process.env.GITHUB_EVENT_PATH = eventPath;
    process.env.GITHUB_BASE_REF = "main";
    process.env.GITHUB_HEAD_REF = "feature/x";

    const range = runModule.resolvePrRange();
    expect(range.baseRef).toBe("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(range.headRef).toBe("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");

    fs.unlinkSync(eventPath);
    delete process.env.GITHUB_EVENT_PATH;
    delete process.env.GITHUB_BASE_REF;
    delete process.env.GITHUB_HEAD_REF;
  });

  it("falls back to GITHUB_BASE_REF / GITHUB_HEAD_REF when no event SHAs", () => {
    delete process.env.GITHUB_EVENT_PATH;
    process.env.GITHUB_BASE_REF = "develop";
    process.env.GITHUB_HEAD_REF = "feature/y";

    const range = runModule.resolvePrRange();
    expect(range.baseRef).toBe("develop");
    expect(range.headRef).toBe("feature/y");

    delete process.env.GITHUB_BASE_REF;
    delete process.env.GITHUB_HEAD_REF;
  });

  it("uses push before/after SHAs when pull_request is absent", () => {
    const eventPath = path.join(os.tmpdir(), `ledgerful-push-${Date.now()}.json`);
    fs.writeFileSync(
      eventPath,
      JSON.stringify({
        before: "cccccccccccccccccccccccccccccccccccccccc",
        after: "dddddddddddddddddddddddddddddddddddddddd",
      }),
      "utf8",
    );
    process.env.GITHUB_EVENT_PATH = eventPath;
    process.env.GITHUB_BASE_REF = "";
    process.env.GITHUB_HEAD_REF = "";

    const range = runModule.resolvePrRange();
    expect(range.baseRef).toBe("cccccccccccccccccccccccccccccccccccccccc");
    expect(range.headRef).toBe("dddddddddddddddddddddddddddddddddddddddd");

    fs.unlinkSync(eventPath);
    delete process.env.GITHUB_EVENT_PATH;
    delete process.env.GITHUB_BASE_REF;
    delete process.env.GITHUB_HEAD_REF;
  });

  it("treats empty GITHUB_BASE_REF as missing (not empty string range)", () => {
    delete process.env.GITHUB_EVENT_PATH;
    process.env.GITHUB_BASE_REF = "";
    process.env.GITHUB_HEAD_REF = "";
    process.env.GITHUB_SHA = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

    const range = runModule.resolvePrRange();
    expect(range.baseRef).toBe("HEAD~1");
    expect(range.headRef).toBe("eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee");

    delete process.env.GITHUB_BASE_REF;
    delete process.env.GITHUB_HEAD_REF;
    delete process.env.GITHUB_SHA;
  });
});
