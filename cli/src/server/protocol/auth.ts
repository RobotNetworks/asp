import type { MiddlewareHandler } from "hono";

import type { Agent, AgentStore } from "../store/agents.js";

export type { Agent };

/** Hono Env that makes the authenticated agent available on the context. */
export type AgentEnv = { Variables: { agent: Agent } };

const BEARER_PREFIX_LOWER = "bearer ";

/**
 * Agent bearer-token authentication for protocol routes.
 *
 * Resolves the calling agent from the Authorization header and sets it on
 * the Hono context as `c.get("agent")` (type: Agent). Returns 401 for
 * missing or invalid credentials.
 */
export function makeAgentAuth(store: AgentStore): MiddlewareHandler<AgentEnv> {
  return async (c, next) => {
    const header = c.req.header("authorization");
    if (!header) {
      return c.json({ error: "missing_authorization" }, 401);
    }
    if (
      header.length <= BEARER_PREFIX_LOWER.length ||
      header.slice(0, BEARER_PREFIX_LOWER.length).toLowerCase() !==
        BEARER_PREFIX_LOWER
    ) {
      return c.json({ error: "invalid_authorization" }, 401);
    }
    const token = header.slice(BEARER_PREFIX_LOWER.length);
    const agent = store.byToken(token);
    if (!agent) {
      return c.json({ error: "invalid_authorization" }, 401);
    }
    c.set("agent", agent);
    await next();
  };
}
