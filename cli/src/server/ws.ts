import type { IncomingMessage } from "node:http";
import type { Socket } from "node:net";

import { WebSocketServer, WebSocket } from "ws";

import type { AgentStore } from "./store/agents.js";
import type { ContactEvent, ContactObserver, ContactStore } from "./store/contacts.js";
import type { EventObserver, SessionStore, StoredEvent } from "./store/sessions.js";

/**
 * Manages the `WS /connect` endpoint for the ASP event stream.
 *
 * Each connected client authenticates via Bearer token, subscribes to all
 * events the agent is eligible to receive across every session, and receives
 * them as JSON text frames. The hub registers a single EventObserver with the
 * session store and fans events to matching connections.
 */
export interface WSHubAttachOptions {
  readonly agentStore: AgentStore;
  readonly sessionStore: SessionStore;
  readonly contactStore?: ContactStore;
  readonly adminToken?: string;
}

export class WSHub {
  readonly #wss: WebSocketServer;
  /** Map from agent handle → set of live WebSocket connections */
  readonly #connections = new Map<string, Set<WebSocket>>();
  /** Admin tap connections receive every event regardless of recipient list */
  readonly #adminConns = new Set<WebSocket>();
  #unsubscribe?: () => void;
  #contactUnsub?: () => void;
  #agentStore?: AgentStore;
  #sessionStore?: SessionStore;
  #adminToken: string | undefined = undefined;

  constructor() {
    this.#wss = new WebSocketServer({ noServer: true });
  }

  /**
   * Attach the hub to the session and contact store event streams and set up
   * the WebSocket server's connection handler. Must be called before the first
   * upgrade request.
   *
   * Pass `adminToken` to enable the `/_admin/tap` endpoint; omit it to
   * disable admin tap (useful for tests that don't need it).
   */
  attach(opts: WSHubAttachOptions): void {
    this.#agentStore = opts.agentStore;
    this.#sessionStore = opts.sessionStore;
    this.#adminToken = opts.adminToken;

    this.#unsubscribe = opts.sessionStore.subscribe((event, recipients) => {
      this.#dispatch(event, recipients);
    });

    if (opts.contactStore) {
      const contactStore = opts.contactStore;
      const contactObserver: ContactObserver = (event, recipient) => {
        this.#dispatchContact(event, recipient);
      };
      this.#contactUnsub = contactStore.subscribe(contactObserver);
    }

    this.#wss.on("connection", (ws: WebSocket, _req: IncomingMessage, handle: string) => {
      this.#addConnection(handle, ws);
      this.#replayForAgent(handle, ws);
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

  /**
   * Handle an incoming HTTP upgrade request for `GET /_admin/tap`.
   * Authenticates with the admin token, then adds the connection to the
   * admin tap set so it receives all session events.
   */
  handleAdminUpgrade(req: IncomingMessage, socket: Socket, head: Buffer): void {
    if (!this.#adminToken) {
      socket.write("HTTP/1.1 501 Not Implemented\r\n\r\n");
      socket.destroy();
      return;
    }
    const token = extractToken(req);
    if (token !== this.#adminToken) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    this.#wss.handleUpgrade(req, socket, head, (ws) => {
      this.#adminConns.add(ws);
      ws.on("close", () => this.#adminConns.delete(ws));
      ws.on("error", () => this.#adminConns.delete(ws));
    });
  }

  close(): void {
    this.#unsubscribe?.();
    this.#contactUnsub?.();
    for (const ws of this.#adminConns) ws.terminate();
    this.#adminConns.clear();
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
    for (const ws of this.#adminConns) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(frame);
      }
    }
  }

  #dispatchContact(event: ContactEvent, recipient: string): void {
    const frame = JSON.stringify({ type: event.type, request_id: event.request_id, payload: event.payload });
    const conns = this.#connections.get(recipient);
    if (conns) {
      for (const ws of conns) {
        if (ws.readyState === WebSocket.OPEN) ws.send(frame);
      }
    }
    for (const ws of this.#adminConns) {
      if (ws.readyState === WebSocket.OPEN) ws.send(frame);
    }
  }

  /**
   * On reconnect, replay all session events visible to this agent so that
   * any events missed while disconnected are delivered before live streaming.
   */
  #replayForAgent(handle: string, ws: WebSocket): void {
    const store = this.#sessionStore;
    if (!store) return;
    const sessions = store.list(handle);
    for (const session of sessions) {
      const events = store.getEvents(session.id, handle);
      if (!events) continue;
      for (const event of events) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(serializeEvent(event)));
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
