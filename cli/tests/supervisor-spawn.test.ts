import { strict as assert } from "node:assert";
import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, it } from "node:test";

import { isProcessAlive } from "../src/supervisor/liveness.js";

const execFileAsync = promisify(execFile);

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const binPath = join(repoRoot, "bin", "asp.js");
const distEntry = join(repoRoot, "dist", "cli.js");

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function readRegistryFile(stateRoot: string): Promise<{
  networks: Record<string, { pid: number; port: number; host: string }>;
}> {
  const raw = await readFile(join(stateRoot, "asp", "networks.json"), "utf8");
  return JSON.parse(raw) as {
    networks: Record<string, { pid: number; port: number; host: string }>;
  };
}

describe("supervisor (integration)", () => {
  let xdgRoot: string;

  beforeEach(async () => {
    xdgRoot = await mkdtemp(join(tmpdir(), "asp-spawn-"));
  });

  afterEach(async () => {
    await rm(xdgRoot, { recursive: true, force: true });
  });

  it("spawns a detached server, registers it, serves /health, and deregisters on SIGTERM", async (t) => {
    if (!(await exists(distEntry))) {
      // The supervisor invokes the bin shim, which requires dist/cli.js.
      // CI runs `npm run build` before `npm test`; locally, run `npm run
      // build` first or this test will be skipped.
      t.skip("dist/cli.js not built; run `npm run build` first");
      return;
    }

    const env = { ...process.env, XDG_STATE_HOME: xdgRoot };
    const { stdout } = await execFileAsync(
      process.execPath,
      [binPath, "start", "--port", "0", "--network", "itest"],
      { env, timeout: 15_000 },
    );

    const pidMatch = stdout.match(/pid (\d+)/);
    assert.ok(pidMatch, `start banner missing pid: ${stdout}`);
    const pid = Number(pidMatch[1]);
    assert.ok(isProcessAlive(pid), "spawned server should be alive");

    try {
      const reg = await readRegistryFile(xdgRoot);
      const entry = reg.networks["itest"];
      assert.ok(entry, "registry entry should exist for itest");
      assert.equal(entry.pid, pid);
      assert.equal(entry.host, "127.0.0.1");
      assert.ok(entry.port > 0, "ephemeral port should be assigned");

      const res = await fetch(`http://127.0.0.1:${entry.port}/health`);
      assert.equal(res.status, 200);
      const body = (await res.json()) as { network: string };
      assert.equal(body.network, "itest");
    } finally {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        /* already dead */
      }
      // Wait up to ~5s for the child to clean up and exit.
      for (let i = 0; i < 50; i++) {
        if (!isProcessAlive(pid)) break;
        await delay(100);
      }
    }

    assert.equal(isProcessAlive(pid), false, "server should exit on SIGTERM");
    const reg2 = await readRegistryFile(xdgRoot);
    assert.deepEqual(
      reg2.networks,
      {},
      "registry should be empty after clean shutdown",
    );
  });

  it("refuses a second start while the first is still running", async (t) => {
    if (!(await exists(distEntry))) {
      t.skip("dist/cli.js not built; run `npm run build` first");
      return;
    }

    const env = { ...process.env, XDG_STATE_HOME: xdgRoot };
    const { stdout } = await execFileAsync(
      process.execPath,
      [binPath, "start", "--port", "0", "--network", "doublestart"],
      { env, timeout: 15_000 },
    );
    const pid = Number(stdout.match(/pid (\d+)/)?.[1]);
    assert.ok(pid > 0);

    try {
      await assert.rejects(
        execFileAsync(
          process.execPath,
          [binPath, "start", "--port", "0", "--network", "doublestart"],
          { env, timeout: 15_000 },
        ),
        /already running/,
      );
    } finally {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        /* */
      }
      for (let i = 0; i < 50; i++) {
        if (!isProcessAlive(pid)) break;
        await delay(100);
      }
    }
  });
});
