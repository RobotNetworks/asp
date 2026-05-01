import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { buildApp } from "../src/server/app.js";
import { startServer } from "../src/server/runtime.js";
import { InMemoryAgentStore } from "../src/server/store/agents.js";
import { InMemorySessionStore } from "../src/server/store/sessions.js";

function makeApp(resetFn?: () => void) {
  const store = new InMemoryAgentStore();
  const sessionStore = new InMemorySessionStore();
  const app = buildApp({
    network: "test",
    store,
    sessionStore,
    adminToken: "admin-tok",
    resetFn,
  });
  return { app, store };
}

describe("POST /_admin/reset", () => {
  it("returns 204 and calls resetFn when provided", async () => {
    let called = false;
    const { app } = makeApp(() => { called = true; });
    const server = await startServer({ app, host: "127.0.0.1", port: 0 });
    const res = await fetch(`http://127.0.0.1:${server.port}/_admin/reset`, {
      method: "POST",
      headers: { Authorization: "Bearer admin-tok" },
    });
    assert.equal(res.status, 204);
    assert.equal(called, true);
    await server.close();
  });

  it("returns 404 when resetFn is not provided", async () => {
    const { app } = makeApp();
    const server = await startServer({ app, host: "127.0.0.1", port: 0 });
    const res = await fetch(`http://127.0.0.1:${server.port}/_admin/reset`, {
      method: "POST",
      headers: { Authorization: "Bearer admin-tok" },
    });
    // Route does not exist — Hono returns 404
    assert.equal(res.status, 404);
    await server.close();
  });

  it("requires admin auth", async () => {
    const { app } = makeApp(() => {});
    const server = await startServer({ app, host: "127.0.0.1", port: 0 });
    const res = await fetch(`http://127.0.0.1:${server.port}/_admin/reset`, {
      method: "POST",
      headers: { Authorization: "Bearer wrong-token" },
    });
    assert.equal(res.status, 401);
    await server.close();
  });
});
