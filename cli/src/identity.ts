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
