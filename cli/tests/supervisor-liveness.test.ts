import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { isProcessAlive } from "../src/supervisor/liveness.js";

describe("supervisor/liveness", () => {
  it("reports the current process as alive", () => {
    assert.equal(isProcessAlive(process.pid), true);
  });

  it("reports a clearly-dead pid as not alive", () => {
    // PID 0x7fff_ffff is ~2.1B, well above any real Linux/macOS PID range.
    assert.equal(isProcessAlive(0x7fff_ffff), false);
  });

  it("treats a non-positive or non-integer pid as not alive", () => {
    assert.equal(isProcessAlive(0), false);
    assert.equal(isProcessAlive(-1), false);
    assert.equal(isProcessAlive(1.5), false);
    assert.equal(isProcessAlive(Number.NaN), false);
  });
});
