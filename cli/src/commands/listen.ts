import { Command } from "commander";
import { WebSocket } from "ws";

import {
  AgentNotFoundError,
  connectSession,
} from "../client/session.js";
import { resolveIdentity } from "../identity.js";

const DEFAULT_NETWORK = "default";

/**
 * Register `asp listen` on the program.
 *
 * Opens a WebSocket connection to the network's /connect endpoint and streams
 * all session events for the given agent to stdout as JSON lines until Ctrl-C.
 */
export function registerListenCommand(program: Command): void {
  program.addCommand(
    new Command("listen")
      .description(
        "Stream live session events for an agent over WebSocket (Ctrl-C to stop)",
      )
      .option("--as <handle>", "Act as this agent handle")
      .option("-n, --network <name>", "Target network", DEFAULT_NETWORK)
      .option("--token <token>", "Override the stored agent bearer token")
      .action(async (opts: ListenOpts) => {
        let handle = opts.as;
        let network = opts.network;
        if (!handle) {
          const identity = await resolveIdentity();
          if (!identity) {
            process.stderr.write(
              "asp: --as <handle> is required, or set a directory identity with `asp identity set`\n",
            );
            process.exit(1);
          }
          handle = identity.handle;
          if (network === DEFAULT_NETWORK) network = identity.network;
        }

        let client;
        try {
          client = await connectSession(network, handle, opts.token);
        } catch (err) {
          if (err instanceof AgentNotFoundError) {
            process.stderr.write(`asp: ${err.message}\n`);
            process.exit(1);
          }
          if (err instanceof Error && err.message.includes("is not running")) {
            process.stderr.write(`asp: ${err.message}\n`);
            process.exit(1);
          }
          throw err;
        }

        const wsUrl = `${client.wsUrl}?token=${encodeURIComponent(client.token)}`;
        process.stderr.write(
          `Listening for events on ${network} as ${handle}…\n`,
        );

        const ws = new WebSocket(wsUrl);

        ws.on("open", () => {
          // Connected — events will start flowing
        });

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

        // Keep alive until Ctrl-C
        process.on("SIGINT", () => {
          ws.close();
          process.exit(0);
        });
      }),
  );
}

interface ListenOpts {
  readonly as?: string;
  readonly network: string;
  readonly token?: string;
}
