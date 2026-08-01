import type {
  PrScanReport,
  PrScanChange,
  TestGapsReport,
  TestGapsUnmappedEntry,
  AffectedFlowsReport,
  AffectedFlowEntry,
  AffectedFlowMatchKind,
} from "./schema.js";
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

/** Max unmapped rows shown in the sticky Test gaps section. */
const MAX_TEST_GAPS_UNMAPPED_ROWS = 20;

/** Max notes lines in the optional details block. */
const MAX_TEST_GAPS_NOTES_ROWS = 20;

/** Max flow rows shown in the sticky Affected flows section. */
const MAX_AFFECTED_FLOWS_ROWS = 15;

/** Max notes lines in the optional Affected flows details block. */
const MAX_AFFECTED_FLOWS_NOTES_ROWS = 20;

/** Match-kind sort priority (lower = stronger; mirrors engine MatchKind::priority). */
const MATCH_KIND_PRIORITY: Record<AffectedFlowMatchKind, number> = {
  handler_symbol: 1,
  handler_impl_file: 2,
  route_file: 3,
  blast_symbol: 4,
  blast_file: 5,
};

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

/**
 * Format one unmapped gap line: symbol + file (+ optional qualifiedName).
 * All dynamic fields are escapeMarkdown'd.
 */
function formatUnmappedEntry(entry: TestGapsUnmappedEntry): string {
  const symbol = escapeMarkdown(entry.symbol);
  const file = escapeMarkdown(entry.file);
  const qn = optionalString(entry.qualifiedName);
  if (qn !== undefined) {
    return `- \`${symbol}\` · \`${file}\` · \`${escapeMarkdown(qn)}\``;
  }
  return `- \`${symbol}\` · \`${file}\``;
}

/**
 * Structural test-gaps section for the sticky PR comment.
 * Omitted when `testGaps` is absent (older engines — keeps v1 output stable).
 *
 * Honesty rules:
 * - Never claim line coverage or "100% covered".
 * - `available` + unmapped == 0 → no unmapped structural mappings only.
 * - Non-available statuses → honest one-liners (not merge blockers).
 */
function renderTestGapsSection(gaps: TestGapsReport | undefined): string {
  if (gaps === undefined) {
    return "";
  }

  let section = `### Test gaps\n\n`;

  switch (gaps.status) {
    case "available": {
      section += `**Status:** available · unmapped ${String(gaps.unmappedCount)} · mapped ${String(gaps.mappedCount)} · file-mapped ${String(gaps.fileMappedCount)}\n\n`;
      if (gaps.unmappedCount > 0) {
        section += `Changed production symbols/files without structural test mapping`;
        if (gaps.unmappedCapped) {
          section += ` (list capped; total unmapped ${String(gaps.unmappedTotal)})`;
        }
        section += `:\n\n`;
        const sorted = [...gaps.unmapped].sort((a, b) => {
          const byFile = a.file.localeCompare(b.file);
          if (byFile !== 0) return byFile;
          return a.symbol.localeCompare(b.symbol);
        });
        const visible = sorted.slice(0, MAX_TEST_GAPS_UNMAPPED_ROWS);
        const hidden = sorted.length - visible.length;
        for (const entry of visible) {
          section += `${formatUnmappedEntry(entry)}\n`;
        }
        if (hidden > 0) {
          section += `\n*…and ${String(hidden)} more.*\n`;
        }
        section += "\n";
      } else {
        section +=
          "No unmapped production symbols/files in the structural test mapping for this change set. This is **not** line coverage and is **not** a claim of full test coverage.\n\n";
      }
      break;
    }
    case "empty_mapping":
      section +=
        "Structural `test_mapping` table is empty — mapping not populated for this repo yet. Not a merge block.\n\n";
      break;
    case "missing_table":
      section +=
        "Structural `test_mapping` table is missing — index/mapping setup required before gaps can be reported. Not a merge block.\n\n";
      break;
    case "no_source_seeds":
      section +=
        "No non-test source seeds in the change set — nothing to map for structural test gaps.\n\n";
      break;
    case "unavailable":
      section +=
        "Structural test mapping unavailable (no local index or soft-open failed). Honest CI default — not a merge block.\n\n";
      break;
    default: {
      // Exhaustiveness guard; validateTestGaps rejects unknown statuses.
      const _exhaustive: never = gaps.status;
      void _exhaustive;
      section += "Structural test mapping status unknown.\n\n";
      break;
    }
  }

  if (gaps.notes.length > 0) {
    const notes = sortStrings(gaps.notes).slice(0, MAX_TEST_GAPS_NOTES_ROWS);
    const hiddenNotes = gaps.notes.length - notes.length;
    section += `<details>\n<summary>Test gaps notes</summary>\n\n`;
    for (const note of notes) {
      section += `- ${escapeMarkdown(note)}\n`;
    }
    if (hiddenNotes > 0) {
      section += `\n*…and ${String(hiddenNotes)} more notes.*\n`;
    }
    section += `\n</details>\n\n`;
  }

  return section;
}

/**
 * Format one affected-flow line.
 * escapeMarkdown on method, pathPattern, handlerSymbolName, handlerFile, framework.
 */
function formatAffectedFlowEntry(entry: AffectedFlowEntry): string {
  const method = escapeMarkdown(entry.method);
  const path = escapeMarkdown(entry.pathPattern);
  const framework = escapeMarkdown(entry.framework);
  let line = `- \`${method}\` \`${path}\` · ${framework} · ${escapeMarkdown(entry.matchKind)}`;
  const handler = optionalString(entry.handlerSymbolName);
  if (handler !== undefined) {
    line += ` · \`${escapeMarkdown(handler)}\``;
  }
  const file = optionalString(entry.handlerFile);
  if (file !== undefined) {
    line += ` · \`${escapeMarkdown(file)}\``;
  }
  const confClass = optionalString(entry.confidenceClass);
  if (confClass !== undefined) {
    line += ` · ${escapeMarkdown(confClass)}`;
  }
  return line;
}

/** Deterministic sort: matchKind priority, method, path, framework, handler. */
function sortAffectedFlows(flows: AffectedFlowEntry[]): AffectedFlowEntry[] {
  return [...flows].sort((a, b) => {
    const byKind =
      MATCH_KIND_PRIORITY[a.matchKind] - MATCH_KIND_PRIORITY[b.matchKind];
    if (byKind !== 0) return byKind;
    const byMethod = a.method.localeCompare(b.method);
    if (byMethod !== 0) return byMethod;
    const byPath = a.pathPattern.localeCompare(b.pathPattern);
    if (byPath !== 0) return byPath;
    const byFw = a.framework.localeCompare(b.framework);
    if (byFw !== 0) return byFw;
    return (a.handlerSymbolName ?? "").localeCompare(
      b.handlerSymbolName ?? "",
    );
  });
}

/**
 * Affected registered HTTP flows section for the sticky PR comment.
 * Omitted when `affectedFlows` is absent (older engines — keeps prior output stable).
 *
 * Honesty rules:
 * - Registered `api_routes` only — not CRG execution-path or distributed-trace flows.
 * - `available` + flowCount == 0 → no registered HTTP flows touched.
 * - Non-available statuses → honest one-liners (not merge blockers).
 * - `unavailable` is the CI index-free default, not a merge block.
 */
function renderAffectedFlowsSection(
  flows: AffectedFlowsReport | undefined,
): string {
  if (flows === undefined) {
    return "";
  }

  let section = `### Affected flows\n\n`;

  switch (flows.status) {
    case "available": {
      section += `**Status:** available · flows ${String(flows.flowCount)}`;
      if (flows.flowCapped) {
        section += ` (list capped; total ${String(flows.flowTotal)})`;
      }
      section += `\n\n`;
      if (flows.flowCount > 0 && flows.flows.length > 0) {
        section += `Registered HTTP routes touched by this change set (api_routes; not CRG execution-path flows):\n\n`;
        const sorted = sortAffectedFlows(flows.flows);
        const visible = sorted.slice(0, MAX_AFFECTED_FLOWS_ROWS);
        const hidden = sorted.length - visible.length;
        for (const entry of visible) {
          section += `${formatAffectedFlowEntry(entry)}\n`;
        }
        if (hidden > 0) {
          section += `\n*…and ${String(hidden)} more.*\n`;
        }
        section += "\n";
      } else {
        section +=
          "No registered HTTP flows touched by this change set\n\n";
      }
      break;
    }
    case "empty_map":
      section +=
        "Structural `api_routes` table is empty — route map not populated for this repo yet. Not a merge block.\n\n";
      break;
    case "missing_table":
      section +=
        "Structural `api_routes` table is missing — index/route extraction required before affected flows can be reported. Not a merge block.\n\n";
      break;
    case "no_change_seeds":
      section +=
        "No change-set seeds for route matching — nothing to map for affected HTTP flows.\n\n";
      break;
    case "unavailable":
      section +=
        "Affected HTTP flows unavailable (no local index or soft-open failed). Honest CI default — not a merge block.\n\n";
      break;
    default: {
      // Exhaustiveness guard; validateAffectedFlows rejects unknown statuses.
      const _exhaustive: never = flows.status;
      void _exhaustive;
      section += "Affected HTTP flows status unknown.\n\n";
      break;
    }
  }

  if (flows.notes.length > 0) {
    const notes = sortStrings(flows.notes).slice(0, MAX_AFFECTED_FLOWS_NOTES_ROWS);
    const hiddenNotes = flows.notes.length - notes.length;
    section += `<details>\n<summary>Affected flows notes</summary>\n\n`;
    for (const note of notes) {
      section += `- ${escapeMarkdown(note)}\n`;
    }
    if (hiddenNotes > 0) {
      section += `\n*…and ${String(hiddenNotes)} more notes.*\n`;
    }
    section += `\n</details>\n\n`;
  }

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
  body += renderTestGapsSection(report.testGaps);
  body += renderAffectedFlowsSection(report.affectedFlows);

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
