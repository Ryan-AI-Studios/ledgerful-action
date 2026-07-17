import { describe, expect, it } from "vitest";
import { PR_SCAN_SCHEMA_VERSION, assertSchemaVersion } from "../src/schema.js";
import sample from "./fixtures/pr-scan-report.sample.json";

const sampleReport = sample as { schemaVersion: number };

describe("schema", () => {
  it("pins schemaVersion to 1", () => {
    expect(PR_SCAN_SCHEMA_VERSION).toBe(1);
  });

  it("accepts the sample fixture", () => {
    expect(sampleReport.schemaVersion).toBe(PR_SCAN_SCHEMA_VERSION);
    assertSchemaVersion(sampleReport as Parameters<typeof assertSchemaVersion>[0]);
  });

  it("rejects an unsupported schema version", () => {
    expect(() => {
      assertSchemaVersion({ schemaVersion: 2 } as Parameters<typeof assertSchemaVersion>[0]);
    }).toThrow(/schema/);
  });
});
