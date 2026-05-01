import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * Directory-bound agent identity for the ASP CLI.
 *
 * When an identity file is present in a project directory (or a parent), CLI
 * commands that require `--as <handle>` will fall back to the stored handle
 * and network rather than erroring. This lets projects commit their agent
 * identity once so all contributors use the same agent without extra flags.
 *
 * File layout:  <project-root>/.robotnet/asp.json
 * Format:       { "version": 1, "handle": "@mybot.bot", "network": "default" }
 */

const CONFIG_DIR = ".robotnet";
const CONFIG_FILE = "asp.json";

export interface IdentityConfig {
  readonly handle: string;
  readonly network: string;
}

export interface ResolvedIdentity extends IdentityConfig {
  /** Absolute path to the .robotnet/asp.json file that was found. */
  readonly filePath: string;
}

/**
 * Where the agent handle came from. Used by error handlers to give
 * actionable advice when an action fails (e.g. "the agent bound by
 * .robotnet/asp.json may have been removed — run `asp identity clear`").
 */
export type IdentitySource = "flag" | "env" | "identity";

export interface ResolvedAgent {
  readonly handle: string;
  readonly network: string;
  readonly source: IdentitySource;
}

/**
 * Three-way precedence for "what agent should this command act as":
 *   1. `--as <handle>` flag (explicit per-command override)
 *   2. `ASP_AGENT` env var (per-shell override, useful for running two
 *      terminal sessions in the same directory as different agents)
 *   3. `.robotnet/asp.json` directory binding (default for the project)
 *
 * `defaultNetwork` is the value the CLI's `--network` flag defaults to
 * (currently "default"). When `explicitNetwork` differs from it, the
 * caller passed `-n` explicitly and we honor it; otherwise we fall back
 * to whatever network the directory identity declares (if any).
 *
 * Returns `undefined` when no source produced a handle — the caller is
 * expected to surface a friendly error message.
 */
export async function resolveAgentIdentity(
  explicitHandle: string | undefined,
  explicitNetwork: string,
  defaultNetwork: string,
  fromDir?: string,
): Promise<ResolvedAgent | undefined> {
  if (explicitHandle !== undefined) {
    return { handle: explicitHandle, network: explicitNetwork, source: "flag" };
  }

  // Resolve directory identity once — we may need its network even when
  // the handle came from the env var.
  const identity = await resolveIdentity(fromDir);

  // Network: --network flag wins when explicit, else the identity's
  // network, else defaultNetwork.
  const network =
    explicitNetwork !== defaultNetwork
      ? explicitNetwork
      : identity?.network ?? defaultNetwork;

  const envHandle = process.env["ASP_AGENT"];
  if (envHandle !== undefined && envHandle.length > 0) {
    return { handle: envHandle, network, source: "env" };
  }

  if (identity) {
    return { handle: identity.handle, network, source: "identity" };
  }

  return undefined;
}

/**
 * Walk up the directory tree from `fromDir` (default: `process.cwd()`)
 * looking for `.robotnet/asp.json`. Returns the first valid identity found,
 * or `undefined` if none exists anywhere in the tree.
 */
export async function resolveIdentity(fromDir?: string): Promise<ResolvedIdentity | undefined> {
  let dir = fromDir ?? process.cwd();
  for (;;) {
    const candidate = join(dir, CONFIG_DIR, CONFIG_FILE);
    const config = await tryReadIdentity(candidate);
    if (config !== undefined) {
      return { ...config, filePath: candidate };
    }
    const parent = dirname(dir);
    if (parent === dir) break; // reached filesystem root
    dir = parent;
  }
  return undefined;
}

/** Write `.robotnet/asp.json` in `dir`, creating the directory if needed. */
export async function writeIdentity(dir: string, config: IdentityConfig): Promise<void> {
  const configDir = join(dir, CONFIG_DIR);
  await mkdir(configDir, { recursive: true });
  const filePath = join(configDir, CONFIG_FILE);
  const payload = { version: 1, handle: config.handle, network: config.network };
  await writeFile(filePath, JSON.stringify(payload, null, 2) + "\n", "utf8");
}

/**
 * Remove `.robotnet/asp.json` from `dir`.
 * Returns `true` if the file was removed, `false` if it did not exist.
 */
export async function clearIdentity(dir: string): Promise<boolean> {
  const filePath = join(dir, CONFIG_DIR, CONFIG_FILE);
  try {
    await unlink(filePath);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
}

async function tryReadIdentity(filePath: string): Promise<IdentityConfig | undefined> {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return isIdentityConfig(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isIdentityConfig(v: unknown): v is IdentityConfig {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as Record<string, unknown>)["handle"] === "string" &&
    typeof (v as Record<string, unknown>)["network"] === "string"
  );
}
