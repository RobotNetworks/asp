import { strict as assert } from "node:assert";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  assertValidNetworkName,
  networkPaths,
  registryPath,
  resolveStateRoot,
} from "../src/paths.js";

describe("paths/resolveStateRoot", () => {
  it("uses XDG_STATE_HOME when set", () => {
    const root = resolveStateRoot({ XDG_STATE_HOME: "/var/state", HOME: "/u/x" });
    assert.equal(root, "/var/state/asp");
  });

  it("falls back to $HOME/.local/state when XDG_STATE_HOME is unset", () => {
    const root = resolveStateRoot({ HOME: "/u/x" });
    assert.equal(root, join("/u/x", ".local", "state", "asp"));
  });

  it("treats an empty XDG_STATE_HOME as unset", () => {
    const root = resolveStateRoot({ XDG_STATE_HOME: "", HOME: "/u/x" });
    assert.equal(root, join("/u/x", ".local", "state", "asp"));
  });
});

describe("paths/assertValidNetworkName", () => {
  const valid = ["default", "dev", "n1", "scratch_2", "demo-net", "a"];
  for (const name of valid) {
    it(`accepts "${name}"`, () => assertValidNetworkName(name));
  }

  const invalid = [
    "",
    "Default", // uppercase
    "-leading", // leading hyphen
    "_leading", // leading underscore
    "with space",
    "with/slash",
    "with.dot",
    "..",
    "a".repeat(65), // too long
  ];
  for (const name of invalid) {
    it(`rejects ${JSON.stringify(name)}`, () => {
      assert.throws(() => assertValidNetworkName(name), /invalid network name/);
    });
  }
});

describe("paths/networkPaths", () => {
  it("composes the expected layout under the state root", () => {
    const p = networkPaths("/s", "default");
    assert.equal(p.networkDir, "/s/networks/default");
    assert.equal(p.pidFile, "/s/networks/default/asp.pid");
    assert.equal(p.logDir, "/s/networks/default/logs");
    assert.equal(p.serverLog, "/s/networks/default/logs/server.log");
    assert.equal(p.networkInfo, "/s/networks/default/network.json");
    assert.equal(p.sqlite, "/s/networks/default/asp.sqlite");
  });

  it("validates the name", () => {
    assert.throws(() => networkPaths("/s", "Bad/Name"), /invalid network name/);
  });
});

describe("paths/registryPath", () => {
  it("places networks.json directly under the state root", () => {
    assert.equal(registryPath("/s"), "/s/networks.json");
  });
});
