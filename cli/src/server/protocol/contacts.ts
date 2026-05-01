import { Hono } from "hono";

import type { AgentStore } from "../store/agents.js";
import {
  ContactError,
  type ContactRequest,
  type ContactStore,
} from "../store/contacts.js";
import { makeAgentAuth, type AgentEnv } from "./auth.js";

/**
 * Build the contact-request protocol routes.
 *
 * Mounted by buildApp at `/contacts`. Every route requires agent bearer-token
 * auth. The contact-request flow allows two allowlist agents to mutually add
 * each other (§6.2). On accept, both agents' allowlists are updated atomically
 * via the agentStore.
 */
export function buildContactRoutes(
  agentStore: AgentStore,
  contactStore: ContactStore,
): Hono<AgentEnv> {
  const app = new Hono<AgentEnv>();
  const auth = makeAgentAuth(agentStore);
  app.use("*", auth);

  // POST /contacts — send a contact request
  app.post("/", async (c) => {
    const caller = c.get("agent");
    const body = await readJson(c);
    if (body === undefined) return c.json({ error: "invalid_json" }, 400);

    const to = isPlainObject(body) ? body["to"] : undefined;
    if (typeof to !== "string" || !agentStore.get(to)) {
      return c.json({ error: "not_found" }, 404);
    }
    if (to === caller.handle) {
      return c.json({ error: "invalid_request" }, 400);
    }

    const message =
      isPlainObject(body) && typeof body["message"] === "string"
        ? body["message"]
        : undefined;

    const req = contactStore.create(caller.handle, to, message);
    return c.json({ request_id: req.id });
  });

  // GET /contacts — list contact requests for the caller
  app.get("/", (c) => {
    const caller = c.get("agent");
    const requests = contactStore.listForAgent(caller.handle);
    return c.json({ requests: requests.map(serializeRequest) });
  });

  // POST /contacts/:id/accept
  app.post("/:id/accept", (c) => {
    const caller = c.get("agent");
    const requestId = c.req.param("id");
    let req: ContactRequest;
    try {
      req = contactStore.accept(requestId, caller.handle);
    } catch (err) {
      return mapContactError(c, err);
    }
    // Atomic bilateral allowlist update
    agentStore.addToAllowlist(req.to, [req.from]);
    agentStore.addToAllowlist(req.from, [req.to]);
    return c.json({});
  });

  // POST /contacts/:id/decline
  app.post("/:id/decline", (c) => {
    const caller = c.get("agent");
    const requestId = c.req.param("id");
    try {
      contactStore.decline(requestId, caller.handle);
    } catch (err) {
      return mapContactError(c, err);
    }
    return c.json({});
  });

  // GET /contacts/:id
  app.get("/:id", (c) => {
    const caller = c.get("agent");
    const requestId = c.req.param("id");
    const req = contactStore.get(requestId);
    if (!req || (req.from !== caller.handle && req.to !== caller.handle)) {
      return c.json({ error: "not_found" }, 404);
    }
    return c.json(serializeRequest(req));
  });

  return app;
}

function serializeRequest(req: ContactRequest): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: req.id,
    from: req.from,
    to: req.to,
    status: req.status,
    created_at: req.created_at,
  };
  if (req.message !== undefined) out["message"] = req.message;
  if (req.resolved_at !== undefined) out["resolved_at"] = req.resolved_at;
  return out;
}

function mapContactError(c: import("hono").Context, err: unknown): Response {
  if (err instanceof ContactError) {
    switch (err.code) {
      case "not_found":
        return c.json({ error: "not_found" }, 404) as unknown as Response;
      case "not_recipient":
        return c.json({ error: "not_found" }, 404) as unknown as Response;
      case "not_pending":
        return c.json({ error: "not_pending" }, 409) as unknown as Response;
    }
  }
  throw err;
}

async function readJson(c: import("hono").Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return undefined;
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
