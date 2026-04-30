import { randomBytes } from "node:crypto";

export type ContactRequestStatus = "pending" | "accepted" | "declined";

export interface ContactRequest {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly message?: string;
  readonly status: ContactRequestStatus;
  readonly created_at: number;
  readonly resolved_at?: number;
}

export class ContactError extends Error {
  readonly code: ContactErrorCode;
  constructor(code: ContactErrorCode) {
    super(code);
    this.name = "ContactError";
    this.code = code;
  }
}

type ContactErrorCode = "not_found" | "not_pending" | "not_recipient";

/**
 * In-memory store for contact requests. Handles the §6.2 handshake flow:
 * send → accept/decline, with atomic bilateral allowlist update on accept.
 */
export interface ContactStore {
  /** Create a new pending contact request from one agent to another. */
  create(from: string, to: string, message?: string): ContactRequest;
  /** Look up a request by id. Returns undefined if absent. */
  get(requestId: string): ContactRequest | undefined;
  /**
   * Accept a contact request. The caller must be the `to` agent.
   * Throws ContactError("not_found") | ("not_pending") | ("not_recipient").
   */
  accept(requestId: string, callerHandle: string): ContactRequest;
  /**
   * Decline a contact request. The caller must be the `to` agent.
   * Throws ContactError("not_found") | ("not_pending") | ("not_recipient").
   */
  decline(requestId: string, callerHandle: string): ContactRequest;
  /**
   * List all contact requests where the agent is the sender or recipient.
   */
  listForAgent(handle: string): ContactRequest[];
}

type MutableContactRequest = {
  -readonly [K in keyof ContactRequest]: ContactRequest[K];
};

export class InMemoryContactStore implements ContactStore {
  readonly #byId = new Map<string, MutableContactRequest>();

  create(from: string, to: string, message?: string): ContactRequest {
    const req: MutableContactRequest = {
      id: generateRequestId(),
      from,
      to,
      status: "pending",
      created_at: Date.now(),
    };
    if (message !== undefined) req.message = message;
    this.#byId.set(req.id, req);
    return snapshot(req);
  }

  get(requestId: string): ContactRequest | undefined {
    const req = this.#byId.get(requestId);
    return req === undefined ? undefined : snapshot(req);
  }

  accept(requestId: string, callerHandle: string): ContactRequest {
    const req = this.#require(requestId, callerHandle);
    req.status = "accepted";
    req.resolved_at = Date.now();
    return snapshot(req);
  }

  decline(requestId: string, callerHandle: string): ContactRequest {
    const req = this.#require(requestId, callerHandle);
    req.status = "declined";
    req.resolved_at = Date.now();
    return snapshot(req);
  }

  listForAgent(handle: string): ContactRequest[] {
    return [...this.#byId.values()]
      .filter((r) => r.from === handle || r.to === handle)
      .map(snapshot);
  }

  #require(requestId: string, callerHandle: string): MutableContactRequest {
    const req = this.#byId.get(requestId);
    if (!req) throw new ContactError("not_found");
    if (req.to !== callerHandle) throw new ContactError("not_recipient");
    if (req.status !== "pending") throw new ContactError("not_pending");
    return req;
  }
}

function snapshot(req: MutableContactRequest): ContactRequest {
  return Object.freeze({ ...req });
}

function generateRequestId(): string {
  return `cr_${randomBytes(12).toString("base64url")}`;
}
