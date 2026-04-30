import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { buildAdminApp } from "../src/server/admin/index.js";
import { InMemoryAgentStore } from "../src/server/store/agents.js";

const TOKEN = "super-secret-admin-token";

function makeApp() {
  return buildAdminApp(new InMemoryAgentStore(), TOKEN);
}

function auth(): HeadersInit {
  return { Authorization: `Bearer ${TOKEN}` };
}

async function json(res: Response): Promise<unknown> {
  return res.json();
}

// ── auth guard ──────────────────────────────────────────────────────────────

describe("admin auth", () => {
  it("rejects requests with no Authorization header", async () => {
    const app = makeApp();
    const res = await app.request("/agents");
    assert.equal(res.status, 401);
    const body = (await json(res)) as { error: string };
    assert.equal(body.error, "missing_authorization");
  });

  it("rejects requests with a wrong token", async () => {
    const app = makeApp();
    const res = await app.request("/agents", {
      headers: { Authorization: "Bearer wrong-token" },
    });
    assert.equal(res.status, 401);
    const body = (await json(res)) as { error: string };
    assert.equal(body.error, "invalid_authorization");
  });

  it("rejects a malformed Authorization header (no bearer prefix)", async () => {
    const app = makeApp();
    const res = await app.request("/agents", {
      headers: { Authorization: TOKEN },
    });
    assert.equal(res.status, 401);
  });
});

// ── POST /agents ─────────────────────────────────────────────────────────────

describe("POST /agents", () => {
  it("registers an agent and returns 201", async () => {
    const app = makeApp();
    const res = await app.request("/agents", {
      method: "POST",
      headers: { ...auth(), "Content-Type": "application/json" },
      body: JSON.stringify({ handle: "@alice.bot" }),
    });
    assert.equal(res.status, 201);
    const body = (await json(res)) as Record<string, unknown>;
    assert.equal(body["handle"], "@alice.bot");
    assert.equal(typeof body["token"], "string");
    assert.equal(body["policy"], "allowlist");
    assert.deepEqual(body["allowlist"], []);
  });

  it("accepts an explicit policy", async () => {
    const app = makeApp();
    const res = await app.request("/agents", {
      method: "POST",
      headers: { ...auth(), "Content-Type": "application/json" },
      body: JSON.stringify({ handle: "@alice.bot", policy: "open" }),
    });
    assert.equal(res.status, 201);
    const body = (await json(res)) as { policy: string };
    assert.equal(body.policy, "open");
  });

  it("returns 409 for a duplicate handle", async () => {
    const app = makeApp();
    const post = () =>
      app.request("/agents", {
        method: "POST",
        headers: { ...auth(), "Content-Type": "application/json" },
        body: JSON.stringify({ handle: "@alice.bot" }),
      });
    await post();
    const res = await post();
    assert.equal(res.status, 409);
    const body = (await json(res)) as { error: string };
    assert.equal(body.error, "agent_exists");
  });

  it("returns 400 for an invalid handle", async () => {
    const app = makeApp();
    const res = await app.request("/agents", {
      method: "POST",
      headers: { ...auth(), "Content-Type": "application/json" },
      body: JSON.stringify({ handle: "no-at-sign" }),
    });
    assert.equal(res.status, 400);
    const body = (await json(res)) as { error: string };
    assert.equal(body.error, "invalid_handle");
  });

  it("returns 400 for an invalid policy", async () => {
    const app = makeApp();
    const res = await app.request("/agents", {
      method: "POST",
      headers: { ...auth(), "Content-Type": "application/json" },
      body: JSON.stringify({ handle: "@alice.bot", policy: "unknown" }),
    });
    assert.equal(res.status, 400);
    const body = (await json(res)) as { error: string };
    assert.equal(body.error, "invalid_policy");
  });

  it("returns 400 for non-JSON body", async () => {
    const app = makeApp();
    const res = await app.request("/agents", {
      method: "POST",
      headers: { ...auth(), "Content-Type": "application/json" },
      body: "not json{{{",
    });
    assert.equal(res.status, 400);
  });
});

// ── GET /agents ───────────────────────────────────────────────────────────────

describe("GET /agents", () => {
  it("returns an empty list when no agents exist", async () => {
    const app = makeApp();
    const res = await app.request("/agents", { headers: auth() });
    assert.equal(res.status, 200);
    const body = (await json(res)) as { agents: unknown[] };
    assert.deepEqual(body.agents, []);
  });

  it("returns all registered agents sorted by handle", async () => {
    const store = new InMemoryAgentStore();
    store.register("@zara.bot");
    store.register("@alice.bot");
    const app = buildAdminApp(store, TOKEN);
    const res = await app.request("/agents", { headers: auth() });
    const body = (await json(res)) as { agents: Array<{ handle: string }> };
    assert.deepEqual(
      body.agents.map((a) => a.handle),
      ["@alice.bot", "@zara.bot"],
    );
  });
});

// ── GET /agents/:handle ───────────────────────────────────────────────────────

describe("GET /agents/:handle", () => {
  it("returns the agent when found", async () => {
    const store = new InMemoryAgentStore();
    const agent = store.register("@alice.bot");
    const app = buildAdminApp(store, TOKEN);
    const res = await app.request("/agents/@alice.bot", {
      headers: auth(),
    });
    assert.equal(res.status, 200);
    const body = (await json(res)) as { handle: string; token: string };
    assert.equal(body.handle, "@alice.bot");
    assert.equal(body.token, agent.token);
  });

  it("returns 404 for an unknown handle", async () => {
    const app = makeApp();
    const res = await app.request("/agents/@ghost.bot", {
      headers: auth(),
    });
    assert.equal(res.status, 404);
  });
});

// ── DELETE /agents/:handle ────────────────────────────────────────────────────

describe("DELETE /agents/:handle", () => {
  it("deletes the agent and returns 204", async () => {
    const store = new InMemoryAgentStore();
    store.register("@alice.bot");
    const app = buildAdminApp(store, TOKEN);
    const res = await app.request("/agents/@alice.bot", {
      method: "DELETE",
      headers: auth(),
    });
    assert.equal(res.status, 204);
    assert.equal(store.get("@alice.bot"), undefined);
  });

  it("returns 404 for an unknown handle", async () => {
    const app = makeApp();
    const res = await app.request("/agents/@ghost.bot", {
      method: "DELETE",
      headers: auth(),
    });
    assert.equal(res.status, 404);
  });
});

// ── POST /agents/:handle/rotate-token ─────────────────────────────────────────

describe("POST /agents/:handle/rotate-token", () => {
  it("returns a new token", async () => {
    const store = new InMemoryAgentStore();
    const original = store.register("@alice.bot");
    const app = buildAdminApp(store, TOKEN);
    const res = await app.request(
      "/agents/@alice.bot/rotate-token",
      { method: "POST", headers: auth() },
    );
    assert.equal(res.status, 200);
    const body = (await json(res)) as { token: string };
    assert.notEqual(body.token, original.token);
  });

  it("returns 404 for an unknown handle", async () => {
    const app = makeApp();
    const res = await app.request(
      "/agents/@ghost.bot/rotate-token",
      { method: "POST", headers: auth() },
    );
    assert.equal(res.status, 404);
  });
});

// ── PATCH /agents/:handle ─────────────────────────────────────────────────────

describe("PATCH /agents/:handle", () => {
  it("updates the policy", async () => {
    const store = new InMemoryAgentStore();
    store.register("@alice.bot");
    const app = buildAdminApp(store, TOKEN);
    const res = await app.request("/agents/@alice.bot", {
      method: "PATCH",
      headers: { ...auth(), "Content-Type": "application/json" },
      body: JSON.stringify({ policy: "open" }),
    });
    assert.equal(res.status, 200);
    const body = (await json(res)) as { policy: string };
    assert.equal(body.policy, "open");
  });

  it("returns 404 for an unknown handle", async () => {
    const app = makeApp();
    const res = await app.request("/agents/@ghost.bot", {
      method: "PATCH",
      headers: { ...auth(), "Content-Type": "application/json" },
      body: JSON.stringify({ policy: "open" }),
    });
    assert.equal(res.status, 404);
  });

  it("returns 400 for an invalid policy value", async () => {
    const store = new InMemoryAgentStore();
    store.register("@alice.bot");
    const app = buildAdminApp(store, TOKEN);
    const res = await app.request("/agents/@alice.bot", {
      method: "PATCH",
      headers: { ...auth(), "Content-Type": "application/json" },
      body: JSON.stringify({ policy: "nonsense" }),
    });
    assert.equal(res.status, 400);
  });

  it("returns 400 for a non-object body", async () => {
    const store = new InMemoryAgentStore();
    store.register("@alice.bot");
    const app = buildAdminApp(store, TOKEN);
    const res = await app.request("/agents/@alice.bot", {
      method: "PATCH",
      headers: { ...auth(), "Content-Type": "application/json" },
      body: JSON.stringify([1, 2, 3]),
    });
    assert.equal(res.status, 400);
  });

  it("no-op PATCH (empty body) returns the current agent unchanged", async () => {
    const store = new InMemoryAgentStore();
    const original = store.register("@alice.bot");
    const app = buildAdminApp(store, TOKEN);
    const res = await app.request("/agents/@alice.bot", {
      method: "PATCH",
      headers: { ...auth(), "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 200);
    const body = (await json(res)) as { policy: string; token: string };
    assert.equal(body.policy, original.policy);
    assert.equal(body.token, original.token);
  });
});
