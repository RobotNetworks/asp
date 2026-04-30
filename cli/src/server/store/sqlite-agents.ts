import { randomBytes } from "node:crypto";
import type { DatabaseSync, StatementSync } from "node:sqlite";

import { assertValidHandle } from "../../handles.js";
import { AgentExistsError, type Agent, type AgentStore, type Policy } from "./agents.js";

interface AgentRow {
  readonly handle: string;
  readonly token: string;
  readonly policy: string;
  readonly allowlist: string;
}

/**
 * SQLite-backed implementation of AgentStore. Thread-safe within a single
 * Node.js process (DatabaseSync is synchronous; the event loop serialises
 * calls). All mutations are wrapped in transactions so partial writes are
 * impossible.
 */
export class SqliteAgentStore implements AgentStore {
  readonly #db: DatabaseSync;
  readonly #selectAll: StatementSync;
  readonly #selectByHandle: StatementSync;
  readonly #selectByToken: StatementSync;
  readonly #insert: StatementSync;
  readonly #delete: StatementSync;
  readonly #updateToken: StatementSync;
  readonly #updatePolicy: StatementSync;
  readonly #updateAllowlist: StatementSync;

  constructor(db: DatabaseSync) {
    this.#db = db;
    this.#selectAll = db.prepare("SELECT * FROM agents ORDER BY handle");
    this.#selectByHandle = db.prepare("SELECT * FROM agents WHERE handle = ?");
    this.#selectByToken = db.prepare("SELECT * FROM agents WHERE token = ?");
    this.#insert = db.prepare(
      "INSERT INTO agents (handle, token, policy, allowlist) VALUES (?, ?, ?, ?)",
    );
    this.#delete = db.prepare("DELETE FROM agents WHERE handle = ?");
    this.#updateToken = db.prepare("UPDATE agents SET token = ? WHERE handle = ?");
    this.#updatePolicy = db.prepare("UPDATE agents SET policy = ? WHERE handle = ?");
    this.#updateAllowlist = db.prepare("UPDATE agents SET allowlist = ? WHERE handle = ?");
  }

  register(handle: string, opts: { policy?: Policy } = {}): Agent {
    assertValidHandle(handle);
    if (this.#selectByHandle.get(handle) !== undefined) {
      throw new AgentExistsError(handle);
    }
    const policy: Policy = opts.policy ?? "allowlist";
    const token = generateToken();
    this.#insert.run(handle, token, policy, "[]");
    return { handle, token, policy, allowlist: [] };
  }

  remove(handle: string): boolean {
    const result = this.#delete.run(handle);
    return (result.changes ?? 0) > 0;
  }

  get(handle: string): Agent | undefined {
    const row = this.#selectByHandle.get(handle) as AgentRow | undefined;
    return row ? rowToAgent(row) : undefined;
  }

  byToken(token: string): Agent | undefined {
    const row = this.#selectByToken.get(token) as AgentRow | undefined;
    return row ? rowToAgent(row) : undefined;
  }

  list(): readonly Agent[] {
    return (this.#selectAll.all() as unknown as AgentRow[]).map(rowToAgent);
  }

  rotateToken(handle: string): Agent | undefined {
    const existing = this.#selectByHandle.get(handle) as AgentRow | undefined;
    if (!existing) return undefined;
    const token = generateToken();
    this.#updateToken.run(token, handle);
    return rowToAgent({ ...existing, token });
  }

  setPolicy(handle: string, policy: Policy): Agent | undefined {
    const existing = this.#selectByHandle.get(handle) as AgentRow | undefined;
    if (!existing) return undefined;
    this.#updatePolicy.run(policy, handle);
    return rowToAgent({ ...existing, policy });
  }

  addToAllowlist(handle: string, entries: readonly string[]): Agent | undefined {
    const existing = this.#selectByHandle.get(handle) as AgentRow | undefined;
    if (!existing) return undefined;
    const current: string[] = JSON.parse(existing.allowlist) as string[];
    const set = new Set(current);
    const next = [...current, ...entries.filter((e) => !set.has(e))];
    const nextJson = JSON.stringify(next);
    this.#updateAllowlist.run(nextJson, handle);
    return rowToAgent({ ...existing, allowlist: nextJson });
  }

  removeFromAllowlist(handle: string, entry: string): Agent | undefined {
    const existing = this.#selectByHandle.get(handle) as AgentRow | undefined;
    if (!existing) return undefined;
    const current: string[] = JSON.parse(existing.allowlist) as string[];
    const next = current.filter((e) => e !== entry);
    const nextJson = JSON.stringify(next);
    this.#updateAllowlist.run(nextJson, handle);
    return rowToAgent({ ...existing, allowlist: nextJson });
  }
}

function rowToAgent(row: AgentRow): Agent {
  return {
    handle: row.handle,
    token: row.token,
    policy: row.policy as Policy,
    allowlist: JSON.parse(row.allowlist) as string[],
  };
}

function generateToken(): string {
  return randomBytes(32).toString("base64url");
}
