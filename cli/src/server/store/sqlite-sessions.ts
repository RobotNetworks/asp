import type { DatabaseSync, StatementSync } from "node:sqlite";

import { generateEventId, generateMessageId, generateSessionId } from "../ids.js";
import {
  SessionError,
  type Content,
  type CreateSessionOpts,
  type CreateSessionResult,
  type EventObserver,
  type GetEventsOpts,
  type InviteResult,
  type Metadata,
  type ReopenSessionOpts,
  type SendResult,
  type Session,
  type SessionStore,
  type StoredEvent,
} from "./sessions.js";

// ── Row shapes ────────────────────────────────────────────────────────────────

interface SessionRow {
  readonly id: string;
  readonly state: string;
  readonly topic: string | null;
  readonly created_at: number;
  readonly ended_at: number | null;
  readonly next_sequence: number;
}

interface ParticipantRow {
  readonly session_id: string;
  readonly handle: string;
  readonly status: string;
  readonly has_joined: number;
  readonly joined_at: number | null;
  readonly left_at: number | null;
  readonly left_sequence: number | null;
}

interface EventRow {
  readonly event_id: string;
  readonly session_id: string;
  readonly sequence: number;
  readonly type: string;
  readonly payload: string;
  readonly created_at: number;
}

// ── SqliteSessionStore ────────────────────────────────────────────────────────

/**
 * SQLite-backed implementation of SessionStore.
 *
 * All writes are synchronous (node:sqlite). The EventObserver mechanism
 * (for the WebSocket hub) is called after each INSERT into session_events so
 * connected clients receive events in real-time even from the durable store.
 */
export class SqliteSessionStore implements SessionStore {
  readonly #db: DatabaseSync;
  readonly #observers = new Set<EventObserver>();

  // Prepared statements
  readonly #insertSession: StatementSync;
  readonly #updateSessionState: StatementSync;
  readonly #updateSessionSeq: StatementSync;
  readonly #selectSession: StatementSync;
  readonly #insertParticipant: StatementSync;
  readonly #selectParticipant: StatementSync;
  readonly #selectParticipants: StatementSync;
  readonly #updateParticipantStatus: StatementSync;
  readonly #insertEvent: StatementSync;
  readonly #selectEvents: StatementSync;
  readonly #selectEventByIdempotencyKey: StatementSync;
  readonly #selectSessionsByParticipant: StatementSync;

  constructor(db: DatabaseSync) {
    this.#db = db;

    this.#insertSession = db.prepare(
      "INSERT INTO sessions (id, state, topic, created_at, next_sequence) VALUES (?, 'active', ?, ?, 0)",
    );
    this.#updateSessionState = db.prepare(
      "UPDATE sessions SET state = ?, ended_at = ? WHERE id = ?",
    );
    this.#updateSessionSeq = db.prepare(
      "UPDATE sessions SET next_sequence = ? WHERE id = ?",
    );
    this.#selectSession = db.prepare("SELECT * FROM sessions WHERE id = ?");

    this.#insertParticipant = db.prepare(
      "INSERT OR IGNORE INTO participants (session_id, handle, status, has_joined, joined_at) " +
        "VALUES (?, ?, ?, ?, ?)",
    );
    this.#selectParticipant = db.prepare(
      "SELECT * FROM participants WHERE session_id = ? AND handle = ?",
    );
    this.#selectParticipants = db.prepare(
      "SELECT * FROM participants WHERE session_id = ?",
    );
    this.#updateParticipantStatus = db.prepare(
      "UPDATE participants SET status = ?, has_joined = ?, joined_at = ?, left_at = ?, left_sequence = ? " +
        "WHERE session_id = ? AND handle = ?",
    );

    this.#insertEvent = db.prepare(
      "INSERT INTO session_events (event_id, session_id, sequence, type, payload, created_at) " +
        "VALUES (?, ?, ?, ?, ?, ?)",
    );
    this.#selectEvents = db.prepare(
      "SELECT * FROM session_events WHERE session_id = ? ORDER BY sequence",
    );
    this.#selectEventByIdempotencyKey = db.prepare(
      "SELECT * FROM session_events WHERE session_id = ? AND type = 'session.message' " +
        "AND json_extract(payload, '$.idempotency_key') = ? LIMIT 1",
    );
    this.#selectSessionsByParticipant = db.prepare(
      "SELECT s.* FROM sessions s " +
        "JOIN participants p ON p.session_id = s.id " +
        "WHERE p.handle = ? ORDER BY s.created_at",
    );
  }

  subscribe(observer: EventObserver): () => void {
    this.#observers.add(observer);
    return () => this.#observers.delete(observer);
  }

  create(opts: CreateSessionOpts): CreateSessionResult {
    const now = Date.now();
    const id = generateSessionId();

    this.#db.exec("BEGIN");
    try {
      this.#insertSession.run(id, opts.topic ?? null, now);
      // Creator joins immediately
      this.#insertParticipant.run(id, opts.creator, "joined", 1, now);

      // Invite others
      for (const handle of opts.invitees ?? []) {
        this.#insertParticipant.run(id, handle, "invited", 0, null);
        this.#pushEvent(id, "session.invited", {
          invitee: handle,
          by: opts.creator,
          ...(opts.topic !== undefined ? { topic: opts.topic } : {}),
          ...(opts.initialMessage !== undefined ? { initial_message: opts.initialMessage } : {}),
        });
      }

      let messageSequence: number | undefined;
      if (opts.initialMessage !== undefined) {
        const msgId = generateMessageId();
        messageSequence = this.#nextSequence(id);
        this.#pushEvent(id, "session.message", {
          id: msgId,
          session_id: id,
          sender: opts.creator,
          sequence: messageSequence,
          content: opts.initialMessage.content,
          created_at: now,
          ...(opts.initialMessage.metadata !== undefined
            ? { metadata: opts.initialMessage.metadata }
            : {}),
        });
      }

      if (opts.endAfterSend === true) {
        this.#updateSessionState.run("ended", now, id);
        this.#pushEvent(id, "session.ended", { ended_by: opts.creator });
      }

      this.#db.exec("COMMIT");
      const session = this.#loadSession(id)!;
      return {
        session,
        ...(messageSequence !== undefined ? { messageSequence } : {}),
      };
    } catch (err) {
      this.#db.exec("ROLLBACK");
      throw err;
    }
  }

  join(sessionId: string, joiner: string): Session {
    const sess = this.#requireSession(sessionId);
    if (sess.state === "ended") {
      throw new SessionError("session_ended", `session ${sessionId} is ended`);
    }
    const p = this.#selectParticipant.get(sessionId, joiner) as ParticipantRow | undefined;
    if (!p) {
      throw new SessionError("not_invited", `${joiner} is not invited to ${sessionId}`);
    }
    if (p.status === "joined") {
      throw new SessionError("already_joined", `${joiner} has already joined ${sessionId}`);
    }
    if (p.status === "left") {
      throw new SessionError("not_invited", `${joiner} has already left ${sessionId}`);
    }
    const now = Date.now();
    this.#updateParticipantStatus.run("joined", 1, now, null, null, sessionId, joiner);
    this.#pushEvent(sessionId, "session.joined", { agent: joiner });
    return this.#loadSession(sessionId)!;
  }

  invite(sessionId: string, inviter: string, invitees: readonly string[]): InviteResult {
    const sess = this.#requireSession(sessionId);
    if (sess.state === "ended") {
      throw new SessionError("session_ended", `session ${sessionId} is ended`);
    }
    const inviterP = this.#selectParticipant.get(sessionId, inviter) as ParticipantRow | undefined;
    if (!inviterP || inviterP.status !== "joined") {
      throw new SessionError("not_joined", `${inviter} must be joined to invite others`);
    }
    const actuallyInvited: string[] = [];
    for (const handle of invitees) {
      const existing = this.#selectParticipant.get(sessionId, handle) as ParticipantRow | undefined;
      if (existing) continue;
      this.#insertParticipant.run(sessionId, handle, "invited", 0, null);
      this.#pushEvent(sessionId, "session.invited", { invitee: handle, by: inviter });
      actuallyInvited.push(handle);
    }
    return { session: this.#loadSession(sessionId)!, invited: actuallyInvited };
  }

  send(
    sessionId: string,
    sender: string,
    content: Content,
    opts: { idempotencyKey?: string; metadata?: Metadata } = {},
  ): SendResult {
    const sess = this.#requireSession(sessionId);
    if (sess.state === "ended") {
      throw new SessionError("session_ended", `session ${sessionId} is ended`);
    }
    const p = this.#selectParticipant.get(sessionId, sender) as ParticipantRow | undefined;
    if (!p || p.status !== "joined") {
      throw new SessionError("not_joined", `${sender} must be joined to send messages`);
    }
    // Idempotency: return existing result if the key was already used in this session
    if (opts.idempotencyKey !== undefined) {
      const existing = this.#selectEventByIdempotencyKey.get(sessionId, opts.idempotencyKey) as EventRow | undefined;
      if (existing) {
        const existingPayload = JSON.parse(existing.payload) as Record<string, unknown>;
        return { session: this.#loadSession(sessionId)!, messageId: existingPayload["id"] as string, sequence: existing.sequence };
      }
    }
    const now = Date.now();
    const msgId = generateMessageId();
    // Peek at current sequence so the payload and event sequence stay consistent
    const sequence = sess.next_sequence;
    this.#pushEvent(sessionId, "session.message", {
      id: msgId,
      session_id: sessionId,
      sender,
      sequence,
      content,
      created_at: now,
      ...(opts.idempotencyKey !== undefined ? { idempotency_key: opts.idempotencyKey } : {}),
      ...(opts.metadata !== undefined ? { metadata: opts.metadata } : {}),
    });
    return { session: this.#loadSession(sessionId)!, messageId: msgId, sequence };
  }

  leave(sessionId: string, leaver: string): Session {
    const p = this.#selectParticipant.get(sessionId, leaver) as ParticipantRow | undefined;
    if (!p || p.status !== "joined") {
      throw new SessionError("not_joined", `${leaver} must be joined to leave`);
    }
    const now = Date.now();
    const leftSequence = this.#nextSequence(sessionId);
    this.#updateParticipantStatus.run("left", 1, p.joined_at ?? null, now, leftSequence, sessionId, leaver);
    this.#pushEvent(sessionId, "session.left", { agent: leaver, reason: "left" });
    return this.#loadSession(sessionId)!;
  }

  end(sessionId: string, ender: string): Session {
    const sess = this.#requireSession(sessionId);
    if (sess.state === "ended") {
      throw new SessionError("session_ended", `session ${sessionId} is already ended`);
    }
    const p = this.#selectParticipant.get(sessionId, ender) as ParticipantRow | undefined;
    if (!p || p.status !== "joined") {
      throw new SessionError("not_joined", `${ender} must be joined to end the session`);
    }
    const now = Date.now();
    this.#updateSessionState.run("ended", now, sessionId);
    this.#pushEvent(sessionId, "session.ended", { ended_by: ender });
    return this.#loadSession(sessionId)!;
  }

  reopen(sessionId: string, reopener: string, opts: ReopenSessionOpts = {}): Session {
    const sess = this.#requireSession(sessionId);
    if (sess.state === "active") {
      throw new SessionError("session_active", `session ${sessionId} is already active`);
    }
    const p = this.#selectParticipant.get(sessionId, reopener) as ParticipantRow | undefined;
    if (!p || !p.has_joined) {
      throw new SessionError(
        "not_participant",
        `${reopener} was never a joined participant of ${sessionId}`,
      );
    }
    const now = Date.now();
    this.#updateSessionState.run("active", null, sessionId);
    this.#pushEvent(sessionId, "session.reopened", { reopened_by: reopener });

    // Re-invite all except reopener; reopener rejoins
    const participants = this.#selectParticipants.all(sessionId) as unknown as ParticipantRow[];
    for (const part of participants) {
      if (part.handle === reopener) {
        this.#updateParticipantStatus.run("joined", 1, now, null, null, sessionId, reopener);
      } else {
        this.#updateParticipantStatus.run("invited", part.has_joined, null, null, null, sessionId, part.handle);
        this.#pushEvent(sessionId, "session.invited", {
          invitee: part.handle,
          by: reopener,
        });
      }
    }

    for (const handle of opts.invitees ?? []) {
      const existing = this.#selectParticipant.get(sessionId, handle) as ParticipantRow | undefined;
      if (!existing) {
        this.#insertParticipant.run(sessionId, handle, "invited", 0, null);
        this.#pushEvent(sessionId, "session.invited", { invitee: handle, by: reopener });
      }
    }

    if (opts.initialMessage !== undefined) {
      const msgId = generateMessageId();
      const sequence = this.#nextSequence(sessionId);
      this.#pushEvent(sessionId, "session.message", {
        id: msgId,
        session_id: sessionId,
        sender: reopener,
        sequence,
        content: opts.initialMessage.content,
        created_at: now,
        ...(opts.initialMessage.metadata !== undefined
          ? { metadata: opts.initialMessage.metadata }
          : {}),
      });
    }

    return this.#loadSession(sessionId)!;
  }

  get(sessionId: string): Session | undefined {
    return this.#loadSession(sessionId);
  }

  getEvents(sessionId: string, viewer: string, opts: GetEventsOpts = {}): StoredEvent[] | null {
    if (!this.#selectSession.get(sessionId)) return null;
    const p = this.#selectParticipant.get(sessionId, viewer) as ParticipantRow | undefined;
    if (!p) return null;

    let events = (this.#selectEvents.all(sessionId) as unknown as EventRow[]).map(rowToEvent);

    if (p.status === "invited") {
      events = events.filter(
        (e) =>
          (e.type === "session.invited" &&
            (e.payload["invitee"] as string) === viewer) ||
          e.type === "session.ended",
      );
    } else if (p.status === "left") {
      const cap = p.left_sequence ?? 0;
      events = events.filter((e) => e.sequence <= cap);
    }

    if (opts.afterSequence !== undefined) {
      events = events.filter((e) => e.sequence > opts.afterSequence!);
    }
    const take = opts.limit;
    if (take !== undefined && take > 0) {
      events = events.slice(0, take);
    }
    return events;
  }

  list(viewer: string): readonly Session[] {
    const rows = this.#selectSessionsByParticipant.all(viewer) as unknown as SessionRow[];
    return rows.map((row) => {
      const parts = this.#selectParticipants.all(row.id) as unknown as ParticipantRow[];
      return rowToSession(row, parts);
    });
  }

  // ── private ────────────────────────────────────────────────────────────────

  #requireSession(sessionId: string): SessionRow {
    const row = this.#selectSession.get(sessionId) as SessionRow | undefined;
    if (!row) throw new SessionError("not_found", `session ${sessionId} not found`);
    return row;
  }

  #nextSequence(sessionId: string): number {
    const row = this.#selectSession.get(sessionId) as SessionRow | undefined;
    const seq = row?.next_sequence ?? 0;
    this.#updateSessionSeq.run(seq + 1, sessionId);
    return seq;
  }

  #pushEvent(
    sessionId: string,
    type: string,
    payload: Record<string, unknown>,
  ): StoredEvent {
    const event: StoredEvent = {
      event_id: generateEventId(),
      session_id: sessionId,
      sequence: this.#nextSequence(sessionId),
      type,
      payload,
      created_at: Date.now(),
    };
    this.#insertEvent.run(
      event.event_id,
      event.session_id,
      event.sequence,
      event.type,
      JSON.stringify(event.payload),
      event.created_at,
    );

    if (this.#observers.size > 0) {
      const participants = this.#selectParticipants.all(sessionId) as unknown as ParticipantRow[];
      const recipients = liveRecipients(participants, event);
      if (recipients.length > 0) {
        for (const obs of this.#observers) obs(event, recipients);
      }
    }

    return event;
  }

  #loadSession(sessionId: string): Session | undefined {
    const row = this.#selectSession.get(sessionId) as SessionRow | undefined;
    if (!row) return undefined;
    const parts = this.#selectParticipants.all(sessionId) as unknown as ParticipantRow[];
    return rowToSession(row, parts);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function rowToSession(row: SessionRow, parts: ParticipantRow[]): Session {
  return {
    id: row.id,
    state: row.state as "active" | "ended",
    participants: parts.map((p) => ({
      handle: p.handle,
      status: p.status as "invited" | "joined" | "left",
      ...(p.joined_at !== null ? { joined_at: p.joined_at } : {}),
      ...(p.left_at !== null ? { left_at: p.left_at } : {}),
    })),
    created_at: row.created_at,
    ...(row.topic !== null ? { topic: row.topic } : {}),
    ...(row.ended_at !== null ? { ended_at: row.ended_at } : {}),
  };
}

function rowToEvent(row: EventRow): StoredEvent {
  return {
    event_id: row.event_id,
    session_id: row.session_id,
    sequence: row.sequence,
    type: row.type,
    payload: JSON.parse(row.payload) as Record<string, unknown>,
    created_at: row.created_at,
  };
}

function liveRecipients(parts: ParticipantRow[], event: StoredEvent): string[] {
  const recipients: string[] = [];
  for (const p of parts) {
    if (p.status === "joined") {
      recipients.push(p.handle);
    } else if (p.status === "invited") {
      if (
        event.type === "session.ended" ||
        (event.type === "session.invited" &&
          (event.payload["invitee"] as string) === p.handle)
      ) {
        recipients.push(p.handle);
      }
    }
  }
  return recipients;
}
