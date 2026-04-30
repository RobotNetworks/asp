import { Hono } from "hono";

import { PACKAGE_VERSION } from "../version.js";
import { buildAdminApp } from "./admin/index.js";
import type { AgentStore } from "./store/agents.js";

/**
 * Application-level context shared with route handlers.
 *
 * Routes never reach into globals; everything they need (the network they
 * belong to, the agent store, the admin token) is wired in here so service
 * logic stays unit-testable in isolation.
 */
export interface AppContext {
  readonly network: string;
  readonly store: AgentStore;
  /** Bearer token guarding the `/_admin/...` management routes. */
  readonly adminToken: string;
}

/**
 * Build the Hono application for an ASP network.
 *
 * Single composition root for HTTP routing — call sites (start command,
 * tests, future supervisor) all go through here so route registration order
 * and cross-cutting middleware are defined in exactly one place.
 *
 * Two surfaces today:
 *   GET /health          — liveness probe, no auth
 *   /_admin/...          — management API, bearer-auth'd by adminToken
 *
 * Protocol routes (sessions, messages, contacts, WS) land in phase 1.4+.
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

  app.route("/_admin", buildAdminApp(ctx.store, ctx.adminToken));

  return app;
}
