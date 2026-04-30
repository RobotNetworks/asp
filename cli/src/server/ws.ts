import type { IncomingMessage } from "node:http";
import type { Socket } from "node:net";

import { WebSocketServer, WebSocket } from "ws";

import type { AgentStore } from "./store/agents.js";
import type { EventObserver, SessionStore, StoredEvent } from "./store/sessions.js";

/**
 * Manages the `WS /connect` endpoint for the ASP event stream.
 *
 * Each connected client authenticates via Bearer token, subscribes to all
 * events the agent is eligible to receive across every session, and receives
 * them as JSON text frames. The hub registers a single EventObserver with the
 * session store and fans events to matching connections.
 */
export class WSHub {
  readonly #wss: WebSocketServer;
  /** Map from agent handle → set of live WebSocket connections */
  readonly #connections = new Map<string, Set<WebSocket>>();
  #unsubscribe?: () => void;
  #agentStore?: AgentStore;

  constructor() {
    this.#wss = new WebSocketServer({ noServer: true });
  }

  /**
   * Attach the hub to the session store's event stream and set up the
   * WebSocket server's connection handler. Must be called before the first
   * upgrade request.
   */
  attach(agentStore: AgentStore, sessionStore: SessionStore): void {
    this.#agentStore = agentStore;

    const observer: EventObserver = (event, recipients) => {
      this.#dispatch(event, recipients);
    };
    this.#unsubscribe = sessionStore.subscribe(observer);

    this.#wss.on("connection", (ws: WebSocket, _req: IncomingMessage, handle: string) => {
      this.#addConnection(handle, ws);
      ws.on("close", () => this.#removeConnection(handle, ws));
      ws.on("error", () => this.#removeConnection(handle, ws));
    });
  }

  /**
   * Handle an incoming HTTP upgrade request for `GET /connect`.
   * Authenticates the agent via the Authorization header or `token` query
   * param, then delegates the upgrade to the WebSocket server.
   */
  handleUpgrade(req: IncomingMessage, socket: Socket, head: Buffer): void {
    const store = this.#agentStore;
    if (!store) {
      socket.write("HTTP/1.1 503 Service Unavailable\r\n\r\n");
      socket.destroy();
      return;
    }
    const token = extractToken(req);
    if (!token) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    const agent = store.byToken(token);
    if (!agent) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    this.#wss.handleUpgrade(req, socket, head, (ws) => {
      this.#wss.emit("connection", ws, req, agent.handle);
    });
  }

  close(): void {
    this.#unsubscribe?.();
    this.#wss.close();
  }

  #addConnection(handle: string, ws: WebSocket): void {
    let set = this.#connections.get(handle);
    if (!set) {
      set = new Set();
      this.#connections.set(handle, set);
    }
    set.add(ws);
  }

  #removeConnection(handle: string, ws: WebSocket): void {
    const set = this.#connections.get(handle);
    if (!set) return;
    set.delete(ws);
    if (set.size === 0) this.#connections.delete(handle);
  }

  #dispatch(event: StoredEvent, recipients: readonly string[]): void {
    const frame = JSON.stringify(serializeEvent(event));
    for (const handle of recipients) {
      const conns = this.#connections.get(handle);
      if (!conns) continue;
      for (const ws of conns) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(frame);
        }
      }
    }
  }
}

function extractToken(req: IncomingMessage): string | undefined {
  const auth = req.headers["authorization"];
  if (auth) {
    const m = auth.match(/^Bearer (.+)$/i);
    if (m) return m[1];
  }
  // Also accept ?token= for WS handshakes where setting headers is awkward
  const url = req.url ?? "";
  const qs = new URLSearchParams(url.includes("?") ? url.slice(url.indexOf("?") + 1) : "");
  return qs.get("token") ?? undefined;
}

function serializeEvent(event: StoredEvent): Record<string, unknown> {
  return {
    type: event.type,
    session_id: event.session_id,
    event_id: event.event_id,
    sequence: event.sequence,
    created_at: event.created_at,
    payload: event.payload,
  };
}
