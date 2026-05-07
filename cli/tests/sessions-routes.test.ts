import { strict as assert } from "node:assert";
import { describe, it, beforeEach, afterEach } from "node:test";

import { buildApp } from "../src/server/app.js";
import { startServer } from "../src/server/runtime.js";
import { InMemoryAgentStore } from "../src/server/store/agents.js";
import { InMemorySessionStore } from "../src/server/store/sessions.js";

const ADMIN_TOKEN = "admin-test-token";

interface Setup {
  port: number;
  agentStore: InMemoryAgentStore;
  sessionStore: InMemorySessionStore;
  close: () => Promise<void>;
}

async function setup(): Promise<Setup> {
  const agentStore = new InMemoryAgentStore();
  const sessionStore = new InMemorySessionStore();
  const app = buildApp({
    network: "test",
    store: agentStore,
    sessionStore,
    adminToken: ADMIN_TOKEN,
  });
  const server = await startServer({ app, host: "127.0.0.1", port: 0 });
  return { port: server.port, agentStore, sessionStore, close: server.close };
}

function baseUrl(port: number) {
  return `http://127.0.0.1:${port}`;
}

function agentHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function json(res: Response): Promise<unknown> {
  return res.json();
}

// ── Agent auth ───────────────────────────────────────────────────────────────

describe("session auth", () => {
  let s: Setup;
  beforeEach(async () => { s = await setup(); });
  afterEach(() => s.close());

  it("returns 401 with no Authorization header", async () => {
    const res = await fetch(`${baseUrl(s.port)}/sessions`);
    assert.equal(res.status, 401);
  });

  it("returns 401 for an unknown token", async () => {
    const res = await fetch(`${baseUrl(s.port)}/sessions`, {
      headers: { Authorization: "Bearer unknown-token" },
    });
    assert.equal(res.status, 401);
  });
});

// ── POST /sessions ────────────────────────────────────────────────────────────

describe("POST /sessions", () => {
  let s: Setup;
  beforeEach(async () => { s = await setup(); });
  afterEach(() => s.close());

  it("creates a session and returns session_id", async () => {
    const agent = s.agentStore.register("@alice.bot", { policy: "open" });
    const res = await fetch(`${baseUrl(s.port)}/sessions`, {
      method: "POST",
      headers: agentHeaders(agent.token),
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 201);
    const body = (await json(res)) as { session_id: string };
    assert.ok(body.session_id.startsWith("sess_"));
  });

  it("adds invitees that have open policy", async () => {
    const alice = s.agentStore.register("@alice.bot", { policy: "open" });
    s.agentStore.register("@bob.bot", { policy: "open" });
    const res = await fetch(`${baseUrl(s.port)}/sessions`, {
      method: "POST",
      headers: agentHeaders(alice.token),
      body: JSON.stringify({ invite: ["@bob.bot"] }),
    });
    assert.equal(res.status, 201);
    const body = (await json(res)) as { session_id: string };
    const sess = s.sessionStore.get(body.session_id)!;
    const bob = sess.participants.find((p) => p.handle === "@bob.bot");
    assert.equal(bob?.status, "invited");
  });

  it("returns 404 when the only invitee has allowlist policy and no allowlist entry", async () => {
    // Non-enumeration: don't let the operator mask a failed invite as a
    // zero-invite session (Whitepaper §6.2, Appendix A #8).
    const alice = s.agentStore.register("@alice.bot", { policy: "open" });
    s.agentStore.register("@bob.bot", { policy: "allowlist" });
    const res = await fetch(`${baseUrl(s.port)}/sessions`, {
      method: "POST",
      headers: agentHeaders(alice.token),
      body: JSON.stringify({ invite: ["@bob.bot"] }),
    });
    assert.equal(res.status, 404);
  });

  it("returns 404 when the only invitee is an unknown handle", async () => {
    const alice = s.agentStore.register("@alice.bot", { policy: "open" });
    const res = await fetch(`${baseUrl(s.port)}/sessions`, {
      method: "POST",
      headers: agentHeaders(alice.token),
      body: JSON.stringify({ invite: ["@ghost.bot"] }),
    });
    assert.equal(res.status, 404);
  });

  it("silently omits filtered invitees when at least one survives", async () => {
    // When some invitees survive policy filtering, the request still
    // succeeds and the rejected handles are simply omitted — that preserves
    // non-enumeration without breaking the request.
    const alice = s.agentStore.register("@alice.bot", { policy: "open" });
    s.agentStore.register("@bob.bot", { policy: "open" });
    const res = await fetch(`${baseUrl(s.port)}/sessions`, {
      method: "POST",
      headers: agentHeaders(alice.token),
      body: JSON.stringify({ invite: ["@bob.bot", "@ghost.bot"] }),
    });
    assert.equal(res.status, 201);
    const body = (await json(res)) as { session_id: string };
    const sess = s.sessionStore.get(body.session_id)!;
    assert.equal(sess.participants.length, 2); // alice + bob
  });

  it("returns 400 when end_after_send=true without initial_message", async () => {
    const alice = s.agentStore.register("@alice.bot", { policy: "open" });
    const res = await fetch(`${baseUrl(s.port)}/sessions`, {
      method: "POST",
      headers: agentHeaders(alice.token),
      body: JSON.stringify({ end_after_send: true }),
    });
    assert.equal(res.status, 400);
  });
});

// ── GET /sessions ─────────────────────────────────────────────────────────────

describe("GET /sessions", () => {
  let s: Setup;
  beforeEach(async () => { s = await setup(); });
  afterEach(() => s.close());

  it("returns sessions the agent is part of", async () => {
    const alice = s.agentStore.register("@alice.bot", { policy: "open" });
    s.sessionStore.create({ creator: "@alice.bot" });
    const res = await fetch(`${baseUrl(s.port)}/sessions`, {
      headers: { Authorization: `Bearer ${alice.token}` },
    });
    assert.equal(res.status, 200);
    const body = (await json(res)) as { sessions: unknown[] };
    assert.equal(body.sessions.length, 1);
  });

  it("returns empty for an agent with no sessions", async () => {
    const alice = s.agentStore.register("@alice.bot", { policy: "open" });
    const res = await fetch(`${baseUrl(s.port)}/sessions`, {
      headers: { Authorization: `Bearer ${alice.token}` },
    });
    const body = (await json(res)) as { sessions: unknown[] };
    assert.deepEqual(body.sessions, []);
  });
});

// ── GET /sessions/:id ─────────────────────────────────────────────────────────

describe("GET /sessions/:id", () => {
  let s: Setup;
  beforeEach(async () => { s = await setup(); });
  afterEach(() => s.close());

  it("returns the session for a participant", async () => {
    const alice = s.agentStore.register("@alice.bot", { policy: "open" });
    const { session } = s.sessionStore.create({ creator: "@alice.bot" });
    const res = await fetch(`${baseUrl(s.port)}/sessions/${session.id}`, {
      headers: { Authorization: `Bearer ${alice.token}` },
    });
    assert.equal(res.status, 200);
    const body = (await json(res)) as { id: string; state: string };
    assert.equal(body.id, session.id);
    assert.equal(body.state, "active");
  });

  it("returns 404 for a non-participant", async () => {
    const alice = s.agentStore.register("@alice.bot", { policy: "open" });
    const bob = s.agentStore.register("@bob.bot", { policy: "open" });
    const { session } = s.sessionStore.create({ creator: "@alice.bot" });
    const res = await fetch(`${baseUrl(s.port)}/sessions/${session.id}`, {
      headers: { Authorization: `Bearer ${bob.token}` },
    });
    assert.equal(res.status, 404);
  });
});

// ── POST /sessions/:id/join ───────────────────────────────────────────────────

describe("POST /sessions/:id/join", () => {
  let s: Setup;
  beforeEach(async () => { s = await setup(); });
  afterEach(() => s.close());

  it("allows an invited agent to join", async () => {
    s.agentStore.register("@alice.bot", { policy: "open" });
    const bob = s.agentStore.register("@bob.bot", { policy: "open" });
    const { session } = s.sessionStore.create({ creator: "@alice.bot", invitees: ["@bob.bot"] });
    const res = await fetch(`${baseUrl(s.port)}/sessions/${session.id}/join`, {
      method: "POST",
      headers: agentHeaders(bob.token),
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 200);
    const updated = s.sessionStore.get(session.id)!;
    assert.equal(updated.participants.find((p) => p.handle === "@bob.bot")?.status, "joined");
  });

  it("returns 404 for a non-invited agent", async () => {
    s.agentStore.register("@alice.bot", { policy: "open" });
    const carol = s.agentStore.register("@carol.bot", { policy: "open" });
    const { session } = s.sessionStore.create({ creator: "@alice.bot" });
    const res = await fetch(`${baseUrl(s.port)}/sessions/${session.id}/join`, {
      method: "POST",
      headers: agentHeaders(carol.token),
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 404);
  });
});

// ── POST /sessions/:id/messages ───────────────────────────────────────────────

describe("POST /sessions/:id/messages", () => {
  let s: Setup;
  beforeEach(async () => { s = await setup(); });
  afterEach(() => s.close());

  it("sends a message and returns message_id and sequence", async () => {
    const alice = s.agentStore.register("@alice.bot", { policy: "open" });
    const { session } = s.sessionStore.create({ creator: "@alice.bot" });
    const res = await fetch(`${baseUrl(s.port)}/sessions/${session.id}/messages`, {
      method: "POST",
      headers: agentHeaders(alice.token),
      body: JSON.stringify({ content: "hello!" }),
    });
    assert.equal(res.status, 201);
    const body = (await json(res)) as { message_id: string; sequence: number };
    assert.ok(body.message_id.startsWith("msg_"));
    assert.equal(typeof body.sequence, "number");
  });

  it("returns 403 when sender is not joined", async () => {
    s.agentStore.register("@alice.bot", { policy: "open" });
    const bob = s.agentStore.register("@bob.bot", { policy: "open" });
    const { session } = s.sessionStore.create({ creator: "@alice.bot", invitees: ["@bob.bot"] });
    const res = await fetch(`${baseUrl(s.port)}/sessions/${session.id}/messages`, {
      method: "POST",
      headers: agentHeaders(bob.token),
      body: JSON.stringify({ content: "hi" }),
    });
    assert.equal(res.status, 403);
  });

  it("returns 400 for missing content", async () => {
    const alice = s.agentStore.register("@alice.bot", { policy: "open" });
    const { session } = s.sessionStore.create({ creator: "@alice.bot" });
    const res = await fetch(`${baseUrl(s.port)}/sessions/${session.id}/messages`, {
      method: "POST",
      headers: agentHeaders(alice.token),
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
  });
});

// ── POST /sessions/:id/leave and /end ────────────────────────────────────────

describe("POST /sessions/:id/leave", () => {
  let s: Setup;
  beforeEach(async () => { s = await setup(); });
  afterEach(() => s.close());

  it("lets a joined agent leave", async () => {
    const alice = s.agentStore.register("@alice.bot", { policy: "open" });
    s.agentStore.register("@bob.bot", { policy: "open" });
    const { session } = s.sessionStore.create({ creator: "@alice.bot", invitees: ["@bob.bot"] });
    s.sessionStore.join(session.id, "@bob.bot");
    const bob = s.agentStore.get("@bob.bot")!;
    const res = await fetch(`${baseUrl(s.port)}/sessions/${session.id}/leave`, {
      method: "POST",
      headers: agentHeaders(bob.token),
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 200);
    const updated = s.sessionStore.get(session.id)!;
    assert.equal(updated.participants.find((p) => p.handle === "@bob.bot")?.status, "left");
    void alice;
  });
});

describe("POST /sessions/:id/end", () => {
  let s: Setup;
  beforeEach(async () => { s = await setup(); });
  afterEach(() => s.close());

  it("ends the session", async () => {
    const alice = s.agentStore.register("@alice.bot", { policy: "open" });
    const { session } = s.sessionStore.create({ creator: "@alice.bot" });
    const res = await fetch(`${baseUrl(s.port)}/sessions/${session.id}/end`, {
      method: "POST",
      headers: agentHeaders(alice.token),
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 200);
    const updated = s.sessionStore.get(session.id)!;
    assert.equal(updated.state, "ended");
  });
});

// ── GET /sessions/:id/events ──────────────────────────────────────────────────

describe("GET /sessions/:id/events", () => {
  let s: Setup;
  beforeEach(async () => { s = await setup(); });
  afterEach(() => s.close());

  it("returns events for a participant", async () => {
    const alice = s.agentStore.register("@alice.bot", { policy: "open" });
    const { session } = s.sessionStore.create({ creator: "@alice.bot" });
    s.sessionStore.send(session.id, "@alice.bot", "hello");
    const res = await fetch(`${baseUrl(s.port)}/sessions/${session.id}/events`, {
      headers: { Authorization: `Bearer ${alice.token}` },
    });
    assert.equal(res.status, 200);
    const body = (await json(res)) as { events: unknown[] };
    assert.ok(body.events.length >= 1);
  });

  it("returns 404 for a non-participant", async () => {
    s.agentStore.register("@alice.bot", { policy: "open" });
    const bob = s.agentStore.register("@bob.bot", { policy: "open" });
    const { session } = s.sessionStore.create({ creator: "@alice.bot" });
    const res = await fetch(`${baseUrl(s.port)}/sessions/${session.id}/events`, {
      headers: { Authorization: `Bearer ${bob.token}` },
    });
    assert.equal(res.status, 404);
  });

  it("paginates with after_sequence", async () => {
    const alice = s.agentStore.register("@alice.bot", { policy: "open" });
    const { session } = s.sessionStore.create({ creator: "@alice.bot" });
    s.sessionStore.send(session.id, "@alice.bot", "msg1");
    s.sessionStore.send(session.id, "@alice.bot", "msg2");
    const all = (await fetch(`${baseUrl(s.port)}/sessions/${session.id}/events`, {
      headers: { Authorization: `Bearer ${alice.token}` },
    }).then((r) => r.json())) as { events: Array<{ sequence: number }> };
    const firstSeq = all.events[0]?.sequence ?? 0;
    const res = await fetch(
      `${baseUrl(s.port)}/sessions/${session.id}/events?after_sequence=${firstSeq}`,
      { headers: { Authorization: `Bearer ${alice.token}` } },
    );
    const body = (await json(res)) as { events: Array<{ sequence: number }> };
    assert.ok(body.events.every((e) => e.sequence > firstSeq));
  });

  it("includes next_cursor when limit is reached", async () => {
    const alice = s.agentStore.register("@alice.bot", { policy: "open" });
    const { session } = s.sessionStore.create({ creator: "@alice.bot" });
    for (let i = 0; i < 3; i++) s.sessionStore.send(session.id, "@alice.bot", `msg ${i}`);
    const res = await fetch(`${baseUrl(s.port)}/sessions/${session.id}/events?limit=2`, {
      headers: { Authorization: `Bearer ${alice.token}` },
    });
    const body = (await json(res)) as { events: unknown[]; next_cursor?: string };
    assert.equal(body.events.length, 2);
    assert.ok(body.next_cursor !== undefined);
  });
});
