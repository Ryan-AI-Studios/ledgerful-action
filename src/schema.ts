/**
 * Latest known PR scan schema version (engine may emit 1 or 2 during rollout).
 * Prefer PR_SCAN_SCHEMA_VERSIONS for acceptance checks.
 */
export const PR_SCAN_SCHEMA_VERSION = 2 as const;

/** Accepted schema versions — v1 remains valid for mixed Workflow A/B rollout. */
export const PR_SCAN_SCHEMA_VERSIONS: ReadonlySet<number> = new Set([1, 2]);

const SCHEMA_VERSION_ERROR =
  "Unsupported or missing schemaVersion. This Action accepts schemaVersion 1 or 2.";

/** Generous caps for untrusted report fields (fail closed on hostile payloads). */
const MAX_STRING_LENGTH = 4096;
const MAX_CHANGES = 10_000;
const MAX_STRING_ARRAY = 200;

/** Soft ISO-8601 shape: YYYY-MM-DDT… (engine emits full timestamps). */
const SOFT_ISO8601_RE = /^\d{4}-\d{2}-\d{2}T/;

export type ChangeType = "added" | "modified" | "deleted" | "renamed";

export interface PrScanChange {
  path: string;
  changeType: ChangeType;
  /** Prior path on renames (schema v2; optional). */
  oldPath?: string;
  /** Commits touching this path inside the history window (schema v2; optional). */
  churn?: number;
  /** ISO-8601 last-commit time within the window (schema v2; optional). */
  lastCommitAt?: string;
  /** True when path matches sensitive patterns (schema v2; optional). */
  isSensitive?: boolean;
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
  /**
   * Optional — engine may omit (or historically emit null on edge cases).
   * `validateReport` normalizes null → absent so consumers never see null.
   */
  headHash?: string;
  /**
   * Optional — omitted/null on detached HEAD (CI pull_request checkout).
   * `validateReport` normalizes null → absent so consumers never see null.
   * Use `displayBranchName()` for a neutral UI label.
   */
  branchName?: string;
  treeClean: boolean;
  changeCount: number;
  changes: PrScanChange[];
  riskLevel: RiskLevel;
  riskReasons: string[];
  /**
   * Reserved — engine currently always emits `[]`; do not treat as a live signal.
   * Required for compat with current engine JSON (missing key fails closed).
   */
  analysisWarnings: string[];
  /** Set by Workflow A from pull_request.number; optional for older reports. */
  prNumber?: number;
  /** First-parent history window size used for churn/recency (schema v2; optional). */
  historyWindowCommits?: number;
  /** True when the history walk hit its commit bound (schema v2; optional). */
  historyTruncated?: boolean;
}

/**
 * Display form for branchName: never the string "null".
 * Unknown / null / empty → neutral placeholder for detached HEAD.
 */
export function displayBranchName(branchName: string | null | undefined): string {
  if (typeof branchName === "string" && branchName.length > 0) {
    return branchName;
  }
  return "detached HEAD";
}

/**
 * Normalize optional string-or-null fields after validation.
 * Consumers should still prefer `typeof x === "string" ? x : undefined`.
 */
export function optionalString(
  value: string | null | undefined,
): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function assertSchemaVersion(report: PrScanReport): void {
  if (
    typeof report.schemaVersion !== "number" ||
    !PR_SCAN_SCHEMA_VERSIONS.has(report.schemaVersion)
  ) {
    // Neutral: never interpolate report content into errors.
    throw new Error(SCHEMA_VERSION_ERROR);
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

  if (
    typeof obj.schemaVersion !== "number" ||
    !PR_SCAN_SCHEMA_VERSIONS.has(obj.schemaVersion)
  ) {
    // Neutral: never interpolate untrusted schemaVersion into the error message.
    throw new Error(SCHEMA_VERSION_ERROR);
  }

  assertNonEmptyString(obj, "generatedAt");
  assertNonEmptyString(obj, "baseRef");
  assertNonEmptyString(obj, "headRef");
  // Detached HEAD / optional hash: string | null | absent. Reject wrong types & empty.
  // Normalize null → delete so typed consumers never observe null at runtime.
  assertOptionalNonEmptyString(obj, "headHash");
  assertOptionalNonEmptyString(obj, "branchName");
  normalizeNullOptionalString(obj, "headHash");
  normalizeNullOptionalString(obj, "branchName");

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
    // Optional v2 per-change fields — independently validated when present.
    validateOptionalChangeFields(change);
  }

  assertStringArray(obj, "riskReasons");
  // Reserved field (engine currently emits empty) — still validated for compat.
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

  // Optional report-level v2 history fields.
  if (obj.historyWindowCommits !== undefined) {
    assertNonNegativeInteger(obj, "historyWindowCommits");
  }
  if (obj.historyTruncated !== undefined) {
    if (typeof obj.historyTruncated !== "boolean") {
      throw new Error(
        "Invalid PR scan report: historyTruncated must be a boolean when present.",
      );
    }
  }
}

function validateOptionalChangeFields(change: Record<string, unknown>): void {
  if (change.oldPath !== undefined) {
    if (
      typeof change.oldPath !== "string" ||
      change.oldPath.length === 0 ||
      change.oldPath.length > MAX_STRING_LENGTH
    ) {
      throw new Error(
        "Invalid PR scan report: change.oldPath must be a non-empty string within length limits when present.",
      );
    }
  }

  if (change.churn !== undefined) {
    if (
      typeof change.churn !== "number" ||
      !Number.isFinite(change.churn) ||
      !Number.isInteger(change.churn) ||
      change.churn < 0
    ) {
      throw new Error(
        "Invalid PR scan report: change.churn must be a non-negative integer when present.",
      );
    }
  }

  if (change.lastCommitAt !== undefined) {
    if (
      typeof change.lastCommitAt !== "string" ||
      change.lastCommitAt.length === 0 ||
      change.lastCommitAt.length > MAX_STRING_LENGTH ||
      !SOFT_ISO8601_RE.test(change.lastCommitAt)
    ) {
      throw new Error(
        "Invalid PR scan report: change.lastCommitAt must be a non-empty ISO-8601-like string when present.",
      );
    }
  }

  if (change.isSensitive !== undefined) {
    if (typeof change.isSensitive !== "boolean") {
      throw new Error(
        "Invalid PR scan report: change.isSensitive must be a boolean when present.",
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

/**
 * Accept string | null | absent. Reject wrong types, empty string, oversized.
 * Call normalizeNullOptionalString afterwards to drop null keys.
 */
function assertOptionalNonEmptyString(
  obj: Record<string, unknown>,
  field: string,
): void {
  const value = obj[field];
  if (value === undefined || value === null) {
    return;
  }
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_STRING_LENGTH
  ) {
    throw new Error(
      `Invalid PR scan report: ${field} must be a non-empty string within length limits when present.`,
    );
  }
}

/** Drop null optional string keys so runtime matches `string | undefined` types. */
function normalizeNullOptionalString(
  obj: Record<string, unknown>,
  field: "headHash" | "branchName",
): void {
  if (obj[field] === null) {
    obj[field] = undefined;
  }
}

function assertNonNegativeInteger(
  obj: Record<string, unknown>,
  field: string,
): void {
  const value = obj[field];
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value < 0
  ) {
    throw new Error(
      `Invalid PR scan report: ${field} must be a non-negative integer when present.`,
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
