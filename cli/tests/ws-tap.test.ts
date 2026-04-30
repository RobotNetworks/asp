import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { WebSocket } from "ws";

import { buildApp } from "../src/server/app.js";
import { startServer } from "../src/server/runtime.js";
import { InMemoryAgentStore } from "../src/server/store/agents.js";
import { InMemoryContactStore } from "../src/server/store/contacts.js";
import { InMemorySessionStore } from "../src/server/store/sessions.js";
import { WSHub } from "../src/server/ws.js";

const ADMIN_TOKEN = "admin-tap-tok";

async function setup() {
  const agentStore = new InMemoryAgentStore();
  const sessionStore = new InMemorySessionStore();
  const contactStore = new InMemoryContactStore();
  const wsHub = new WSHub();
  wsHub.attach(agentStore, sessionStore, ADMIN_TOKEN);
  const app = buildApp({
    network: "test",
    store: agentStore,
    sessionStore,
    contactStore,
    adminToken: ADMIN_TOKEN,
  });
  const server = await startServer({ app, host: "127.0.0.1", port: 0, wsHub });
  return { server, agentStore, sessionStore, wsHub };
}

function tapWS(port: number, token: string): WebSocket {
  return new WebSocket(`ws://127.0.0.1:${port}/_admin/tap?token=${encodeURIComponent(token)}`);
}

async function wsOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
}

async function nextMessage(ws: WebSocket): Promise<unknown> {
  return new Promise((resolve, reject) => {
    ws.once("message", (data) => {
      try { resolve(JSON.parse(data.toString())); }
      catch (e) { reject(e); }
    });
    ws.once("error", reject);
  });
}

describe("WS /_admin/tap", () => {
  it("returns 401 for a wrong token", async () => {
    const { server, wsHub } = await setup();
    const ws = tapWS(server.port, "wrong-token");
    await new Promise<void>((resolve) => {
      ws.once("unexpected-response", (_req, res) => {
        assert.equal(res.statusCode, 401);
        resolve();
      });
      ws.once("open", () => assert.fail("should not connect"));
    });
    wsHub.close();
    await server.close();
  });

  it("returns 401 when no adminToken is wired", async () => {
    const agentStore = new InMemoryAgentStore();
    const sessionStore = new InMemorySessionStore();
    const contactStore = new InMemoryContactStore();
    const wsHub = new WSHub();
    wsHub.attach(agentStore, sessionStore); // no adminToken
    const app = buildApp({
      network: "test",
      store: agentStore,
      sessionStore,
      contactStore,
      adminToken: ADMIN_TOKEN,
    });
    const server = await startServer({ app, host: "127.0.0.1", port: 0, wsHub });
    const ws = tapWS(server.port, ADMIN_TOKEN);
    await new Promise<void>((resolve) => {
      ws.once("unexpected-response", (_req, res) => {
        assert.equal(res.statusCode, 501);
        resolve();
      });
      ws.once("open", () => assert.fail("should not connect"));
    });
    wsHub.close();
    await server.close();
  });

  it("delivers all events regardless of recipient", async () => {
    const { server, agentStore, sessionStore, wsHub } = await setup();

    // tap opens before alice creates a session
    const ws = tapWS(server.port, ADMIN_TOKEN);
    await wsOpen(ws);

    const msgPromise = nextMessage(ws);

    agentStore.register("@alice.bot", { policy: "open" });
    const { session } = sessionStore.create({ creator: "@alice.bot" });
    sessionStore.send(session.id, "@alice.bot", "tap test");

    const event = (await msgPromise) as Record<string, unknown>;
    assert.equal(event["type"], "session.message");
    assert.equal(event["session_id"], session.id);

    ws.close();
    wsHub.close();
    await server.close();
  });

  it("does not require agent membership in the session", async () => {
    const { server, agentStore, sessionStore, wsHub } = await setup();

    agentStore.register("@alice.bot", { policy: "open" });
    agentStore.register("@bob.bot", { policy: "open" });

    const ws = tapWS(server.port, ADMIN_TOKEN);
    await wsOpen(ws);

    const msgPromise = nextMessage(ws);

    // Alice and Bob's private session — tap should still see it
    const { session } = sessionStore.create({ creator: "@alice.bot", invitees: ["@bob.bot"] });
    sessionStore.join(session.id, "@bob.bot");
    sessionStore.send(session.id, "@bob.bot", "private");

    const event = (await msgPromise) as Record<string, unknown>;
    assert.ok(event["type"] !== undefined);

    ws.close();
    wsHub.close();
    await server.close();
  });
});
