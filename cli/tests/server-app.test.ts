import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { buildApp } from "../src/server/app.js";
import { InMemoryAgentStore } from "../src/server/store/agents.js";
import { InMemoryContactStore } from "../src/server/store/contacts.js";
import { InMemorySessionStore } from "../src/server/store/sessions.js";
import { PACKAGE_VERSION } from "../src/version.js";

function makeCtx(network = "test-net") {
  return {
    network,
    store: new InMemoryAgentStore(),
    sessionStore: new InMemorySessionStore(),
    contactStore: new InMemoryContactStore(),
    adminToken: "test-token",
  };
}

describe("server/app", () => {
  it("answers GET /health with the network name and CLI version", async () => {
    const app = buildApp(makeCtx());
    const res = await app.request("/health");

    assert.equal(res.status, 200);
    const body = (await res.json()) as Record<string, unknown>;
    assert.deepEqual(body, {
      status: "ok",
      network: "test-net",
      version: PACKAGE_VERSION,
    });
  });

  it("404s on unknown routes (no leak from default handler)", async () => {
    const app = buildApp(makeCtx());
    const res = await app.request("/does-not-exist");
    assert.equal(res.status, 404);
  });
});
