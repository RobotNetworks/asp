import { setTimeout as delay } from "node:timers/promises";

import { isProcessAlive } from "./liveness.js";
import { clearRegistration } from "./state.js";
import { readRegistry } from "../registry.js";

export type StopOutcome =
  | { readonly kind: "stopped" }
  /** Registry had an entry but the process was already gone; we cleaned the entry. */
  | { readonly kind: "stale" }
  /** Process did not exit on SIGTERM; we sent SIGKILL. */
  | { readonly kind: "force-killed" }
  /** No registry entry for this network. */
  | { readonly kind: "missing" };

export interface StopResult {
  readonly name: string;
  readonly outcome: StopOutcome;
}

export interface StopOptions {
  /** How long to wait for the process to exit after SIGTERM, in ms. */
  readonly timeoutMs: number;
  /** If true, send SIGKILL after the SIGTERM grace period elapses. */
  readonly force: boolean;
}

const POLL_INTERVAL_MS = 50;
const FORCE_REAP_MS = 1000;

/**
 * Stop a single network. Returns a result describing what happened; throws
 * only if (a) the process is still alive after the SIGTERM grace period
 * and `force` is false, or (b) sending the signal failed for an unexpected
 * reason. Missing/stale registry entries are *outcomes*, not errors —
 * callers decide how to surface them.
 */
export async function stopNetwork(
  stateRoot: string,
  name: string,
  opts: StopOptions,
): Promise<StopResult> {
  const reg = await readRegistry(stateRoot);
  const entry = reg.networks[name];
  if (!entry) {
    return { name, outcome: { kind: "missing" } };
  }

  if (!isProcessAlive(entry.pid)) {
    await clearRegistration(stateRoot, name);
    return { name, outcome: { kind: "stale" } };
  }

  try {
    process.kill(entry.pid, "SIGTERM");
  } catch (err: unknown) {
    if (isErrnoCode(err, "ESRCH")) {
      // Race: the process exited between our liveness check and the signal.
      await clearRegistration(stateRoot, name);
      return { name, outcome: { kind: "stale" } };
    }
    throw err;
  }

  if (await waitForExit(entry.pid, opts.timeoutMs)) {
    // The child should have already deregistered itself; clean up any
    // residue defensively.
    await clearRegistration(stateRoot, name);
    return { name, outcome: { kind: "stopped" } };
  }

  if (!opts.force) {
    throw new Error(
      `network "${name}" (pid ${entry.pid}) did not exit within ${opts.timeoutMs}ms — retry with --force to send SIGKILL`,
    );
  }

  try {
    process.kill(entry.pid, "SIGKILL");
  } catch (err: unknown) {
    if (!isErrnoCode(err, "ESRCH")) throw err;
  }
  await waitForExit(entry.pid, FORCE_REAP_MS);
  await clearRegistration(stateRoot, name);
  return { name, outcome: { kind: "force-killed" } };
}

async function waitForExit(pid: number, timeoutMs: number): Promise<boolean> {
  let elapsed = 0;
  while (elapsed < timeoutMs) {
    if (!isProcessAlive(pid)) return true;
    await delay(POLL_INTERVAL_MS);
    elapsed += POLL_INTERVAL_MS;
  }
  return !isProcessAlive(pid);
}

function isErrnoCode(err: unknown, code: string): boolean {
  return (
    err instanceof Error &&
    "code" in err &&
    (err as NodeJS.ErrnoException).code === code
  );
}
