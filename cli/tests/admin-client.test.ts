import { strict as assert } from "node:assert";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import {
  AdminApiError,
  AdminClient,
  NetworkNotRunningError,
  connectAdmin,
} from "../src/client/admin.js";
import { buildApp } from "../src/server/app.js";
import { startServer } from "../src/server/runtime.js";
import { InMemoryAgentStore } from "../src/server/store/agents.js";
import { InMemorySessionStore } from "../src/server/store/sessions.js";
import { networkPaths } from "../src/paths.js";
import { writeRegistry, upsertEntry } from "../src/registry.js";

const ADMIN_TOKEN = "test-admin-token-for-client-tests";

// ── AdminClient (unit against an in-process server) ──────────────────────────

describe("AdminClient", () => {
  let handle: { port: number; close: () => Promise<void> };
  let store: InMemoryAgentStore;
  let client: AdminClient;

  beforeEach(async () => {
    store = new InMemoryAgentStore();
    const app = buildApp({ network: "test", store, sessionStore: new InMemorySessionStore(), adminToken: ADMIN_TOKEN });
    handle = await startServer({ app, host: "127.0.0.1", port: 0 });
    client = new AdminClient(
      `http://127.0.0.1:${handle.port}`,
      ADMIN_TOKEN,
    );
  });

  afterEach(() => handle.close());

  it("registerAgent creates an agent with default policy", async () => {
    const agent = await client.registerAgent("@alice.bot");
    assert.equal(agent.handle, "@alice.bot");
    assert.equal(agent.policy, "allowlist");
    assert.equal(typeof agent.token, "string");
    assert.ok(agent.token.length > 0);
  });

  it("registerAgent accepts an explicit policy", async () => {
    const agent = await client.registerAgent("@alice.bot", { policy: "open" });
    assert.equal(agent.policy, "open");
  });

  it("registerAgent throws AdminApiError(409) for a duplicate handle", async () => {
    await client.registerAgent("@alice.bot");
    await assert.rejects(
      client.registerAgent("@alice.bot"),
      (err: unknown) => err instanceof AdminApiError && err.status === 409,
    );
  });

  it("registerAgent throws AdminApiError(400) for an invalid handle", async () => {
    await assert.rejects(
      client.registerAgent("not-a-handle"),
      (err: unknown) => err instanceof AdminApiError && err.status === 400,
    );
  });

  it("listAgents returns an empty array when no agents exist", async () => {
    const agents = await client.listAgents();
    assert.deepEqual(agents, []);
  });

  it("listAgents returns all agents sorted by handle", async () => {
    await client.registerAgent("@zara.bot");
    await client.registerAgent("@alice.bot");
    const agents = await client.listAgents();
    assert.deepEqual(
      agents.map((a) => a.handle),
      ["@alice.bot", "@zara.bot"],
    );
  });

  it("showAgent returns the agent", async () => {
    const created = await client.registerAgent("@alice.bot");
    const shown = await client.showAgent("@alice.bot");
    assert.equal(shown.handle, created.handle);
    assert.equal(shown.token, created.token);
  });

  it("showAgent throws AdminApiError(404) for an unknown handle", async () => {
    await assert.rejects(
      client.showAgent("@ghost.bot"),
      (err: unknown) => err instanceof AdminApiError && err.status === 404,
    );
  });

  it("removeAgent deletes the agent", async () => {
    await client.registerAgent("@alice.bot");
    await client.removeAgent("@alice.bot");
    assert.equal(store.get("@alice.bot"), undefined);
  });

  it("removeAgent throws AdminApiError(404) for an unknown handle", async () => {
    await assert.rejects(
      client.removeAgent("@ghost.bot"),
      (err: unknown) => err instanceof AdminApiError && err.status === 404,
    );
  });

  it("rotateToken returns an agent with a new token", async () => {
    const original = await client.registerAgent("@alice.bot");
    const rotated = await client.rotateToken("@alice.bot");
    assert.notEqual(rotated.token, original.token);
    assert.equal(rotated.handle, "@alice.bot");
  });

  it("rotateToken throws AdminApiError(404) for an unknown handle", async () => {
    await assert.rejects(
      client.rotateToken("@ghost.bot"),
      (err: unknown) => err instanceof AdminApiError && err.status === 404,
    );
  });

  it("setPolicy updates the policy", async () => {
    await client.registerAgent("@alice.bot");
    const updated = await client.setPolicy("@alice.bot", "open");
    assert.equal(updated.policy, "open");
  });

  it("setPolicy throws AdminApiError(404) for an unknown handle", async () => {
    await assert.rejects(
      client.setPolicy("@ghost.bot", "open"),
      (err: unknown) => err instanceof AdminApiError && err.status === 404,
    );
  });

  it("throws when the server is unreachable", async () => {
    const dead = new AdminClient("http://127.0.0.1:1", ADMIN_TOKEN);
    await assert.rejects(dead.listAgents(), /could not reach network/);
  });
});

// ── connectAdmin ──────────────────────────────────────────────────────────────

describe("connectAdmin", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "asp-connect-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("throws NetworkNotRunningError when the network has no registry entry", async () => {
    await assert.rejects(
      connectAdmin("default", tmpDir),
      NetworkNotRunningError,
    );
  });

  it("throws NetworkNotRunningError when the admin token file is missing", async () => {
    const entry = {
      name: "default",
      pid: process.pid,
      host: "127.0.0.1",
      port: 9999,
      startedAt: Date.now(),
      version: "0.0.0",
    };
    await writeRegistry(tmpDir, upsertEntry({ version: 1, networks: {} }, entry));
    // No token file written → should throw
    await assert.rejects(
      connectAdmin("default", tmpDir),
      NetworkNotRunningError,
    );
  });

  it("returns a working AdminClient when everything is on disk", async () => {
    const store = new InMemoryAgentStore();
    const app = buildApp({ network: "default", store, sessionStore: new InMemorySessionStore(), adminToken: ADMIN_TOKEN });
    const server = await startServer({ app, host: "127.0.0.1", port: 0 });

    try {
      const entry = {
        name: "default",
        pid: process.pid,
        host: "127.0.0.1",
        port: server.port,
        startedAt: Date.now(),
        version: "0.0.0",
      };
      await writeRegistry(
        tmpDir,
        upsertEntry({ version: 1, networks: {} }, entry),
      );
      const paths = networkPaths(tmpDir, "default");
      await mkdir(paths.networkDir, { recursive: true });
      await writeFile(paths.adminTokenFile, `${ADMIN_TOKEN}\n`, {
        mode: 0o600,
      });

      const client = await connectAdmin("default", tmpDir);
      const agents = await client.listAgents();
      assert.deepEqual(agents, []);
    } finally {
      await server.close();
    }
  });
});
