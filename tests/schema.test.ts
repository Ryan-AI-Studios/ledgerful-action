import { describe, expect, it } from "vitest";
import {
  PR_SCAN_SCHEMA_VERSION,
  assertSchemaVersion,
  validateReport,
  type PrScanReport,
} from "../src/schema.js";
import sample from "./fixtures/pr-scan-report.sample.json";

const sampleReport = sample as unknown as PrScanReport;

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
  it("pins schemaVersion to 1", () => {
    expect(PR_SCAN_SCHEMA_VERSION).toBe(1);
  });

  it("accepts the sample fixture via assertSchemaVersion", () => {
    expect(sampleReport.schemaVersion).toBe(PR_SCAN_SCHEMA_VERSION);
    assertSchemaVersion(sampleReport);
  });

  it("rejects an unsupported schema version via assertSchemaVersion with neutral message", () => {
    expect(() => {
      assertSchemaVersion({ schemaVersion: 2 } as PrScanReport);
    }).toThrow(
      `Unsupported or missing schemaVersion. This Action pins schemaVersion ${String(PR_SCAN_SCHEMA_VERSION)}.`,
    );
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
    }).toThrow(
      `Unsupported or missing schemaVersion. This Action pins schemaVersion ${String(PR_SCAN_SCHEMA_VERSION)}.`,
    );
    expect(() => {
      validateReport(
        validReport({ schemaVersion: attacker }),
      );
    }).toThrow(
      `Unsupported or missing schemaVersion. This Action pins schemaVersion ${String(PR_SCAN_SCHEMA_VERSION)}.`,
    );
    try {
      validateReport(
        validReport({ schemaVersion: attacker }),
      );
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
