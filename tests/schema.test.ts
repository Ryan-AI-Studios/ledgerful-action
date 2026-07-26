import { describe, expect, it } from "vitest";
import {
  PR_SCAN_SCHEMA_VERSION,
  PR_SCAN_SCHEMA_VERSIONS,
  assertSchemaVersion,
  displayBranchName,
  optionalString,
  validateReport,
  type PrScanReport,
} from "../src/schema.js";
import sample from "./fixtures/pr-scan-report.sample.json";
import liveCi from "./fixtures/live/pr-scan-report.ci.json";

const sampleReport = sample as unknown as PrScanReport;
const SCHEMA_VERSION_ERROR =
  "Unsupported or missing schemaVersion. This Action accepts schemaVersion 1 or 2.";

function validReport(overrides: Record<string, unknown> = {}): unknown {
  return {
    schemaVersion: 1,
    generatedAt: "2026-07-17T21:05:24.708717700+00:00",
    baseRef: "main",
    headRef: "HEAD",
    headHash: "5002402f413a3ebd3af4691fb5aaebc1b73d5fb4",
    branchName: "feature/test",
    treeClean: true,
    changeCount: 1,
    changes: [{ path: "src/a.ts", changeType: "modified" }],
    riskLevel: "low",
    riskReasons: [],
    analysisWarnings: [],
    ...overrides,
  };
}

describe("schema", () => {
  it("pins latest schemaVersion to 2 and accepts 1 and 2", () => {
    expect(PR_SCAN_SCHEMA_VERSION).toBe(2);
    expect(PR_SCAN_SCHEMA_VERSIONS.has(1)).toBe(true);
    expect(PR_SCAN_SCHEMA_VERSIONS.has(2)).toBe(true);
    expect(PR_SCAN_SCHEMA_VERSIONS.has(3)).toBe(false);
  });

  it("accepts the sample fixture via assertSchemaVersion", () => {
    expect(sampleReport.schemaVersion).toBe(1);
    assertSchemaVersion(sampleReport);
  });

  it("accepts schemaVersion 2 via assertSchemaVersion", () => {
    expect(() => {
      assertSchemaVersion({ schemaVersion: 2 } as PrScanReport);
    }).not.toThrow();
  });

  it("rejects an unsupported schema version via assertSchemaVersion with neutral message", () => {
    expect(() => {
      assertSchemaVersion({ schemaVersion: 3 } as PrScanReport);
    }).toThrow(SCHEMA_VERSION_ERROR);
  });
});

describe("displayBranchName", () => {
  it("returns the branch when present", () => {
    expect(displayBranchName("feature/x")).toBe("feature/x");
  });

  it("uses detached HEAD placeholder for null, undefined, and empty", () => {
    expect(displayBranchName(null)).toBe("detached HEAD");
    expect(displayBranchName(undefined)).toBe("detached HEAD");
    expect(displayBranchName("")).toBe("detached HEAD");
  });

  it("never returns the string null", () => {
    expect(displayBranchName(null)).not.toBe("null");
    expect(displayBranchName(undefined)).not.toBe("null");
  });
});

describe("validateReport", () => {
  it("accepts the sample fixture", () => {
    expect(() => {
      validateReport(sampleReport);
    }).not.toThrow();
  });

  it("accepts a minimal valid report", () => {
    expect(() => {
      validateReport(validReport());
    }).not.toThrow();
  });

  it("accepts the live CI fixture with branchName null (DoD-2)", () => {
    expect(liveCi).toMatchObject({ branchName: null, schemaVersion: 1 });
    expect(() => {
      validateReport(structuredClone(liveCi));
    }).not.toThrow();
  });

  it("accepts headHash/branchName absent", () => {
    const report = validReport() as Record<string, unknown>;
    delete report.headHash;
    delete report.branchName;
    expect(() => {
      validateReport(report);
    }).not.toThrow();
  });

  it("accepts headHash/branchName null and normalizes to undefined", () => {
    const report = validReport({ headHash: null, branchName: null });
    expect(() => {
      validateReport(report);
    }).not.toThrow();
    const r = report as { headHash: unknown; branchName: unknown };
    expect(r.headHash).toBeUndefined();
    expect(r.branchName).toBeUndefined();
    expect(optionalString(r.branchName as string | null | undefined)).toBeUndefined();
    expect(displayBranchName(r.branchName as string | null | undefined)).toBe(
      "detached HEAD",
    );
  });

  it("rejects wrong types for headHash/branchName (fail closed)", () => {
    expect(() => {
      validateReport(validReport({ headHash: 123 }));
    }).toThrow(/headHash/);
    expect(() => {
      validateReport(validReport({ headHash: { a: 1 } }));
    }).toThrow(/headHash/);
    expect(() => {
      validateReport(validReport({ headHash: ["x"] }));
    }).toThrow(/headHash/);
    expect(() => {
      validateReport(validReport({ branchName: 0 }));
    }).toThrow(/branchName/);
    expect(() => {
      validateReport(validReport({ branchName: { name: "x" } }));
    }).toThrow(/branchName/);
    expect(() => {
      validateReport(validReport({ branchName: ["feature"] }));
    }).toThrow(/branchName/);
  });

  it("rejects empty string headHash/branchName when present", () => {
    expect(() => {
      validateReport(validReport({ headHash: "" }));
    }).toThrow(/headHash/);
    expect(() => {
      validateReport(validReport({ branchName: "" }));
    }).toThrow(/branchName/);
  });

  it("accepts schemaVersion 2 reports", () => {
    expect(() => {
      validateReport(validReport({ schemaVersion: 2 }));
    }).not.toThrow();
  });

  it("accepts v2 optional per-change and report-level fields", () => {
    expect(() => {
      validateReport(
        validReport({
          schemaVersion: 2,
          historyWindowCommits: 1000,
          historyTruncated: true,
          changes: [
            {
              path: "src/new.ts",
              changeType: "renamed",
              oldPath: "src/old.ts",
              churn: 12,
              lastCommitAt: "2026-07-26T12:00:00Z",
              isSensitive: true,
            },
          ],
        }),
      );
    }).not.toThrow();
  });

  it("rejects invalid v2 optional fields when present", () => {
    expect(() => {
      validateReport(
        validReport({
          changes: [
            { path: "a.ts", changeType: "modified", oldPath: "" },
          ],
        }),
      );
    }).toThrow(/oldPath/);
    expect(() => {
      validateReport(
        validReport({
          changes: [
            { path: "a.ts", changeType: "modified", churn: -1 },
          ],
        }),
      );
    }).toThrow(/churn/);
    expect(() => {
      validateReport(
        validReport({
          changes: [
            { path: "a.ts", changeType: "modified", churn: 1.5 },
          ],
        }),
      );
    }).toThrow(/churn/);
    expect(() => {
      validateReport(
        validReport({
          changes: [
            {
              path: "a.ts",
              changeType: "modified",
              lastCommitAt: "not-a-date",
            },
          ],
        }),
      );
    }).toThrow(/lastCommitAt/);
    expect(() => {
      validateReport(
        validReport({
          changes: [
            { path: "a.ts", changeType: "modified", isSensitive: "yes" },
          ],
        }),
      );
    }).toThrow(/isSensitive/);
    expect(() => {
      validateReport(validReport({ historyWindowCommits: -1 }));
    }).toThrow(/historyWindowCommits/);
    expect(() => {
      validateReport(validReport({ historyTruncated: "true" }));
    }).toThrow(/historyTruncated/);
  });

  it("rejects non-object, null, and array before property access", () => {
    expect(() => {
      validateReport(null);
    }).toThrow(/expected a JSON object/);
    expect(() => {
      validateReport(undefined);
    }).toThrow(/expected a JSON object/);
    expect(() => {
      validateReport("string");
    }).toThrow(/expected a JSON object/);
    expect(() => {
      validateReport(42);
    }).toThrow(/expected a JSON object/);
    expect(() => {
      validateReport([]);
    }).toThrow(/expected a JSON object/);
    // Neutral: must not echo report content
    expect(() => {
      validateReport({ evil: "payload-should-not-appear" });
    }).toThrow();
    try {
      validateReport({ evil: "payload-should-not-appear" });
    } catch (err) {
      expect(String(err)).not.toContain("payload-should-not-appear");
    }
  });

  it("rejects wrong schemaVersion with neutral message (never echoes report value)", () => {
    const attacker = "attacker-payload-should-not-appear";
    expect(() => {
      validateReport(validReport({ schemaVersion: 99 }));
    }).toThrow(SCHEMA_VERSION_ERROR);
    expect(() => {
      validateReport(validReport({ schemaVersion: attacker }));
    }).toThrow(SCHEMA_VERSION_ERROR);
    try {
      validateReport(validReport({ schemaVersion: attacker }));
    } catch (err) {
      expect(String(err)).not.toContain(attacker);
    }
  });

  it("rejects bad riskLevel", () => {
    expect(() => {
      validateReport(validReport({ riskLevel: "critical" }));
    }).toThrow(/riskLevel/);
  });

  it("rejects bad changeType", () => {
    expect(() => {
      validateReport(
        validReport({
          changes: [{ path: "a.ts", changeType: "moved" }],
        }),
      );
    }).toThrow(/changeType/);
  });

  it("rejects empty change.path", () => {
    expect(() => {
      validateReport(
        validReport({
          changes: [{ path: "", changeType: "modified" }],
        }),
      );
    }).toThrow(/change\.path/);
  });

  it("rejects empty required strings", () => {
    expect(() => {
      validateReport(validReport({ baseRef: "" }));
    }).toThrow(/baseRef/);
    expect(() => {
      validateReport(validReport({ generatedAt: "" }));
    }).toThrow(/generatedAt/);
  });

  it("rejects oversized strings", () => {
    const huge = "x".repeat(4097);
    expect(() => {
      validateReport(validReport({ branchName: huge }));
    }).toThrow(/branchName/);
    expect(() => {
      validateReport(
        validReport({
          changes: [{ path: huge, changeType: "added" }],
        }),
      );
    }).toThrow(/path/);
  });

  it("rejects oversized arrays", () => {
    expect(() => {
      validateReport(
        validReport({
          riskReasons: Array.from({ length: 201 }, () => "r"),
        }),
      );
    }).toThrow(/riskReasons/);
    expect(() => {
      validateReport(
        validReport({
          analysisWarnings: Array.from({ length: 201 }, () => "w"),
        }),
      );
    }).toThrow(/analysisWarnings/);
    expect(() => {
      validateReport(
        validReport({
          changeCount: 10_001,
          changes: Array.from({ length: 10_001 }, (_, i) => ({
            path: `f${String(i)}.ts`,
            changeType: "modified",
          })),
        }),
      );
    }).toThrow(/changes array exceeds/);
  });

  it("rejects wrong types", () => {
    expect(() => {
      validateReport(validReport({ treeClean: "yes" }));
    }).toThrow(/treeClean/);
    expect(() => {
      validateReport(validReport({ changeCount: -1 }));
    }).toThrow(/changeCount/);
    expect(() => {
      validateReport(validReport({ changeCount: 1.5 }));
    }).toThrow(/changeCount/);
    expect(() => {
      validateReport(validReport({ changeCount: Number.POSITIVE_INFINITY }));
    }).toThrow(/changeCount/);
    expect(() => {
      validateReport(validReport({ changes: "nope" }));
    }).toThrow(/changes/);
    expect(() => {
      validateReport(validReport({ riskReasons: "nope" }));
    }).toThrow(/riskReasons/);
  });

  it("accepts optional prNumber when a positive integer", () => {
    expect(() => {
      validateReport(validReport({ prNumber: 42 }));
    }).not.toThrow();
  });

  it("rejects invalid prNumber values", () => {
    expect(() => {
      validateReport(validReport({ prNumber: 0 }));
    }).toThrow(/prNumber/);
    expect(() => {
      validateReport(validReport({ prNumber: -3 }));
    }).toThrow(/prNumber/);
    expect(() => {
      validateReport(validReport({ prNumber: 1.5 }));
    }).toThrow(/prNumber/);
    expect(() => {
      validateReport(validReport({ prNumber: "7" }));
    }).toThrow(/prNumber/);
  });
});
