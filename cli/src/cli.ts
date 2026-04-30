import { Command } from "commander";

import { registerStartCommand } from "./commands/start.js";
import { PACKAGE_VERSION } from "./version.js";

/**
 * Build the root commander program.
 *
 * Exposed as a function (not a singleton) so tests can construct a fresh
 * program per case and assert on parsed options without leaking state.
 */
export function buildProgram(): Command {
  const program = new Command();

  program
    .name("asp")
    .description(
      "Run and inspect local Agent Session Protocol networks. " +
        "Use this to develop, test, and verify ASP implementations on your machine.",
    )
    .version(PACKAGE_VERSION, "-v, --version", "Show the asp CLI version")
    .helpOption("-h, --help", "Show help");

  registerStartCommand(program);
  // Subcommands registered in subsequent phases:
  //   phase 1.2 — `asp stop|status|logs` (supervised lifecycle)
  //   phase 1.3 — `asp agent ...`
  //   phase 1.4 — `asp session ...`
  //   phase 1.5 — `asp permission ...`, `asp contact ...`, `asp listen`
  //   phase 4   — `asp tap`, `asp seed`, `asp reset`
  //   phase 5   — `asp identity ...`

  return program;
}

/**
 * CLI entry point invoked by bin/asp.js.
 *
 * Parses argv and dispatches. Surface errors as user-facing messages with a
 * non-zero exit; reserve stack traces for unexpected failures.
 */
export async function run(argv: readonly string[]): Promise<void> {
  const program = buildProgram();
  try {
    await program.parseAsync(argv as string[]);
  } catch (err) {
    if (err instanceof Error) {
      process.stderr.write(`asp: ${err.message}\n`);
    } else {
      process.stderr.write(`asp: ${String(err)}\n`);
    }
    process.exit(1);
  }
}
