import { randomBytes } from "node:crypto";
import type { DatabaseSync, StatementSync } from "node:sqlite";

import {
  ContactError,
  type ContactRequest,
  type ContactStore,
  type ContactRequestStatus,
} from "./contacts.js";

interface ContactRow {
  readonly id: string;
  readonly from_handle: string;
  readonly to_handle: string;
  readonly message: string | null;
  readonly status: string;
  readonly created_at: number;
  readonly resolved_at: number | null;
}

/** SQLite-backed implementation of ContactStore. */
export class SqliteContactStore implements ContactStore {
  readonly #insert: StatementSync;
  readonly #selectById: StatementSync;
  readonly #listForAgent: StatementSync;
  readonly #updateStatus: StatementSync;

  constructor(db: DatabaseSync) {
    this.#insert = db.prepare(
      "INSERT INTO contacts (id, from_handle, to_handle, message, status, created_at) " +
        "VALUES (?, ?, ?, ?, 'pending', ?)",
    );
    this.#selectById = db.prepare("SELECT * FROM contacts WHERE id = ?");
    this.#listForAgent = db.prepare(
      "SELECT * FROM contacts WHERE from_handle = ? OR to_handle = ? ORDER BY created_at",
    );
    this.#updateStatus = db.prepare(
      "UPDATE contacts SET status = ?, resolved_at = ? WHERE id = ? AND status = 'pending'",
    );
  }

  create(from: string, to: string, message?: string): ContactRequest {
    const id = `cr_${randomBytes(12).toString("base64url")}`;
    const now = Date.now();
    this.#insert.run(id, from, to, message ?? null, now);
    const req: ContactRequest = {
      id,
      from,
      to,
      status: "pending",
      created_at: now,
      ...(message !== undefined ? { message } : {}),
    };
    return req;
  }

  get(requestId: string): ContactRequest | undefined {
    const row = this.#selectById.get(requestId) as ContactRow | undefined;
    return row ? rowToRequest(row) : undefined;
  }

  accept(requestId: string, callerHandle: string): ContactRequest {
    return this.#resolveRequest(requestId, callerHandle, "accepted");
  }

  decline(requestId: string, callerHandle: string): ContactRequest {
    return this.#resolveRequest(requestId, callerHandle, "declined");
  }

  listForAgent(handle: string): ContactRequest[] {
    return (this.#listForAgent.all(handle, handle) as unknown as ContactRow[]).map(rowToRequest);
  }

  #resolveRequest(
    requestId: string,
    callerHandle: string,
    status: "accepted" | "declined",
  ): ContactRequest {
    const row = this.#selectById.get(requestId) as ContactRow | undefined;
    if (!row) throw new ContactError("not_found");
    if (row.to_handle !== callerHandle) throw new ContactError("not_recipient");
    if (row.status !== "pending") throw new ContactError("not_pending");
    const now = Date.now();
    this.#updateStatus.run(status, now, requestId);
    return rowToRequest({ ...row, status, resolved_at: now });
  }
}

function rowToRequest(row: ContactRow): ContactRequest {
  return {
    id: row.id,
    from: row.from_handle,
    to: row.to_handle,
    status: row.status as ContactRequestStatus,
    created_at: row.created_at,
    ...(row.message !== null ? { message: row.message } : {}),
    ...(row.resolved_at !== null ? { resolved_at: row.resolved_at } : {}),
  };
}
