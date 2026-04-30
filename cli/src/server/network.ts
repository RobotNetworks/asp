import { randomBytes } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";

import {
  networkPaths,
  resolveStateRoot,
  type NetworkPaths,
} from "../paths.js";
import { buildApp } from "./app.js";
import { startServer, type ServerHandle } from "./runtime.js";
import { InMemoryAgentStore, type AgentStore } from "./store/agents.js";
import { InMemoryContactStore } from "./store/contacts.js";
import { InMemorySessionStore } from "./store/sessions.js";

export interface StartNetworkOptions {
  readonly network: string;
  readonly host: string;
  readonly port: number;
}

export interface NetworkRuntime {
  readonly handle: ServerHandle;
  readonly store: AgentStore;
  readonly adminToken: string;
  readonly paths: NetworkPaths;
  /**
   * Stop the listener and clean up runtime-only state (the admin token
   * file). Does not touch the registry or pid file — those belong to the
   * supervisor's lifecycle, not the network's.
   */
  close(): Promise<void>;
}

/**
 * Start an ASP network in-process: generate a fresh admin token, persist it
 * to the network state directory at mode 0600, instantiate the agent store,
 * build the Hono app, and bind a TCP listener.
 *
 * Used by both the foreground (`asp start --foreground`) and supervised
 * (default `asp start`) lifecycles so they exhibit identical behavior; the
 * only difference is who owns the process supervising state (registry,
 * pid file).
 */
export async function startNetwork(
  opts: StartNetworkOptions,
): Promise<NetworkRuntime> {
  const stateRoot = resolveStateRoot();
  const paths = networkPaths(stateRoot, opts.network);
  await mkdir(paths.networkDir, { recursive: true, mode: 0o700 });

  const adminToken = randomBytes(32).toString("base64url");
  await writeFile(paths.adminTokenFile, `${adminToken}\n`, { mode: 0o600 });

  const store = new InMemoryAgentStore();
  const sessionStore = new InMemorySessionStore();
  const contactStore = new InMemoryContactStore();
  const handle = await startServer({
    app: buildApp({ network: opts.network, store, sessionStore, contactStore, adminToken }),
    host: opts.host,
    port: opts.port,
  });

  return {
    handle,
    store,
    adminToken,
    paths,
    close: async () => {
      await handle.close();
      try {
        await unlink(paths.adminTokenFile);
      } catch (err: unknown) {
        if (
          !(
            err instanceof Error &&
            (err as NodeJS.ErrnoException).code === "ENOENT"
          )
        ) {
          throw err;
        }
      }
    },
  };
}
