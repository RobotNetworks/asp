import { strict as assert } from "node:assert";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import {
  AgentNotFoundError,
  SessionApiError,
  SessionClient,
  connectSession,
} from "../src/client/session.js";
import { buildApp } from "../src/server/app.js";
import { startServer } from "../src/server/runtime.js";
import { InMemoryAgentStore } from "../src/server/store/agents.js";
import { InMemorySessionStore } from "../src/server/store/sessions.js";
import { agentCredentialPath } from "../src/paths.js";
import { writeRegistry, upsertEntry } from "../src/registry.js";

// ── SessionClient (unit against an in-process server) ────────────────────────

describe("SessionClient", () => {
  let handle: { port: number; close: () => Promise<void> };
  let agentStore: InMemoryAgentStore;
  let sessionStore: InMemorySessionStore;
  let aliceClient: SessionClient;

  beforeEach(async () => {
    agentStore = new InMemoryAgentStore();
    sessionStore = new InMemorySessionStore();
    const app = buildApp({
      network: "test",
      store: agentStore,
      sessionStore,
      adminToken: "admin-token",
    });
    handle = await startServer({ app, host: "127.0.0.1", port: 0 });

    const alice = agentStore.register("@alice.bot", { policy: "open" });
    aliceClient = new SessionClient(
      `http://127.0.0.1:${handle.port}`,
      alice.token,
    );
  });

  afterEach(() => handle.close());

  // ── createSession ────────────────────────────────────────────────────────────

  it("createSession returns a session_id", async () => {
    const result = await aliceClient.createSession();
    assert.ok(result.session_id.startsWith("sess_"));
    assert.equal(result.sequence, undefined);
  });

  it("createSession with initial_message returns sequence", async () => {
    const result = await aliceClient.createSession({
      initialMessage: { content: "hello" },
    });
    assert.ok(result.session_id.startsWith("sess_"));
    assert.equal(typeof result.sequence, "number");
  });

  it("createSession with end_after_send creates an ended session", async () => {
    const result = await aliceClient.createSession({
      initialMessage: { content: "one-shot" },
      endAfterSend: true,
    });
    const sess = sessionStore.get(result.session_id)!;
    assert.equal(sess.state, "ended");
  });

  it("createSession throws SessionApiError(400) when end_after_send without message", async () => {
    await assert.rejects(
      aliceClient.createSession({ endAfterSend: true }),
      (err: unknown) => err instanceof SessionApiError && err.status === 400,
    );
  });

  it("createSession with invite adds invitees that accept", async () => {
    agentStore.register("@bob.bot", { policy: "open" });
    const result = await aliceClient.createSession({ invite: ["@bob.bot"] });
    const sess = sessionStore.get(result.session_id)!;
    assert.ok(sess.participants.some((p) => p.handle === "@bob.bot"));
  });

  // ── listSessions ─────────────────────────────────────────────────────────────

  it("listSessions returns sessions the agent is in", async () => {
    await aliceClient.createSession();
    const sessions = await aliceClient.listSessions();
    assert.equal(sessions.length, 1);
    assert.ok(sessions[0]?.id.startsWith("sess_"));
  });

  it("listSessions returns empty array when no sessions", async () => {
    const sessions = await aliceClient.listSessions();
    assert.deepEqual(sessions, []);
  });

  // ── showSession ──────────────────────────────────────────────────────────────

  it("showSession returns the session for a participant", async () => {
    const { session_id } = await aliceClient.createSession({ topic: "test" });
    const sess = await aliceClient.showSession(session_id);
    assert.equal(sess.id, session_id);
    assert.equal(sess.state, "active");
    assert.equal(sess.topic, "test");
  });

  it("showSession throws SessionApiError(404) for a non-participant", async () => {
    const bob = agentStore.register("@bob.bot", { policy: "open" });
    const bobClient = new SessionClient(
      `http://127.0.0.1:${handle.port}`,
      bob.token,
    );
    const { session_id } = await aliceClient.createSession();
    await assert.rejects(
      bobClient.showSession(session_id),
      (err: unknown) => err instanceof SessionApiError && err.status === 404,
    );
  });

  // ── joinSession ──────────────────────────────────────────────────────────────

  it("joinSession succeeds for an invited agent", async () => {
    agentStore.register("@bob.bot", { policy: "open" });
    const bob = agentStore.get("@bob.bot")!;
    const bobClient = new SessionClient(
      `http://127.0.0.1:${handle.port}`,
      bob.token,
    );
    const { session_id } = await aliceClient.createSession({
      invite: ["@bob.bot"],
    });
    await bobClient.joinSession(session_id);
    const sess = sessionStore.get(session_id)!;
    assert.equal(
      sess.participants.find((p) => p.handle === "@bob.bot")?.status,
      "joined",
    );
  });

  it("joinSession throws SessionApiError(404) for a non-invited agent", async () => {
    const bob = agentStore.register("@bob.bot", { policy: "open" });
    const bobClient = new SessionClient(
      `http://127.0.0.1:${handle.port}`,
      bob.token,
    );
    const { session_id } = await aliceClient.createSession();
    await assert.rejects(
      bobClient.joinSession(session_id),
      (err: unknown) => err instanceof SessionApiError && err.status === 404,
    );
  });

  // ── inviteToSession ──────────────────────────────────────────────────────────

  it("inviteToSession adds an open-policy agent", async () => {
    agentStore.register("@bob.bot", { policy: "open" });
    const { session_id } = await aliceClient.createSession();
    const result = await aliceClient.inviteToSession(session_id, ["@bob.bot"]);
    assert.deepEqual(result.invited, ["@bob.bot"]);
  });

  it("inviteToSession returns empty invited for allowlist-policy agent", async () => {
    agentStore.register("@bob.bot", { policy: "allowlist" });
    const { session_id } = await aliceClient.createSession();
    const result = await aliceClient.inviteToSession(session_id, ["@bob.bot"]);
    assert.deepEqual(result.invited, []);
  });

  // ── sendMessage ──────────────────────────────────────────────────────────────

  it("sendMessage returns message_id and sequence", async () => {
    const { session_id } = await aliceClient.createSession();
    const result = await aliceClient.sendMessage(session_id, "hello");
    assert.ok(result.message_id.startsWith("msg_"));
    assert.equal(typeof result.sequence, "number");
  });

  it("sendMessage throws SessionApiError(403) when not joined", async () => {
    const bob = agentStore.register("@bob.bot", { policy: "open" });
    const bobClient = new SessionClient(
      `http://127.0.0.1:${handle.port}`,
      bob.token,
    );
    const { session_id } = await aliceClient.createSession({
      invite: ["@bob.bot"],
    });
    await assert.rejects(
      bobClient.sendMessage(session_id, "hi"),
      (err: unknown) => err instanceof SessionApiError && err.status === 403,
    );
  });

  // ── leaveSession ─────────────────────────────────────────────────────────────

  it("leaveSession sets participant status to left", async () => {
    agentStore.register("@bob.bot", { policy: "open" });
    const bob = agentStore.get("@bob.bot")!;
    const bobClient = new SessionClient(
      `http://127.0.0.1:${handle.port}`,
      bob.token,
    );
    const { session_id } = await aliceClient.createSession({
      invite: ["@bob.bot"],
    });
    await bobClient.joinSession(session_id);
    await bobClient.leaveSession(session_id);
    const sess = sessionStore.get(session_id)!;
    assert.equal(
      sess.participants.find((p) => p.handle === "@bob.bot")?.status,
      "left",
    );
  });

  // ── endSession ───────────────────────────────────────────────────────────────

  it("endSession sets session state to ended", async () => {
    const { session_id } = await aliceClient.createSession();
    await aliceClient.endSession(session_id);
    const sess = sessionStore.get(session_id)!;
    assert.equal(sess.state, "ended");
  });

  // ── reopenSession ─────────────────────────────────────────────────────────────

  it("reopenSession sets state back to active", async () => {
    const { session_id } = await aliceClient.createSession();
    await aliceClient.endSession(session_id);
    await aliceClient.reopenSession(session_id);
    const sess = sessionStore.get(session_id)!;
    assert.equal(sess.state, "active");
  });

  // ── getEvents ─────────────────────────────────────────────────────────────────

  it("getEvents returns events for a participant", async () => {
    const { session_id } = await aliceClient.createSession();
    await aliceClient.sendMessage(session_id, "hi");
    const result = await aliceClient.getEvents(session_id);
    assert.ok(result.events.length >= 1);
  });

  it("getEvents respects afterSequence", async () => {
    const { session_id } = await aliceClient.createSession();
    await aliceClient.sendMessage(session_id, "first");
    await aliceClient.sendMessage(session_id, "second");
    const all = await aliceClient.getEvents(session_id);
    const firstSeq = all.events[0]?.sequence ?? 0;
    const after = await aliceClient.getEvents(session_id, {
      afterSequence: firstSeq,
    });
    assert.ok(after.events.every((e) => e.sequence > firstSeq));
  });

  it("getEvents respects limit and returns next_cursor", async () => {
    const { session_id } = await aliceClient.createSession();
    for (let i = 0; i < 3; i++) {
      await aliceClient.sendMessage(session_id, `msg ${i}`);
    }
    const result = await aliceClient.getEvents(session_id, { limit: 2 });
    assert.equal(result.events.length, 2);
    assert.ok(result.next_cursor !== undefined);
  });

  it("throws when the server is unreachable", async () => {
    const dead = new SessionClient("http://127.0.0.1:1", "some-token");
    await assert.rejects(dead.listSessions(), /could not reach network/);
  });
});

// ── connectSession ───────────────────────────────────────────────────────────

describe("connectSession", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "asp-connect-sess-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("throws when the network has no registry entry", async () => {
    await assert.rejects(
      connectSession("default", "@alice.bot", undefined, tmpDir),
      /is not running/,
    );
  });

  it("throws AgentNotFoundError when the credential file is missing", async () => {
    const entry = {
      name: "default",
      pid: process.pid,
      host: "127.0.0.1",
      port: 9999,
      startedAt: Date.now(),
      version: "0.0.0",
    };
    await writeRegistry(tmpDir, upsertEntry({ version: 1, networks: {} }, entry));
    await assert.rejects(
      connectSession("default", "@alice.bot", undefined, tmpDir),
      AgentNotFoundError,
    );
  });

  it("uses the overrideToken without reading a credential file", async () => {
    const agentStore = new InMemoryAgentStore();
    const sessionStore = new InMemorySessionStore();
    const app = buildApp({
      network: "default",
      store: agentStore,
      sessionStore,
      adminToken: "admin-token",
    });
    const server = await startServer({ app, host: "127.0.0.1", port: 0 });

    try {
      const alice = agentStore.register("@alice.bot", { policy: "open" });
      const entry = {
        name: "default",
        pid: process.pid,
        host: "127.0.0.1",
        port: server.port,
        startedAt: Date.now(),
        version: "0.0.0",
      };
      await writeRegistry(tmpDir, upsertEntry({ version: 1, networks: {} }, entry));

      const client = await connectSession(
        "default",
        "@alice.bot",
        alice.token,
        tmpDir,
      );
      const sessions = await client.listSessions();
      assert.deepEqual(sessions, []);
    } finally {
      await server.close();
    }
  });

  it("reads token from credential file and connects", async () => {
    const agentStore = new InMemoryAgentStore();
    const sessionStore = new InMemorySessionStore();
    const app = buildApp({
      network: "default",
      store: agentStore,
      sessionStore,
      adminToken: "admin-token",
    });
    const server = await startServer({ app, host: "127.0.0.1", port: 0 });

    try {
      const alice = agentStore.register("@alice.bot", { policy: "open" });
      const entry = {
        name: "default",
        pid: process.pid,
        host: "127.0.0.1",
        port: server.port,
        startedAt: Date.now(),
        version: "0.0.0",
      };
      await writeRegistry(tmpDir, upsertEntry({ version: 1, networks: {} }, entry));

      const credPath = agentCredentialPath(tmpDir, "default", "@alice.bot");
      await mkdir(join(credPath, ".."), { recursive: true });
      await writeFile(credPath, `${alice.token}\n`, { mode: 0o600 });

      const client = await connectSession(
        "default",
        "@alice.bot",
        undefined,
        tmpDir,
      );
      const sessions = await client.listSessions();
      assert.deepEqual(sessions, []);
    } finally {
      await server.close();
    }
  });
});
