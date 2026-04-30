import { Command } from "commander";

import { resolveStateRoot } from "../paths.js";
import { readRegistry, type RegistryEntry } from "../registry.js";
import { isProcessAlive } from "../supervisor/liveness.js";

/** Whether the registry entry corresponds to a live process. */
export type NetworkState = "running" | "stale";

export interface NetworkStatus {
  readonly name: string;
  readonly state: NetworkState;
  readonly host: string;
  readonly port: number;
  readonly pid: number;
  readonly startedAt: number;
  readonly uptimeMs: number;
  readonly version: string;
}

interface StatusOptions {
  readonly json: boolean;
}

export function registerStatusCommand(program: Command): void {
  program
    .command("status [network]")
    .description("Show running ASP networks on this device")
    .option("--json", "Emit machine-readable JSON", false)
    .action(async (network: string | undefined, opts: StatusOptions) => {
      const stateRoot = resolveStateRoot();
      const reg = await readRegistry(stateRoot);
      const statuses = Object.values(reg.networks)
        .map((entry) => describeEntry(entry, Date.now()))
        .sort((a, b) => a.name.localeCompare(b.name));

      if (network !== undefined) {
        const one = statuses.find((s) => s.name === network);
        if (!one) {
          if (opts.json) {
            process.stdout.write(
              `${JSON.stringify({ networks: [] }, null, 2)}\n`,
            );
          } else {
            process.stdout.write(
              `No network named "${network}" in the registry.\n`,
            );
          }
          process.exitCode = 1;
          return;
        }
        emit([one], opts.json);
        return;
      }
      emit(statuses, opts.json);
    });
}

/**
 * Translate a registry entry into a status snapshot.
 *
 * Pure: takes `now` so tests can pin uptime.
 */
export function describeEntry(
  entry: RegistryEntry,
  now: number,
): NetworkStatus {
  return {
    name: entry.name,
    state: isProcessAlive(entry.pid) ? "running" : "stale",
    host: entry.host,
    port: entry.port,
    pid: entry.pid,
    startedAt: entry.startedAt,
    uptimeMs: Math.max(0, now - entry.startedAt),
    version: entry.version,
  };
}

function emit(networks: readonly NetworkStatus[], json: boolean): void {
  if (json) {
    process.stdout.write(`${JSON.stringify({ networks }, null, 2)}\n`);
    return;
  }
  if (networks.length === 0) {
    process.stdout.write("No ASP networks running on this device.\n");
    return;
  }
  process.stdout.write(formatTable(networks));
}

/**
 * Render a fixed-column status table. Two-space gutter between columns;
 * left-aligned cells. Only the human-readable mode uses this — JSON mode
 * emits the raw structured form.
 */
export function formatTable(rows: readonly NetworkStatus[]): string {
  const headers = ["NAME", "STATE", "URL", "PID", "UPTIME", "VERSION"];
  const cells: string[][] = rows.map((r) => [
    r.name,
    r.state,
    `http://${r.host}:${r.port}`,
    r.state === "running" ? String(r.pid) : "-",
    r.state === "running" ? formatDuration(r.uptimeMs) : "-",
    r.version,
  ]);
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...cells.map((row) => row[i]?.length ?? 0)),
  );
  const renderRow = (row: readonly string[]): string =>
    row.map((cell, i) => cell.padEnd(widths[i] ?? 0)).join("  ").trimEnd();
  return `${[headers, ...cells].map(renderRow).join("\n")}\n`;
}

export function formatDuration(ms: number): string {
  if (ms < 0 || !Number.isFinite(ms)) return "-";
  const totalSec = Math.floor(ms / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}
