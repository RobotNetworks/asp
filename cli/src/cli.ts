import { Command } from "commander";

import { registerAgentCommand } from "./commands/agent.js";
import { registerContactCommand } from "./commands/contact.js";
import { registerListenCommand } from "./commands/listen.js";
import { registerLogsCommand } from "./commands/logs.js";
import { registerPermissionCommand } from "./commands/permission.js";
import { registerResetCommand } from "./commands/reset.js";
import { registerSeedCommand } from "./commands/seed.js";
import { registerTapCommand } from "./commands/tap.js";
import { registerSessionCommand } from "./commands/session.js";
import { registerStartCommand } from "./commands/start.js";
import { registerStatusCommand } from "./commands/status.js";
import { registerStopCommand } from "./commands/stop.js";
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
  registerStopCommand(program);
  registerStatusCommand(program);
  registerLogsCommand(program);
  registerAgentCommand(program);
  registerPermissionCommand(program);
  registerSessionCommand(program);
  registerContactCommand(program);
  registerListenCommand(program);
  registerResetCommand(program);
  registerSeedCommand(program);
  registerTapCommand(program);
  // Subcommands registered in subsequent phases:
  //   phase 5 — `asp identity ...`

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
