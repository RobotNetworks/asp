import { Command } from "commander";

import {
  AgentNotFoundError,
  SessionApiError,
  connectSession,
  type ContactRequestWire,
} from "../client/session.js";
import { resolveAgentIdentity, type IdentitySource } from "../identity.js";

const DEFAULT_NETWORK = "default";

/**
 * Register `asp contact` and its sub-commands on the program.
 *
 * Contact requests are the §6.2 handshake mechanism that lets two `allowlist`
 * agents mutually add each other. Each sub-command requires --as <handle>
 * and accepts -n/--network (default: "default"), --token, and --json.
 */
export function registerContactCommand(program: Command): void {
  const contact = new Command("contact").description(
    "Manage contact requests between agents on a local ASP network",
  );

  contact.addCommand(makeSendCmd());
  contact.addCommand(makeListCmd());
  contact.addCommand(makeShowCmd());
  contact.addCommand(makeAcceptCmd());
  contact.addCommand(makeDeclineCmd());

  program.addCommand(contact);
}

// ── send ──────────────────────────────────────────────────────────────────────

function makeSendCmd(): Command {
  return new Command("send")
    .description("Send a contact request to another agent")
    .argument("<to>", "Recipient agent handle")
    .option("--as <handle>", "Act as this agent handle")
    .option("-n, --network <name>", "Target network", DEFAULT_NETWORK)
    .option("--message <text>", "Optional message to include with the request")
    .option("--token <token>", "Override the stored agent bearer token")
    .option("--json", "Emit machine-readable JSON", false)
    .action(
      wrap(async (to: string, opts: SendOpts) => {
        const { handle, network } = await resolveAs(opts.as, opts.network);
        const client = await resolveClient(network, handle, opts.token);
        const result = await client.sendContactRequest(to, {
          ...(opts.message !== undefined ? { message: opts.message } : {}),
        });
        if (opts.json) {
          out(JSON.stringify(result, null, 2));
          return;
        }
        out(`Contact request sent (id=${result.request_id}).`);
      }),
    );
}

interface SendOpts {
  readonly as?: string;
  readonly network: string;
  readonly message?: string;
  readonly token?: string;
  readonly json: boolean;
}

// ── list ──────────────────────────────────────────────────────────────────────

function makeListCmd(): Command {
  return new Command("list")
    .description("List contact requests for the agent")
    .option("--as <handle>", "Act as this agent handle")
    .option("-n, --network <name>", "Target network", DEFAULT_NETWORK)
    .option("--token <token>", "Override the stored agent bearer token")
    .option("--json", "Emit machine-readable JSON", false)
    .action(
      wrap(async (opts: AgentNetworkJsonOpts) => {
        const { handle, network } = await resolveAs(opts.as, opts.network);
        const client = await resolveClient(network, handle, opts.token);
        const { requests } = await client.listContactRequests();
        if (opts.json) {
          out(JSON.stringify({ requests }, null, 2));
          return;
        }
        if (requests.length === 0) {
          out(`No contact requests for ${opts.as} on network "${opts.network}".`);
          return;
        }
        out(formatRequestTable(requests));
      }),
    );
}

// ── show ──────────────────────────────────────────────────────────────────────

function makeShowCmd(): Command {
  return new Command("show")
    .description("Show details for a contact request")
    .argument("<request-id>", "Contact request ID")
    .option("--as <handle>", "Act as this agent handle")
    .option("-n, --network <name>", "Target network", DEFAULT_NETWORK)
    .option("--token <token>", "Override the stored agent bearer token")
    .option("--json", "Emit machine-readable JSON", false)
    .action(
      wrap(async (requestId: string, opts: AgentNetworkJsonOpts) => {
        const { handle, network } = await resolveAs(opts.as, opts.network);
        const client = await resolveClient(network, handle, opts.token);
        const req = await client.showContactRequest(requestId);
        if (opts.json) {
          out(JSON.stringify(req, null, 2));
          return;
        }
        printRequest(req);
      }),
    );
}

// ── accept ────────────────────────────────────────────────────────────────────

function makeAcceptCmd(): Command {
  return new Command("accept")
    .description("Accept a contact request (adds both agents to each other's allowlist)")
    .argument("<request-id>", "Contact request ID")
    .option("--as <handle>", "Act as this agent handle")
    .option("-n, --network <name>", "Target network", DEFAULT_NETWORK)
    .option("--token <token>", "Override the stored agent bearer token")
    .action(
      wrap(async (requestId: string, opts: AgentNetworkOpts) => {
        const { handle, network } = await resolveAs(opts.as, opts.network);
        const client = await resolveClient(network, handle, opts.token);
        await client.acceptContactRequest(requestId);
        out(`Accepted contact request ${requestId}. Both agents' allowlists have been updated.`);
      }),
    );
}

// ── decline ───────────────────────────────────────────────────────────────────

function makeDeclineCmd(): Command {
  return new Command("decline")
    .description("Decline a contact request")
    .argument("<request-id>", "Contact request ID")
    .option("--as <handle>", "Act as this agent handle")
    .option("-n, --network <name>", "Target network", DEFAULT_NETWORK)
    .option("--token <token>", "Override the stored agent bearer token")
    .action(
      wrap(async (requestId: string, opts: AgentNetworkOpts) => {
        const { handle, network } = await resolveAs(opts.as, opts.network);
        const client = await resolveClient(network, handle, opts.token);
        await client.declineContactRequest(requestId);
        out(`Declined contact request ${requestId}.`);
      }),
    );
}

// ── shared helpers ─────────────────────────────────────────────────────────────

interface AgentNetworkOpts {
  readonly as?: string;
  readonly network: string;
  readonly token?: string;
}

interface AgentNetworkJsonOpts extends AgentNetworkOpts {
  readonly json: boolean;
}

async function resolveAs(
  explicit: string | undefined,
  network: string,
): Promise<{ handle: string; network: string; source: IdentitySource }> {
  const resolved = await resolveAgentIdentity(explicit, network, DEFAULT_NETWORK);
  if (!resolved) {
    process.stderr.write(
      "asp: --as <handle> is required, or set ASP_AGENT, or bind a directory identity with `asp identity set`\n",
    );
    process.exit(1);
  }
  return resolved;
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
      return "contact request not found";
    case "not_pending":
      return "contact request is no longer pending";
    case "not_recipient":
      return "you are not the recipient of this contact request";
    case "invalid_request":
      return "invalid contact request";
    case "missing_authorization":
    case "invalid_authorization":
      return (
        "authorization rejected — the agent may have been removed " +
        "(check `asp agent list`; if a directory identity points at it, " +
        "run `asp identity clear`)"
      );
    default:
      return `server returned ${err.status}: ${err.code}`;
  }
}

function printRequest(req: ContactRequestWire): void {
  const pad = 12;
  out(`  ${"id".padEnd(pad)} ${req.id}`);
  out(`  ${"from".padEnd(pad)} ${req.from}`);
  out(`  ${"to".padEnd(pad)} ${req.to}`);
  out(`  ${"status".padEnd(pad)} ${req.status}`);
  if (req.message !== undefined) {
    out(`  ${"message".padEnd(pad)} ${req.message}`);
  }
  out(`  ${"created_at".padEnd(pad)} ${new Date(req.created_at).toISOString()}`);
  if (req.resolved_at !== undefined) {
    out(`  ${"resolved_at".padEnd(pad)} ${new Date(req.resolved_at).toISOString()}`);
  }
}

function formatRequestTable(requests: readonly ContactRequestWire[]): string {
  const headers = ["ID", "FROM", "TO", "STATUS"];
  const rows = requests.map((r) => [r.id, r.from, r.to, r.status]);
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => r[i]?.length ?? 0)),
  );
  const renderRow = (row: readonly string[]): string =>
    row.map((cell, i) => cell.padEnd(widths[i] ?? 0)).join("  ").trimEnd();
  return `${[headers, ...rows].map(renderRow).join("\n")}\n`;
}

function out(line: string): void {
  process.stdout.write(`${line}\n`);
}
