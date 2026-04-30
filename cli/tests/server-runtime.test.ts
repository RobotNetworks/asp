import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { buildApp } from "../src/server/app.js";
import { startServer } from "../src/server/runtime.js";
import { InMemoryAgentStore } from "../src/server/store/agents.js";

function makeCtx(network: string) {
  return { network, store: new InMemoryAgentStore(), adminToken: "test-token" };
}

describe("server/runtime", () => {
  it("binds an ephemeral port, serves /health, and closes cleanly", async () => {
    const app = buildApp(makeCtx("rt-test"));
    const handle = await startServer({ app, host: "127.0.0.1", port: 0 });

    try {
      assert.ok(handle.port > 0, "ephemeral port should be assigned");
      const res = await fetch(`http://127.0.0.1:${handle.port}/health`);
      assert.equal(res.status, 200);
      const body = (await res.json()) as { network: string };
      assert.equal(body.network, "rt-test");
    } finally {
      await handle.close();
    }

    // After close(), the port should no longer accept connections. We don't
    // assert on a specific error code (the kernel reuses ports quickly and
    // a fresh listener could appear), but the fetch must not succeed.
    let stillOpen = false;
    try {
      const res = await fetch(`http://127.0.0.1:${handle.port}/health`);
      stillOpen = res.ok;
    } catch {
      stillOpen = false;
    }
    assert.equal(stillOpen, false);
  });

  it("rejects when the requested port is unavailable", async () => {
    const app = buildApp(makeCtx("rt-test"));
    const first = await startServer({ app, host: "127.0.0.1", port: 0 });

    try {
      await assert.rejects(
        startServer({
          app: buildApp(makeCtx("rt-test-2")),
          host: "127.0.0.1",
          port: first.port,
        }),
        /EADDRINUSE/,
      );
    } finally {
      await first.close();
    }
  });
});
