import { randomBytes } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";

import {
  networkPaths,
  resolveStateRoot,
  type NetworkPaths,
} from "../paths.js";
import { buildApp } from "./app.js";
import { startServer, type ServerHandle } from "./runtime.js";
import { type AgentStore } from "./store/agents.js";
import { openDatabase, resetDatabase } from "./store/sqlite.js";
import { SqliteAgentStore } from "./store/sqlite-agents.js";
import { SqliteContactStore } from "./store/sqlite-contacts.js";
import { SqliteSessionStore } from "./store/sqlite-sessions.js";
import { WSHub } from "./ws.js";

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

  const db = openDatabase(paths.sqlite);
  const store = new SqliteAgentStore(db);
  const sessionStore = new SqliteSessionStore(db);
  const contactStore = new SqliteContactStore(db);
  const wsHub = new WSHub();
  wsHub.attach(store, sessionStore, adminToken);
  const handle = await startServer({
    app: buildApp({ network: opts.network, store, sessionStore, contactStore, adminToken, resetFn: () => resetDatabase(db) }),
    host: opts.host,
    port: opts.port,
    wsHub,
  });

  return {
    handle,
    store,
    adminToken,
    paths,
    close: async () => {
      wsHub.close();
      await handle.close();
      db.close();
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
