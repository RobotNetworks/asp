import { Hono } from "hono";

import { isValidAllowlistEntry, isValidHandle } from "../../handles.js";
import {
  AgentExistsError,
  type Agent,
  type AgentStore,
  type Policy,
} from "../store/agents.js";

interface RegisterRequest {
  readonly handle: string;
  readonly policy?: Policy;
}

interface PatchRequest {
  readonly policy?: Policy;
}

/**
 * Build the admin-routes app under `/agents`. Mounted by buildAdminApp at
 * `/_admin/agents`. Pure: takes the store as a dependency, returns a
 * Hono app with no shared state.
 */
export function buildAdminAgentRoutes(store: AgentStore): Hono {
  const app = new Hono();

  app.post("/agents", async (c) => {
    const body = await readJson(c);
    if (body === undefined) {
      return c.json({ error: "invalid_json" }, 400);
    }
    const parsed = parseRegister(body);
    if ("error" in parsed) {
      return c.json({ error: parsed.error }, 400);
    }
    try {
      const agent =
        parsed.policy === undefined
          ? store.register(parsed.handle)
          : store.register(parsed.handle, { policy: parsed.policy });
      return c.json(serializeAgent(agent), 201);
    } catch (err) {
      if (err instanceof AgentExistsError) {
        return c.json({ error: "agent_exists" }, 409);
      }
      throw err;
    }
  });

  app.get("/agents", (c) => {
    return c.json({ agents: store.list().map(serializeAgent) });
  });

  app.get("/agents/:handle", (c) => {
    const agent = store.get(c.req.param("handle"));
    if (!agent) return c.json({ error: "not_found" }, 404);
    return c.json(serializeAgent(agent));
  });

  app.delete("/agents/:handle", (c) => {
    if (!store.remove(c.req.param("handle"))) {
      return c.json({ error: "not_found" }, 404);
    }
    return c.body(null, 204);
  });

  app.post("/agents/:handle/rotate-token", (c) => {
    const agent = store.rotateToken(c.req.param("handle"));
    if (!agent) return c.json({ error: "not_found" }, 404);
    return c.json(serializeAgent(agent));
  });

  app.patch("/agents/:handle", async (c) => {
    const handle = c.req.param("handle");
    const body = await readJson(c);
    if (body === undefined) {
      return c.json({ error: "invalid_json" }, 400);
    }
    const parsed = parsePatch(body);
    if ("error" in parsed) {
      return c.json({ error: parsed.error }, 400);
    }
    let agent = store.get(handle);
    if (!agent) return c.json({ error: "not_found" }, 404);
    if (parsed.policy !== undefined) {
      agent = store.setPolicy(handle, parsed.policy) ?? agent;
    }
    return c.json(serializeAgent(agent));
  });

  app.post("/agents/:handle/allowlist", async (c) => {
    const handle = c.req.param("handle");
    const body = await readJson(c);
    if (body === undefined) return c.json({ error: "invalid_json" }, 400);
    const parsed = parseAllowlistAdd(body);
    if ("error" in parsed) return c.json({ error: parsed.error }, 400);
    const agent = store.addToAllowlist(handle, parsed.entries);
    if (!agent) return c.json({ error: "not_found" }, 404);
    return c.json(serializeAgent(agent));
  });

  app.delete("/agents/:handle/allowlist/:entry", (c) => {
    const handle = c.req.param("handle");
    const entry = c.req.param("entry");
    const agent = store.removeFromAllowlist(handle, entry);
    if (!agent) return c.json({ error: "not_found" }, 404);
    return c.json(serializeAgent(agent));
  });

  return app;
}

/**
 * Stable JSON shape for an agent. Distinct from the in-memory `Agent`
 * (whose array fields are `readonly`) so the wire contract is independent
 * of the storage representation.
 */
function serializeAgent(agent: Agent): {
  handle: string;
  token: string;
  policy: Policy;
  allowlist: string[];
} {
  return {
    handle: agent.handle,
    token: agent.token,
    policy: agent.policy,
    allowlist: [...agent.allowlist],
  };
}

async function readJson(c: import("hono").Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return undefined;
  }
}

function parseRegister(raw: unknown): RegisterRequest | { error: string } {
  if (!isPlainObject(raw)) return { error: "invalid_body" };
  if (!isValidHandle(raw["handle"])) return { error: "invalid_handle" };
  const policy = raw["policy"];
  if (policy !== undefined && !isPolicy(policy)) {
    return { error: "invalid_policy" };
  }
  return policy === undefined
    ? { handle: raw["handle"] }
    : { handle: raw["handle"], policy };
}

function parsePatch(raw: unknown): PatchRequest | { error: string } {
  if (!isPlainObject(raw)) return { error: "invalid_body" };
  const policy = raw["policy"];
  if (policy !== undefined && !isPolicy(policy)) {
    return { error: "invalid_policy" };
  }
  return policy === undefined ? {} : { policy };
}

interface AllowlistAddRequest {
  readonly entries: readonly string[];
}

function parseAllowlistAdd(raw: unknown): AllowlistAddRequest | { error: string } {
  if (!isPlainObject(raw)) return { error: "invalid_body" };
  const entries = raw["entries"];
  if (!Array.isArray(entries)) return { error: "invalid_entries" };
  for (const e of entries) {
    if (!isValidAllowlistEntry(e)) return { error: "invalid_entries" };
  }
  return { entries: entries as string[] };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isPolicy(v: unknown): v is Policy {
  return v === "allowlist" || v === "open";
}
