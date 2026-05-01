import { Hono } from "hono";

import { PACKAGE_VERSION } from "../version.js";
import { buildAdminApp } from "./admin/index.js";
import { buildSessionRoutes } from "./protocol/sessions.js";
import type { AgentStore } from "./store/agents.js";
import type { SessionStore } from "./store/sessions.js";

/**
 * Application-level context shared with route handlers.
 *
 * Routes never reach into globals; everything they need (the network they
 * belong to, the stores, the admin token) is wired in here so service
 * logic stays unit-testable in isolation.
 */
export interface AppContext {
  readonly network: string;
  readonly store: AgentStore;
  readonly sessionStore: SessionStore;
  /** Bearer token guarding the `/_admin/...` management routes. */
  readonly adminToken: string;
  /**
   * If provided, the admin `POST /_admin/reset` endpoint is enabled and calls
   * this function to wipe all network state. Only wired up when backed by
   * a durable store (SQLite); omitted for in-memory (tests, embedders).
   */
  readonly resetFn?: () => void;
}

/**
 * Build the Hono application for an ASP network.
 *
 * Single composition root for HTTP routing.
 *
 *   GET /health          — liveness probe, no auth
 *   /_admin/...          — management API, bearer-auth'd by adminToken
 *   /sessions/...        — ASP session protocol, agent bearer-auth
 */
export function buildApp(ctx: AppContext): Hono {
  const app = new Hono();

  app.get("/health", (c) =>
    c.json({
      status: "ok",
      network: ctx.network,
      version: PACKAGE_VERSION,
    }),
  );

  app.route("/_admin", buildAdminApp(ctx.store, ctx.adminToken, ctx.resetFn));
  app.route("/sessions", buildSessionRoutes(ctx.store, ctx.sessionStore));

  return app;
}
