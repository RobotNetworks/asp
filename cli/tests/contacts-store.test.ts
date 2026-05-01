import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  ContactError,
  InMemoryContactStore,
} from "../src/server/store/contacts.js";

function make() {
  return new InMemoryContactStore();
}

describe("InMemoryContactStore/create", () => {
  it("creates a pending contact request", () => {
    const store = make();
    const req = store.create("@alice.bot", "@bob.bot");
    assert.ok(req.id.startsWith("req_"));
    assert.equal(req.from, "@alice.bot");
    assert.equal(req.to, "@bob.bot");
    assert.equal(req.status, "pending");
    assert.equal(req.message, undefined);
    assert.equal(typeof req.created_at, "number");
  });

  it("stores an optional message", () => {
    const store = make();
    const req = store.create("@alice.bot", "@bob.bot", "hey!");
    assert.equal(req.message, "hey!");
  });
});

describe("InMemoryContactStore/accept", () => {
  it("transitions status to accepted", () => {
    const store = make();
    const { id } = store.create("@alice.bot", "@bob.bot");
    const accepted = store.accept(id, "@bob.bot");
    assert.equal(accepted.status, "accepted");
    assert.ok(accepted.resolved_at !== undefined);
  });

  it("throws not_found for an unknown request id", () => {
    const store = make();
    assert.throws(
      () => store.accept("cr_NOPE", "@bob.bot"),
      (e: unknown) => e instanceof ContactError && e.code === "not_found",
    );
  });

  it("throws not_recipient when caller is not the `to` agent", () => {
    const store = make();
    const { id } = store.create("@alice.bot", "@bob.bot");
    assert.throws(
      () => store.accept(id, "@alice.bot"),
      (e: unknown) => e instanceof ContactError && e.code === "not_recipient",
    );
  });

  it("throws not_pending when the request is already accepted", () => {
    const store = make();
    const { id } = store.create("@alice.bot", "@bob.bot");
    store.accept(id, "@bob.bot");
    assert.throws(
      () => store.accept(id, "@bob.bot"),
      (e: unknown) => e instanceof ContactError && e.code === "not_pending",
    );
  });
});

describe("InMemoryContactStore/decline", () => {
  it("transitions status to declined", () => {
    const store = make();
    const { id } = store.create("@alice.bot", "@bob.bot");
    const declined = store.decline(id, "@bob.bot");
    assert.equal(declined.status, "declined");
    assert.ok(declined.resolved_at !== undefined);
  });

  it("throws not_recipient when caller is not the `to` agent", () => {
    const store = make();
    const { id } = store.create("@alice.bot", "@bob.bot");
    assert.throws(
      () => store.decline(id, "@carol.bot"),
      (e: unknown) => e instanceof ContactError && e.code === "not_recipient",
    );
  });

  it("throws not_pending when the request is already declined", () => {
    const store = make();
    const { id } = store.create("@alice.bot", "@bob.bot");
    store.decline(id, "@bob.bot");
    assert.throws(
      () => store.decline(id, "@bob.bot"),
      (e: unknown) => e instanceof ContactError && e.code === "not_pending",
    );
  });
});

describe("InMemoryContactStore/listForAgent", () => {
  it("returns requests where the agent is sender or recipient", () => {
    const store = make();
    store.create("@alice.bot", "@bob.bot");
    store.create("@carol.bot", "@alice.bot");
    store.create("@bob.bot", "@carol.bot");
    const alice = store.listForAgent("@alice.bot");
    assert.equal(alice.length, 2);
    assert.ok(alice.every((r) => r.from === "@alice.bot" || r.to === "@alice.bot"));
  });

  it("returns empty array for an agent with no requests", () => {
    const store = make();
    assert.deepEqual(store.listForAgent("@ghost.bot"), []);
  });
});

describe("InMemoryContactStore/get", () => {
  it("returns the request by id", () => {
    const store = make();
    const created = store.create("@alice.bot", "@bob.bot");
    const found = store.get(created.id);
    assert.deepEqual(found, created);
  });

  it("returns undefined for an unknown id", () => {
    const store = make();
    assert.equal(store.get("cr_NOPE"), undefined);
  });
});
