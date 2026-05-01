import { strict as assert } from "node:assert";
import { describe, it, beforeEach, afterEach } from "node:test";

import { buildApp } from "../src/server/app.js";
import { startServer } from "../src/server/runtime.js";
import { InMemoryAgentStore } from "../src/server/store/agents.js";
import { InMemoryContactStore } from "../src/server/store/contacts.js";
import { InMemorySessionStore } from "../src/server/store/sessions.js";

interface Setup {
  port: number;
  agentStore: InMemoryAgentStore;
  contactStore: InMemoryContactStore;
  close: () => Promise<void>;
}

async function setup(): Promise<Setup> {
  const agentStore = new InMemoryAgentStore();
  const sessionStore = new InMemorySessionStore();
  const contactStore = new InMemoryContactStore();
  const app = buildApp({
    network: "test",
    store: agentStore,
    sessionStore,
    contactStore,
    adminToken: "admin-token",
  });
  const server = await startServer({ app, host: "127.0.0.1", port: 0 });
  return { port: server.port, agentStore, contactStore, close: server.close };
}

function baseUrl(port: number) {
  return `http://127.0.0.1:${port}`;
}

function headers(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function json(res: Response): Promise<unknown> {
  return res.json();
}

// ── POST /contacts ────────────────────────────────────────────────────────────

describe("POST /contacts", () => {
  let s: Setup;
  beforeEach(async () => { s = await setup(); });
  afterEach(() => s.close());

  it("creates a contact request and returns request_id", async () => {
    const alice = s.agentStore.register("@alice.bot", { policy: "open" });
    s.agentStore.register("@bob.bot", { policy: "allowlist" });
    const res = await fetch(`${baseUrl(s.port)}/contacts`, {
      method: "POST",
      headers: headers(alice.token),
      body: JSON.stringify({ to: "@bob.bot" }),
    });
    assert.equal(res.status, 200);
    const body = (await json(res)) as { request_id: string };
    assert.ok(body.request_id.startsWith("req_"));
  });

  it("stores an optional message", async () => {
    const alice = s.agentStore.register("@alice.bot", { policy: "open" });
    s.agentStore.register("@bob.bot", { policy: "allowlist" });
    const res = await fetch(`${baseUrl(s.port)}/contacts`, {
      method: "POST",
      headers: headers(alice.token),
      body: JSON.stringify({ to: "@bob.bot", message: "hi there" }),
    });
    assert.equal(res.status, 200);
    const body = (await json(res)) as { request_id: string };
    const req = s.contactStore.get(body.request_id)!;
    assert.equal(req.message, "hi there");
  });

  it("returns 404 when the recipient does not exist", async () => {
    const alice = s.agentStore.register("@alice.bot", { policy: "open" });
    const res = await fetch(`${baseUrl(s.port)}/contacts`, {
      method: "POST",
      headers: headers(alice.token),
      body: JSON.stringify({ to: "@ghost.bot" }),
    });
    assert.equal(res.status, 404);
  });

  it("returns 400 when sender and recipient are the same", async () => {
    const alice = s.agentStore.register("@alice.bot", { policy: "open" });
    const res = await fetch(`${baseUrl(s.port)}/contacts`, {
      method: "POST",
      headers: headers(alice.token),
      body: JSON.stringify({ to: "@alice.bot" }),
    });
    assert.equal(res.status, 400);
  });

  it("returns 401 with no token", async () => {
    const res = await fetch(`${baseUrl(s.port)}/contacts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: "@bob.bot" }),
    });
    assert.equal(res.status, 401);
  });
});

// ── GET /contacts ─────────────────────────────────────────────────────────────

describe("GET /contacts", () => {
  let s: Setup;
  beforeEach(async () => { s = await setup(); });
  afterEach(() => s.close());

  it("returns requests where the caller is sender or recipient", async () => {
    const alice = s.agentStore.register("@alice.bot", { policy: "open" });
    const bob = s.agentStore.register("@bob.bot", { policy: "allowlist" });
    s.contactStore.create("@alice.bot", "@bob.bot");
    s.contactStore.create("@bob.bot", "@alice.bot");
    const res = await fetch(`${baseUrl(s.port)}/contacts`, {
      headers: { Authorization: `Bearer ${alice.token}` },
    });
    assert.equal(res.status, 200);
    const body = (await json(res)) as { requests: unknown[] };
    assert.equal(body.requests.length, 2);
    void bob;
  });

  it("returns empty requests array for an agent with none", async () => {
    const alice = s.agentStore.register("@alice.bot", { policy: "open" });
    const res = await fetch(`${baseUrl(s.port)}/contacts`, {
      headers: { Authorization: `Bearer ${alice.token}` },
    });
    const body = (await json(res)) as { requests: unknown[] };
    assert.deepEqual(body.requests, []);
  });
});

// ── GET /contacts/:id ─────────────────────────────────────────────────────────

describe("GET /contacts/:id", () => {
  let s: Setup;
  beforeEach(async () => { s = await setup(); });
  afterEach(() => s.close());

  it("returns the request for the sender", async () => {
    const alice = s.agentStore.register("@alice.bot", { policy: "open" });
    s.agentStore.register("@bob.bot", { policy: "allowlist" });
    const req = s.contactStore.create("@alice.bot", "@bob.bot");
    const res = await fetch(`${baseUrl(s.port)}/contacts/${req.id}`, {
      headers: { Authorization: `Bearer ${alice.token}` },
    });
    assert.equal(res.status, 200);
    const body = (await json(res)) as { id: string };
    assert.equal(body.id, req.id);
  });

  it("returns 404 for a non-participant", async () => {
    const carol = s.agentStore.register("@carol.bot", { policy: "open" });
    s.agentStore.register("@alice.bot", { policy: "open" });
    s.agentStore.register("@bob.bot", { policy: "allowlist" });
    const req = s.contactStore.create("@alice.bot", "@bob.bot");
    const res = await fetch(`${baseUrl(s.port)}/contacts/${req.id}`, {
      headers: { Authorization: `Bearer ${carol.token}` },
    });
    assert.equal(res.status, 404);
  });
});

// ── POST /contacts/:id/accept ─────────────────────────────────────────────────

describe("POST /contacts/:id/accept", () => {
  let s: Setup;
  beforeEach(async () => { s = await setup(); });
  afterEach(() => s.close());

  it("accepts the request and updates both allowlists", async () => {
    s.agentStore.register("@alice.bot", { policy: "allowlist" });
    const bob = s.agentStore.register("@bob.bot", { policy: "allowlist" });
    const req = s.contactStore.create("@alice.bot", "@bob.bot");
    const res = await fetch(`${baseUrl(s.port)}/contacts/${req.id}/accept`, {
      method: "POST",
      headers: headers(bob.token),
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 200);
    const alice = s.agentStore.get("@alice.bot")!;
    const updatedBob = s.agentStore.get("@bob.bot")!;
    assert.ok(alice.allowlist.includes("@bob.bot"));
    assert.ok(updatedBob.allowlist.includes("@alice.bot"));
    const stored = s.contactStore.get(req.id)!;
    assert.equal(stored.status, "accepted");
  });

  it("returns 404 when caller is not the recipient", async () => {
    const alice = s.agentStore.register("@alice.bot", { policy: "allowlist" });
    s.agentStore.register("@bob.bot", { policy: "allowlist" });
    const req = s.contactStore.create("@alice.bot", "@bob.bot");
    const res = await fetch(`${baseUrl(s.port)}/contacts/${req.id}/accept`, {
      method: "POST",
      headers: headers(alice.token),
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 404);
  });

  it("returns 409 when the request is already resolved", async () => {
    s.agentStore.register("@alice.bot", { policy: "allowlist" });
    const bob = s.agentStore.register("@bob.bot", { policy: "allowlist" });
    const req = s.contactStore.create("@alice.bot", "@bob.bot");
    s.contactStore.accept(req.id, "@bob.bot");
    const res = await fetch(`${baseUrl(s.port)}/contacts/${req.id}/accept`, {
      method: "POST",
      headers: headers(bob.token),
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 409);
  });
});

// ── POST /contacts/:id/decline ────────────────────────────────────────────────

describe("POST /contacts/:id/decline", () => {
  let s: Setup;
  beforeEach(async () => { s = await setup(); });
  afterEach(() => s.close());

  it("declines the request", async () => {
    s.agentStore.register("@alice.bot", { policy: "allowlist" });
    const bob = s.agentStore.register("@bob.bot", { policy: "allowlist" });
    const req = s.contactStore.create("@alice.bot", "@bob.bot");
    const res = await fetch(`${baseUrl(s.port)}/contacts/${req.id}/decline`, {
      method: "POST",
      headers: headers(bob.token),
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 200);
    const stored = s.contactStore.get(req.id)!;
    assert.equal(stored.status, "declined");
  });

  it("returns 404 for an unknown request", async () => {
    const alice = s.agentStore.register("@alice.bot", { policy: "open" });
    const res = await fetch(`${baseUrl(s.port)}/contacts/cr_NOPE/decline`, {
      method: "POST",
      headers: headers(alice.token),
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 404);
  });
});
