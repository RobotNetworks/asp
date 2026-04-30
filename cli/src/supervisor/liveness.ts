/**
 * Test whether a process is currently alive.
 *
 * Uses the standard POSIX trick: `kill(pid, 0)` sends no signal but performs
 * the same permission/existence checks. ESRCH means the process is gone;
 * EPERM means it exists but isn't ours — still "alive" for our purposes
 * (we only ask about liveness to refuse double-starts and detect stale state).
 */
export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      "code" in err &&
      (err as NodeJS.ErrnoException).code === "EPERM"
    ) {
      return true;
    }
    return false;
  }
}
