import { strict as assert } from "node:assert";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  clearIdentity,
  resolveAgentIdentity,
  resolveIdentity,
  writeIdentity,
} from "../src/identity.js";

const DEFAULT_NETWORK = "default";

/** Run `fn` with `process.env.ASP_AGENT` set to `value`, restored on exit. */
async function withEnvAgent(value: string | undefined, fn: () => Promise<void>): Promise<void> {
  const prev = process.env["ASP_AGENT"];
  if (value === undefined) delete process.env["ASP_AGENT"];
  else process.env["ASP_AGENT"] = value;
  try {
    await fn();
  } finally {
    if (prev === undefined) delete process.env["ASP_AGENT"];
    else process.env["ASP_AGENT"] = prev;
  }
}

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "asp-identity-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("writeIdentity / resolveIdentity", () => {
  it("round-trips handle and network", async () => {
    await withTempDir(async (dir) => {
      await writeIdentity(dir, { handle: "@mybot.bot", network: "dev" });
      const identity = await resolveIdentity(dir);
      assert.ok(identity !== undefined);
      assert.equal(identity.handle, "@mybot.bot");
      assert.equal(identity.network, "dev");
    });
  });

  it("filePath points to .robotnet/asp.json inside the dir", async () => {
    await withTempDir(async (dir) => {
      await writeIdentity(dir, { handle: "@mybot.bot", network: "default" });
      const identity = await resolveIdentity(dir);
      assert.ok(identity !== undefined);
      assert.equal(identity.filePath, join(dir, ".robotnet", "asp.json"));
    });
  });

  it("walks up the directory tree to find identity", async () => {
    await withTempDir(async (root) => {
      await writeIdentity(root, { handle: "@root.bot", network: "default" });
      const child = join(root, "subdir", "nested");
      const identity = await resolveIdentity(child);
      assert.ok(identity !== undefined);
      assert.equal(identity.handle, "@root.bot");
    });
  });

  it("returns undefined when no identity exists", async () => {
    await withTempDir(async (dir) => {
      const identity = await resolveIdentity(dir);
      assert.equal(identity, undefined);
    });
  });

  it("prefers the closest identity when multiple exist in tree", async () => {
    await withTempDir(async (root) => {
      const child = join(root, "subdir");
      await writeIdentity(root, { handle: "@root.bot", network: "root-net" });
      await writeIdentity(child, { handle: "@child.bot", network: "child-net" });
      const identity = await resolveIdentity(child);
      assert.ok(identity !== undefined);
      assert.equal(identity.handle, "@child.bot");
      assert.equal(identity.network, "child-net");
    });
  });

  it("ignores a file with missing required fields", async () => {
    const { mkdir, writeFile } = await import("node:fs/promises");
    await withTempDir(async (dir) => {
      const configDir = join(dir, ".robotnet");
      await mkdir(configDir, { recursive: true });
      // Missing network field
      await writeFile(join(configDir, "asp.json"), '{"handle":"@mybot.bot"}', "utf8");
      const identity = await resolveIdentity(dir);
      assert.equal(identity, undefined);
    });
  });

  it("ignores a file with invalid JSON", async () => {
    const { mkdir, writeFile } = await import("node:fs/promises");
    await withTempDir(async (dir) => {
      const configDir = join(dir, ".robotnet");
      await mkdir(configDir, { recursive: true });
      await writeFile(join(configDir, "asp.json"), "not json", "utf8");
      const identity = await resolveIdentity(dir);
      assert.equal(identity, undefined);
    });
  });
});

describe("clearIdentity", () => {
  it("removes an existing identity file and returns true", async () => {
    await withTempDir(async (dir) => {
      await writeIdentity(dir, { handle: "@mybot.bot", network: "default" });
      const removed = await clearIdentity(dir);
      assert.equal(removed, true);
      assert.equal(await resolveIdentity(dir), undefined);
    });
  });

  it("returns false when no file exists", async () => {
    await withTempDir(async (dir) => {
      const removed = await clearIdentity(dir);
      assert.equal(removed, false);
    });
  });

  it("is idempotent — calling twice does not throw", async () => {
    await withTempDir(async (dir) => {
      await writeIdentity(dir, { handle: "@mybot.bot", network: "default" });
      await clearIdentity(dir);
      assert.doesNotReject(() => clearIdentity(dir));
    });
  });
});

describe("resolveAgentIdentity — precedence", () => {
  it("--as flag wins over both ASP_AGENT and directory identity", async () => {
    await withTempDir(async (dir) => {
      await writeIdentity(dir, { handle: "@dir.bot", network: "dir-net" });
      await withEnvAgent("@env.bot", async () => {
        const r = await resolveAgentIdentity("@flag.bot", DEFAULT_NETWORK, DEFAULT_NETWORK, dir);
        assert.ok(r);
        assert.equal(r.handle, "@flag.bot");
        assert.equal(r.source, "flag");
      });
    });
  });

  it("--as carries the network through unchanged (no identity lookup needed)", async () => {
    await withTempDir(async (dir) => {
      await writeIdentity(dir, { handle: "@dir.bot", network: "dir-net" });
      const r = await resolveAgentIdentity("@flag.bot", "explicit-net", DEFAULT_NETWORK, dir);
      assert.ok(r);
      assert.equal(r.network, "explicit-net");
    });
  });

  it("ASP_AGENT wins over directory identity for the handle", async () => {
    await withTempDir(async (dir) => {
      await writeIdentity(dir, { handle: "@dir.bot", network: "dir-net" });
      await withEnvAgent("@env.bot", async () => {
        const r = await resolveAgentIdentity(undefined, DEFAULT_NETWORK, DEFAULT_NETWORK, dir);
        assert.ok(r);
        assert.equal(r.handle, "@env.bot");
        assert.equal(r.source, "env");
      });
    });
  });

  it("ASP_AGENT inherits the directory identity's network when --network was not explicit", async () => {
    // Use case: project pinned to dev-net, terminal flips agent to @bob via env
    await withTempDir(async (dir) => {
      await writeIdentity(dir, { handle: "@dir.bot", network: "dev-net" });
      await withEnvAgent("@env.bot", async () => {
        const r = await resolveAgentIdentity(undefined, DEFAULT_NETWORK, DEFAULT_NETWORK, dir);
        assert.ok(r);
        assert.equal(r.network, "dev-net");
      });
    });
  });

  it("explicit --network wins over the directory identity's network even with ASP_AGENT", async () => {
    await withTempDir(async (dir) => {
      await writeIdentity(dir, { handle: "@dir.bot", network: "dir-net" });
      await withEnvAgent("@env.bot", async () => {
        const r = await resolveAgentIdentity(undefined, "explicit-net", DEFAULT_NETWORK, dir);
        assert.ok(r);
        assert.equal(r.network, "explicit-net");
      });
    });
  });

  it("falls back to directory identity when neither --as nor ASP_AGENT is set", async () => {
    await withTempDir(async (dir) => {
      await writeIdentity(dir, { handle: "@dir.bot", network: "dir-net" });
      await withEnvAgent(undefined, async () => {
        const r = await resolveAgentIdentity(undefined, DEFAULT_NETWORK, DEFAULT_NETWORK, dir);
        assert.ok(r);
        assert.equal(r.handle, "@dir.bot");
        assert.equal(r.network, "dir-net");
        assert.equal(r.source, "identity");
      });
    });
  });

  it("returns undefined when nothing produces a handle", async () => {
    await withTempDir(async (dir) => {
      await withEnvAgent(undefined, async () => {
        const r = await resolveAgentIdentity(undefined, DEFAULT_NETWORK, DEFAULT_NETWORK, dir);
        assert.equal(r, undefined);
      });
    });
  });

  it("treats empty ASP_AGENT as unset", async () => {
    await withTempDir(async (dir) => {
      await writeIdentity(dir, { handle: "@dir.bot", network: "dir-net" });
      await withEnvAgent("", async () => {
        const r = await resolveAgentIdentity(undefined, DEFAULT_NETWORK, DEFAULT_NETWORK, dir);
        assert.ok(r);
        assert.equal(r.handle, "@dir.bot");
        assert.equal(r.source, "identity");
      });
    });
  });
});
