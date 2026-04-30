import { Hono } from "hono";

import { PACKAGE_VERSION } from "../version.js";

/**
 * Application-level context shared with route handlers.
 *
 * Routes never reach into globals; everything they need (the network they
 * belong to, the store, the clock) is wired in here so service logic stays
 * unit-testable in isolation. The shape will grow as phase 1 lands service
 * and store modules.
 */
export interface AppContext {
  readonly network: string;
}

/**
 * Build the Hono application for an ASP network.
 *
 * The function is the single composition root for HTTP routing — call sites
 * (start command, tests, future supervisor) all go through here so route
 * registration order and cross-cutting middleware are defined in exactly
 * one place.
 *
 * Phase 1.1 exposes only `/health`; protocol routes are added in 1.2+.
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

  return app;
}
