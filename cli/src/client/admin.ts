import { readFile } from "node:fs/promises";

import { networkPaths, resolveStateRoot } from "../paths.js";
import { readRegistry } from "../registry.js";

export type Policy = "allowlist" | "open";

export interface AgentWire {
  readonly handle: string;
  readonly token: string;
  readonly policy: Policy;
  readonly allowlist: readonly string[];
}

/**
 * Thrown when an admin API request comes back with an HTTP error. The
 * `code` field is the `error` string from the JSON body when present.
 */
export class AdminApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super(`admin API error ${status}: ${code}`);
    this.name = "AdminApiError";
    this.status = status;
    this.code = code;
  }
}

/**
 * Thrown when the requested network is not in the registry. The caller
 * should surface this as a user-facing message rather than a stack trace.
 */
export class NetworkNotRunningError extends Error {
  constructor(network: string) {
    super(`network "${network}" is not running — run \`asp start\` first`);
    this.name = "NetworkNotRunningError";
  }
}

/**
 * Typed HTTP client for the /_admin management API of a single network.
 * Constructed via {@link connectAdmin}; not intended to be instantiated
 * directly in application code.
 */
export class AdminClient {
  readonly #baseUrl: string;
  readonly #token: string;

  constructor(baseUrl: string, token: string) {
    this.#baseUrl = baseUrl;
    this.#token = token;
  }

  async registerAgent(
    handle: string,
    opts: { policy?: Policy } = {},
  ): Promise<AgentWire> {
    return this.#post<AgentWire>("/agents", {
      handle,
      ...(opts.policy !== undefined ? { policy: opts.policy } : {}),
    });
  }

  async listAgents(): Promise<AgentWire[]> {
    const body = await this.#get<{ agents: AgentWire[] }>("/agents");
    return body.agents;
  }

  async showAgent(handle: string): Promise<AgentWire> {
    return this.#get<AgentWire>(`/agents/${encodeURIComponent(handle)}`);
  }

  async removeAgent(handle: string): Promise<void> {
    await this.#delete(`/agents/${encodeURIComponent(handle)}`);
  }

  async rotateToken(handle: string): Promise<AgentWire> {
    return this.#post<AgentWire>(
      `/agents/${encodeURIComponent(handle)}/rotate-token`,
      undefined,
    );
  }

  async setPolicy(handle: string, policy: Policy): Promise<AgentWire> {
    return this.#patch<AgentWire>(
      `/agents/${encodeURIComponent(handle)}`,
      { policy },
    );
  }

  async addToAllowlist(handle: string, entries: string[]): Promise<AgentWire> {
    return this.#post<AgentWire>(
      `/agents/${encodeURIComponent(handle)}/allowlist`,
      { entries },
    );
  }

  async removeFromAllowlist(handle: string, entry: string): Promise<AgentWire> {
    return this.#delete<AgentWire>(
      `/agents/${encodeURIComponent(handle)}/allowlist/${encodeURIComponent(entry)}`,
    );
  }

  /** Wipe all agents and sessions from the network. */
  async reset(): Promise<void> {
    await this.#post<null>("/reset", undefined);
  }

  /** WebSocket URL for the admin event-tap endpoint. */
  get tapWsUrl(): string {
    return this.#baseUrl.replace(/^http/, "ws") + "/_admin/tap";
  }

  /** The admin bearer token (used to authenticate the tap WebSocket). */
  get token(): string {
    return this.#token;
  }

  async #get<T>(path: string): Promise<T> {
    return this.#request<T>("GET", path);
  }

  async #post<T>(path: string, body: unknown): Promise<T> {
    return this.#request<T>("POST", path, body);
  }

  async #patch<T>(path: string, body: unknown): Promise<T> {
    return this.#request<T>("PATCH", path, body);
  }

  async #delete<T = null>(path: string): Promise<T> {
    return this.#request<T>("DELETE", path);
  }

  async #request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.#token}`,
    };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    let res: Response;
    try {
      res = await fetch(`${this.#baseUrl}/_admin${path}`, {
        method,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`could not reach network at ${this.#baseUrl}: ${msg}`);
    }
    if (res.status === 204) {
      return null as T;
    }
    const json = (await res.json()) as unknown;
    if (!res.ok) {
      const code = isErrorBody(json) ? json.error : `http_${res.status}`;
      throw new AdminApiError(res.status, code);
    }
    return json as T;
  }
}

/**
 * Locate a running network and return an authenticated AdminClient for it.
 *
 * Reads the registry to find the network's host/port, then reads the
 * per-network admin token file. Both are produced by `asp start` and
 * removed on shutdown; if either is missing the network is not usable.
 */
export async function connectAdmin(
  network: string,
  stateRoot?: string,
): Promise<AdminClient> {
  const root = stateRoot ?? resolveStateRoot();
  const reg = await readRegistry(root);
  const entry = reg.networks[network];
  if (!entry) {
    throw new NetworkNotRunningError(network);
  }
  const paths = networkPaths(root, network);
  let token: string;
  try {
    token = (await readFile(paths.adminTokenFile, "utf8")).trim();
  } catch {
    throw new NetworkNotRunningError(network);
  }
  return new AdminClient(`http://${entry.host}:${entry.port}`, token);
}

function isErrorBody(v: unknown): v is { error: string } {
  return (
    typeof v === "object" &&
    v !== null &&
    "error" in v &&
    typeof (v as { error: unknown }).error === "string"
  );
}
