import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  assertValidHandle,
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
});
