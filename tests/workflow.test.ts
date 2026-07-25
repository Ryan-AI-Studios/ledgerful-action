import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

const CONCLUSION_GATE =
  "if: github.event.workflow_run.conclusion == 'success'";

describe("workflows/ledgerful-pr-report.yml", () => {
  it("gates the post job on workflow_run.conclusion == success", () => {
    const yamlPath = path.resolve(
      process.cwd(),
      "workflows/ledgerful-pr-report.yml",
    );
    const content = fs.readFileSync(yamlPath, "utf8");
    expect(content).toContain(CONCLUSION_GATE);
  });

  it("grants actions:read for cross-run artifact download", () => {
    const yamlPath = path.resolve(
      process.cwd(),
      "workflows/ledgerful-pr-report.yml",
    );
    const content = fs.readFileSync(yamlPath, "utf8");
    expect(content).toMatch(/actions:\s*read/);
  });
});

describe("README Workflow B snippet", () => {
  it("includes the same conclusion gate as the shipped workflow", () => {
    const readmePath = path.resolve(process.cwd(), "README.md");
    const content = fs.readFileSync(readmePath, "utf8");
    expect(content).toContain(CONCLUSION_GATE);
  });

  it("documents actions:read for cross-run artifact download", () => {
    const readmePath = path.resolve(process.cwd(), "README.md");
    const content = fs.readFileSync(readmePath, "utf8");
    expect(content).toMatch(/actions:\s*read/);
  });
});
