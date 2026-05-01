import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { WebSocket } from "ws";

import { buildApp } from "../src/server/app.js";
import { startServer } from "../src/server/runtime.js";
import { InMemoryAgentStore } from "../src/server/store/agents.js";
import { InMemorySessionStore } from "../src/server/store/sessions.js";
import { WSHub } from "../src/server/ws.js";

async function setupWithWS() {
  const agentStore = new InMemoryAgentStore();
  const sessionStore = new InMemorySessionStore();
  const wsHub = new WSHub();
  wsHub.attach({ agentStore, sessionStore });
  const app = buildApp({
    network: "test",
    store: agentStore,
    sessionStore,
    adminToken: "admin-token",
  });
  const server = await startServer({
    app,
    host: "127.0.0.1",
    port: 0,
    wsHub,
  });
  return { server, agentStore, sessionStore, wsHub };
}

function connectWS(port: number, token: string): WebSocket {
  return new WebSocket(`ws://127.0.0.1:${port}/connect?token=${encodeURIComponent(token)}`);
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
      try {
        resolve(JSON.parse(data.toString()));
      } catch (e) {
        reject(e);
      }
    });
    ws.once("error", reject);
  });
}

function collectMessages(ws: WebSocket, n: number): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const msgs: unknown[] = [];
    const onMsg = (data: Buffer | string) => {
      try {
        msgs.push(JSON.parse(data.toString()));
      } catch (e) {
        reject(e);
      }
      if (msgs.length >= n) {
        ws.off("message", onMsg);
        resolve(msgs);
      }
    };
    ws.on("message", onMsg);
    ws.once("error", reject);
  });
}

describe("WS /connect", () => {
  it("returns 401 for an unknown token", async () => {
    const { server, wsHub } = await setupWithWS();
    const ws = new WebSocket(
      `ws://127.0.0.1:${server.port}/connect?token=invalid`,
    );
    await new Promise<void>((resolve) => {
      ws.once("unexpected-response", (req, res) => {
        assert.equal(res.statusCode, 401);
        resolve();
      });
      ws.once("open", () => {
        assert.fail("should not have connected");
      });
    });
    wsHub.close();
    await server.close();
  });

  it("delivers a session.message event to a joined participant", async () => {
    const { server, agentStore, sessionStore, wsHub } = await setupWithWS();

    const alice = agentStore.register("@alice.bot", { policy: "open" });
    const ws = connectWS(server.port, alice.token);
    await wsOpen(ws);

    const msgPromise = nextMessage(ws);

    const { session } = sessionStore.create({ creator: "@alice.bot" });
    sessionStore.send(session.id, "@alice.bot", "hello WebSocket");

    const event = (await msgPromise) as Record<string, unknown>;
    assert.equal(event["type"], "session.message");
    assert.equal(event["session_id"], session.id);
    assert.equal((event["payload"] as Record<string, unknown>)["content"], "hello WebSocket");

    ws.close();
    wsHub.close();
    await server.close();
  });

  it("delivers session.invited to the invitee", async () => {
    const { server, agentStore, sessionStore, wsHub } = await setupWithWS();

    agentStore.register("@alice.bot", { policy: "open" });
    const bob = agentStore.register("@bob.bot", { policy: "open" });

    const ws = connectWS(server.port, bob.token);
    await wsOpen(ws);

    const msgPromise = nextMessage(ws);

    // Alice creates a session inviting Bob
    sessionStore.create({ creator: "@alice.bot", invitees: ["@bob.bot"] });

    const event = (await msgPromise) as Record<string, unknown>;
    assert.equal(event["type"], "session.invited");
    assert.equal((event["payload"] as Record<string, unknown>)["invitee"], "@bob.bot");

    ws.close();
    wsHub.close();
    await server.close();
  });

  it("does not deliver events to non-participants", async () => {
    const { server, agentStore, sessionStore, wsHub } = await setupWithWS();

    agentStore.register("@alice.bot", { policy: "open" });
    const bob = agentStore.register("@bob.bot", { policy: "open" });

    const ws = connectWS(server.port, bob.token);
    await wsOpen(ws);

    let received = false;
    ws.on("message", () => { received = true; });

    // Alice creates a session WITHOUT inviting Bob
    const { session } = sessionStore.create({ creator: "@alice.bot" });
    sessionStore.send(session.id, "@alice.bot", "private message");

    // Brief wait to confirm no message arrives
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(received, false);

    ws.close();
    wsHub.close();
    await server.close();
  });

  it("delivers session.ended to invited (not yet joined) participants", async () => {
    const { server, agentStore, sessionStore, wsHub } = await setupWithWS();

    agentStore.register("@alice.bot", { policy: "open" });
    const bob = agentStore.register("@bob.bot", { policy: "open" });

    const ws = connectWS(server.port, bob.token);
    await wsOpen(ws);

    // Collect invited + ended events
    const promise = collectMessages(ws, 2);

    const { session } = sessionStore.create({ creator: "@alice.bot", invitees: ["@bob.bot"] });
    sessionStore.end(session.id, "@alice.bot");

    const events = (await promise) as Array<Record<string, unknown>>;
    const types = events.map((e) => e["type"]);
    assert.ok(types.includes("session.invited"));
    assert.ok(types.includes("session.ended"));

    ws.close();
    wsHub.close();
    await server.close();
  });

  it("supports multiple simultaneous connections for the same agent", async () => {
    const { server, agentStore, sessionStore, wsHub } = await setupWithWS();

    const alice = agentStore.register("@alice.bot", { policy: "open" });
    const ws1 = connectWS(server.port, alice.token);
    const ws2 = connectWS(server.port, alice.token);
    await Promise.all([wsOpen(ws1), wsOpen(ws2)]);

    const p1 = nextMessage(ws1);
    const p2 = nextMessage(ws2);

    const { session } = sessionStore.create({ creator: "@alice.bot" });
    sessionStore.send(session.id, "@alice.bot", "broadcast");

    const [e1, e2] = await Promise.all([p1, p2]);
    assert.equal((e1 as Record<string, unknown>)["type"], "session.message");
    assert.equal((e2 as Record<string, unknown>)["type"], "session.message");

    ws1.close();
    ws2.close();
    wsHub.close();
    await server.close();
  });

  it("hub.close() drops live agent connections so server.close() resolves promptly", async () => {
    // Regression: previously hub.close() only terminated admin tap conns.
    // Per-agent connections stayed open, so the underlying http server's
    // close() blocked waiting for them — `asp stop` then timed out on the
    // 10-second SIGTERM grace and warned about needing --force.
    const { server, agentStore, wsHub } = await setupWithWS();

    const alice = agentStore.register("@alice.bot", { policy: "open" });
    const ws = connectWS(server.port, alice.token);
    await wsOpen(ws);

    wsHub.close();

    const t0 = Date.now();
    await server.close();
    const elapsed = Date.now() - t0;
    assert.ok(
      elapsed < 1000,
      `server.close() took ${elapsed}ms with one live agent connection — hub.close() did not terminate it`,
    );
  });
});
