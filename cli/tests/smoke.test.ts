import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { buildProgram, PACKAGE_VERSION } from "../src/index.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const binPath = join(repoRoot, "bin", "asp.js");

function manifestVersion(): string {
  const raw = readFileSync(join(repoRoot, "package.json"), "utf8");
  return (JSON.parse(raw) as { version: string }).version;
}

describe("scaffolding", () => {
  it("exports a version that matches package.json", () => {
    assert.equal(PACKAGE_VERSION, manifestVersion());
  });

  it("builds a commander program named asp with the version flag wired up", () => {
    const program = buildProgram();
    assert.equal(program.name(), "asp");
    // commander stores the registered version internally; surface it via
    // its public accessor to confirm we wired the flag, not just set the field.
    assert.equal(program.version(), PACKAGE_VERSION);
  });

  it("ships a runnable bin shim", () => {
    // The shim only resolves once `npm run build` has produced dist/.
    // Skip if dist/ is absent so this test passes both pre- and post-build.
    if (!existsSync(join(repoRoot, "dist", "cli.js"))) {
      return;
    }
    const out = execFileSync(process.execPath, [binPath, "--version"], {
      encoding: "utf8",
    });
    assert.equal(out.trim(), PACKAGE_VERSION);
  });
});
