import { homedir } from "node:os";
import { join } from "node:path";

const STATE_DIR_NAME = "asp";

/**
 * Resolve the device-wide state root for ASP networks.
 *
 * Honors `$XDG_STATE_HOME` if set, else falls back to `$HOME/.local/state`.
 * On macOS we deliberately use the Linux/XDG convention (rather than
 * `~/Library/Application Support`) so the CLI's on-disk layout is identical
 * across the two supported platforms — easier to document, debug, and back up.
 *
 * Reads env at call time (not import time) so tests can override `HOME` or
 * `XDG_STATE_HOME` per case.
 */
export function resolveStateRoot(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const xdg = env["XDG_STATE_HOME"];
  if (xdg && xdg.length > 0) {
    return join(xdg, STATE_DIR_NAME);
  }
  const home = env["HOME"] ?? homedir();
  return join(home, ".local", "state", STATE_DIR_NAME);
}

/**
 * The name of a network is part of its on-disk path and the key it appears
 * under in the device-wide registry, so accept only a conservative subset:
 * lowercase alphanumerics, underscore, and hyphen. No uppercase (filesystem
 * case-sensitivity varies by platform), no separators, no leading punctuation.
 */
const NETWORK_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export function assertValidNetworkName(name: string): void {
  if (!NETWORK_NAME_PATTERN.test(name)) {
    throw new Error(
      `invalid network name "${name}" (lowercase letters, digits, underscore, ` +
        `hyphen only; must start with a letter or digit; max 64 chars)`,
    );
  }
}

/**
 * The set of paths that belong to a single network. Computed up front so
 * call sites never assemble path strings ad-hoc and the directory layout has
 * exactly one definition.
 */
export interface NetworkPaths {
  readonly stateRoot: string;
  readonly networkDir: string;
  readonly pidFile: string;
  /**
   * Per-network bearer token guarding the management API (`/_admin/...`).
   * Rotated each start; mode 0600. Any process that can read this file
   * can manage agents on this network.
   */
  readonly adminTokenFile: string;
  readonly logDir: string;
  readonly serverLog: string;
  readonly networkInfo: string;
  readonly sqlite: string;
  /** Directory holding per-agent bearer-token files written by `asp agent register`. */
  readonly credentialsDir: string;
}

export function networkPaths(stateRoot: string, name: string): NetworkPaths {
  assertValidNetworkName(name);
  const networkDir = join(stateRoot, "networks", name);
  const logDir = join(networkDir, "logs");
  return {
    stateRoot,
    networkDir,
    pidFile: join(networkDir, "asp.pid"),
    adminTokenFile: join(networkDir, "admin.token"),
    logDir,
    serverLog: join(logDir, "server.log"),
    networkInfo: join(networkDir, "network.json"),
    sqlite: join(networkDir, "asp.sqlite"),
    credentialsDir: join(networkDir, "credentials"),
  };
}

export function registryPath(stateRoot: string): string {
  return join(stateRoot, "networks.json");
}

/**
 * Per-agent credential file storing the bearer token returned at registration.
 * Written by `asp agent register`; read by session commands to authenticate.
 * Mode 0600; lives under the network's state directory.
 */
export function agentCredentialPath(stateRoot: string, network: string, handle: string): string {
  const sanitized = handle.startsWith("@") ? handle.slice(1) : handle;
  return join(stateRoot, "networks", network, "credentials", `${sanitized}.token`);
}
