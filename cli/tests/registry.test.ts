import { strict as assert } from "node:assert";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { registryPath } from "../src/paths.js";
import {
  readRegistry,
  removeEntry,
  upsertEntry,
  writeRegistry,
  type RegistryEntry,
} from "../src/registry.js";

const sample: RegistryEntry = {
  name: "default",
  pid: 4321,
  host: "127.0.0.1",
  port: 8723,
  startedAt: 1_700_000_000_000,
  version: "0.0.0",
};

describe("registry", () => {
  let stateRoot: string;

  beforeEach(async () => {
    stateRoot = await mkdtemp(join(tmpdir(), "asp-registry-"));
  });

  afterEach(async () => {
    await rm(stateRoot, { recursive: true, force: true });
  });

  it("returns an empty registry when the file is absent", async () => {
    const reg = await readRegistry(stateRoot);
    assert.deepEqual(reg, { version: 1, networks: {} });
  });

  it("round-trips through writeRegistry/readRegistry", async () => {
    await writeRegistry(stateRoot, {
      version: 1,
      networks: { default: sample },
    });
    const reg = await readRegistry(stateRoot);
    assert.deepEqual(reg.networks["default"], sample);
  });

  it("creates the state directory with restrictive perms", async () => {
    await writeRegistry(stateRoot, { version: 1, networks: {} });
    // The directory existed before write (mkdtemp), so we cannot assert
    // the dir mode bits. The file mode must be 0600 — that's the secret-
    // adjacent property we actually care about (PIDs/ports leak attack info).
    const { statSync } = await import("node:fs");
    const mode = statSync(registryPath(stateRoot)).mode & 0o777;
    assert.equal(mode, 0o600);
  });

  it("leaves no temp files behind after a successful write", async () => {
    await writeRegistry(stateRoot, { version: 1, networks: { default: sample } });
    const entries = await readdir(stateRoot);
    const stragglers = entries.filter((e) => e.includes(".tmp."));
    assert.deepEqual(stragglers, []);
  });

  it("upsertEntry inserts and replaces without mutation", () => {
    const r0 = { version: 1, networks: {} } as const;
    const r1 = upsertEntry(r0, sample);
    assert.equal(r1.networks["default"], sample);
    assert.equal(r0.networks["default"], undefined, "must not mutate input");

    const replaced: RegistryEntry = { ...sample, port: 9999 };
    const r2 = upsertEntry(r1, replaced);
    assert.equal(r2.networks["default"]?.port, 9999);
    assert.equal(r1.networks["default"]?.port, 8723, "must not mutate input");
  });

  it("removeEntry deletes by name and is a no-op when absent", () => {
    const r0 = upsertEntry({ version: 1, networks: {} }, sample);
    const r1 = removeEntry(r0, "default");
    assert.equal(r1.networks["default"], undefined);
    const r2 = removeEntry(r1, "missing");
    assert.equal(r2, r1, "no-op should return the same registry");
  });

  it("rejects malformed JSON loudly", async () => {
    await mkdir(stateRoot, { recursive: true });
    await writeFile(registryPath(stateRoot), "{ not json", "utf8");
    await assert.rejects(readRegistry(stateRoot), /not valid JSON/);
  });

  it("rejects unsupported versions", async () => {
    await writeFile(
      registryPath(stateRoot),
      JSON.stringify({ version: 99, networks: {} }),
      "utf8",
    );
    await assert.rejects(readRegistry(stateRoot), /unsupported version/);
  });

  it("rejects entries whose key disagrees with the inner name", async () => {
    await writeFile(
      registryPath(stateRoot),
      JSON.stringify({
        version: 1,
        networks: { default: { ...sample, name: "other" } },
      }),
      "utf8",
    );
    await assert.rejects(readRegistry(stateRoot), /mismatched name/);
  });

  it("rejects entries with bogus port", async () => {
    await writeFile(
      registryPath(stateRoot),
      JSON.stringify({
        version: 1,
        networks: { default: { ...sample, port: 99999 } },
      }),
      "utf8",
    );
    await assert.rejects(readRegistry(stateRoot), /invalid port/);
  });
});
