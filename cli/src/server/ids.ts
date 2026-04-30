import { randomBytes } from "node:crypto";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * Generate a ULID-like ID: 48-bit ms timestamp + 80 random bits, encoded
 * as 26 Crockford base32 characters. Timestamp prefix makes IDs
 * lexicographically sortable within the same millisecond (with high
 * probability due to the random suffix).
 */
function generateId(prefix: string): string {
  const ts = BigInt(Date.now());
  const rand = randomBytes(10);

  let val = ts << 80n;
  for (let i = 0; i < 10; i++) {
    val |= BigInt(rand[i] ?? 0) << BigInt((9 - i) * 8);
  }

  let encoded = "";
  for (let i = 0; i < 26; i++) {
    encoded = CROCKFORD[Number(val & 31n)] + encoded;
    val >>= 5n;
  }
  return `${prefix}_${encoded}`;
}

export const generateSessionId = (): string => generateId("sess");
export const generateMessageId = (): string => generateId("msg");
export const generateEventId = (): string => generateId("evt");
