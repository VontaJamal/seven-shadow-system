import assert from "node:assert/strict";
import test from "node:test";

import { parseCommentsArgs, sortComments } from "../src/commands/comments";
import { renderCommentsMarkdown } from "../src/commands/render/commentsMarkdown";
import { renderCommentsXml } from "../src/commands/render/commentsXml";
import type { SentinelUnresolvedComment } from "../src/providers/types";

test("parseCommentsArgs applies defaults", () => {
  const args = parseCommentsArgs([]);
  assert.equal(args.providerName, "github");
  assert.equal(args.format, "md");
});

test("sortComments orders by file then line", () => {
  const comments: SentinelUnresolvedComment[] = [
    {
      file: "src/b.ts",
      line: 10,
      author: "two",
      body: "B",
      createdAt: "2026-02-21T00:00:00.000Z",
      url: "https://example.com/b",
      resolved: false,
      outdated: false
    },
    {
      file: "src/a.ts",
      line: 12,
      author: "one",
      body: "A",
      createdAt: "2026-02-21T00:00:00.000Z",
      url: "https://example.com/a",
      resolved: false,
      outdated: false
    }
  ];

  const sorted = sortComments(comments);
  assert.equal(sorted[0]?.file, "src/a.ts");
  assert.equal(sorted[1]?.file, "src/b.ts");
});

test("renderers include mandatory file:line content", () => {
  const comments: SentinelUnresolvedComment[] = [
    {
      file: "src/a.ts",
      line: 42,
      author: "reviewer",
      body: "Please handle token fallback.",
      createdAt: "2026-02-21T00:00:00.000Z",
      url: "https://example.com/comment",
      resolved: false,
      outdated: false
    }
  ];

  const markdown = renderCommentsMarkdown(comments);
  const xml = renderCommentsXml(comments);

  assert.match(markdown, /src\/a\.ts:42/);
  assert.match(xml, /file="src\/a\.ts" line="42"/);
});
