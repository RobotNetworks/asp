import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir, unlink, writeFile } from "node:fs/promises";

import {
  networkPaths,
  resolveStateRoot,
  type NetworkPaths,
} from "../paths.js";
import {
  readRegistry,
  removeEntry,
  upsertEntry,
  writeRegistry,
} from "../registry.js";
import { buildApp } from "../server/app.js";
import { startServer, type ServerHandle } from "../server/runtime.js";
import { PACKAGE_VERSION } from "../version.js";

export interface RunSupervisedChildOptions {
  readonly network: string;
  readonly host: string;
  readonly port: number;
}

/**
 * The long-running child process when started via the supervisor.
 *
 * Order of operations is deliberate: bind the listener first (so we know
 * the assigned port), then publish state (pid file, registry, network.json),
 * then signal ready to the parent. If anything before the ready signal
 * fails, the parent times out and surfaces an error; subsequent starts
 * detect any stale state via PID liveness and clean it up.
 *
 * After signaling ready the child writes only to its own log file — the
 * parent's stdout pipe is no longer being read.
 */
export async function runSupervisedChild(
  opts: RunSupervisedChildOptions,
): Promise<void> {
  const stateRoot = resolveStateRoot();
  const paths = networkPaths(stateRoot, opts.network);
  await mkdir(paths.logDir, { recursive: true, mode: 0o700 });

  const log = createWriteStream(paths.serverLog, { flags: "a", mode: 0o600 });
  installCrashLogger(log);

  const handle = await startServer({
    app: buildApp({ network: opts.network }),
    host: opts.host,
    port: opts.port,
  });

  await publishState(stateRoot, opts.network, paths, handle);

  await emitReady(handle);
  log.write(
    `[${new Date().toISOString()}] network "${opts.network}" listening on http://${handle.host}:${handle.port} (pid ${process.pid})\n`,
  );

  const signal = await waitForSignal();
  log.write(`[${new Date().toISOString()}] received ${signal}, shutting down\n`);

  await handle.close();
  await retract(stateRoot, opts.network, paths);
  await new Promise<void>((resolve) => log.end(resolve));
}

async function publishState(
  stateRoot: string,
  name: string,
  paths: NetworkPaths,
  handle: ServerHandle,
): Promise<void> {
  await writeFile(paths.pidFile, `${process.pid}\n`, { mode: 0o600 });
  const reg = await readRegistry(stateRoot);
  const next = upsertEntry(reg, {
    name,
    pid: process.pid,
    host: handle.host,
    port: handle.port,
    startedAt: Date.now(),
    version: PACKAGE_VERSION,
  });
  await writeRegistry(stateRoot, next);
  await writeFile(
    paths.networkInfo,
    `${JSON.stringify(
      {
        network: name,
        host: handle.host,
        port: handle.port,
        pid: process.pid,
        startedAt: Date.now(),
        version: PACKAGE_VERSION,
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );
}

async function retract(
  stateRoot: string,
  name: string,
  paths: NetworkPaths,
): Promise<void> {
  // Best-effort: a partial cleanup is better than a crashed cleanup. The
  // next `asp start` will detect any leftover state via PID liveness.
  try {
    const reg = await readRegistry(stateRoot);
    await writeRegistry(stateRoot, removeEntry(reg, name));
  } catch {
    /* registry stale; will be reaped by the next start */
  }
  try {
    await unlink(paths.pidFile);
  } catch (err: unknown) {
    if (!isErrnoNotFound(err)) {
      // swallow — logging here is not critical, the file may already be gone
    }
  }
  // Leave network.json on disk: useful as a last-known-state record for
  // post-mortem inspection.
}

/**
 * Tell the parent we're ready. One newline-terminated JSON line on stdout,
 * flushed before we proceed. The parent reads up to this newline and then
 * stops listening.
 */
function emitReady(handle: ServerHandle): Promise<void> {
  const message = JSON.stringify({
    event: "ready",
    host: handle.host,
    port: handle.port,
    pid: process.pid,
  });
  return new Promise<void>((resolve, reject) => {
    process.stdout.write(`${message}\n`, (err) =>
      err ? reject(err) : resolve(),
    );
  });
}

function installCrashLogger(log: WriteStream): void {
  const record = (label: string, err: unknown): void => {
    const stack = err instanceof Error ? (err.stack ?? err.message) : String(err);
    log.write(`[${new Date().toISOString()}] ${label}: ${stack}\n`);
  };
  process.on("uncaughtException", (err) => {
    record("uncaughtException", err);
    process.exitCode = 1;
  });
  process.on("unhandledRejection", (err) => {
    record("unhandledRejection", err);
    process.exitCode = 1;
  });
}

function waitForSignal(): Promise<NodeJS.Signals> {
  return new Promise((resolve) => {
    process.once("SIGTERM", () => resolve("SIGTERM"));
    process.once("SIGINT", () => resolve("SIGINT"));
  });
}

function isErrnoNotFound(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err as NodeJS.ErrnoException).code === "ENOENT"
  );
}
