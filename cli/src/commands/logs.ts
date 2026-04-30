import { Command } from "commander";
import { existsSync, statSync } from "node:fs";
import { open, watch } from "node:fs/promises";

import { readLastLines } from "../log-tail.js";
import { networkPaths, resolveStateRoot } from "../paths.js";

const DEFAULT_LINES = 100;
const DEFAULT_NETWORK = "default";

interface LogsOptions {
  readonly follow: boolean;
  readonly lines: number;
}

export function registerLogsCommand(program: Command): void {
  program
    .command("logs [network]")
    .description("Print the tail of an ASP network's server log")
    .option("-f, --follow", "Stream new lines as they're written", false)
    .option(
      "-n, --lines <n>",
      `Trailing line count (default ${DEFAULT_LINES})`,
      parsePositiveInt,
      DEFAULT_LINES,
    )
    .action(async (network: string | undefined, opts: LogsOptions) => {
      const name = network ?? DEFAULT_NETWORK;
      const paths = networkPaths(resolveStateRoot(), name);
      if (!existsSync(paths.serverLog)) {
        throw new Error(
          `no server log for network "${name}" at ${paths.serverLog}`,
        );
      }

      const initial = await readLastLines(paths.serverLog, opts.lines);
      process.stdout.write(initial);

      if (!opts.follow) return;
      await follow(paths.serverLog);
    });
}

/**
 * Stream appended bytes as the file grows. Aborts cleanly on SIGINT so
 * `Ctrl-C` returns the user to their shell with exit code 0.
 *
 * Truncations or rotations (size shrinks) are handled by resetting the
 * read cursor to the new end-of-file — we don't try to follow the rotated
 * file, since for a local CLI the "last truncate wins" behavior is
 * predictable enough.
 */
async function follow(path: string): Promise<void> {
  let cursor = statSync(path).size;
  const ac = new AbortController();
  const onSignal = (): void => ac.abort();
  process.once("SIGINT", onSignal);

  try {
    const watcher = watch(path, { signal: ac.signal });
    for await (const _event of watcher) {
      const size = statSync(path).size;
      if (size < cursor) {
        cursor = size;
        continue;
      }
      if (size === cursor) continue;
      const handle = await open(path, "r");
      try {
        const buf = Buffer.alloc(size - cursor);
        await handle.read(buf, 0, buf.length, cursor);
        process.stdout.write(buf.toString("utf8"));
        cursor = size;
      } finally {
        await handle.close();
      }
    }
  } catch (err: unknown) {
    if (!ac.signal.aborted) throw err;
  } finally {
    process.removeListener("SIGINT", onSignal);
  }
}

function parsePositiveInt(raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`expected a positive integer, got "${raw}"`);
  }
  return n;
}
