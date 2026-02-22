import type { SentinelUnresolvedComment } from "../../providers/types";

export function relativeAgeFromIso(isoTimestamp: string, now = new Date()): string {
  const timestamp = Date.parse(isoTimestamp);
  if (!Number.isFinite(timestamp)) {
    return "unknown";
  }

  const deltaMs = Math.max(0, now.getTime() - timestamp);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (deltaMs < hour) {
    const minutes = Math.max(1, Math.floor(deltaMs / minute));
    return `${minutes}m ago`;
  }

  if (deltaMs < day) {
    const hours = Math.max(1, Math.floor(deltaMs / hour));
    return `${hours}h ago`;
  }

  const days = Math.max(1, Math.floor(deltaMs / day));
  if (days < 7) {
    return `${days}d ago`;
  }

  return new Date(timestamp).toISOString().slice(0, 10);
}

export function renderCommentsMarkdown(comments: SentinelUnresolvedComment[], now = new Date()): string {
  if (comments.length === 0) {
    return "## Unresolved Comments (0)\n\nNo unresolved comments.\n";
  }

  const lines: string[] = [];
  lines.push(`## Unresolved Comments (${comments.length})`);
  lines.push("");

  for (const comment of comments) {
    lines.push(`### ${comment.file}:${comment.line}`);
    lines.push(`**@${comment.author}** (${relativeAgeFromIso(comment.createdAt, now)})`);
    lines.push(`> ${comment.body}`);
    lines.push("");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}
