import { Command } from "commander";

import { AdminApiError, NetworkNotRunningError, connectAdmin } from "../client/admin.js";

const DEFAULT_NETWORK = "default";
const DEFAULT_COUNT = 5;
const DEFAULT_PREFIX = "test";

/**
 * Register `asp seed` on the program.
 *
 * Registers a set of test agents on a network with open policy so they can
 * interact with each other without allowlist management. Useful for quickly
 * standing up a populated network for development or protocol testing.
 *
 * Handles are generated as `@{prefix}-{i}.bot` (1-indexed).
 */
export function registerSeedCommand(program: Command): void {
  program.addCommand(
    new Command("seed")
      .description("Register a batch of test agents with open policy")
      .option("-n, --network <name>", "Target network", DEFAULT_NETWORK)
      .option("--count <n>", "Number of agents to register", String(DEFAULT_COUNT))
      .option("--prefix <name>", "Handle prefix (e.g. 'bot' → @bot-1.bot)", DEFAULT_PREFIX)
      .option("--json", "Emit machine-readable JSON", false)
      .action(async (opts: SeedOpts) => {
        const count = parseInt(opts.count, 10);
        if (!Number.isInteger(count) || count < 1 || count > 100) {
          process.stderr.write("asp seed: --count must be an integer between 1 and 100\n");
          process.exit(1);
        }
        if (!/^[a-z0-9][a-z0-9_-]*$/.test(opts.prefix)) {
          process.stderr.write(
            "asp seed: --prefix must be lowercase alphanumeric, hyphens, or underscores\n",
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

        const results: Array<{ handle: string; token: string }> = [];
        const skipped: string[] = [];

        for (let i = 1; i <= count; i++) {
          const handle = `@${opts.prefix}-${i}.bot`;
          try {
            const agent = await client.registerAgent(handle, { policy: "open" });
            results.push({ handle: agent.handle, token: agent.token });
          } catch (err) {
            if (err instanceof AdminApiError && err.status === 409) {
              skipped.push(handle);
            } else {
              throw err;
            }
          }
        }

        if (opts.json) {
          process.stdout.write(JSON.stringify({ registered: results, skipped }, null, 2) + "\n");
          return;
        }

        if (results.length > 0) {
          process.stdout.write(`Registered ${results.length} agent(s) on "${opts.network}":\n\n`);
          const handleWidth = Math.max(6, ...results.map((r) => r.handle.length));
          process.stdout.write(
            `${"HANDLE".padEnd(handleWidth)}  TOKEN\n` +
              `${"─".repeat(handleWidth)}  ${"─".repeat(44)}\n`,
          );
          for (const { handle, token } of results) {
            process.stdout.write(`${handle.padEnd(handleWidth)}  ${token}\n`);
          }
        }
        if (skipped.length > 0) {
          process.stdout.write(
            `\nSkipped (already registered): ${skipped.join(", ")}\n`,
          );
        }
        if (results.length === 0) {
          process.stdout.write("No new agents registered (all already exist).\n");
        }
      }),
  );
}

interface SeedOpts {
  readonly network: string;
  readonly count: string;
  readonly prefix: string;
  readonly json: boolean;
}
