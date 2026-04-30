import { Command, Option } from "commander";

import { resolveStateRoot } from "../paths.js";
import { readRegistry } from "../registry.js";
import { stopNetwork, type StopResult } from "../supervisor/stop.js";

const DEFAULT_NETWORK = "default";
const DEFAULT_TIMEOUT_S = 10;

interface StopCommandOptions {
  readonly all: boolean;
  readonly force: boolean;
  readonly timeout: number;
  readonly json: boolean;
}

export function registerStopCommand(program: Command): void {
  program
    .command("stop [network]")
    .description("Stop a running ASP network")
    .option("--all", "Stop every running network on this device", false)
    .addOption(
      new Option(
        "--force",
        "Send SIGKILL if the network does not exit within the timeout",
      ).default(false),
    )
    .option(
      "-t, --timeout <seconds>",
      `Grace period for SIGTERM before failing or escalating (default ${DEFAULT_TIMEOUT_S})`,
      parsePositiveInt,
      DEFAULT_TIMEOUT_S,
    )
    .option("--json", "Emit machine-readable outcomes", false)
    .action(async (network: string | undefined, opts: StopCommandOptions) => {
      if (opts.all && network !== undefined) {
        throw new Error(
          "--all cannot be combined with a positional network argument",
        );
      }
      const stateRoot = resolveStateRoot();
      const targets = opts.all
        ? Object.keys((await readRegistry(stateRoot)).networks).sort()
        : [network ?? DEFAULT_NETWORK];

      const timeoutMs = opts.timeout * 1000;
      const results: StopResult[] = [];
      const errors: { name: string; message: string }[] = [];

      for (const name of targets) {
        try {
          results.push(
            await stopNetwork(stateRoot, name, {
              timeoutMs,
              force: opts.force,
            }),
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          errors.push({ name, message });
        }
      }

      emit(results, errors, opts.json);

      const hadFailure =
        errors.length > 0 ||
        results.some((r) => r.outcome.kind === "missing");
      if (hadFailure) {
        process.exitCode = 1;
      }
    });
}

function emit(
  results: readonly StopResult[],
  errors: readonly { name: string; message: string }[],
  json: boolean,
): void {
  if (json) {
    process.stdout.write(
      `${JSON.stringify({ results, errors }, null, 2)}\n`,
    );
    return;
  }

  for (const r of results) {
    switch (r.outcome.kind) {
      case "stopped":
        process.stdout.write(`Stopped network "${r.name}".\n`);
        break;
      case "stale":
        process.stdout.write(
          `Network "${r.name}" was already gone — cleaned up registry.\n`,
        );
        break;
      case "force-killed":
        process.stdout.write(
          `Force-killed network "${r.name}" (SIGTERM ignored).\n`,
        );
        break;
      case "missing":
        process.stderr.write(
          `No network named "${r.name}" in the registry.\n`,
        );
        break;
    }
  }
  for (const e of errors) {
    process.stderr.write(`asp: ${e.name}: ${e.message}\n`);
  }
}

function parsePositiveInt(raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`expected a positive integer, got "${raw}"`);
  }
  return n;
}
