import { strict as assert } from "node:assert";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { networkPaths, registryPath } from "../src/paths.js";
import { readRegistry } from "../src/registry.js";
import type { Registry, RegistryEntry } from "../src/registry.js";
import { stopNetwork } from "../src/supervisor/stop.js";

async function seedRegistry(
  stateRoot: string,
  entries: readonly RegistryEntry[],
): Promise<void> {
  const networks: Record<string, RegistryEntry> = {};
  for (const e of entries) networks[e.name] = e;
  const reg: Registry = { version: 1, networks };
  await mkdir(stateRoot, { recursive: true });
  await writeFile(registryPath(stateRoot), JSON.stringify(reg, null, 2), "utf8");
}

describe("supervisor/stop", () => {
  let stateRoot: string;

  beforeEach(async () => {
    stateRoot = await mkdtemp(join(tmpdir(), "asp-stop-"));
  });

  afterEach(async () => {
    await rm(stateRoot, { recursive: true, force: true });
  });

  it("returns 'missing' when no entry exists for the network", async () => {
    const r = await stopNetwork(stateRoot, "nope", {
      timeoutMs: 1000,
      force: false,
    });
    assert.equal(r.outcome.kind, "missing");
  });

  it("returns 'stale' and reaps the entry when the PID is dead", async () => {
    await seedRegistry(stateRoot, [
      {
        name: "old",
        pid: 0x7fff_ffff, // unreachable PID, never alive
        host: "127.0.0.1",
        port: 8723,
        startedAt: 1,
        version: "0.0.0",
      },
    ]);
    // Touch the pid file so we can verify it's removed.
    const paths = networkPaths(stateRoot, "old");
    await mkdir(paths.networkDir, { recursive: true });
    await writeFile(paths.pidFile, "999999\n", "utf8");

    const r = await stopNetwork(stateRoot, "old", {
      timeoutMs: 1000,
      force: false,
    });

    assert.equal(r.outcome.kind, "stale");
    const reg = await readRegistry(stateRoot);
    assert.equal(reg.networks["old"], undefined);
    const { existsSync } = await import("node:fs");
    assert.equal(existsSync(paths.pidFile), false);
  });
});
