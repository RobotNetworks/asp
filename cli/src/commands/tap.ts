import { Command } from "commander";

import { WebSocket } from "ws";

import { NetworkNotRunningError, connectAdmin } from "../client/admin.js";

const DEFAULT_NETWORK = "default";

/**
 * Register `asp tap` on the program.
 *
 * Opens an admin WebSocket connection to `/_admin/tap` and streams all session
 * events across every session on the network to stdout as JSON lines. Unlike
 * `asp listen`, this requires no agent identity and delivers every event
 * regardless of recipient — useful for debugging or observability.
 */
export function registerTapCommand(program: Command): void {
  program.addCommand(
    new Command("tap")
      .description(
        "Stream all session events on a network (admin-level; Ctrl-C to stop)",
      )
      .option("-n, --network <name>", "Target network", DEFAULT_NETWORK)
      .action(async (opts: TapOpts) => {
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

        const wsUrl = `${client.tapWsUrl}?token=${encodeURIComponent(client.token)}`;
        process.stderr.write(`Tapping all events on "${opts.network}"…\n`);

        const ws = new WebSocket(wsUrl);

        ws.on("message", (data) => {
          process.stdout.write(`${data.toString()}\n`);
        });

        ws.on("error", (err) => {
          process.stderr.write(`asp: WebSocket error: ${err.message}\n`);
        });

        ws.on("close", (code, reason) => {
          process.stderr.write(
            `asp: connection closed (${code}${reason.length ? `: ${reason}` : ""})\n`,
          );
          process.exit(0);
        });

        process.on("SIGINT", () => {
          ws.close();
          process.exit(0);
        });
      }),
  );
}

interface TapOpts {
  readonly network: string;
}
