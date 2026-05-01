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

/**
 * Commander argParser for a single `<handle>` argument or `--as <handle>`-style
 * option. Validates the value and passes it through unchanged so handle-format
 * errors surface at parse time with a clear message — never as a downstream
 * "agent not found" or "session not found" from the API.
 */
export function handleArg(value: string): string {
  assertValidHandle(value);
  return value;
}

/**
 * Commander argParser for a variadic `<handles...>` argument or repeated
 * `--invite <handle>` option. Validates each value and collects them into an
 * array.
 */
export function handlesArg(
  value: string,
  previous: readonly string[] | undefined,
): string[] {
  assertValidHandle(value);
  return previous === undefined ? [value] : [...previous, value];
}

/**
 * Commander argParser for a variadic `<entries...>` allowlist argument.
 * Accepts handles and owner globs (`@acme.*`).
 */
export function allowlistEntriesArg(
  value: string,
  previous: readonly string[] | undefined,
): string[] {
  if (!isValidAllowlistEntry(value)) {
    throw new Error(
      `invalid allowlist entry "${value}" (expected @<owner>.<name> or @<owner>.*)`,
    );
  }
  return previous === undefined ? [value] : [...previous, value];
}
