import { Hono } from "hono";

import type { AgentStore } from "../store/agents.js";
import {
  InMemorySessionStore,
  SessionError,
  type Content,
  type GetEventsOpts,
  type Metadata,
  type Session,
  type SessionStore,
  type StoredEvent,
} from "../store/sessions.js";
import { makeAgentAuth, type Agent, type AgentEnv } from "./auth.js";

/**
 * Build the session protocol routes.
 *
 * Mounted by buildApp at `/sessions`. Every route requires agent bearer-token
 * auth. Access-control errors (not_participant, not_invited) map to 404 per
 * the ASP non-enumeration principle (§6.2): an agent should not be able to
 * learn about sessions it's not part of.
 */
export function buildSessionRoutes(
  agentStore: AgentStore,
  sessionStore: SessionStore,
): Hono<AgentEnv> {
  const app = new Hono<AgentEnv>();
  const auth = makeAgentAuth(agentStore);
  app.use("*", auth);

  // ── POST / — create session ───────────────────────────────────────────────

  app.post("/", async (c) => {
    const agent = c.get("agent") as Agent;
    const body = await readJson(c);
    if (body === undefined) return c.json({ error: "invalid_json" }, 400);
    const parsed = parseCreateRequest(body);
    if ("error" in parsed) return c.json({ error: parsed.error }, 400);

    // Filter invitees by policy (non-enumeration: silently omit rejects).
    // If invitees were explicitly listed but every one gets filtered out, the
    // request fails with 404 — silently succeeding would let the operator mask
    // any failed contact attempt as a zero-invite session, breaking the
    // non-enumeration property (Whitepaper §6.2, Appendix A #8).
    const requestedInvitees = parsed.invite ?? [];
    const filteredInvitees: string[] = [];
    for (const handle of requestedInvitees) {
      const invitee = agentStore.get(handle);
      if (!invitee) continue;
      if (canInvite(agent.handle, invitee)) filteredInvitees.push(handle);
    }
    if (requestedInvitees.length > 0 && filteredInvitees.length === 0) {
      return c.json({ error: "not_found" }, 404);
    }

    const result = sessionStore.create({
      creator: agent.handle,
      invitees: filteredInvitees,
      ...(parsed.topic !== undefined ? { topic: parsed.topic } : {}),
      ...(parsed.initial_message !== undefined
        ? { initialMessage: parsed.initial_message }
        : {}),
      ...(parsed.end_after_send === true ? { endAfterSend: true } : {}),
    });

    return c.json({
      session_id: result.session.id,
      ...(result.messageSequence !== undefined
        ? { sequence: result.messageSequence }
        : {}),
    });
  });

  // ── GET / — list sessions for the calling agent ───────────────────────────

  app.get("/", (c) => {
    const agent = c.get("agent") as Agent;
    const sessions = sessionStore.list(agent.handle);
    return c.json({ sessions: sessions.map(serializeSession) });
  });

  // ── GET /:id — show session ───────────────────────────────────────────────

  app.get("/:id", (c) => {
    const agent = c.get("agent") as Agent;
    const session = sessionStore.get(c.req.param("id"));
    if (!session || !isParticipant(session, agent.handle)) {
      return c.json({ error: "not_found" }, 404);
    }
    return c.json(serializeSession(session));
  });

  // ── POST /:id/join ────────────────────────────────────────────────────────

  app.post("/:id/join", (c) => {
    const agent = c.get("agent") as Agent;
    try {
      sessionStore.join(c.req.param("id"), agent.handle);
    } catch (err) {
      return mapSessionError(c, err);
    }
    return c.json({ ok: true });
  });

  // ── POST /:id/invite ──────────────────────────────────────────────────────

  app.post("/:id/invite", async (c) => {
    const agent = c.get("agent") as Agent;
    const sessionId = c.req.param("id");
    const body = await readJson(c);
    if (body === undefined) return c.json({ error: "invalid_json" }, 400);
    const parsed = parseInviteRequest(body);
    if ("error" in parsed) return c.json({ error: parsed.error }, 400);

    // Policy filter — silently omit handles that reject the invitation
    const session = sessionStore.get(sessionId);
    if (!session || !isParticipant(session, agent.handle)) {
      return c.json({ error: "not_found" }, 404);
    }
    const filtered: string[] = [];
    for (const handle of parsed.invite) {
      const invitee = agentStore.get(handle);
      if (!invitee) continue;
      if (canInvite(agent.handle, invitee)) filtered.push(handle);
    }

    let result: { invited: readonly string[] };
    try {
      result = sessionStore.invite(sessionId, agent.handle, filtered);
    } catch (err) {
      return mapSessionError(c, err);
    }
    return c.json({ invited: [...result.invited] });
  });

  // ── POST /:id/messages ────────────────────────────────────────────────────

  app.post("/:id/messages", async (c) => {
    const agent = c.get("agent") as Agent;
    const body = await readJson(c);
    if (body === undefined) return c.json({ error: "invalid_json" }, 400);
    const parsed = parseMessageRequest(body);
    if ("error" in parsed) return c.json({ error: parsed.error }, 400);

    let result: { messageId: string; sequence: number };
    try {
      result = sessionStore.send(c.req.param("id"), agent.handle, parsed.content, {
        ...(parsed.idempotency_key !== undefined
          ? { idempotencyKey: parsed.idempotency_key }
          : {}),
        ...(parsed.metadata !== undefined ? { metadata: parsed.metadata } : {}),
      });
    } catch (err) {
      return mapSessionError(c, err);
    }
    return c.json({ message_id: result.messageId, sequence: result.sequence });
  });

  // ── POST /:id/leave ───────────────────────────────────────────────────────

  app.post("/:id/leave", (c) => {
    const agent = c.get("agent") as Agent;
    try {
      sessionStore.leave(c.req.param("id"), agent.handle);
    } catch (err) {
      return mapSessionError(c, err);
    }
    return c.json({ ok: true });
  });

  // ── POST /:id/end ─────────────────────────────────────────────────────────

  app.post("/:id/end", (c) => {
    const agent = c.get("agent") as Agent;
    try {
      sessionStore.end(c.req.param("id"), agent.handle);
    } catch (err) {
      return mapSessionError(c, err);
    }
    return c.json({ ok: true });
  });

  // ── POST /:id/reopen ──────────────────────────────────────────────────────

  app.post("/:id/reopen", async (c) => {
    const agent = c.get("agent") as Agent;
    const body = await readJson(c);
    if (body === undefined) return c.json({ error: "invalid_json" }, 400);

    // Body is optional/empty — allow missing or null
    const parsed =
      body === null || (isPlainObject(body) && Object.keys(body).length === 0)
        ? {}
        : parseReopenRequest(body);
    if ("error" in parsed) return c.json({ error: parsed.error }, 400);

    try {
      sessionStore.reopen(c.req.param("id"), agent.handle, {
        ...("invite" in parsed && parsed.invite !== undefined
          ? { invitees: parsed.invite }
          : {}),
        ...("initial_message" in parsed && parsed.initial_message !== undefined
          ? { initialMessage: parsed.initial_message }
          : {}),
      });
    } catch (err) {
      return mapSessionError(c, err);
    }
    return c.json({ ok: true });
  });

  // ── GET /:id/events ───────────────────────────────────────────────────────

  app.get("/:id/events", (c) => {
    const agent = c.get("agent") as Agent;
    const sessionId = c.req.param("id");

    const afterRaw = c.req.query("after_sequence");
    const limitRaw = c.req.query("limit");
    let afterSequence: number | undefined;
    let limit: number | undefined;
    if (afterRaw !== undefined) {
      const n = Number(afterRaw);
      if (!Number.isInteger(n) || n < 0) {
        return c.json({ error: "invalid_after_sequence" }, 400);
      }
      afterSequence = n;
    }
    if (limitRaw !== undefined) {
      const n = Number(limitRaw);
      if (!Number.isInteger(n) || n < 1 || n > 1000) {
        return c.json({ error: "invalid_limit" }, 400);
      }
      limit = n;
    }
    const eventsOpts: GetEventsOpts = {
      ...(afterSequence !== undefined ? { afterSequence } : {}),
      ...(limit !== undefined ? { limit } : {}),
    };

    const events = sessionStore.getEvents(sessionId, agent.handle, eventsOpts);
    if (events === null) return c.json({ error: "not_found" }, 404);

    const hasMore =
      limit !== undefined && events.length === limit;
    const last = events[events.length - 1];
    return c.json({
      events: events.map(serializeEvent),
      ...(hasMore && last !== undefined
        ? { next_cursor: String(last.sequence) }
        : {}),
    });
  });

  return app;
}

// ── Serializers ───────────────────────────────────────────────────────────────

function serializeSession(s: Session): Record<string, unknown> {
  return {
    id: s.id,
    state: s.state,
    participants: s.participants.map((p) => ({
      handle: p.handle,
      status: p.status,
      ...(p.joined_at !== undefined ? { joined_at: p.joined_at } : {}),
      ...(p.left_at !== undefined ? { left_at: p.left_at } : {}),
    })),
    created_at: s.created_at,
    ...(s.topic !== undefined ? { topic: s.topic } : {}),
    ...(s.ended_at !== undefined ? { ended_at: s.ended_at } : {}),
  };
}

function serializeEvent(e: StoredEvent): Record<string, unknown> {
  return {
    type: e.type,
    session_id: e.session_id,
    event_id: e.event_id,
    sequence: e.sequence,
    created_at: e.created_at,
    payload: e.payload,
  };
}

// ── Parsers ───────────────────────────────────────────────────────────────────

interface CreateRequest {
  readonly invite?: readonly string[];
  readonly topic?: string;
  readonly initial_message?: { content: Content; metadata?: Metadata };
  readonly end_after_send?: boolean;
}

function parseCreateRequest(raw: unknown): CreateRequest | { error: string } {
  if (!isPlainObject(raw)) return { error: "invalid_body" };

  const invite = raw["invite"];
  if (invite !== undefined) {
    if (!Array.isArray(invite) || !invite.every((h) => typeof h === "string")) {
      return { error: "invalid_invite" };
    }
  }

  const topic = raw["topic"];
  if (topic !== undefined && typeof topic !== "string") {
    return { error: "invalid_topic" };
  }

  const initial_message = raw["initial_message"];
  if (initial_message !== undefined) {
    if (!isPlainObject(initial_message) || !isContent(initial_message["content"])) {
      return { error: "invalid_initial_message" };
    }
  }

  const end_after_send = raw["end_after_send"];
  if (end_after_send !== undefined && typeof end_after_send !== "boolean") {
    return { error: "invalid_end_after_send" };
  }
  if (end_after_send === true && initial_message === undefined) {
    return { error: "end_after_send_requires_initial_message" };
  }

  return {
    ...(invite !== undefined ? { invite: invite as string[] } : {}),
    ...(topic !== undefined ? { topic: topic as string } : {}),
    ...(initial_message !== undefined
      ? {
          initial_message: {
            content: (initial_message as Record<string, unknown>)["content"] as Content,
            ...(isPlainObject((initial_message as Record<string, unknown>)["metadata"])
              ? { metadata: (initial_message as Record<string, unknown>)["metadata"] as Metadata }
              : {}),
          },
        }
      : {}),
    ...(end_after_send !== undefined ? { end_after_send: end_after_send as boolean } : {}),
  };
}

interface InviteRequest {
  readonly invite: readonly string[];
}

function parseInviteRequest(raw: unknown): InviteRequest | { error: string } {
  if (!isPlainObject(raw)) return { error: "invalid_body" };
  const invite = raw["invite"];
  if (!Array.isArray(invite) || invite.length === 0) {
    return { error: "invalid_invite" };
  }
  if (!invite.every((h) => typeof h === "string")) {
    return { error: "invalid_invite" };
  }
  return { invite: invite as string[] };
}

interface MessageRequest {
  readonly content: Content;
  readonly idempotency_key?: string;
  readonly metadata?: Metadata;
}

function parseMessageRequest(raw: unknown): MessageRequest | { error: string } {
  if (!isPlainObject(raw)) return { error: "invalid_body" };
  const content = raw["content"];
  if (!isContent(content)) return { error: "invalid_content" };
  const idempotency_key = raw["idempotency_key"];
  if (idempotency_key !== undefined && typeof idempotency_key !== "string") {
    return { error: "invalid_idempotency_key" };
  }
  return {
    content: content as Content,
    ...(idempotency_key !== undefined ? { idempotency_key: idempotency_key as string } : {}),
    ...(isPlainObject(raw["metadata"]) ? { metadata: raw["metadata"] as Metadata } : {}),
  };
}

interface ReopenRequest {
  readonly invite?: readonly string[];
  readonly initial_message?: { content: Content; metadata?: Metadata };
}

function parseReopenRequest(raw: unknown): ReopenRequest | { error: string } {
  if (!isPlainObject(raw)) return { error: "invalid_body" };
  const invite = raw["invite"];
  if (invite !== undefined) {
    if (!Array.isArray(invite) || !invite.every((h) => typeof h === "string")) {
      return { error: "invalid_invite" };
    }
  }
  const initial_message = raw["initial_message"];
  if (initial_message !== undefined) {
    if (!isPlainObject(initial_message) || !isContent(initial_message["content"])) {
      return { error: "invalid_initial_message" };
    }
  }
  return {
    ...(invite !== undefined ? { invite: invite as string[] } : {}),
    ...(initial_message !== undefined
      ? {
          initial_message: {
            content: (initial_message as Record<string, unknown>)["content"] as Content,
          },
        }
      : {}),
  };
}

// ── Error mapping ─────────────────────────────────────────────────────────────

function mapSessionError(
  c: import("hono").Context<AgentEnv>,
  err: unknown,
): Response {
  if (err instanceof SessionError) {
    switch (err.code) {
      case "not_found":
      case "not_participant":
      case "not_invited":
        return c.json({ error: "not_found" }, 404);
      case "not_joined":
        return c.json({ error: "not_joined" }, 403);
      case "already_joined":
      case "session_ended":
      case "session_active":
        return c.json({ error: err.code }, 409);
    }
  }
  throw err;
}

// ── Guards ────────────────────────────────────────────────────────────────────

function isParticipant(session: Session, handle: string): boolean {
  return session.participants.some((p) => p.handle === handle);
}

function canInvite(inviter: string, invitee: { policy: string; allowlist: readonly string[] }): boolean {
  if (invitee.policy === "open") return true;
  return invitee.allowlist.includes(inviter);
}

function isContent(v: unknown): boolean {
  if (typeof v === "string") return true;
  if (!Array.isArray(v) || v.length === 0) return false;
  return v.every(isContentPart);
}

function isContentPart(v: unknown): boolean {
  if (!isPlainObject(v)) return false;
  const t = v["type"];
  if (t === "text") return typeof v["text"] === "string";
  if (t === "image")
    return typeof v["url"] === "string" || typeof v["data_uri"] === "string";
  if (t === "file") return typeof v["url"] === "string";
  if (t === "data") return isPlainObject(v["data"]);
  return false;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

async function readJson(c: import("hono").Context<AgentEnv>): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return undefined;
  }
}
