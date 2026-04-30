import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The CLI version, read from package.json at runtime.
 *
 * We read the manifest instead of hard-coding the string so `npm version`
 * stays the single source of truth and a stale literal can never drift.
 */
function readVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // dist/version.js → ../package.json (we ship dist/ alongside package.json)
  const manifestPath = join(here, "..", "package.json");
  const raw = readFileSync(manifestPath, "utf8");
  const parsed: unknown = JSON.parse(raw);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("version" in parsed) ||
    typeof (parsed as { version: unknown }).version !== "string"
  ) {
    throw new Error("package.json is missing a string `version` field");
  }
  return (parsed as { version: string }).version;
}

export const PACKAGE_VERSION: string = readVersion();
