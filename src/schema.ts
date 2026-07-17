export const PR_SCAN_SCHEMA_VERSION = 1 as const;

export type ChangeType = "added" | "modified" | "deleted" | "renamed";

export interface PrScanChange {
  path: string;
  changeType: ChangeType;
}

export type RiskLevel = "low" | "medium" | "high";

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
}

export function assertSchemaVersion(report: PrScanReport): void {
  if (report.schemaVersion !== PR_SCAN_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported PR scan schema version: ${report.schemaVersion}. ` +
        `This Action pins schemaVersion ${PR_SCAN_SCHEMA_VERSION}.`,
    );
  }
}
