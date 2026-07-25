const HTML_SPECIALS: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#x27;",
};

const MARKDOWN_SPECIALS_RE = /[\\`*_{}[\]()#+\-.!|]/g;

/**
 * Strip characters that can spoof or restructure rendered display text.
 *
 * Two separate justifications (kept in one pass for simplicity):
 * 1. **Bidi / Trojan Source** — Unicode bidi formatting controls that reorder
 *    visible glyphs (CVE-2021-42574 class): U+202A–U+202E, U+2066–U+2069,
 *    U+200E, U+200F, U+061C (Arabic Letter Mark, same family as LRM/RLM).
 * 2. **Line / paragraph separators** — U+2028 (LINE SEPARATOR) and U+2029
 *    (PARAGRAPH SEPARATOR) are not bidi controls (Unicode Zl/Zp). They are
 *    stripped so an embedded separator in a path/reason cannot manipulate how
 *    rendered Markdown breaks across lines.
 *
 * Applied on the display path only (`escapeMarkdown`). The raw report JSON
 * dump (check-run `<details>`) stays byte-preserving via `escapeHtml` alone.
 */
export function stripBidiControls(input: string): string {
  return input.replace(
    /[\u202A-\u202E\u2066-\u2069\u200E\u200F\u061C\u2028\u2029]/g,
    "",
  );
}

export function escapeHtml(input: string): string {
  return input.replace(/[&<>"']/g, (c) => HTML_SPECIALS[c] ?? c);
}

export function escapeMarkdown(input: string): string {
  // Strip first so bidi/separators never reach rendered PR comment / check summary.
  const stripped = stripBidiControls(input);
  const htmlSafe = escapeHtml(stripped);
  return htmlSafe.replace(MARKDOWN_SPECIALS_RE, "\\$&");
}

const SHELL_METACHARACTERS_RE = /[$`"\\!|&;(){}[\]<>*?#~]/g;

export function escapeShell(input: string): string {
  return input.replace(SHELL_METACHARACTERS_RE, "\\$&");
}
