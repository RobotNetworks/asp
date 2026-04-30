import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  InMemorySessionStore,
  SessionError,
} from "../src/server/store/sessions.js";

function make() {
  return new InMemorySessionStore();
}

describe("InMemorySessionStore/create", () => {
  it("creates a session and returns the session id", () => {
    const store = make();
    const { session } = store.create({ creator: "@alice.bot" });
    assert.ok(session.id.startsWith("sess_"));
    assert.equal(session.state, "active");
    assert.equal(session.participants.length, 1);
    assert.equal(session.participants[0]?.handle, "@alice.bot");
    assert.equal(session.participants[0]?.status, "joined");
  });

  it("stores the topic when provided", () => {
    const store = make();
    const { session } = store.create({ creator: "@alice.bot", topic: "hello" });
    assert.equal(session.topic, "hello");
  });

  it("adds invitees as invited participants and returns no messageSequence", () => {
    const store = make();
    const { session, messageSequence } = store.create({
      creator: "@alice.bot",
      invitees: ["@bob.bot"],
    });
    assert.equal(messageSequence, undefined);
    assert.equal(session.participants.length, 2);
    const bob = session.participants.find((p) => p.handle === "@bob.bot");
    assert.equal(bob?.status, "invited");
  });

  it("emits session.invited events for invitees", () => {
    const store = make();
    const { session } = store.create({
      creator: "@alice.bot",
      invitees: ["@bob.bot"],
    });
    const events = store.getEvents(session.id, "@alice.bot");
    assert.ok(events);
    const invited = events.filter((e) => e.type === "session.invited");
    assert.equal(invited.length, 1);
    assert.equal(invited[0]?.payload["invitee"], "@bob.bot");
    assert.equal(invited[0]?.payload["by"], "@alice.bot");
  });

  it("emits session.message and sets messageSequence for initial_message", () => {
    const store = make();
    const { session, messageSequence } = store.create({
      creator: "@alice.bot",
      initialMessage: { content: "hello!" },
    });
    assert.equal(typeof messageSequence, "number");
    const events = store.getEvents(session.id, "@alice.bot");
    assert.ok(events);
    const msg = events.find((e) => e.type === "session.message");
    assert.ok(msg);
    const payload = msg.payload as { content: string; sender: string };
    assert.equal(payload.content, "hello!");
    assert.equal(payload.sender, "@alice.bot");
  });

  it("ends the session immediately when end_after_send is true", () => {
    const store = make();
    const { session } = store.create({
      creator: "@alice.bot",
      initialMessage: { content: "one-shot" },
      endAfterSend: true,
    });
    assert.equal(session.state, "ended");
    assert.ok(session.ended_at !== undefined);
  });
});

describe("InMemorySessionStore/join", () => {
  it("transitions an invited participant to joined", () => {
    const store = make();
    const { session } = store.create({
      creator: "@alice.bot",
      invitees: ["@bob.bot"],
    });
    const updated = store.join(session.id, "@bob.bot");
    const bob = updated.participants.find((p) => p.handle === "@bob.bot");
    assert.equal(bob?.status, "joined");
    assert.ok(bob?.joined_at !== undefined);
  });

  it("emits session.joined", () => {
    const store = make();
    const { session } = store.create({ creator: "@alice.bot", invitees: ["@bob.bot"] });
    store.join(session.id, "@bob.bot");
    const events = store.getEvents(session.id, "@alice.bot")!;
    assert.ok(events.some((e) => e.type === "session.joined" && e.payload["agent"] === "@bob.bot"));
  });

  it("throws not_found for an unknown session", () => {
    const store = make();
    assert.throws(
      () => store.join("sess_NOPE", "@alice.bot"),
      (e: unknown) => e instanceof SessionError && e.code === "not_found",
    );
  });

  it("throws not_invited for a non-participant", () => {
    const store = make();
    const { session } = store.create({ creator: "@alice.bot" });
    assert.throws(
      () => store.join(session.id, "@bob.bot"),
      (e: unknown) => e instanceof SessionError && e.code === "not_invited",
    );
  });

  it("throws already_joined when already joined", () => {
    const store = make();
    const { session } = store.create({ creator: "@alice.bot", invitees: ["@bob.bot"] });
    store.join(session.id, "@bob.bot");
    assert.throws(
      () => store.join(session.id, "@bob.bot"),
      (e: unknown) => e instanceof SessionError && e.code === "already_joined",
    );
  });

  it("throws session_ended when session is ended", () => {
    const store = make();
    const { session } = store.create({ creator: "@alice.bot", invitees: ["@bob.bot"] });
    store.end(session.id, "@alice.bot");
    assert.throws(
      () => store.join(session.id, "@bob.bot"),
      (e: unknown) => e instanceof SessionError && e.code === "session_ended",
    );
  });
});

describe("InMemorySessionStore/invite", () => {
  it("adds a new participant as invited", () => {
    const store = make();
    const { session } = store.create({ creator: "@alice.bot" });
    const { invited } = store.invite(session.id, "@alice.bot", ["@bob.bot"]);
    assert.deepEqual([...invited], ["@bob.bot"]);
    const updated = store.get(session.id)!;
    assert.equal(updated.participants.find((p) => p.handle === "@bob.bot")?.status, "invited");
  });

  it("skips handles already in the session", () => {
    const store = make();
    const { session } = store.create({ creator: "@alice.bot", invitees: ["@bob.bot"] });
    const { invited } = store.invite(session.id, "@alice.bot", ["@bob.bot"]);
    assert.deepEqual([...invited], []);
  });

  it("throws not_joined when inviter is not joined", () => {
    const store = make();
    const { session } = store.create({ creator: "@alice.bot", invitees: ["@bob.bot"] });
    assert.throws(
      () => store.invite(session.id, "@bob.bot", ["@carol.bot"]),
      (e: unknown) => e instanceof SessionError && e.code === "not_joined",
    );
  });

  it("throws session_ended when session is ended", () => {
    const store = make();
    const { session } = store.create({ creator: "@alice.bot" });
    store.end(session.id, "@alice.bot");
    assert.throws(
      () => store.invite(session.id, "@alice.bot", ["@bob.bot"]),
      (e: unknown) => e instanceof SessionError && e.code === "session_ended",
    );
  });
});

describe("InMemorySessionStore/send", () => {
  it("returns a message id and sequence", () => {
    const store = make();
    const { session } = store.create({ creator: "@alice.bot" });
    const { messageId, sequence } = store.send(session.id, "@alice.bot", "hi!");
    assert.ok(messageId.startsWith("msg_"));
    assert.equal(typeof sequence, "number");
  });

  it("emits session.message with the content", () => {
    const store = make();
    const { session } = store.create({ creator: "@alice.bot" });
    store.send(session.id, "@alice.bot", "hello world");
    const events = store.getEvents(session.id, "@alice.bot")!;
    const msg = events.find((e) => e.type === "session.message");
    assert.ok(msg);
    assert.equal((msg.payload as { content: string }).content, "hello world");
  });

  it("throws not_joined when sender is not joined", () => {
    const store = make();
    const { session } = store.create({ creator: "@alice.bot", invitees: ["@bob.bot"] });
    assert.throws(
      () => store.send(session.id, "@bob.bot", "hi"),
      (e: unknown) => e instanceof SessionError && e.code === "not_joined",
    );
  });

  it("throws session_ended when session is ended", () => {
    const store = make();
    const { session } = store.create({ creator: "@alice.bot" });
    store.end(session.id, "@alice.bot");
    assert.throws(
      () => store.send(session.id, "@alice.bot", "too late"),
      (e: unknown) => e instanceof SessionError && e.code === "session_ended",
    );
  });
});

describe("InMemorySessionStore/leave", () => {
  it("sets participant status to left", () => {
    const store = make();
    const { session } = store.create({ creator: "@alice.bot", invitees: ["@bob.bot"] });
    store.join(session.id, "@bob.bot");
    const updated = store.leave(session.id, "@bob.bot");
    const bob = updated.participants.find((p) => p.handle === "@bob.bot");
    assert.equal(bob?.status, "left");
    assert.ok(bob?.left_at !== undefined);
  });

  it("throws not_joined when not joined", () => {
    const store = make();
    const { session } = store.create({ creator: "@alice.bot", invitees: ["@bob.bot"] });
    assert.throws(
      () => store.leave(session.id, "@bob.bot"),
      (e: unknown) => e instanceof SessionError && e.code === "not_joined",
    );
  });
});

describe("InMemorySessionStore/end", () => {
  it("sets session state to ended", () => {
    const store = make();
    const { session } = store.create({ creator: "@alice.bot" });
    const ended = store.end(session.id, "@alice.bot");
    assert.equal(ended.state, "ended");
    assert.ok(ended.ended_at !== undefined);
  });

  it("throws session_ended if already ended", () => {
    const store = make();
    const { session } = store.create({ creator: "@alice.bot" });
    store.end(session.id, "@alice.bot");
    assert.throws(
      () => store.end(session.id, "@alice.bot"),
      (e: unknown) => e instanceof SessionError && e.code === "session_ended",
    );
  });
});

describe("InMemorySessionStore/reopen", () => {
  it("sets state back to active", () => {
    const store = make();
    const { session } = store.create({ creator: "@alice.bot" });
    store.end(session.id, "@alice.bot");
    const reopened = store.reopen(session.id, "@alice.bot");
    assert.equal(reopened.state, "active");
    assert.equal(reopened.ended_at, undefined);
  });

  it("throws session_active if already active", () => {
    const store = make();
    const { session } = store.create({ creator: "@alice.bot" });
    assert.throws(
      () => store.reopen(session.id, "@alice.bot"),
      (e: unknown) => e instanceof SessionError && e.code === "session_active",
    );
  });

  it("throws not_participant if caller never joined", () => {
    const store = make();
    const { session } = store.create({ creator: "@alice.bot", invitees: ["@bob.bot"] });
    store.end(session.id, "@alice.bot");
    assert.throws(
      () => store.reopen(session.id, "@bob.bot"),
      (e: unknown) => e instanceof SessionError && e.code === "not_participant",
    );
  });

  it("re-invites other participants", () => {
    const store = make();
    const { session } = store.create({ creator: "@alice.bot", invitees: ["@bob.bot"] });
    store.join(session.id, "@bob.bot");
    store.end(session.id, "@alice.bot");
    const reopened = store.reopen(session.id, "@alice.bot");
    const bob = reopened.participants.find((p) => p.handle === "@bob.bot");
    assert.equal(bob?.status, "invited");
  });
});

describe("InMemorySessionStore/getEvents visibility", () => {
  it("joined participant sees all events", () => {
    const store = make();
    const { session } = store.create({ creator: "@alice.bot", invitees: ["@bob.bot"] });
    store.join(session.id, "@bob.bot");
    store.send(session.id, "@alice.bot", "hello");
    const events = store.getEvents(session.id, "@alice.bot")!;
    assert.ok(events.length >= 3); // invited + joined + message
  });

  it("invited participant sees only own invited event and session.ended", () => {
    const store = make();
    const { session } = store.create({ creator: "@alice.bot", invitees: ["@bob.bot"] });
    store.send(session.id, "@alice.bot", "hi");
    store.end(session.id, "@alice.bot");
    const events = store.getEvents(session.id, "@bob.bot")!;
    assert.ok(events.length >= 1);
    assert.ok(events.every((e) => e.type === "session.invited" || e.type === "session.ended"));
  });

  it("left participant sees events only up to their leave", () => {
    const store = make();
    const { session } = store.create({ creator: "@alice.bot", invitees: ["@bob.bot"] });
    store.join(session.id, "@bob.bot");
    store.leave(session.id, "@bob.bot");
    const leftSeq = store.getEvents(session.id, "@alice.bot")!
      .find((e) => e.type === "session.left")!.sequence;
    // Send more messages after bob left
    store.send(session.id, "@alice.bot", "after bob left");
    const bobEvents = store.getEvents(session.id, "@bob.bot")!;
    assert.ok(bobEvents.every((e) => e.sequence <= leftSeq));
  });

  it("returns null for a non-participant", () => {
    const store = make();
    const { session } = store.create({ creator: "@alice.bot" });
    assert.equal(store.getEvents(session.id, "@ghost.bot"), null);
  });

  it("returns null for an unknown session", () => {
    const store = make();
    assert.equal(store.getEvents("sess_NOPE", "@alice.bot"), null);
  });

  it("respects afterSequence cursor", () => {
    const store = make();
    const { session } = store.create({ creator: "@alice.bot" });
    store.send(session.id, "@alice.bot", "first");
    store.send(session.id, "@alice.bot", "second");
    const all = store.getEvents(session.id, "@alice.bot")!;
    const firstMsgSeq = all.find((e) => e.type === "session.message")!.sequence;
    const after = store.getEvents(session.id, "@alice.bot", { afterSequence: firstMsgSeq })!;
    assert.ok(after.every((e) => e.sequence > firstMsgSeq));
  });

  it("respects limit", () => {
    const store = make();
    const { session } = store.create({ creator: "@alice.bot" });
    for (let i = 0; i < 5; i++) store.send(session.id, "@alice.bot", `msg ${i}`);
    const limited = store.getEvents(session.id, "@alice.bot", { limit: 2 })!;
    assert.equal(limited.length, 2);
  });
});

describe("InMemorySessionStore/list", () => {
  it("returns sessions where the viewer is a participant", () => {
    const store = make();
    store.create({ creator: "@alice.bot" });
    store.create({ creator: "@bob.bot" });
    const alice = store.list("@alice.bot");
    assert.equal(alice.length, 1);
    assert.equal(alice[0]?.participants[0]?.handle, "@alice.bot");
  });

  it("returns empty for a non-participant", () => {
    const store = make();
    store.create({ creator: "@alice.bot" });
    assert.equal(store.list("@carol.bot").length, 0);
  });
});
