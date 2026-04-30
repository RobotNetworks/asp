import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { buildApp } from "../src/server/app.js";
import { PACKAGE_VERSION } from "../src/version.js";

describe("server/app", () => {
  it("answers GET /health with the network name and CLI version", async () => {
    const app = buildApp({ network: "test-net" });
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
    const app = buildApp({ network: "test-net" });
    const res = await app.request("/does-not-exist");
    assert.equal(res.status, 404);
  });
});
