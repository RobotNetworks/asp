import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  allowlistEntriesArg,
  assertValidHandle,
  handleArg,
  handlesArg,
  isValidAllowlistEntry,
  isValidHandle,
} from "../src/handles.js";

describe("handles", () => {
  describe("isValidHandle", () => {
    const valid = [
      "@alice.bot",
      "@owner.name",
      "@a.b",
      "@a1.b2",
      "@foo-bar.baz_qux",
    ];
    for (const h of valid) {
      it(`accepts ${h}`, () => assert.equal(isValidHandle(h), true));
    }

    const invalid = [
      "alice.bot",        // missing @
      "@alice",           // missing dot / name part
      "@alice.",          // empty name
      "@.bot",            // empty owner
      "@ALICE.bot",       // uppercase
      "@alice.BOT",       // uppercase
      "@alice.bot/extra", // trailing slash
      "@alice.bot extra", // space
      "",
      42,
      null,
      undefined,
    ];
    for (const h of invalid) {
      it(`rejects ${JSON.stringify(h)}`, () =>
        assert.equal(isValidHandle(h), false));
    }
  });

  describe("isValidAllowlistEntry", () => {
    it("accepts a specific handle", () =>
      assert.equal(isValidAllowlistEntry("@alice.bot"), true));
    it("accepts a wildcard name", () =>
      assert.equal(isValidAllowlistEntry("@alice.*"), true));
    it("rejects double wildcard", () =>
      assert.equal(isValidAllowlistEntry("@*.*"), false));
    it("rejects wildcard in owner", () =>
      assert.equal(isValidAllowlistEntry("@*.bot"), false));
    it("rejects bare *", () =>
      assert.equal(isValidAllowlistEntry("*"), false));
  });

  describe("assertValidHandle", () => {
    it("does not throw for a valid handle", () =>
      assert.doesNotThrow(() => assertValidHandle("@alice.bot")));
    it("throws for an invalid handle", () =>
      assert.throws(() => assertValidHandle("not-a-handle"), /invalid handle/));
  });

  describe("handleArg (commander argParser)", () => {
    it("returns the value when valid", () =>
      assert.equal(handleArg("@alice.bot"), "@alice.bot"));
    it("throws on a missing @ prefix — fails CLI parse before any network call", () =>
      assert.throws(() => handleArg("alice.bot"), /invalid handle "alice\.bot"/));
    it("throws on uppercase", () =>
      assert.throws(() => handleArg("@Alice.Bot"), /invalid handle/));
  });

  describe("handlesArg (variadic <handles...>)", () => {
    it("collects valid handles into an array", () => {
      const after1 = handlesArg("@a.bot", undefined);
      const after2 = handlesArg("@b.bot", after1);
      assert.deepEqual(after2, ["@a.bot", "@b.bot"]);
    });
    it("throws on the first invalid handle in the list", () =>
      assert.throws(() => handlesArg("nope", undefined), /invalid handle "nope"/));
  });

  describe("allowlistEntriesArg", () => {
    it("accepts handles and globs", () => {
      const after1 = allowlistEntriesArg("@a.bot", undefined);
      const after2 = allowlistEntriesArg("@vendor.*", after1);
      assert.deepEqual(after2, ["@a.bot", "@vendor.*"]);
    });
    it("throws on bare *", () =>
      assert.throws(() => allowlistEntriesArg("*", undefined), /invalid allowlist entry/));
    it("throws on a missing @", () =>
      assert.throws(() => allowlistEntriesArg("alice.bot", undefined), /invalid allowlist entry/));
  });
});
