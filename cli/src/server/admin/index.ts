import { Hono } from "hono";

import type { AgentStore } from "../store/agents.js";
import { buildAdminAgentRoutes } from "./agents.js";
import { makeAdminAuth } from "./auth.js";

/**
 * Build the management API for an ASP network.
 *
 * Mounted by `buildApp` under `/_admin`. The leading underscore is a
 * convention to signal "not part of the ASP wire spec" — these routes
 * exist for the CLI and are auth'd by a per-network bearer token, not
 * by an agent's protocol token.
 */
export function buildAdminApp(
  store: AgentStore,
  adminToken: string,
  resetFn?: () => void,
): Hono {
  const app = new Hono();
  app.use("*", makeAdminAuth(adminToken));
  app.route("/", buildAdminAgentRoutes(store));
  if (resetFn) {
    const fn = resetFn;
    app.post("/reset", (c) => {
      fn();
      return c.body(null, 204);
    });
  }
  return app;
}
