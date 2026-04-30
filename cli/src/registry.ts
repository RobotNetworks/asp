import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { registryPath } from "./paths.js";

/**
 * What we record about a running network in the device-wide registry.
 *
 * Kept minimal: enough for any process on the box to find a network (host,
 * port) and to verify it is still alive (pid). Per-network metadata that
 * would bloat the registry (logs, sqlite path, ...) is derived from the
 * network name via {@link networkPaths}.
 */
export interface RegistryEntry {
  readonly name: string;
  readonly pid: number;
  readonly host: string;
  readonly port: number;
  /** Epoch milliseconds. */
  readonly startedAt: number;
  /** Version of the CLI that started this network. Useful for debugging cross-version weirdness. */
  readonly version: string;
}

export interface Registry {
  readonly version: 1;
  readonly networks: Readonly<Record<string, RegistryEntry>>;
}

const EMPTY_REGISTRY: Registry = { version: 1, networks: {} };

/**
 * Read the registry from disk, or return an empty registry if it doesn't
 * exist yet (a fresh install). Throws on malformed content rather than
 * silently dropping it — corrupted state should fail loudly so the user
 * can investigate.
 */
export async function readRegistry(stateRoot: string): Promise<Registry> {
  const path = registryPath(stateRoot);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err: unknown) {
    if (isErrnoException(err) && err.code === "ENOENT") {
      return EMPTY_REGISTRY;
    }
    throw err;
  }
  return parseRegistry(raw, path);
}

/**
 * Atomically replace the registry on disk. Writes to a temp sibling then
 * renames into place so a crash mid-write can never leave a partial file.
 * Permissions: 0700 directory, 0600 file — registry leaks PIDs and ports,
 * so it's user-private.
 */
export async function writeRegistry(
  stateRoot: string,
  registry: Registry,
): Promise<void> {
  const path = registryPath(stateRoot);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.tmp.${process.pid}.${Date.now()}`;
  const body = `${JSON.stringify(registry, null, 2)}\n`;
  await writeFile(tmp, body, { encoding: "utf8", mode: 0o600 });
  await rename(tmp, path);
}

/** Pure: insert or replace an entry. */
export function upsertEntry(
  registry: Registry,
  entry: RegistryEntry,
): Registry {
  return {
    version: 1,
    networks: { ...registry.networks, [entry.name]: entry },
  };
}

/** Pure: remove an entry by name. No-op if absent. */
export function removeEntry(registry: Registry, name: string): Registry {
  if (!(name in registry.networks)) {
    return registry;
  }
  const next: Record<string, RegistryEntry> = { ...registry.networks };
  delete next[name];
  return { version: 1, networks: next };
}

function parseRegistry(raw: string, path: string): Registry {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `registry at ${path} is not valid JSON: ${(err as Error).message}`,
    );
  }

  if (!isPlainObject(parsed)) {
    throw new Error(`registry at ${path} is not a JSON object`);
  }
  if (parsed["version"] !== 1) {
    throw new Error(
      `registry at ${path} has unsupported version ${String(parsed["version"])} (expected 1)`,
    );
  }
  const networks = parsed["networks"];
  if (!isPlainObject(networks)) {
    throw new Error(`registry at ${path} has invalid \`networks\` field`);
  }

  const validated: Record<string, RegistryEntry> = {};
  for (const [key, raw] of Object.entries(networks)) {
    validated[key] = parseEntry(key, raw, path);
  }
  return { version: 1, networks: validated };
}

function parseEntry(key: string, raw: unknown, path: string): RegistryEntry {
  if (!isPlainObject(raw)) {
    throw new Error(`registry entry "${key}" at ${path} is not an object`);
  }
  const name = raw["name"];
  if (name !== key) {
    throw new Error(
      `registry entry "${key}" at ${path} has mismatched name field (got ${JSON.stringify(name)})`,
    );
  }
  const pid = raw["pid"];
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) {
    throw new Error(`registry entry "${key}" has invalid pid`);
  }
  const host = raw["host"];
  if (typeof host !== "string" || host.length === 0) {
    throw new Error(`registry entry "${key}" has invalid host`);
  }
  const port = raw["port"];
  if (
    typeof port !== "number" ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  ) {
    throw new Error(`registry entry "${key}" has invalid port`);
  }
  const startedAt = raw["startedAt"];
  if (typeof startedAt !== "number" || startedAt <= 0) {
    throw new Error(`registry entry "${key}" has invalid startedAt`);
  }
  const version = raw["version"];
  if (typeof version !== "string" || version.length === 0) {
    throw new Error(`registry entry "${key}" has invalid version`);
  }
  return { name, pid, host, port, startedAt, version };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isErrnoException(err: unknown): err is NodeJS.ErrnoException {
  return (
    err instanceof Error &&
    "code" in err &&
    typeof (err as { code: unknown }).code === "string"
  );
}
