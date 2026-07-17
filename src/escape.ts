const HTML_SPECIALS: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#x27;",
};

const MARKDOWN_SPECIALS_RE = /[\\`*_{}[\]()#+\-.!|]/g;

export function escapeHtml(input: string): string {
  return input.replace(/[&<>"']/g, (c) => HTML_SPECIALS[c] ?? c);
}

export function escapeMarkdown(input: string): string {
  const htmlSafe = escapeHtml(input);
  return htmlSafe.replace(MARKDOWN_SPECIALS_RE, "\\$&");
}

const SHELL_METACHARACTERS_RE = /[$`"\\!|&;(){}[\]<>*?#~]/g;

export function escapeShell(input: string): string {
  return input.replace(SHELL_METACHARACTERS_RE, "\\$&");
}
