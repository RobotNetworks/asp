import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  AgentExistsError,
  InMemoryAgentStore,
} from "../src/server/store/agents.js";

describe("InMemoryAgentStore", () => {
  it("registers an agent with a generated token", () => {
    const store = new InMemoryAgentStore();
    const agent = store.register("@alice.bot");
    assert.equal(agent.handle, "@alice.bot");
    assert.equal(typeof agent.token, "string");
    assert.ok(agent.token.length > 0);
    assert.equal(agent.policy, "allowlist");
    assert.deepEqual([...agent.allowlist], []);
  });

  it("defaults policy to allowlist", () => {
    const store = new InMemoryAgentStore();
    const agent = store.register("@alice.bot");
    assert.equal(agent.policy, "allowlist");
  });

  it("accepts an explicit open policy", () => {
    const store = new InMemoryAgentStore();
    const agent = store.register("@alice.bot", { policy: "open" });
    assert.equal(agent.policy, "open");
  });

  it("throws AgentExistsError on duplicate handle", () => {
    const store = new InMemoryAgentStore();
    store.register("@alice.bot");
    assert.throws(() => store.register("@alice.bot"), AgentExistsError);
  });

  it("throws on invalid handle", () => {
    const store = new InMemoryAgentStore();
    assert.throws(() => store.register("not-valid"), /invalid handle/);
  });

  it("get returns undefined for unknown handle", () => {
    const store = new InMemoryAgentStore();
    assert.equal(store.get("@ghost.bot"), undefined);
  });

  it("get returns the agent after registration", () => {
    const store = new InMemoryAgentStore();
    const agent = store.register("@alice.bot");
    assert.deepEqual(store.get("@alice.bot"), agent);
  });

  it("byToken returns the agent", () => {
    const store = new InMemoryAgentStore();
    const agent = store.register("@alice.bot");
    assert.deepEqual(store.byToken(agent.token), agent);
  });

  it("byToken returns undefined for unknown token", () => {
    const store = new InMemoryAgentStore();
    assert.equal(store.byToken("bogus"), undefined);
  });

  it("remove deletes the agent and its token mapping", () => {
    const store = new InMemoryAgentStore();
    const agent = store.register("@alice.bot");
    assert.equal(store.remove("@alice.bot"), true);
    assert.equal(store.get("@alice.bot"), undefined);
    assert.equal(store.byToken(agent.token), undefined);
  });

  it("remove returns false for unknown handle", () => {
    const store = new InMemoryAgentStore();
    assert.equal(store.remove("@ghost.bot"), false);
  });

  it("list returns agents sorted by handle", () => {
    const store = new InMemoryAgentStore();
    store.register("@zara.bot");
    store.register("@alice.bot");
    store.register("@bob.bot");
    const handles = store.list().map((a) => a.handle);
    assert.deepEqual(handles, ["@alice.bot", "@bob.bot", "@zara.bot"]);
  });

  it("list returns empty array when no agents", () => {
    const store = new InMemoryAgentStore();
    assert.deepEqual([...store.list()], []);
  });

  it("rotateToken issues a new token and invalidates the old one", () => {
    const store = new InMemoryAgentStore();
    const agent = store.register("@alice.bot");
    const oldToken = agent.token;
    const next = store.rotateToken("@alice.bot");
    assert.ok(next);
    assert.notEqual(next.token, oldToken);
    assert.equal(store.byToken(oldToken), undefined);
    assert.deepEqual(store.byToken(next.token), next);
  });

  it("rotateToken returns undefined for unknown handle", () => {
    const store = new InMemoryAgentStore();
    assert.equal(store.rotateToken("@ghost.bot"), undefined);
  });

  it("setPolicy updates the policy", () => {
    const store = new InMemoryAgentStore();
    store.register("@alice.bot");
    const updated = store.setPolicy("@alice.bot", "open");
    assert.equal(updated?.policy, "open");
    assert.equal(store.get("@alice.bot")?.policy, "open");
  });

  it("setPolicy returns undefined for unknown handle", () => {
    const store = new InMemoryAgentStore();
    assert.equal(store.setPolicy("@ghost.bot", "open"), undefined);
  });

  it("allows re-registering a handle after removal", () => {
    const store = new InMemoryAgentStore();
    store.register("@alice.bot");
    store.remove("@alice.bot");
    assert.doesNotThrow(() => store.register("@alice.bot"));
  });
});
