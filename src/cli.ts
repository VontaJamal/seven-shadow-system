import { runCommentsCommand } from "./commands/comments";
import { runDashboardCommand } from "./commands/dashboard";
import { runDigestCommand } from "./commands/digest";
import { runDoctrineCommand } from "./commands/doctrine";
import { runDoctrineLintCommand } from "./commands/doctrineLint";
import { runFailuresCommand } from "./commands/failures";
import { runInboxCommand } from "./commands/inbox";
import { runLintCommand } from "./commands/lint";
import { runPatternsCommand } from "./commands/patterns";
import { runScoreCommand } from "./commands/score";
import { runShadowGateCommand } from "./commands/shadowGate";
import { runTestQualityCommand } from "./commands/testQuality";
import { runSevenShadowSystem } from "./sevenShadowSystem";

function renderHelp(): string {
  return [
    "Seven Shadow System CLI",
    "",
    "Usage:",
    "  7s guard [guard options]",
    "  7s comments [--pr N] [--repo owner/repo] [--provider github|gitlab|bitbucket] [--format md|xml|json]",
    "  7s failures [--pr N] [--run id] [--repo owner/repo] [--provider github|gitlab|bitbucket] [--format md|json]",
    "  7s lint [--pr N] [--run id] [--repo owner/repo] [--provider github|gitlab|bitbucket] [--format md|json]",
    "  7s test-quality [--path test] [--format md|json] [--base-ref ref] [--head-ref ref]",
    "  7s patterns [--repo owner/repo] [--provider github|gitlab|bitbucket] [--limit N] [--format md|json] [--config path]",
    "  7s inbox [--repo owner/repo] [--provider github|gitlab|bitbucket] [--limit N] [--all] [--format md|json] [--config path]",
    "  7s score [--pr N] [--repo owner/repo] [--provider github|gitlab|bitbucket] [--limit N] [--format md|json] [--config path]",
    "  7s digest [--repo owner/repo] [--provider github|gitlab|bitbucket] [--limit N] [--all] [--format md|json] [--config path]",
    "  7s dashboard [--repo owner/repo] [--provider github|gitlab|bitbucket] [--limit N] [--config path] [--host 127.0.0.1|0.0.0.0] [--port N] [--refresh-sec N] [--open] [--no-open]",
    "  7s doctrine [--quickstart] [--format md|json] [--doctrine path]",
    "  7s doctrine-lint [--doctrine path] [--policy path] [--format md|json]",
    "  7s shadow-gate [--policy path] [--doctrine path] [--exceptions path] [--event path] [--event-name name] [--format md|json]",
    "",
    "Backward compatibility:",
    "  seven-shadow-system --policy ... (implicit guard mode)",
    ""
  ].join("\n");
}

export async function runCli(
  argv: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env
): Promise<number> {
  const first = argv[0];

  if (!first) {
    process.stdout.write(renderHelp());
    return 0;
  }

  if (first === "--help" || first === "-h" || first === "help") {
    process.stdout.write(renderHelp());
    return 0;
  }

  if (first.startsWith("--")) {
    return runSevenShadowSystem(argv, env);
  }

  const command = first.trim().toLowerCase();
  const rest = argv.slice(1);

  if (command === "help" || command === "--help" || command === "-h") {
    process.stdout.write(renderHelp());
    return 0;
  }

  if (command === "guard") {
    return runSevenShadowSystem(rest, env);
  }

  if (command === "comments") {
    return runCommentsCommand(rest, env);
  }

  if (command === "failures") {
    return runFailuresCommand(rest, env);
  }

  if (command === "lint") {
    return runLintCommand(rest, env);
  }

  if (command === "test-quality") {
    return runTestQualityCommand(rest, env);
  }

  if (command === "patterns") {
    return runPatternsCommand(rest, env);
  }

  if (command === "inbox") {
    return runInboxCommand(rest, env);
  }

  if (command === "score") {
    return runScoreCommand(rest, env);
  }

  if (command === "digest") {
    return runDigestCommand(rest, env);
  }

  if (command === "dashboard") {
    return runDashboardCommand(rest, env);
  }

  if (command === "doctrine") {
    return runDoctrineCommand(rest, env);
  }

  if (command === "doctrine-lint") {
    return runDoctrineLintCommand(rest, env);
  }

  if (command === "shadow-gate") {
    return runShadowGateCommand(rest, env);
  }

  throw new Error(`E_UNKNOWN_COMMAND: '${command}'. Use --help to view supported commands.`);
}

if (require.main === module) {
  runCli()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);

      if (message.startsWith("E_SENTINEL_HELP:")) {
        process.stdout.write(`${message.replace(/^E_SENTINEL_HELP:\s*/, "")}\n`);
        process.exitCode = 0;
        return;
      }

      if (message.startsWith("E_SHADOW_HELP:")) {
        process.stdout.write(`${message.replace(/^E_SHADOW_HELP:\s*/, "")}\n`);
        process.exitCode = 0;
        return;
      }

      process.stderr.write(`Seven Shadow System CLI failed: ${message}\n`);
      process.exitCode = 1;
    });
}
