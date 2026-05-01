import { readFile } from "node:fs/promises";

import { agentCredentialPath, resolveStateRoot } from "../paths.js";
import { readRegistry } from "../registry.js";
import type { Content, Metadata, ParticipantStatus, SessionState } from "../server/store/sessions.js";

export type { Content, Metadata, ParticipantStatus, SessionState };

export interface ParticipantWire {
  readonly handle: string;
  readonly status: ParticipantStatus;
  readonly joined_at?: number;
  readonly left_at?: number;
}

export interface SessionWire {
  readonly id: string;
  readonly state: SessionState;
  readonly topic?: string;
  readonly participants: readonly ParticipantWire[];
  readonly created_at: number;
  readonly ended_at?: number;
}

export interface EventWire {
  readonly type: string;
  readonly session_id: string;
  readonly event_id: string;
  readonly sequence: number;
  readonly created_at: number;
  readonly payload: Readonly<Record<string, unknown>>;
}

export class SessionApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super(`session API error ${status}: ${code}`);
    this.name = "SessionApiError";
    this.status = status;
    this.code = code;
  }
}

export class AgentNotFoundError extends Error {
  constructor(handle: string, network: string) {
    super(
      `no credential for ${handle} on network "${network}" — run \`asp agent register ${handle}\` first, or pass --token`,
    );
    this.name = "AgentNotFoundError";
  }
}

/**
 * Typed HTTP client for the /sessions protocol routes.
 * Authenticated by the calling agent's bearer token.
 */
export class SessionClient {
  readonly #baseUrl: string;
  readonly #token: string;

  constructor(baseUrl: string, token: string) {
    this.#baseUrl = baseUrl;
    this.#token = token;
  }

  /** The WebSocket URL for the `/connect` event stream endpoint. */
  get wsUrl(): string {
    return this.#baseUrl.replace(/^http/, "ws") + "/connect";
  }

  /** The agent's bearer token (needed for WS auth). */
  get token(): string {
    return this.#token;
  }

  async createSession(opts: {
    invite?: string[];
    topic?: string;
    initialMessage?: { content: Content; metadata?: Metadata };
    endAfterSend?: boolean;
  } = {}): Promise<{ session_id: string; sequence?: number }> {
    return this.#post<{ session_id: string; sequence?: number }>("/sessions", {
      ...(opts.invite !== undefined ? { invite: opts.invite } : {}),
      ...(opts.topic !== undefined ? { topic: opts.topic } : {}),
      ...(opts.initialMessage !== undefined ? { initial_message: opts.initialMessage } : {}),
      ...(opts.endAfterSend === true ? { end_after_send: true } : {}),
    });
  }

  async listSessions(): Promise<SessionWire[]> {
    const body = await this.#get<{ sessions: SessionWire[] }>("/sessions");
    return body.sessions;
  }

  async showSession(sessionId: string): Promise<SessionWire> {
    return this.#get<SessionWire>(`/sessions/${encodeURIComponent(sessionId)}`);
  }

  async joinSession(sessionId: string): Promise<void> {
    await this.#post(`/sessions/${encodeURIComponent(sessionId)}/join`, {});
  }

  async inviteToSession(sessionId: string, handles: string[]): Promise<{ invited: string[] }> {
    return this.#post<{ invited: string[] }>(
      `/sessions/${encodeURIComponent(sessionId)}/invite`,
      { invite: handles },
    );
  }

  async sendMessage(
    sessionId: string,
    content: Content,
    opts: { idempotencyKey?: string; metadata?: Metadata } = {},
  ): Promise<{ message_id: string; sequence: number }> {
    return this.#post<{ message_id: string; sequence: number }>(
      `/sessions/${encodeURIComponent(sessionId)}/messages`,
      {
        content,
        ...(opts.idempotencyKey !== undefined ? { idempotency_key: opts.idempotencyKey } : {}),
        ...(opts.metadata !== undefined ? { metadata: opts.metadata } : {}),
      },
    );
  }

  async leaveSession(sessionId: string): Promise<void> {
    await this.#post(`/sessions/${encodeURIComponent(sessionId)}/leave`, {});
  }

  async endSession(sessionId: string): Promise<void> {
    await this.#post(`/sessions/${encodeURIComponent(sessionId)}/end`, {});
  }

  async reopenSession(sessionId: string, opts: {
    invite?: string[];
    initialMessage?: { content: Content; metadata?: Metadata };
  } = {}): Promise<void> {
    await this.#post(`/sessions/${encodeURIComponent(sessionId)}/reopen`, {
      ...(opts.invite !== undefined ? { invite: opts.invite } : {}),
      ...(opts.initialMessage !== undefined ? { initial_message: opts.initialMessage } : {}),
    });
  }

  async getEvents(
    sessionId: string,
    opts: { afterSequence?: number; limit?: number } = {},
  ): Promise<{ events: EventWire[]; next_cursor?: string }> {
    const params = new URLSearchParams();
    if (opts.afterSequence !== undefined) params.set("after_sequence", String(opts.afterSequence));
    if (opts.limit !== undefined) params.set("limit", String(opts.limit));
    const qs = params.toString();
    const path = `/sessions/${encodeURIComponent(sessionId)}/events${qs ? `?${qs}` : ""}`;
    return this.#get<{ events: EventWire[]; next_cursor?: string }>(path);
  }

  async #get<T>(path: string): Promise<T> {
    return this.#request<T>("GET", path);
  }

  async #post<T>(path: string, body: unknown): Promise<T> {
    return this.#request<T>("POST", path, body);
  }

  async #request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.#token}`,
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    let res: Response;
    try {
      res = await fetch(`${this.#baseUrl}${path}`, {
        method,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`could not reach network at ${this.#baseUrl}: ${msg}`);
    }
    const json = (await res.json()) as unknown;
    if (!res.ok) {
      const code = isErrorBody(json) ? json.error : `http_${res.status}`;
      throw new SessionApiError(res.status, code);
    }
    return json as T;
  }
}

/**
 * Resolve a SessionClient for a given agent on a given network.
 * Reads the network's host/port from the registry and the agent's token
 * from the credential file written by `asp agent register`.
 */
export async function connectSession(
  network: string,
  handle: string,
  overrideToken?: string,
  stateRoot?: string,
): Promise<SessionClient> {
  const root = stateRoot ?? resolveStateRoot();
  const reg = await readRegistry(root);
  const entry = reg.networks[network];
  if (!entry) {
    throw new Error(`network "${network}" is not running — run \`asp start\` first`);
  }
  let token: string;
  if (overrideToken !== undefined) {
    token = overrideToken;
  } else {
    const credPath = agentCredentialPath(root, network, handle);
    try {
      token = (await readFile(credPath, "utf8")).trim();
    } catch {
      throw new AgentNotFoundError(handle, network);
    }
  }
  return new SessionClient(`http://${entry.host}:${entry.port}`, token);
}

function isErrorBody(v: unknown): v is { error: string } {
  return (
    typeof v === "object" &&
    v !== null &&
    "error" in v &&
    typeof (v as { error: unknown }).error === "string"
  );
}
