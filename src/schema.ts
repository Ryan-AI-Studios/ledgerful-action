export const PR_SCAN_SCHEMA_VERSION = 1 as const;

/** Generous caps for untrusted report fields (fail closed on hostile payloads). */
const MAX_STRING_LENGTH = 4096;
const MAX_CHANGES = 10_000;
const MAX_STRING_ARRAY = 200;

export type ChangeType = "added" | "modified" | "deleted" | "renamed";

export interface PrScanChange {
  path: string;
  changeType: ChangeType;
}

export type RiskLevel = "low" | "medium" | "high";

const RISK_LEVELS = new Set<string>(["low", "medium", "high"]);
const CHANGE_TYPES = new Set<string>([
  "added",
  "modified",
  "deleted",
  "renamed",
]);

export interface PrScanReport {
  schemaVersion: number;
  generatedAt: string;
  baseRef: string;
  headRef: string;
  headHash: string;
  branchName: string;
  treeClean: boolean;
  changeCount: number;
  changes: PrScanChange[];
  riskLevel: RiskLevel;
  riskReasons: string[];
  analysisWarnings: string[];
  /** Set by Workflow A from pull_request.number; optional for older reports. */
  prNumber?: number;
}

export function assertSchemaVersion(report: PrScanReport): void {
  if (report.schemaVersion !== PR_SCAN_SCHEMA_VERSION) {
    // Neutral: never interpolate report content (even numeric) into errors.
    throw new Error(
      `Unsupported or missing schemaVersion. This Action pins schemaVersion ${String(PR_SCAN_SCHEMA_VERSION)}.`,
    );
  }
}

/**
 * Runtime validation of an untrusted PR scan report (Workflow B artifact).
 * Fail closed with neutral errors — never echo report content into the message.
 */
export function validateReport(value: unknown): asserts value is PrScanReport {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Invalid PR scan report: expected a JSON object.");
  }

  const obj = value as Record<string, unknown>;

  if (obj.schemaVersion !== PR_SCAN_SCHEMA_VERSION) {
    // Neutral: never interpolate untrusted schemaVersion into the error message.
    throw new Error(
      `Unsupported or missing schemaVersion. This Action pins schemaVersion ${String(PR_SCAN_SCHEMA_VERSION)}.`,
    );
  }

  assertNonEmptyString(obj, "generatedAt");
  assertNonEmptyString(obj, "baseRef");
  assertNonEmptyString(obj, "headRef");
  assertNonEmptyString(obj, "headHash");
  assertNonEmptyString(obj, "branchName");

  if (typeof obj.treeClean !== "boolean") {
    throw new Error("Invalid PR scan report: treeClean must be a boolean.");
  }

  if (
    typeof obj.changeCount !== "number" ||
    !Number.isFinite(obj.changeCount) ||
    !Number.isInteger(obj.changeCount) ||
    obj.changeCount < 0
  ) {
    throw new Error(
      "Invalid PR scan report: changeCount must be a non-negative integer.",
    );
  }

  if (typeof obj.riskLevel !== "string" || !RISK_LEVELS.has(obj.riskLevel)) {
    throw new Error(
      "Invalid PR scan report: riskLevel must be low, medium, or high.",
    );
  }

  if (!Array.isArray(obj.changes)) {
    throw new Error("Invalid PR scan report: changes must be an array.");
  }
  if (obj.changes.length > MAX_CHANGES) {
    throw new Error("Invalid PR scan report: changes array exceeds size limit.");
  }
  for (const entry of obj.changes) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new Error("Invalid PR scan report: each change must be an object.");
    }
    const change = entry as Record<string, unknown>;
    if (
      typeof change.path !== "string" ||
      change.path.length === 0 ||
      change.path.length > MAX_STRING_LENGTH
    ) {
      throw new Error(
        "Invalid PR scan report: each change.path must be a non-empty string within length limits.",
      );
    }
    if (
      typeof change.changeType !== "string" ||
      !CHANGE_TYPES.has(change.changeType)
    ) {
      throw new Error(
        "Invalid PR scan report: each change.changeType must be added, modified, deleted, or renamed.",
      );
    }
  }

  assertStringArray(obj, "riskReasons");
  assertStringArray(obj, "analysisWarnings");

  if (obj.prNumber !== undefined) {
    if (
      typeof obj.prNumber !== "number" ||
      !Number.isFinite(obj.prNumber) ||
      !Number.isInteger(obj.prNumber) ||
      obj.prNumber <= 0
    ) {
      throw new Error(
        "Invalid PR scan report: prNumber must be a positive integer when present.",
      );
    }
  }
}

function assertNonEmptyString(
  obj: Record<string, unknown>,
  field: string,
): void {
  const value = obj[field];
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_STRING_LENGTH
  ) {
    throw new Error(
      `Invalid PR scan report: ${field} must be a non-empty string within length limits.`,
    );
  }
}

function assertStringArray(
  obj: Record<string, unknown>,
  field: string,
): void {
  const value = obj[field];
  if (!Array.isArray(value)) {
    throw new Error(`Invalid PR scan report: ${field} must be an array.`);
  }
  if (value.length > MAX_STRING_ARRAY) {
    throw new Error(
      `Invalid PR scan report: ${field} array exceeds size limit.`,
    );
  }
  for (const entry of value) {
    if (typeof entry !== "string" || entry.length > MAX_STRING_LENGTH) {
      throw new Error(
        `Invalid PR scan report: each ${field} entry must be a string within length limits.`,
      );
    }
  }
}
