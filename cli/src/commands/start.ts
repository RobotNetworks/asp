import { Command, Option } from "commander";

import { startNetwork, type NetworkRuntime } from "../server/network.js";
import { runSupervisedChild } from "../supervisor/run.js";
import { supervise } from "../supervisor/spawn.js";

const DEFAULT_PORT = 8723;
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_NETWORK = "default";

interface StartOptions {
  network: string;
  host: string;
  port: number;
  foreground: boolean;
  internalSupervised: boolean;
}

/**
 * Register `asp start` on the program.
 *
 * Three internal modes — at most one applies per invocation:
 *
 *   default                 → supervisor: spawn self with --internal-supervised
 *                             and exit once the child reports ready.
 *   --foreground            → run the server in this terminal until SIGINT.
 *   --internal-supervised   → become the long-running supervised child. Hidden
 *                             from --help; only the supervisor invokes it.
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
    .option("-H, --host <host>", "Interface to bind", DEFAULT_HOST)
    .addOption(
      new Option(
        "-f, --foreground",
        "Run in the foreground until interrupted",
      ).default(false),
    )
    .addOption(
      new Option(
        "--internal-supervised",
        "Internal: act as the supervised child. Do not use directly.",
      )
        .default(false)
        .hideHelp(),
    )
    .action(async (opts: StartOptions) => {
      if (opts.foreground && opts.internalSupervised) {
        throw new Error(
          "--foreground and --internal-supervised cannot be combined",
        );
      }
      if (opts.internalSupervised) {
        await runSupervisedChild({
          network: opts.network,
          host: opts.host,
          port: opts.port,
        });
        return;
      }
      if (opts.foreground) {
        await runForeground(opts);
        return;
      }
      await runDetached(opts);
    });
}

async function runForeground(opts: StartOptions): Promise<void> {
  const runtime = await startNetwork({
    network: opts.network,
    host: opts.host,
    port: opts.port,
  });
  process.stdout.write(
    `ASP network "${opts.network}" listening on http://${runtime.handle.host}:${runtime.handle.port}\n`,
  );
  await waitForShutdown(runtime);
}

async function runDetached(opts: StartOptions): Promise<void> {
  const result = await supervise({
    network: opts.network,
    host: opts.host,
    port: opts.port,
  });
  process.stdout.write(
    `ASP network "${opts.network}" started on http://${result.host}:${result.port} (pid ${result.pid})\n`,
  );
}

/**
 * Block on SIGINT/SIGTERM, then close the network and resolve. Once-only:
 * a second signal during shutdown re-raises so a stuck close still lets
 * the user Ctrl-C out.
 */
function waitForShutdown(runtime: NetworkRuntime): Promise<void> {
  return new Promise((resolve, reject) => {
    let shuttingDown = false;
    const onSignal = (sig: NodeJS.Signals): void => {
      if (shuttingDown) {
        process.kill(process.pid, sig);
        return;
      }
      shuttingDown = true;
      process.stdout.write(`\nShutting down (received ${sig})\n`);
      runtime.close().then(resolve).catch(reject);
    };
    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);
  });
}

function parsePort(raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 65535) {
    throw new Error(
      `invalid port "${raw}" (expected an integer between 0 and 65535)`,
    );
  }
  return n;
}
