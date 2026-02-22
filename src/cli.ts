import { runCommentsCommand } from "./commands/comments";
import { runFailuresCommand } from "./commands/failures";
import { runLintCommand } from "./commands/lint";
import { runTestQualityCommand } from "./commands/testQuality";
import { runSevenShadowSystem } from "./sevenShadowSystem";

function renderHelp(): string {
  return [
    "Seven Shadow System CLI",
    "",
    "Usage:",
    "  sss guard [guard options]",
    "  sss comments [--pr N] [--repo owner/repo] [--provider github|gitlab|bitbucket] [--format md|xml|json]",
    "  sss failures [--pr N] [--run id] [--repo owner/repo] [--provider github|gitlab|bitbucket] [--format md|json]",
    "  sss lint [--pr N] [--run id] [--repo owner/repo] [--provider github|gitlab|bitbucket] [--format md|json]",
    "  sss test-quality [--path test] [--format md|json] [--base-ref ref] [--head-ref ref]",
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

  throw new Error(`E_UNKNOWN_COMMAND: '${command}'. Use --help to view supported commands.`);
}

if (require.main === module) {
  runCli()
    .then((code) => {
      process.exit(code);
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);

      if (message.startsWith("E_SENTINEL_HELP:")) {
        process.stdout.write(`${message.replace(/^E_SENTINEL_HELP:\s*/, "")}\n`);
        process.exit(0);
      }

      process.stderr.write(`Seven Shadow System CLI failed: ${message}\n`);
      process.exit(1);
    });
}
