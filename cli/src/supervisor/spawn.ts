import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, unlink } from "node:fs/promises";

import { networkPaths, resolveStateRoot } from "../paths.js";
import { readRegistry, removeEntry, writeRegistry } from "../registry.js";
import { isProcessAlive } from "./liveness.js";

export interface SuperviseOptions {
  readonly network: string;
  readonly host: string;
  readonly port: number;
  /** Path to the asp binary. Defaults to `process.argv[1]` (the active CLI). */
  readonly bin?: string;
  /** Maximum time to wait for the child to signal ready, in seconds. */
  readonly readyTimeoutSeconds?: number;
}

export interface SuperviseResult {
  readonly host: string;
  readonly port: number;
  readonly pid: number;
}

interface ChildReadyMessage {
  readonly event: "ready";
  readonly host: string;
  readonly port: number;
  readonly pid: number;
}

interface ChildErrorMessage {
  readonly event: "error";
  readonly message: string;
}

type ChildMessage = ChildReadyMessage | ChildErrorMessage;

const DEFAULT_READY_TIMEOUT_S = 10;

/**
 * Start a network as a detached child process. Resolves once the child has
 * confirmed the server is listening; rejects if the child dies, errors, or
 * fails to signal ready before the timeout.
 *
 * The parent process is the one that enforces "no double-start": it consults
 * the device-wide registry and refuses if a live entry already exists for
 * this network. Stale entries (PID dead) are reaped here so a crashed
 * network can always be replaced by a fresh start.
 */
export async function supervise(
  opts: SuperviseOptions,
): Promise<SuperviseResult> {
  const stateRoot = resolveStateRoot();
  await ensureNotAlreadyRunning(stateRoot, opts.network);

  const paths = networkPaths(stateRoot, opts.network);
  await mkdir(paths.networkDir, { recursive: true, mode: 0o700 });

  const bin = opts.bin ?? process.argv[1];
  if (!bin) {
    throw new Error(
      "supervise: cannot determine asp binary path (process.argv[1] missing)",
    );
  }

  const child = spawn(
    process.execPath,
    [
      bin,
      "start",
      "--internal-supervised",
      "--network",
      opts.network,
      "--host",
      opts.host,
      "--port",
      String(opts.port),
    ],
    {
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  const timeoutSeconds = opts.readyTimeoutSeconds ?? DEFAULT_READY_TIMEOUT_S;

  try {
    const message = await readReadyMessage(child, timeoutSeconds);
    if (message.event === "error") {
      throw new Error(message.message);
    }
    // Release the inherited stdio handles so the parent's event loop can
    // exit. unref() on the child process handle alone is not enough — each
    // pipe is its own handle that holds the loop alive until destroyed.
    child.stdout?.destroy();
    child.stderr?.destroy();
    child.unref();
    return {
      host: message.host,
      port: message.port,
      pid: message.pid,
    };
  } catch (err) {
    try {
      child.kill("SIGTERM");
    } catch {
      /* already gone */
    }
    throw err;
  }
}

async function ensureNotAlreadyRunning(
  stateRoot: string,
  name: string,
): Promise<void> {
  const reg = await readRegistry(stateRoot);
  const entry = reg.networks[name];
  if (!entry) return;

  if (isProcessAlive(entry.pid)) {
    throw new Error(
      `network "${name}" is already running on http://${entry.host}:${entry.port} (pid ${entry.pid})`,
    );
  }

  // Stale registry entry — the previous process is gone. Sweep it.
  await writeRegistry(stateRoot, removeEntry(reg, name));
  try {
    await unlink(networkPaths(stateRoot, name).pidFile);
  } catch (err: unknown) {
    if (
      !(
        err instanceof Error &&
        (err as NodeJS.ErrnoException).code === "ENOENT"
      )
    ) {
      // Surface unexpected errors; an inaccessible state directory is a
      // problem the user should know about before we continue.
      throw err;
    }
  }
}

function readReadyMessage(
  child: ChildProcess,
  timeoutSeconds: number,
): Promise<ChildMessage> {
  return new Promise((resolve, reject) => {
    let stdoutBuffer = "";
    let stderrBuffer = "";
    let settled = false;

    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdout?.removeAllListeners();
      child.stderr?.removeAllListeners();
      child.removeAllListeners("error");
      child.removeAllListeners("exit");
      fn();
    };

    const timer = setTimeout(() => {
      finish(() =>
        reject(
          new Error(
            `server did not signal ready within ${timeoutSeconds}s${
              stderrBuffer ? `\nstderr: ${stderrBuffer.trim()}` : ""
            }`,
          ),
        ),
      );
    }, timeoutSeconds * 1000);

    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdoutBuffer += chunk;
      const newline = stdoutBuffer.indexOf("\n");
      if (newline === -1) return;
      const line = stdoutBuffer.slice(0, newline);
      try {
        const parsed = JSON.parse(line) as ChildMessage;
        finish(() => resolve(parsed));
      } catch {
        finish(() =>
          reject(new Error(`unparseable startup message from server: ${line}`)),
        );
      }
    });

    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderrBuffer += chunk;
    });

    child.on("error", (err) => finish(() => reject(err)));
    child.on("exit", (code, signal) => {
      finish(() =>
        reject(
          new Error(
            `server exited before signaling ready (code=${code ?? "null"} signal=${signal ?? "null"})${
              stderrBuffer ? `\nstderr: ${stderrBuffer.trim()}` : ""
            }`,
          ),
        ),
      );
    });
  });
}
