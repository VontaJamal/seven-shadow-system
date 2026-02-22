import { resolveSentinelContext } from "./shared/context";
import { relativeAgeFromIso, renderCommentsMarkdown } from "./render/commentsMarkdown";
import { renderCommentsXml } from "./render/commentsXml";
import type { SentinelUnresolvedComment } from "../providers/types";

type CommentsFormat = "md" | "xml" | "json";

interface CommentsArgs {
  prNumber?: number;
  repoArg?: string;
  providerName: string;
  format: CommentsFormat;
}

function makeError(code: string, message: string): Error {
  return new Error(`${code}: ${message}`);
}

function parsePositiveInt(value: string, optionName: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw makeError("E_SENTINEL_ARG_INVALID", `${optionName} must be a positive integer`);
  }

  return parsed;
}

function parseFormat(value: string): CommentsFormat {
  if (value === "md" || value === "xml" || value === "json") {
    return value;
  }

  throw makeError("E_SENTINEL_ARG_INVALID", "--format must be md|xml|json");
}

export function parseCommentsArgs(argv: string[]): CommentsArgs {
  const args: CommentsArgs = {
    providerName: "github",
    format: "md"
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? "";

    if (token === "--help" || token === "-h") {
      throw makeError(
        "E_SENTINEL_HELP",
        "Usage: 7s comments [--pr <number>] [--repo <owner/repo>] [--provider github|gitlab|bitbucket] [--format md|xml|json]"
      );
    }

    if (token === "--pr") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw makeError("E_SENTINEL_ARG_REQUIRED", "--pr");
      }

      args.prNumber = parsePositiveInt(value, "--pr");
      index += 1;
      continue;
    }

    if (token === "--repo") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw makeError("E_SENTINEL_ARG_REQUIRED", "--repo");
      }

      args.repoArg = value;
      index += 1;
      continue;
    }

    if (token === "--provider") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw makeError("E_SENTINEL_ARG_REQUIRED", "--provider");
      }

      args.providerName = value.trim().toLowerCase();
      index += 1;
      continue;
    }

    if (token === "--format") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw makeError("E_SENTINEL_ARG_REQUIRED", "--format");
      }

      args.format = parseFormat(value.trim().toLowerCase());
      index += 1;
      continue;
    }

    if (token.startsWith("--")) {
      throw makeError("E_SENTINEL_ARG_UNKNOWN", token);
    }
  }

  return args;
}

export function sortComments(comments: SentinelUnresolvedComment[]): SentinelUnresolvedComment[] {
  return [...comments].sort((left, right) => {
    const fileCompare = left.file.localeCompare(right.file);
    if (fileCompare !== 0) {
      return fileCompare;
    }

    if (left.line !== right.line) {
      return left.line - right.line;
    }

    return left.createdAt.localeCompare(right.createdAt);
  });
}

function renderJson(comments: SentinelUnresolvedComment[]): string {
  const payload = comments.map((comment) => ({
    file: comment.file,
    line: comment.line,
    author: comment.author,
    age: relativeAgeFromIso(comment.createdAt),
    body: comment.body,
    resolved: comment.resolved,
    url: comment.url
  }));

  return `${JSON.stringify(payload, null, 2)}\n`;
}

export async function runCommentsCommand(
  argv: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env
): Promise<number> {
  const args = parseCommentsArgs(argv);
  const context = await resolveSentinelContext({
    providerName: args.providerName,
    repoArg: args.repoArg,
    prNumber: args.prNumber,
    env,
    requirePr: true
  });

  const rawComments = await context.sentinel.listUnresolvedComments(context.repo, context.prNumber ?? 0, {
    authToken: context.authToken
  });

  const comments = sortComments(
    rawComments
      .filter((item) => item.resolved === false)
      .map((item) => ({
        ...item,
        line: Number.isInteger(item.line) && item.line > 0 ? item.line : 1
      }))
  );

  if (args.format === "json") {
    process.stdout.write(renderJson(comments));
    return 0;
  }

  if (args.format === "xml") {
    process.stdout.write(renderCommentsXml(comments));
    return 0;
  }

  process.stdout.write(renderCommentsMarkdown(comments));
  return 0;
}
