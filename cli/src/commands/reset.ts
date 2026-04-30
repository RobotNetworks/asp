import { Command } from "commander";

import { AdminApiError, NetworkNotRunningError, connectAdmin } from "../client/admin.js";

const DEFAULT_NETWORK = "default";

/**
 * Register `asp reset` on the program.
 *
 * Wipes all agents, sessions, and contacts from a running network. Requires
 * `--yes` to prevent accidental data loss. The server process stays running —
 * only the stored data is cleared.
 */
export function registerResetCommand(program: Command): void {
  program.addCommand(
    new Command("reset")
      .description(
        "Wipe all agents, sessions, and contacts from a running network (cannot be undone)",
      )
      .option("-n, --network <name>", "Target network", DEFAULT_NETWORK)
      .option("--yes", "Confirm the destructive reset", false)
      .action(async (opts: ResetOpts) => {
        if (!opts.yes) {
          process.stderr.write(
            "asp reset: pass --yes to confirm you want to wipe all network data\n",
          );
          process.exit(1);
        }
        let client;
        try {
          client = await connectAdmin(opts.network);
        } catch (err) {
          if (err instanceof NetworkNotRunningError) {
            process.stderr.write(`asp: ${err.message}\n`);
            process.exit(1);
          }
          throw err;
        }
        try {
          await client.reset();
        } catch (err) {
          if (err instanceof AdminApiError) {
            if (err.status === 501) {
              process.stderr.write(
                "asp: reset is not available on this network (not backed by a durable store)\n",
              );
              process.exit(1);
            }
            process.stderr.write(`asp: admin API error: ${err.code}\n`);
            process.exit(1);
          }
          throw err;
        }
        process.stdout.write(
          `Network "${opts.network}" has been reset. All agents, sessions, and contacts cleared.\n`,
        );
      }),
  );
}

interface ResetOpts {
  readonly network: string;
  readonly yes: boolean;
}
