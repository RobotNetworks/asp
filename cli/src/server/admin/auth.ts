import { timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";

const BEARER_PREFIX_LOWER = "bearer ";

/**
 * Bearer-token auth for the management API. The expected token is fixed at
 * app construction; we use a constant-time comparison so a request that
 * happens to share a prefix with the real token isn't faster to fail than
 * one that doesn't.
 *
 * Distinct error codes for missing vs. invalid auth are intentional — admin
 * routes are not part of the ASP spec, so they don't have to follow the
 * spec's non-enumerating "deny by 404" posture. The token gates *all*
 * endpoints, not visibility of individual resources, so leaking "auth was
 * malformed" is a usability win, not an enumeration risk.
 */
export function makeAdminAuth(adminToken: string): MiddlewareHandler {
  const expected = Buffer.from(adminToken, "utf8");
  return async (c, next) => {
    const header = c.req.header("authorization");
    if (
      !header ||
      header.length <= BEARER_PREFIX_LOWER.length ||
      header.slice(0, BEARER_PREFIX_LOWER.length).toLowerCase() !==
        BEARER_PREFIX_LOWER
    ) {
      return c.json({ error: "missing_authorization" }, 401);
    }
    const provided = Buffer.from(
      header.slice(BEARER_PREFIX_LOWER.length),
      "utf8",
    );
    if (
      provided.length !== expected.length ||
      !timingSafeEqual(provided, expected)
    ) {
      return c.json({ error: "invalid_authorization" }, 401);
    }
    await next();
  };
}
