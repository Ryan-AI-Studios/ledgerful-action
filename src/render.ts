import type { PrScanReport, PrScanChange } from "./schema.js";
import { optionalString } from "./schema.js";
import { escapeMarkdown } from "./escape.js";
import {
  CHECK_RUN_MAX_BYTES,
  CHECK_RUN_TRUNCATION_MARKER,
  COMMENT_MAX_CHARS,
  COMMENT_TRUNCATION_MARKER,
  truncateToCharLimit,
  truncateToUtf8Bytes,
} from "./truncate.js";

export const COMMENT_ANCHOR = "<!-- ledgerful-action:pr-comment -->";

/** Render-time cap on riskReasons / analysisWarnings lines shown (parse caps are higher). */
const MAX_RENDER_STRING_ARRAY = 50;

/** Max rows in the most-churned-files details block. */
const MAX_CHURN_ROWS = 20;

function sortChanges(changes: PrScanChange[]): PrScanChange[] {
  return [...changes].sort((a, b) => {
    const byPath = a.path.localeCompare(b.path);
    if (byPath !== 0) return byPath;
    return a.changeType.localeCompare(b.changeType);
  });
}

function sortStrings(arr: string[]): string[] {
  return [...arr].sort((a, b) => a.localeCompare(b));
}

function changeEmoji(changeType: string): string {
  switch (changeType) {
    case "added":
      return "➕";
    case "deleted":
      return "🗑️";
    case "renamed":
      return "📛";
    case "modified":
    default:
      return "📝";
  }
}

/** Format a change path; renames with oldPath use `old → new`. */
function formatChangePath(c: PrScanChange): string {
  const oldPath = optionalString(c.oldPath);
  if (oldPath !== undefined) {
    return `\`${escapeMarkdown(oldPath)}\` → \`${escapeMarkdown(c.path)}\``;
  }
  return `\`${escapeMarkdown(c.path)}\``;
}

/**
 * Size-capped most-churned-files section.
 * Omitted entirely when no change has a defined `churn` (keeps v1 output byte-identical).
 */
function renderChurnSection(report: PrScanReport): string {
  const withChurn = report.changes.filter(
    (c) => typeof c.churn === "number" && Number.isFinite(c.churn),
  );
  if (withChurn.length === 0) {
    return "";
  }

  const sorted = [...withChurn].sort((a, b) => {
    const byChurn = (b.churn ?? 0) - (a.churn ?? 0);
    if (byChurn !== 0) return byChurn;
    return a.path.localeCompare(b.path);
  });

  const visible = sorted.slice(0, MAX_CHURN_ROWS);
  const hidden = sorted.length - visible.length;

  let section = `<details>\n<summary>Most-churned files in this PR</summary>\n\n`;
  for (const c of visible) {
    let line = `- ${formatChangePath(c)} — churn ${String(c.churn)}`;
    const lastAt = optionalString(c.lastCommitAt);
    if (lastAt !== undefined) {
      line += `, last commit ${escapeMarkdown(lastAt)}`;
    }
    if (c.isSensitive === true) {
      line += " (sensitive)";
    }
    section += `${line}\n`;
  }
  if (hidden > 0) {
    section += `\n*…and ${String(hidden)} more.*\n`;
  }
  if (report.historyTruncated === true) {
    section += `\n*History walk was truncated`;
    if (
      typeof report.historyWindowCommits === "number" &&
      Number.isFinite(report.historyWindowCommits)
    ) {
      section += ` (window: ${String(report.historyWindowCommits)} commits)`;
    }
    section += `.*\n`;
  }
  section += `\n</details>\n\n`;
  return section;
}

export function renderSummary(
  report: PrScanReport,
  artifactUrl?: string,
): string {
  const changes = sortChanges(report.changes);
  const riskReasons = sortStrings(report.riskReasons).slice(
    0,
    MAX_RENDER_STRING_ARRAY,
  );
  // analysisWarnings is reserved (engine emits empty) — still render if present for compat.
  const warnings = sortStrings(report.analysisWarnings).slice(
    0,
    MAX_RENDER_STRING_ARRAY,
  );

  let body = `${COMMENT_ANCHOR}\n\n`;
  body += `## Ledgerful PR Risk Report\n\n`;
  body += `**Risk level:** ${escapeMarkdown(report.riskLevel)}\n\n`;
  body += `**Changes:** ${report.changeCount} (base \`${escapeMarkdown(report.baseRef)}\` → head \`${escapeMarkdown(report.headRef)}\`)\n\n`;

  if (riskReasons.length > 0) {
    body += `**Why:** ${riskReasons.map(escapeMarkdown).join("; ")}\n\n`;
  }

  if (warnings.length > 0) {
    body += `**Warnings:** ${warnings.map(escapeMarkdown).join("; ")}\n\n`;
  }

  if (changes.length > 0) {
    const maxVisible = 30;
    const visible = changes.slice(0, maxVisible);
    const hidden = changes.length - maxVisible;
    body += `**Files changed:**\n\n`;
    for (const c of visible) {
      body += `- ${changeEmoji(c.changeType)} ${formatChangePath(c)} (${escapeMarkdown(c.changeType)})\n`;
    }
    if (hidden > 0) {
      body += `\n*...and ${hidden} more.*\n`;
    }
    body += "\n";
  }

  body += renderChurnSection(report);

  if (artifactUrl) {
    body += `[Full report artifact](${artifactUrl})\n\n`;
  }

  body += "*Powered by the real Ledgerful engine binary in your runner — no server in the loop.*\n";

  const trimmed = body.trimEnd();
  return truncateToCharLimit(
    trimmed,
    COMMENT_MAX_CHARS,
    COMMENT_TRUNCATION_MARKER,
  );
}

export function renderCheckRunSummary(report: PrScanReport): string {
  const riskReasons = sortStrings(report.riskReasons).slice(
    0,
    MAX_RENDER_STRING_ARRAY,
  );
  const warnings = sortStrings(report.analysisWarnings).slice(
    0,
    MAX_RENDER_STRING_ARRAY,
  );
  const lines: string[] = [
    `Risk level: ${escapeMarkdown(report.riskLevel)}`,
    `Changes: ${report.changeCount} (base ${escapeMarkdown(report.baseRef)} → head ${escapeMarkdown(report.headRef)})`,
  ];
  if (riskReasons.length > 0) {
    lines.push(`Reasons: ${riskReasons.map(escapeMarkdown).join("; ")}`);
  }
  if (warnings.length > 0) {
    lines.push(`Warnings: ${warnings.map(escapeMarkdown).join("; ")}`);
  }
  const text = lines.join("\n");
  return truncateToUtf8Bytes(
    text,
    CHECK_RUN_MAX_BYTES,
    CHECK_RUN_TRUNCATION_MARKER,
  );
}

export function renderCheckRunTitle(report: PrScanReport): string {
  return `Ledgerful risk: ${escapeMarkdown(report.riskLevel)} (${report.changeCount} changes)`;
}
