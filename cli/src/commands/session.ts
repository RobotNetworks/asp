import { Command } from "commander";

import {
  AgentNotFoundError,
  SessionApiError,
  connectSession,
  type Content,
  type EventWire,
  type SessionWire,
} from "../client/session.js";

const DEFAULT_NETWORK = "default";

/**
 * Register `asp session` and all its sub-commands on the program.
 *
 * Each sub-command requires --as <handle> (the acting agent) and accepts
 * -n/--network to target a specific local network (default: "default"),
 * plus --token to override the stored credential and --json for machine-
 * readable output.
 */
export function registerSessionCommand(program: Command): void {
  const session = new Command("session").description(
    "Manage ASP sessions as an agent on a local network",
  );

  session.addCommand(makeCreateCmd());
  session.addCommand(makeListCmd());
  session.addCommand(makeShowCmd());
  session.addCommand(makeJoinCmd());
  session.addCommand(makeInviteCmd());
  session.addCommand(makeSendCmd());
  session.addCommand(makeLeaveCmd());
  session.addCommand(makeEndCmd());
  session.addCommand(makeReopenCmd());
  session.addCommand(makeEventsCmd());

  program.addCommand(session);
}

// ── create ───────────────────────────────────────────────────────────────────

function makeCreateCmd(): Command {
  return new Command("create")
    .description("Create a new session")
    .option("--as <handle>", "Act as this agent handle")
    .option("-n, --network <name>", "Target network", DEFAULT_NETWORK)
    .option("--invite <handles>", "Comma-separated handles to invite")
    .option("--topic <text>", "Session topic")
    .option("--message <text>", "Send an initial message")
    .option(
      "--end-after-send",
      "End the session immediately after the initial message",
      false,
    )
    .option("--token <token>", "Override the stored agent bearer token")
    .option("--json", "Emit machine-readable JSON", false)
    .action(
      wrap(async (opts: CreateOpts) => {
        requireAs(opts.as);
        const client = await resolveClient(opts.network, opts.as, opts.token);
        const invite = opts.invite
          ? opts.invite.split(",").map((h) => h.trim()).filter(Boolean)
          : undefined;
        const result = await client.createSession({
          ...(invite !== undefined ? { invite } : {}),
          ...(opts.topic !== undefined ? { topic: opts.topic } : {}),
          ...(opts.message !== undefined
            ? { initialMessage: { content: opts.message } }
            : {}),
          ...(opts.endAfterSend ? { endAfterSend: true } : {}),
        });
        if (opts.json) {
          out(JSON.stringify(result, null, 2));
          return;
        }
        out(`Created session ${result.session_id}.`);
        if (result.sequence !== undefined) {
          out(`  Message sequence: ${result.sequence}`);
        }
      }),
    );
}

interface CreateOpts {
  readonly as?: string;
  readonly network: string;
  readonly invite?: string;
  readonly topic?: string;
  readonly message?: string;
  readonly endAfterSend: boolean;
  readonly token?: string;
  readonly json: boolean;
}

// ── list ─────────────────────────────────────────────────────────────────────

function makeListCmd(): Command {
  return new Command("list")
    .description("List sessions the agent is part of")
    .option("--as <handle>", "Act as this agent handle")
    .option("-n, --network <name>", "Target network", DEFAULT_NETWORK)
    .option("--token <token>", "Override the stored agent bearer token")
    .option("--json", "Emit machine-readable JSON", false)
    .action(
      wrap(async (opts: AgentNetworkJsonOpts) => {
        requireAs(opts.as);
        const client = await resolveClient(opts.network, opts.as, opts.token);
        const sessions = await client.listSessions();
        if (opts.json) {
          out(JSON.stringify({ sessions }, null, 2));
          return;
        }
        if (sessions.length === 0) {
          out(`No sessions found for ${opts.as} on network "${opts.network}".`);
          return;
        }
        out(formatSessionTable(sessions));
      }),
    );
}

// ── show ─────────────────────────────────────────────────────────────────────

function makeShowCmd(): Command {
  return new Command("show")
    .description("Show details for a session")
    .argument("<session-id>", "Session ID")
    .option("--as <handle>", "Act as this agent handle")
    .option("-n, --network <name>", "Target network", DEFAULT_NETWORK)
    .option("--token <token>", "Override the stored agent bearer token")
    .option("--json", "Emit machine-readable JSON", false)
    .action(
      wrap(async (sessionId: string, opts: AgentNetworkJsonOpts) => {
        requireAs(opts.as);
        const client = await resolveClient(opts.network, opts.as, opts.token);
        const session = await client.showSession(sessionId);
        if (opts.json) {
          out(JSON.stringify(session, null, 2));
          return;
        }
        printSession(session);
      }),
    );
}

// ── join ─────────────────────────────────────────────────────────────────────

function makeJoinCmd(): Command {
  return new Command("join")
    .description("Join a session the agent has been invited to")
    .argument("<session-id>", "Session ID")
    .option("--as <handle>", "Act as this agent handle")
    .option("-n, --network <name>", "Target network", DEFAULT_NETWORK)
    .option("--token <token>", "Override the stored agent bearer token")
    .action(
      wrap(async (sessionId: string, opts: AgentNetworkOpts) => {
        requireAs(opts.as);
        const client = await resolveClient(opts.network, opts.as, opts.token);
        await client.joinSession(sessionId);
        out(`Joined session ${sessionId}.`);
      }),
    );
}

// ── invite ───────────────────────────────────────────────────────────────────

function makeInviteCmd(): Command {
  return new Command("invite")
    .description("Invite one or more agents to a session")
    .argument("<session-id>", "Session ID")
    .argument("<handles...>", "Agent handles to invite")
    .option("--as <handle>", "Act as this agent handle")
    .option("-n, --network <name>", "Target network", DEFAULT_NETWORK)
    .option("--token <token>", "Override the stored agent bearer token")
    .option("--json", "Emit machine-readable JSON", false)
    .action(
      wrap(async (sessionId: string, handles: string[], opts: AgentNetworkJsonOpts) => {
        requireAs(opts.as);
        const client = await resolveClient(opts.network, opts.as, opts.token);
        const result = await client.inviteToSession(sessionId, handles);
        if (opts.json) {
          out(JSON.stringify(result, null, 2));
          return;
        }
        if (result.invited.length === 0) {
          out("No agents were invited (all were already participants or not reachable).");
        } else {
          out(`Invited: ${result.invited.join(", ")}`);
        }
      }),
    );
}

// ── send ─────────────────────────────────────────────────────────────────────

function makeSendCmd(): Command {
  return new Command("send")
    .description("Send a message to a session")
    .argument("<session-id>", "Session ID")
    .argument("<message>", "Message content")
    .option("--as <handle>", "Act as this agent handle")
    .option("-n, --network <name>", "Target network", DEFAULT_NETWORK)
    .option("--token <token>", "Override the stored agent bearer token")
    .option("--json", "Emit machine-readable JSON", false)
    .action(
      wrap(async (sessionId: string, message: string, opts: AgentNetworkJsonOpts) => {
        requireAs(opts.as);
        const client = await resolveClient(opts.network, opts.as, opts.token);
        const result = await client.sendMessage(sessionId, message);
        if (opts.json) {
          out(JSON.stringify(result, null, 2));
          return;
        }
        out(`Message sent (id=${result.message_id}, seq=${result.sequence}).`);
      }),
    );
}

// ── leave ─────────────────────────────────────────────────────────────────────

function makeLeaveCmd(): Command {
  return new Command("leave")
    .description("Leave a session")
    .argument("<session-id>", "Session ID")
    .option("--as <handle>", "Act as this agent handle")
    .option("-n, --network <name>", "Target network", DEFAULT_NETWORK)
    .option("--token <token>", "Override the stored agent bearer token")
    .action(
      wrap(async (sessionId: string, opts: AgentNetworkOpts) => {
        requireAs(opts.as);
        const client = await resolveClient(opts.network, opts.as, opts.token);
        await client.leaveSession(sessionId);
        out(`Left session ${sessionId}.`);
      }),
    );
}

// ── end ───────────────────────────────────────────────────────────────────────

function makeEndCmd(): Command {
  return new Command("end")
    .description("End a session")
    .argument("<session-id>", "Session ID")
    .option("--as <handle>", "Act as this agent handle")
    .option("-n, --network <name>", "Target network", DEFAULT_NETWORK)
    .option("--token <token>", "Override the stored agent bearer token")
    .action(
      wrap(async (sessionId: string, opts: AgentNetworkOpts) => {
        requireAs(opts.as);
        const client = await resolveClient(opts.network, opts.as, opts.token);
        await client.endSession(sessionId);
        out(`Ended session ${sessionId}.`);
      }),
    );
}

// ── reopen ────────────────────────────────────────────────────────────────────

function makeReopenCmd(): Command {
  return new Command("reopen")
    .description("Reopen an ended session")
    .argument("<session-id>", "Session ID")
    .option("--as <handle>", "Act as this agent handle")
    .option("-n, --network <name>", "Target network", DEFAULT_NETWORK)
    .option("--invite <handles>", "Comma-separated handles to re-invite")
    .option("--message <text>", "Send an initial message to the reopened session")
    .option("--token <token>", "Override the stored agent bearer token")
    .action(
      wrap(async (sessionId: string, opts: ReopenOpts) => {
        requireAs(opts.as);
        const client = await resolveClient(opts.network, opts.as, opts.token);
        const invite = opts.invite
          ? opts.invite.split(",").map((h) => h.trim()).filter(Boolean)
          : undefined;
        await client.reopenSession(sessionId, {
          ...(invite !== undefined ? { invite } : {}),
          ...(opts.message !== undefined
            ? { initialMessage: { content: opts.message } }
            : {}),
        });
        out(`Reopened session ${sessionId}.`);
      }),
    );
}

interface ReopenOpts {
  readonly as?: string;
  readonly network: string;
  readonly invite?: string;
  readonly message?: string;
  readonly token?: string;
}

// ── events ────────────────────────────────────────────────────────────────────

function makeEventsCmd(): Command {
  return new Command("events")
    .description("Fetch events from a session")
    .argument("<session-id>", "Session ID")
    .option("--as <handle>", "Act as this agent handle")
    .option("-n, --network <name>", "Target network", DEFAULT_NETWORK)
    .option("--after <sequence>", "Only return events after this sequence number")
    .option("--limit <n>", "Maximum number of events to return")
    .option("--token <token>", "Override the stored agent bearer token")
    .option("--json", "Emit machine-readable JSON", false)
    .action(
      wrap(async (sessionId: string, opts: EventsOpts) => {
        requireAs(opts.as);
        const client = await resolveClient(opts.network, opts.as, opts.token);
        const afterSequence =
          opts.after !== undefined ? parseInt(opts.after, 10) : undefined;
        const limit =
          opts.limit !== undefined ? parseInt(opts.limit, 10) : undefined;
        const result = await client.getEvents(sessionId, {
          ...(afterSequence !== undefined ? { afterSequence } : {}),
          ...(limit !== undefined ? { limit } : {}),
        });
        if (opts.json) {
          out(JSON.stringify(result, null, 2));
          return;
        }
        if (result.events.length === 0) {
          out("No events.");
          return;
        }
        for (const event of result.events) {
          out(formatEvent(event));
        }
        if (result.next_cursor !== undefined) {
          out(`\n  next_cursor: ${result.next_cursor}`);
        }
      }),
    );
}

interface EventsOpts {
  readonly as?: string;
  readonly network: string;
  readonly after?: string;
  readonly limit?: string;
  readonly token?: string;
  readonly json: boolean;
}

// ── shared helpers ────────────────────────────────────────────────────────────

interface AgentNetworkOpts {
  readonly as?: string;
  readonly network: string;
  readonly token?: string;
}

interface AgentNetworkJsonOpts extends AgentNetworkOpts {
  readonly json: boolean;
}

function requireAs(handle: string | undefined): asserts handle is string {
  if (!handle) {
    process.stderr.write(
      "asp: --as <handle> is required — specify the acting agent handle\n",
    );
    process.exit(1);
  }
}

async function resolveClient(
  network: string,
  handle: string,
  overrideToken?: string,
) {
  try {
    return await connectSession(network, handle, overrideToken);
  } catch (err) {
    if (err instanceof AgentNotFoundError) {
      process.stderr.write(`asp: ${err.message}\n`);
      process.exit(1);
    }
    if (err instanceof Error && err.message.includes("is not running")) {
      process.stderr.write(`asp: ${err.message}\n`);
      process.exit(1);
    }
    throw err;
  }
}

function wrap<Args extends unknown[]>(
  fn: (...args: Args) => Promise<void>,
): (...args: Args) => Promise<void> {
  return async (...args: Args): Promise<void> => {
    try {
      await fn(...args);
    } catch (err) {
      if (err instanceof SessionApiError) {
        process.stderr.write(`asp: ${apiErrorMessage(err)}\n`);
        process.exit(1);
      }
      if (err instanceof Error && err.message.startsWith("could not reach")) {
        process.stderr.write(`asp: ${err.message}\n`);
        process.exit(1);
      }
      throw err;
    }
  };
}

function apiErrorMessage(err: SessionApiError): string {
  switch (err.code) {
    case "not_found":
      return "session not found";
    case "not_participant":
      return "you are not a participant in this session";
    case "not_invited":
      return "you have not been invited to this session";
    case "not_joined":
      return "you must join the session before performing this action";
    case "already_joined":
      return "you have already joined this session";
    case "session_ended":
      return "the session has ended";
    case "session_active":
      return "the session is already active";
    case "missing_authorization":
    case "invalid_authorization":
      return "authorization rejected — is your token correct?";
    default:
      return `server returned ${err.status}: ${err.code}`;
  }
}

function printSession(session: SessionWire): void {
  const pad = 14;
  out(`  ${"id".padEnd(pad)} ${session.id}`);
  out(`  ${"state".padEnd(pad)} ${session.state}`);
  if (session.topic !== undefined) {
    out(`  ${"topic".padEnd(pad)} ${session.topic}`);
  }
  out(`  ${"created_at".padEnd(pad)} ${new Date(session.created_at).toISOString()}`);
  if (session.ended_at !== undefined) {
    out(`  ${"ended_at".padEnd(pad)} ${new Date(session.ended_at).toISOString()}`);
  }
  if (session.participants.length > 0) {
    out(`  ${"participants".padEnd(pad)}`);
    for (const p of session.participants) {
      out(`    ${p.handle.padEnd(30)} ${p.status}`);
    }
  }
}

function formatSessionTable(sessions: readonly SessionWire[]): string {
  const headers = ["ID", "STATE", "PARTICIPANTS", "TOPIC"];
  const rows = sessions.map((s) => [
    s.id,
    s.state,
    s.participants.map((p) => p.handle).join(", "),
    s.topic ?? "",
  ]);
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => r[i]?.length ?? 0)),
  );
  const renderRow = (row: readonly string[]): string =>
    row.map((cell, i) => cell.padEnd(widths[i] ?? 0)).join("  ").trimEnd();
  return `${[headers, ...rows].map(renderRow).join("\n")}\n`;
}

function formatEvent(event: EventWire): string {
  const ts = new Date(event.created_at).toISOString();
  return `[${event.sequence}] ${ts}  ${event.type}  ${JSON.stringify(event.payload)}`;
}

function out(line: string): void {
  process.stdout.write(`${line}\n`);
}

// Re-export Content so it is accessible from the type if needed externally
export type { Content };
