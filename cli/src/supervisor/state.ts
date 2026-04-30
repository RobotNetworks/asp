import { unlink } from "node:fs/promises";

import { networkPaths } from "../paths.js";
import { readRegistry, removeEntry, writeRegistry } from "../registry.js";

/**
 * Drop a network's claim on shared device state — registry entry and pid
 * file — and tolerate any pieces that are already missing.
 *
 * Idempotent: running twice yields the same result. Used in three places:
 * - the supervisor before spawning, to reap stale state from a crashed run,
 * - the supervised child during clean shutdown,
 * - `asp stop`, after a process has been signaled and exited.
 *
 * Registry write errors are not swallowed — corrupted state should fail
 * loudly. Pid file ENOENT is expected and ignored; other errors propagate
 * so a user-visible failure surfaces (e.g. permission problems).
 */
export async function clearRegistration(
  stateRoot: string,
  name: string,
): Promise<void> {
  const reg = await readRegistry(stateRoot);
  if (name in reg.networks) {
    await writeRegistry(stateRoot, removeEntry(reg, name));
  }
  try {
    await unlink(networkPaths(stateRoot, name).pidFile);
  } catch (err: unknown) {
    if (!isErrnoNotFound(err)) {
      throw err;
    }
  }
}

function isErrnoNotFound(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err as NodeJS.ErrnoException).code === "ENOENT"
  );
}
