import { Command, Option } from "commander";

import { buildApp } from "../server/app.js";
import { startServer, type ServerHandle } from "../server/runtime.js";

const DEFAULT_PORT = 8723;
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_NETWORK = "default";

interface StartOptions {
  network: string;
  host: string;
  port: number;
  foreground: boolean;
}

/**
 * Register `asp start` on the program.
 *
 * Phase 1.1 supports only `--foreground`; the supervised (detached) mode
 * arrives in phase 1.2 alongside `stop`/`status`/`logs`. Defaulting `start`
 * to detached later is a planned UX shift, not a breaking one — the flag
 * is being introduced explicitly now so users learn the surface up front.
 */
export function registerStartCommand(program: Command): void {
  program
    .command("start")
    .description("Start a local ASP network")
    .option(
      "-n, --network <name>",
      "Name of the network (used in logs and the device-wide registry)",
      DEFAULT_NETWORK,
    )
    .option(
      "-p, --port <port>",
      `TCP port to bind (default ${DEFAULT_PORT}, 0 for ephemeral)`,
      parsePort,
      DEFAULT_PORT,
    )
    .option(
      "-H, --host <host>",
      "Interface to bind",
      DEFAULT_HOST,
    )
    .addOption(
      new Option(
        "-f, --foreground",
        "Run in the foreground until interrupted",
      ).default(false),
    )
    .action(async (opts: StartOptions) => {
      if (!opts.foreground) {
        throw new Error(
          "supervised mode is not yet implemented — pass --foreground to run the server in this terminal",
        );
      }
      await runForeground(opts);
    });
}

async function runForeground(opts: StartOptions): Promise<void> {
  const app = buildApp({ network: opts.network });
  const handle = await startServer({
    app,
    host: opts.host,
    port: opts.port,
  });
  printBanner(handle, opts.network);
  await waitForShutdown(handle);
}

function printBanner(handle: ServerHandle, network: string): void {
  // Stdout, not stderr: this is normal operation, and users may want to pipe
  // the URL into curl/scripts. Errors and progress chatter still go to stderr.
  process.stdout.write(
    `ASP network "${network}" listening on http://${handle.host}:${handle.port}\n`,
  );
}

/**
 * Block on SIGINT/SIGTERM, then close the server and resolve. Once-only:
 * a second signal during shutdown forwards to the default handler so a stuck
 * close still lets the user Ctrl-C out.
 */
function waitForShutdown(handle: ServerHandle): Promise<void> {
  return new Promise((resolve, reject) => {
    let shuttingDown = false;
    const onSignal = (sig: NodeJS.Signals): void => {
      if (shuttingDown) {
        process.kill(process.pid, sig);
        return;
      }
      shuttingDown = true;
      process.stdout.write(`\nShutting down (received ${sig})\n`);
      handle
        .close()
        .then(resolve)
        .catch(reject);
    };
    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);
  });
}

function parsePort(raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 65535) {
    throw new Error(`invalid port "${raw}" (expected an integer between 0 and 65535)`);
  }
  return n;
}
