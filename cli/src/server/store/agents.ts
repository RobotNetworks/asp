import { randomBytes } from "node:crypto";

import { assertValidHandle } from "../../handles.js";

/**
 * Per-agent inbound trust posture. ASP defines two: `allowlist` (closed by
 * default; only listed counterparties can reach the agent) and `open` (no
 * gate). The CLI exposes both for testing.
 */
export type Policy = "allowlist" | "open";

export interface Agent {
  readonly handle: string;
  /** Bearer token used for protocol auth. Treat as a credential. */
  readonly token: string;
  readonly policy: Policy;
  readonly allowlist: readonly string[];
}

export interface AgentRegistration {
  readonly policy?: Policy;
}

/**
 * In-memory mutable index of agents on a network. Phase 4 will add a
 * SQLite-backed implementation behind this interface; nothing else in the
 * server should depend on the storage shape.
 */
export interface AgentStore {
  /**
   * Register a new agent with a freshly generated bearer token. Throws
   * AgentExistsError if the handle is already taken; throws on an invalid
   * handle (per ASP's regex).
   */
  register(handle: string, opts?: AgentRegistration): Agent;
  /** Remove an agent by handle. Returns true if one was removed. */
  remove(handle: string): boolean;
  /** Look up by handle. Returns undefined if absent. */
  get(handle: string): Agent | undefined;
  /** Reverse lookup by bearer token. Used by protocol-route auth in later phases. */
  byToken(token: string): Agent | undefined;
  /** Snapshot of all agents, sorted by handle. */
  list(): readonly Agent[];
  /** Replace the agent's bearer token. Returns the new agent or undefined if absent. */
  rotateToken(handle: string): Agent | undefined;
  /** Update inbound policy. Returns the updated agent or undefined if absent. */
  setPolicy(handle: string, policy: Policy): Agent | undefined;
  /**
   * Add entries to the agent's allowlist. Skips duplicates. Returns the
   * updated agent or undefined if the agent is absent.
   */
  addToAllowlist(handle: string, entries: readonly string[]): Agent | undefined;
  /**
   * Remove an entry from the agent's allowlist. Returns the updated agent or
   * undefined if the agent is absent. Idempotent — no error if the entry is
   * not present.
   */
  removeFromAllowlist(handle: string, entry: string): Agent | undefined;
}

export class AgentExistsError extends Error {
  readonly handle: string;
  constructor(handle: string) {
    super(`agent "${handle}" already exists`);
    this.name = "AgentExistsError";
    this.handle = handle;
  }
}

export class InMemoryAgentStore implements AgentStore {
  readonly #byHandle = new Map<string, Agent>();
  readonly #handleByToken = new Map<string, string>();

  register(handle: string, opts: AgentRegistration = {}): Agent {
    assertValidHandle(handle);
    if (this.#byHandle.has(handle)) {
      throw new AgentExistsError(handle);
    }
    const policy: Policy = opts.policy ?? "allowlist";
    const token = generateToken();
    const agent: Agent = { handle, token, policy, allowlist: [] };
    this.#byHandle.set(handle, agent);
    this.#handleByToken.set(token, handle);
    return agent;
  }

  remove(handle: string): boolean {
    const agent = this.#byHandle.get(handle);
    if (!agent) return false;
    this.#byHandle.delete(handle);
    this.#handleByToken.delete(agent.token);
    return true;
  }

  get(handle: string): Agent | undefined {
    return this.#byHandle.get(handle);
  }

  byToken(token: string): Agent | undefined {
    const handle = this.#handleByToken.get(token);
    return handle === undefined ? undefined : this.#byHandle.get(handle);
  }

  list(): readonly Agent[] {
    return [...this.#byHandle.values()].sort((a, b) =>
      a.handle.localeCompare(b.handle),
    );
  }

  rotateToken(handle: string): Agent | undefined {
    const old = this.#byHandle.get(handle);
    if (!old) return undefined;
    const token = generateToken();
    const next: Agent = { ...old, token };
    this.#byHandle.set(handle, next);
    this.#handleByToken.delete(old.token);
    this.#handleByToken.set(token, handle);
    return next;
  }

  setPolicy(handle: string, policy: Policy): Agent | undefined {
    const old = this.#byHandle.get(handle);
    if (!old) return undefined;
    const next: Agent = { ...old, policy };
    this.#byHandle.set(handle, next);
    return next;
  }

  addToAllowlist(handle: string, entries: readonly string[]): Agent | undefined {
    const old = this.#byHandle.get(handle);
    if (!old) return undefined;
    const existing = new Set(old.allowlist);
    const next: Agent = {
      ...old,
      allowlist: [...old.allowlist, ...entries.filter((e) => !existing.has(e))],
    };
    this.#byHandle.set(handle, next);
    return next;
  }

  removeFromAllowlist(handle: string, entry: string): Agent | undefined {
    const old = this.#byHandle.get(handle);
    if (!old) return undefined;
    const next: Agent = {
      ...old,
      allowlist: old.allowlist.filter((e) => e !== entry),
    };
    this.#byHandle.set(handle, next);
    return next;
  }
}

/**
 * Bearer tokens: 32 random bytes, base64url-encoded (43 chars, no padding).
 * That's 256 bits of entropy — well past the threshold for guessing
 * resistance — and the encoding is URL/header safe without escaping.
 */
function generateToken(): string {
  return randomBytes(32).toString("base64url");
}
