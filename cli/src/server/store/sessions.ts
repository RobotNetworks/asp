import { generateEventId, generateMessageId, generateSessionId } from "../ids.js";

export type SessionState = "active" | "ended";
export type ParticipantStatus = "invited" | "joined" | "left";

/** Content per ASP spec common.json — string shorthand or typed parts array. */
export type Content = string | ContentPart[];
export type ContentPart = Readonly<Record<string, unknown>> & { readonly type: string };

export interface Metadata {
  readonly [key: string]: unknown;
}

export interface Message {
  readonly id: string;
  readonly session_id: string;
  readonly sender: string;
  readonly sequence: number;
  readonly content: Content;
  readonly created_at: number;
  readonly idempotency_key?: string;
  readonly metadata?: Metadata;
}

export interface Participant {
  readonly handle: string;
  readonly status: ParticipantStatus;
  readonly joined_at?: number;
  readonly left_at?: number;
}

export interface Session {
  readonly id: string;
  readonly state: SessionState;
  readonly topic?: string;
  readonly participants: readonly Participant[];
  readonly created_at: number;
  readonly ended_at?: number;
}

export interface StoredEvent {
  readonly event_id: string;
  readonly session_id: string;
  readonly sequence: number;
  readonly type: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly created_at: number;
}

export class SessionError extends Error {
  readonly code:
    | "not_found"
    | "not_participant"
    | "not_invited"
    | "not_joined"
    | "already_joined"
    | "session_ended"
    | "session_active";

  constructor(
    code: SessionError["code"],
    message: string,
  ) {
    super(message);
    this.name = "SessionError";
    this.code = code;
  }
}

export interface CreateSessionOpts {
  readonly creator: string;
  readonly invitees?: readonly string[];
  readonly topic?: string;
  readonly initialMessage?: { content: Content; metadata?: Metadata };
  readonly endAfterSend?: boolean;
}

export interface CreateSessionResult {
  readonly session: Session;
  readonly messageSequence?: number;
}

export interface InviteResult {
  readonly session: Session;
  readonly invited: readonly string[];
}

export interface SendResult {
  readonly session: Session;
  readonly messageId: string;
  readonly sequence: number;
}

export interface ReopenSessionOpts {
  readonly invitees?: readonly string[];
  readonly initialMessage?: { content: Content; metadata?: Metadata };
}

export interface GetEventsOpts {
  readonly afterSequence?: number;
  readonly limit?: number;
}

export interface SessionStore {
  create(opts: CreateSessionOpts): CreateSessionResult;
  join(sessionId: string, joiner: string): Session;
  invite(sessionId: string, inviter: string, invitees: readonly string[]): InviteResult;
  send(sessionId: string, sender: string, content: Content, opts?: { idempotencyKey?: string; metadata?: Metadata }): SendResult;
  leave(sessionId: string, leaver: string): Session;
  end(sessionId: string, ender: string): Session;
  reopen(sessionId: string, reopener: string, opts?: ReopenSessionOpts): Session;
  get(sessionId: string): Session | undefined;
  getEvents(sessionId: string, viewer: string, opts?: GetEventsOpts): StoredEvent[] | null;
  list(viewer: string): readonly Session[];
}

// ── Internal mutable representation ──────────────────────────────────────────

interface InternalParticipant {
  handle: string;
  status: ParticipantStatus;
  hasJoined: boolean;
  joinedAt?: number;
  leftAt?: number;
  leftSequence?: number;
}

interface InternalSession {
  id: string;
  state: SessionState;
  topic?: string;
  participants: InternalParticipant[];
  createdAt: number;
  endedAt?: number;
  events: StoredEvent[];
  nextSequence: number;
}

// ── InMemorySessionStore ──────────────────────────────────────────────────────

export class InMemorySessionStore implements SessionStore {
  readonly #sessions = new Map<string, InternalSession>();

  create(opts: CreateSessionOpts): CreateSessionResult {
    const now = Date.now();
    const id = generateSessionId();
    const sess: InternalSession = {
      id,
      state: "active",
      participants: [],
      createdAt: now,
      events: [],
      nextSequence: 0,
      ...(opts.topic !== undefined ? { topic: opts.topic } : {}),
    };

    // Creator joins immediately
    sess.participants.push({
      handle: opts.creator,
      status: "joined",
      hasJoined: true,
      joinedAt: now,
    });

    // Emit session.invited for each invitee
    for (const handle of opts.invitees ?? []) {
      sess.participants.push({ handle, status: "invited", hasJoined: false });
      this.#pushEvent(sess, "session.invited", {
        invitee: handle,
        by: opts.creator,
        ...(opts.topic !== undefined ? { topic: opts.topic } : {}),
      });
    }

    let messageSequence: number | undefined;

    // Optional initial message
    if (opts.initialMessage !== undefined) {
      const msgId = generateMessageId();
      messageSequence = sess.nextSequence;
      const msg: Message = {
        id: msgId,
        session_id: id,
        sender: opts.creator,
        sequence: messageSequence,
        content: opts.initialMessage.content,
        created_at: now,
        ...(opts.initialMessage.metadata !== undefined
          ? { metadata: opts.initialMessage.metadata }
          : {}),
      };

      if (opts.invitees && opts.invitees.length > 0 && opts.endAfterSend) {
        // For end_after_send sessions, update the invited events to include initial_message
        // (re-emit with message payload — in a real impl we'd update the payload)
        // For simplicity: emit session.message normally, then session.ended
      }

      this.#pushEvent(sess, "session.message", msg as unknown as Record<string, unknown>);
    }

    // end_after_send: end the session immediately
    if (opts.endAfterSend === true) {
      sess.state = "ended";
      sess.endedAt = now;
      this.#pushEvent(sess, "session.ended", { ended_by: opts.creator });
    }

    this.#sessions.set(id, sess);
    return {
      session: snapshot(sess),
      ...(messageSequence !== undefined ? { messageSequence } : {}),
    };
  }

  join(sessionId: string, joiner: string): Session {
    const sess = this.#require(sessionId);
    if (sess.state === "ended") {
      throw new SessionError("session_ended", `session ${sessionId} is ended`);
    }
    const p = sess.participants.find((x) => x.handle === joiner);
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
    p.status = "joined";
    p.hasJoined = true;
    p.joinedAt = now;
    this.#pushEvent(sess, "session.joined", { agent: joiner });
    return snapshot(sess);
  }

  invite(sessionId: string, inviter: string, invitees: readonly string[]): InviteResult {
    const sess = this.#require(sessionId);
    if (sess.state === "ended") {
      throw new SessionError("session_ended", `session ${sessionId} is ended`);
    }
    const inviterP = sess.participants.find((p) => p.handle === inviter);
    if (!inviterP || inviterP.status !== "joined") {
      throw new SessionError("not_joined", `${inviter} must be joined to invite others`);
    }
    const actuallyInvited: string[] = [];
    for (const handle of invitees) {
      const existing = sess.participants.find((p) => p.handle === handle);
      if (existing) continue; // already a participant — skip silently
      sess.participants.push({ handle, status: "invited", hasJoined: false });
      this.#pushEvent(sess, "session.invited", { invitee: handle, by: inviter });
      actuallyInvited.push(handle);
    }
    return { session: snapshot(sess), invited: actuallyInvited };
  }

  send(
    sessionId: string,
    sender: string,
    content: Content,
    opts: { idempotencyKey?: string; metadata?: Metadata } = {},
  ): SendResult {
    const sess = this.#require(sessionId);
    if (sess.state === "ended") {
      throw new SessionError("session_ended", `session ${sessionId} is ended`);
    }
    const p = sess.participants.find((x) => x.handle === sender);
    if (!p || p.status !== "joined") {
      throw new SessionError("not_joined", `${sender} must be joined to send messages`);
    }
    const now = Date.now();
    const msgId = generateMessageId();
    const sequence = sess.nextSequence;
    const msg: Message = {
      id: msgId,
      session_id: sessionId,
      sender,
      sequence,
      content,
      created_at: now,
      ...(opts.idempotencyKey !== undefined ? { idempotency_key: opts.idempotencyKey } : {}),
      ...(opts.metadata !== undefined ? { metadata: opts.metadata } : {}),
    };
    this.#pushEvent(sess, "session.message", msg as unknown as Record<string, unknown>);
    return { session: snapshot(sess), messageId: msgId, sequence };
  }

  leave(sessionId: string, leaver: string): Session {
    const sess = this.#require(sessionId);
    const p = sess.participants.find((x) => x.handle === leaver);
    if (!p || p.status !== "joined") {
      throw new SessionError("not_joined", `${leaver} must be joined to leave`);
    }
    const now = Date.now();
    const leftSequence = sess.nextSequence;
    p.status = "left";
    p.leftAt = now;
    p.leftSequence = leftSequence;
    this.#pushEvent(sess, "session.left", { agent: leaver, reason: "left" });
    return snapshot(sess);
  }

  end(sessionId: string, ender: string): Session {
    const sess = this.#require(sessionId);
    if (sess.state === "ended") {
      throw new SessionError("session_ended", `session ${sessionId} is already ended`);
    }
    const p = sess.participants.find((x) => x.handle === ender);
    if (!p || p.status !== "joined") {
      throw new SessionError("not_joined", `${ender} must be joined to end the session`);
    }
    const now = Date.now();
    sess.state = "ended";
    sess.endedAt = now;
    this.#pushEvent(sess, "session.ended", { ended_by: ender });
    return snapshot(sess);
  }

  reopen(sessionId: string, reopener: string, opts: ReopenSessionOpts = {}): Session {
    const sess = this.#require(sessionId);
    if (sess.state === "active") {
      throw new SessionError("session_active", `session ${sessionId} is already active`);
    }
    const p = sess.participants.find((x) => x.handle === reopener);
    if (!p || !p.hasJoined) {
      throw new SessionError(
        "not_participant",
        `${reopener} was never a joined participant of ${sessionId}`,
      );
    }
    const now = Date.now();
    sess.state = "active";
    delete sess.endedAt;
    this.#pushEvent(sess, "session.reopened", { reopened_by: reopener });

    // Re-invite all participants; reopener joins immediately
    for (const participant of sess.participants) {
      if (participant.handle === reopener) {
        participant.status = "joined";
        participant.hasJoined = true;
        participant.joinedAt = now;
        delete participant.leftAt;
        delete participant.leftSequence;
      } else {
        participant.status = "invited";
        delete participant.joinedAt;
        delete participant.leftAt;
        delete participant.leftSequence;
        this.#pushEvent(sess, "session.invited", {
          invitee: participant.handle,
          by: reopener,
        });
      }
    }

    // Optional new invitees from reopen
    for (const handle of opts.invitees ?? []) {
      const existing = sess.participants.find((x) => x.handle === handle);
      if (!existing) {
        sess.participants.push({ handle, status: "invited", hasJoined: false });
        this.#pushEvent(sess, "session.invited", { invitee: handle, by: reopener });
      }
    }

    if (opts.initialMessage !== undefined) {
      const msgId = generateMessageId();
      const sequence = sess.nextSequence;
      const msg: Message = {
        id: msgId,
        session_id: sessionId,
        sender: reopener,
        sequence,
        content: opts.initialMessage.content,
        created_at: now,
        ...(opts.initialMessage.metadata !== undefined
          ? { metadata: opts.initialMessage.metadata }
          : {}),
      };
      this.#pushEvent(sess, "session.message", msg as unknown as Record<string, unknown>);
    }

    return snapshot(sess);
  }

  get(sessionId: string): Session | undefined {
    const sess = this.#sessions.get(sessionId);
    return sess ? snapshot(sess) : undefined;
  }

  getEvents(sessionId: string, viewer: string, opts: GetEventsOpts = {}): StoredEvent[] | null {
    const sess = this.#sessions.get(sessionId);
    if (!sess) return null;

    const p = sess.participants.find((x) => x.handle === viewer);
    if (!p) return null; // not a participant

    let events = sess.events;

    // Visibility filter by participant status
    if (p.status === "invited") {
      // Only session.invited (own) and session.ended
      events = events.filter(
        (e) =>
          (e.type === "session.invited" &&
            (e.payload["invitee"] as string) === viewer) ||
          e.type === "session.ended",
      );
    } else if (p.status === "left") {
      // Events up to and including the sequence at which they left
      const cap = p.leftSequence ?? 0;
      events = events.filter((e) => e.sequence <= cap);
    }
    // joined: all events

    // after_sequence cursor
    if (opts.afterSequence !== undefined) {
      events = events.filter((e) => e.sequence > opts.afterSequence!);
    }

    // limit
    const take = opts.limit;
    if (take !== undefined && take > 0) {
      events = events.slice(0, take);
    }

    return events;
  }

  list(viewer: string): readonly Session[] {
    return [...this.#sessions.values()]
      .filter((s) => s.participants.some((p) => p.handle === viewer))
      .map(snapshot)
      .sort((a, b) => a.created_at - b.created_at);
  }

  // ── private ──────────────────────────────────────────────────────────────

  #require(sessionId: string): InternalSession {
    const sess = this.#sessions.get(sessionId);
    if (!sess) throw new SessionError("not_found", `session ${sessionId} not found`);
    return sess;
  }

  #pushEvent(
    sess: InternalSession,
    type: string,
    payload: Record<string, unknown>,
  ): StoredEvent {
    const event: StoredEvent = {
      event_id: generateEventId(),
      session_id: sess.id,
      sequence: sess.nextSequence++,
      type,
      payload,
      created_at: Date.now(),
    };
    sess.events.push(event);
    return event;
  }
}

// ── Pure snapshot helper ──────────────────────────────────────────────────────

function snapshot(sess: InternalSession): Session {
  return {
    id: sess.id,
    state: sess.state,
    participants: sess.participants.map((p) => ({
      handle: p.handle,
      status: p.status,
      ...(p.joinedAt !== undefined ? { joined_at: p.joinedAt } : {}),
      ...(p.leftAt !== undefined ? { left_at: p.leftAt } : {}),
    })),
    created_at: sess.createdAt,
    ...(sess.topic !== undefined ? { topic: sess.topic } : {}),
    ...(sess.endedAt !== undefined ? { ended_at: sess.endedAt } : {}),
  };
}
