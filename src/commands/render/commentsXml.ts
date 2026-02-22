import type { SentinelUnresolvedComment } from "../../providers/types";

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function renderCommentsXml(comments: SentinelUnresolvedComment[]): string {
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(`<unresolvedComments count="${comments.length}">`);

  for (const comment of comments) {
    lines.push(
      `  <comment file="${escapeXml(comment.file)}" line="${comment.line}" author="${escapeXml(comment.author)}" createdAt="${escapeXml(comment.createdAt)}" url="${escapeXml(comment.url)}">`
    );
    lines.push(`    <body>${escapeXml(comment.body)}</body>`);
    lines.push("  </comment>");
  }

  lines.push("</unresolvedComments>");
  return `${lines.join("\n")}\n`;
}
