import { serve } from "@hono/node-server";
import type { Hono } from "hono";

import type { WSHub } from "./ws.js";

/**
 * A running ASP server. Callers own the lifetime — the runtime does not
 * install signal handlers or print banners; that belongs to the CLI command
 * so library consumers (tests, embedders) can drive shutdown deterministically.
 */
export interface ServerHandle {
  readonly host: string;
  readonly port: number;
  /** Stop accepting new connections and resolve once the server has fully closed. */
  close(): Promise<void>;
}

export interface StartServerOptions {
  readonly app: Hono;
  readonly host: string;
  /** Pass 0 to ask the OS for an ephemeral port; the assigned port is on the returned handle. */
  readonly port: number;
  /** Optional WebSocket hub. When provided, the server forwards HTTP upgrade
   *  requests for the `/connect` path to the hub. */
  readonly wsHub?: WSHub;
}

/**
 * Bind the Hono app to a TCP listener and resolve once it's ready to accept
 * requests. Rejects on bind errors (EADDRINUSE, permission denied, ...).
 */
export function startServer(opts: StartServerOptions): Promise<ServerHandle> {
  return new Promise((resolve, reject) => {
    let settled = false;

    const server = serve(
      { fetch: opts.app.fetch, port: opts.port, hostname: opts.host },
      (info) => {
        if (settled) return;
        settled = true;

        // Wire WebSocket upgrades for GET /connect if a hub is provided.
        // The 'upgrade' event fires before Hono sees the request.
        if (opts.wsHub) {
          const hub = opts.wsHub;
          server.on("upgrade", (req, socket, head) => {
            const url = req.url ?? "";
            const path = url.split("?")[0];
            if (path === "/connect") {
              hub.handleUpgrade(req, socket as import("net").Socket, head);
            } else if (path === "/_admin/tap") {
              hub.handleAdminUpgrade(req, socket as import("net").Socket, head);
            } else {
              socket.destroy();
            }
          });
        }

        resolve({
          host: info.address,
          port: info.port,
          close: () =>
            new Promise<void>((res, rej) => {
              server.close((err) => (err ? rej(err) : res()));
            }),
        });
      },
    );

    server.on("error", (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
  });
}
