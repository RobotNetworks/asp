import { strict as assert } from "node:assert";
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";

import { buildApp } from "../src/server/app.js";
import { startServer, type ServerHandle } from "../src/server/runtime.js";
import { InMemoryAgentStore } from "../src/server/store/agents.js";
import { InMemoryContactStore } from "../src/server/store/contacts.js";
import { InMemorySessionStore } from "../src/server/store/sessions.js";
import { WSHub } from "../src/server/ws.js";

/**
 * ASP conformance runner.
 *
 * Spins up an in-process server, seeds the four test agents the conformance
 * suite expects, and runs the Python pytest suite (`tests/conformance/`)
 * against it. The runner is part of the npm test suite when `uv` is on PATH;
 * otherwise it skips so we don't fail the build on machines without Python.
 */

const CONFORMANCE_DIR = resolve(process.cwd(), "..", "tests", "conformance");
const ADMIN_TOKEN = "admin-conformance-tok";

interface Setup {
  readonly server: ServerHandle;
  readonly hub: WSHub;
  readonly agentTokens: Record<string, string>;
  close(): Promise<void>;
}

async function setupServer(): Promise<Setup> {
  const agentStore = new InMemoryAgentStore();
  const sessionStore = new InMemorySessionStore();
  const contactStore = new InMemoryContactStore();
  const hub = new WSHub();
  hub.attach({ agentStore, sessionStore, contactStore, adminToken: ADMIN_TOKEN });
  const app = buildApp({
    network: "conformance",
    store: agentStore,
    sessionStore,
    contactStore,
    adminToken: ADMIN_TOKEN,
  });
  const server = await startServer({ app, host: "127.0.0.1", port: 0, wsHub: hub });

  const agentTokens: Record<string, string> = {};
  for (const handle of ["@alice.test", "@bob.test", "@carol.test"]) {
    const a = agentStore.register(handle, { policy: "open" });
    agentTokens[handle] = a.token;
  }
  // @closed.test is allowlist with an empty allowlist — allows the trust
  // suite to exercise the policy-denial path (which must surface as 404).
  const closed = agentStore.register("@closed.test", { policy: "allowlist" });
  agentTokens["@closed.test"] = closed.token;

  return {
    server,
    hub,
    agentTokens,
    close: async () => {
      hub.close();
      await server.close();
    },
  };
}

function uvAvailable(): boolean {
  const r = spawnSync("uv", ["--version"], { stdio: "ignore" });
  return r.status === 0;
}

function runPytest(env: NodeJS.ProcessEnv): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolveP) => {
    let stdout = "";
    let stderr = "";
    const child = spawn("uv", ["run", "python", "-m", "pytest", "--tb=short", "-q"], {
      cwd: CONFORMANCE_DIR,
      env: { ...process.env, ...env },
    });
    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    child.on("close", (code) => resolveP({ code: code ?? 1, stdout, stderr }));
  });
}

describe("ASP conformance suite", () => {
  it("passes against the in-process TypeScript server", { timeout: 120_000 }, async (t) => {
    if (!existsSync(CONFORMANCE_DIR)) {
      t.skip(`conformance dir not found at ${CONFORMANCE_DIR}`);
      return;
    }
    if (!uvAvailable()) {
      t.skip("uv (Python toolchain) not available — skipping conformance run");
      return;
    }

    const setup = await setupServer();
    try {
      const result = await runPytest({
        ASP_OPERATOR_URL: `http://127.0.0.1:${setup.server.port}`,
        ASP_TEST_AGENTS: JSON.stringify(setup.agentTokens),
      });
      if (result.code !== 0) {
        process.stderr.write(`\n--- pytest stdout ---\n${result.stdout}\n--- pytest stderr ---\n${result.stderr}\n`);
      }
      assert.equal(result.code, 0, "pytest conformance suite failed");
    } finally {
      await setup.close();
    }
  });
});
