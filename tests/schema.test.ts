import { describe, expect, it } from "vitest";
import {
  PR_SCAN_SCHEMA_VERSION,
  PR_SCAN_SCHEMA_VERSIONS,
  assertSchemaVersion,
  displayBranchName,
  optionalString,
  validateReport,
  validateTestGaps,
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

/** Minimal valid testGaps payload (available, one unmapped). */
function validTestGaps(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    status: "available",
    sourceSeedCount: 12,
    mappedCount: 7,
    fileMappedCount: 2,
    unmappedCount: 1,
    unmappedCapped: false,
    unmappedTotal: 1,
    unmapped: [
      {
        symbol: "execute_foo",
        file: "src/commands/foo.rs",
        qualifiedName: "commands::foo::execute_foo",
        mappingKind: "none",
      },
    ],
    mappedSample: [
      {
        symbol: "bar",
        file: "src/bar.rs",
        coveringTestCount: 2,
        mappingKind: "symbol",
      },
    ],
    notes: [
      "Structural test_mapping only (IMPORT/NAMING_CONVENTION); not line coverage",
      "LCOV COVERAGE mapping kind does not currently persist (DDL NOT NULL on test_symbol_id)",
    ],
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

  it("accepts reports with absent testGaps (old engine)", () => {
    expect(() => {
      validateReport(validReport());
    }).not.toThrow();
    const report = validReport() as Record<string, unknown>;
    expect(report.testGaps).toBeUndefined();
  });

  it("accepts reports with a valid testGaps payload", () => {
    expect(() => {
      validateReport(
        validReport({ schemaVersion: 2, testGaps: validTestGaps() }),
      );
    }).not.toThrow();
  });

  it("rejects hostile/huge testGaps via validateReport", () => {
    expect(() => {
      validateReport(
        validReport({
          testGaps: validTestGaps({
            unmapped: Array.from({ length: 51 }, (_, i) => ({
              symbol: `s${String(i)}`,
              file: `f${String(i)}.rs`,
              mappingKind: "none",
            })),
          }),
        }),
      );
    }).toThrow(/testGaps\.unmapped array exceeds/);
    expect(() => {
      validateReport(
        validReport({
          testGaps: validTestGaps({ status: "empty" }),
        }),
      );
    }).toThrow(/testGaps\.status/);
  });
});

describe("validateTestGaps", () => {
  it("accepts a full available payload", () => {
    expect(() => {
      validateTestGaps(validTestGaps());
    }).not.toThrow();
  });

  it("accepts each known status with empty arrays", () => {
    for (const status of [
      "available",
      "empty_mapping",
      "missing_table",
      "no_source_seeds",
      "unavailable",
    ] as const) {
      expect(() => {
        validateTestGaps(
          validTestGaps({
            status,
            unmappedCount: 0,
            unmappedTotal: 0,
            unmapped: [],
            mappedSample: [],
            mappedCount: 0,
            fileMappedCount: 0,
            sourceSeedCount: 0,
          }),
        );
      }).not.toThrow();
    }
  });

  it("rejects non-object and wrong types with neutral errors", () => {
    expect(() => {
      validateTestGaps(null);
    }).toThrow(/testGaps must be an object/);
    expect(() => {
      validateTestGaps([]);
    }).toThrow(/testGaps must be an object/);
    expect(() => {
      validateTestGaps("nope");
    }).toThrow(/testGaps must be an object/);
    expect(() => {
      validateTestGaps(validTestGaps({ status: 1 }));
    }).toThrow(/testGaps\.status/);
    expect(() => {
      validateTestGaps(validTestGaps({ unmappedCapped: "yes" }));
    }).toThrow(/unmappedCapped/);
    expect(() => {
      validateTestGaps(validTestGaps({ mappedCount: -1 }));
    }).toThrow(/mappedCount/);
    expect(() => {
      validateTestGaps(validTestGaps({ sourceSeedCount: 1.5 }));
    }).toThrow(/sourceSeedCount/);
    expect(() => {
      validateTestGaps(validTestGaps({ unmappedTotal: Number.POSITIVE_INFINITY }));
    }).toThrow(/unmappedTotal/);
  });

  it("rejects bare empty status and unknown statuses", () => {
    expect(() => {
      validateTestGaps(validTestGaps({ status: "empty" }));
    }).toThrow(/testGaps\.status/);
    expect(() => {
      validateTestGaps(validTestGaps({ status: "ok" }));
    }).toThrow(/testGaps\.status/);
  });

  it("rejects wrong mappingKind on unmapped and mappedSample", () => {
    expect(() => {
      validateTestGaps(
        validTestGaps({
          unmapped: [
            {
              symbol: "a",
              file: "a.rs",
              mappingKind: "symbol",
            },
          ],
        }),
      );
    }).toThrow(/unmapped\[\]\.mappingKind/);
    expect(() => {
      validateTestGaps(
        validTestGaps({
          mappedSample: [
            {
              symbol: "a",
              file: "a.rs",
              coveringTestCount: 1,
              mappingKind: "none",
            },
          ],
        }),
      );
    }).toThrow(/mappedSample\[\]\.mappingKind/);
  });

  it("rejects missing arrays and wrong entry shapes", () => {
    expect(() => {
      validateTestGaps(validTestGaps({ unmapped: "nope" }));
    }).toThrow(/testGaps\.unmapped must be an array/);
    expect(() => {
      validateTestGaps(validTestGaps({ mappedSample: null }));
    }).toThrow(/testGaps\.mappedSample must be an array/);
    expect(() => {
      validateTestGaps(validTestGaps({ notes: {} }));
    }).toThrow(/testGaps\.notes must be an array/);
    expect(() => {
      validateTestGaps(validTestGaps({ unmapped: [null] }));
    }).toThrow(/unmapped entry must be an object/);
    expect(() => {
      validateTestGaps(
        validTestGaps({
          mappedSample: [
            {
              symbol: "a",
              file: "a.rs",
              coveringTestCount: -1,
              mappingKind: "file",
            },
          ],
        }),
      );
    }).toThrow(/coveringTestCount/);
    expect(() => {
      validateTestGaps(
        validTestGaps({
          unmapped: [{ symbol: "", file: "a.rs", mappingKind: "none" }],
        }),
      );
    }).toThrow(/unmapped\[\]\.symbol/);
  });

  it("rejects oversized unmapped, mappedSample, notes, and strings", () => {
    expect(() => {
      validateTestGaps(
        validTestGaps({
          unmapped: Array.from({ length: 51 }, (_, i) => ({
            symbol: `s${String(i)}`,
            file: `f${String(i)}.rs`,
            mappingKind: "none",
          })),
        }),
      );
    }).toThrow(/unmapped array exceeds/);
    expect(() => {
      validateTestGaps(
        validTestGaps({
          mappedSample: Array.from({ length: 21 }, (_, i) => ({
            symbol: `s${String(i)}`,
            file: `f${String(i)}.rs`,
            coveringTestCount: 1,
            mappingKind: "file",
          })),
        }),
      );
    }).toThrow(/mappedSample array exceeds/);
    expect(() => {
      validateTestGaps(
        validTestGaps({
          notes: Array.from({ length: 51 }, () => "n"),
        }),
      );
    }).toThrow(/notes array exceeds/);
    const huge = "x".repeat(4097);
    expect(() => {
      validateTestGaps(
        validTestGaps({
          unmapped: [
            { symbol: huge, file: "a.rs", mappingKind: "none" },
          ],
        }),
      );
    }).toThrow(/unmapped\[\]\.symbol/);
  });

  it("never echoes hostile payload content into validation errors", () => {
    const attacker = "attacker-payload-must-not-leak";
    try {
      validateTestGaps(validTestGaps({ status: attacker }));
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(String(err)).not.toContain(attacker);
      expect(String(err)).toMatch(/testGaps\.status/);
    }
    try {
      validateTestGaps(
        validTestGaps({
          unmapped: [
            {
              symbol: attacker,
              file: "a.rs",
              mappingKind: "evil",
            },
          ],
        }),
      );
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(String(err)).not.toContain(attacker);
    }
  });
});
