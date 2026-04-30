/**
 * Handle and allowlist-entry validation.
 *
 * Patterns are vendored from `asp/schemas/common.json` ($defs/Handle and
 * $defs/AllowlistEntry) at the same ASP version this CLI implements. If
 * the schema patterns change, update both — the conformance suite will
 * catch a drift, but failing fast at parse time is cheaper than failing
 * deep in route handlers.
 */

const HANDLE_PATTERN = /^@[a-z0-9_-]+\.[a-z0-9_-]+$/;
const ALLOWLIST_ENTRY_PATTERN = /^@[a-z0-9_-]+\.([a-z0-9_-]+|\*)$/;

export function isValidHandle(value: unknown): value is string {
  return typeof value === "string" && HANDLE_PATTERN.test(value);
}

export function isValidAllowlistEntry(value: unknown): value is string {
  return typeof value === "string" && ALLOWLIST_ENTRY_PATTERN.test(value);
}

export function assertValidHandle(value: string): void {
  if (!HANDLE_PATTERN.test(value)) {
    throw new Error(
      `invalid handle "${value}" (expected @<owner>.<name> with lowercase ` +
        `letters, digits, underscore, or hyphen in each part)`,
    );
  }
}
