import type { PrScanReport, PrScanChange } from "./schema.js";
import { escapeMarkdown } from "./escape.js";

export const COMMENT_ANCHOR = "<!-- ledgerful-action:pr-comment -->";

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

export function renderSummary(
  report: PrScanReport,
  artifactUrl?: string,
): string {
  const changes = sortChanges(report.changes);
  const riskReasons = sortStrings(report.riskReasons);
  const warnings = sortStrings(report.analysisWarnings);

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
      body += `- ${changeEmoji(c.changeType)} \`${escapeMarkdown(c.path)}\` (${escapeMarkdown(c.changeType)})\n`;
    }
    if (hidden > 0) {
      body += `\n*...and ${hidden} more.*\n`;
    }
    body += "\n";
  }

  if (artifactUrl) {
    body += `[Full report artifact](${artifactUrl})\n\n`;
  }

  body += "*Powered by the real Ledgerful engine binary in your runner — no server in the loop.*\n";

  return body.trimEnd();
}

export function renderCheckRunSummary(report: PrScanReport): string {
  const lines: string[] = [
    `Risk level: ${escapeMarkdown(report.riskLevel)}`,
    `Changes: ${report.changeCount} (base ${escapeMarkdown(report.baseRef)} → head ${escapeMarkdown(report.headRef)})`,
  ];
  if (report.riskReasons.length > 0) {
    lines.push(`Reasons: ${sortStrings(report.riskReasons).map(escapeMarkdown).join("; ")}`);
  }
  if (report.analysisWarnings.length > 0) {
    lines.push(`Warnings: ${sortStrings(report.analysisWarnings).map(escapeMarkdown).join("; ")}`);
  }
  return lines.join("\n");
}

export function renderCheckRunTitle(report: PrScanReport): string {
  return `Ledgerful risk: ${escapeMarkdown(report.riskLevel)} (${report.changeCount} changes)`;
}
