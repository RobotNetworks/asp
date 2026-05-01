import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { Command } from "commander";

import {
  AdminApiError,
  NetworkNotRunningError,
  connectAdmin,
  type AgentWire,
  type Policy,
} from "../client/admin.js";
import { agentCredentialPath, resolveStateRoot } from "../paths.js";

const DEFAULT_NETWORK = "default";

/**
 * Register `asp agent` and all its sub-commands on the program.
 *
 * Each sub-command accepts -n/--network to target a specific local network
 * (default: "default") and --json for machine-readable output.
 */
export function registerAgentCommand(program: Command): void {
  const agent = new Command("agent").description(
    "Manage agents on a local ASP network",
  );

  agent.addCommand(makeRegisterCmd());
  agent.addCommand(makeListCmd());
  agent.addCommand(makeShowCmd());
  agent.addCommand(makeRmCmd());
  agent.addCommand(makeRotateTokenCmd());
  agent.addCommand(makeSetPolicyCmd());

  program.addCommand(agent);
}

// ── register ────────────────────────────────────────────────────────────────

function makeRegisterCmd(): Command {
  return new Command("register")
    .description("Register a new agent on a network")
    .argument("<handle>", "Agent handle (e.g. @alice.bot)")
    .option("-n, --network <name>", "Target network", DEFAULT_NETWORK)
    .option(
      "--policy <policy>",
      'Inbound trust posture: "allowlist" (default) or "open"',
    )
    .option("--json", "Emit machine-readable JSON", false)
    .action(
      wrap(async (handle: string, opts: RegisterOpts) => {
        if (opts.policy !== undefined && !isPolicy(opts.policy)) {
          throw new Error(
            `invalid policy "${opts.policy}" — expected "allowlist" or "open"`,
          );
        }
        const client = await resolveClient(opts.network);
        const agent = await client.registerAgent(
          handle,
          opts.policy !== undefined ? { policy: opts.policy } : {},
        );
        // Persist token to disk so session commands can authenticate without --token
        const credPath = agentCredentialPath(resolveStateRoot(), opts.network, handle);
        await mkdir(dirname(credPath), { recursive: true, mode: 0o700 });
        await writeFile(credPath, `${agent.token}\n`, { mode: 0o600 });
        if (opts.json) {
          out(JSON.stringify(agent, null, 2));
          return;
        }
        out(`Agent registered on network "${opts.network}".`);
        printAgent(agent);
      }),
    );
}

interface RegisterOpts {
  readonly network: string;
  readonly policy?: string;
  readonly json: boolean;
}

// ── list ─────────────────────────────────────────────────────────────────────

function makeListCmd(): Command {
  return new Command("list")
    .description("List all agents on a network")
    .option("-n, --network <name>", "Target network", DEFAULT_NETWORK)
    .option("--json", "Emit machine-readable JSON", false)
    .action(
      wrap(async (opts: NetworkJsonOpts) => {
        const client = await resolveClient(opts.network);
        const agents = await client.listAgents();
        if (opts.json) {
          out(JSON.stringify({ agents }, null, 2));
          return;
        }
        if (agents.length === 0) {
          out(`No agents registered on network "${opts.network}".`);
          return;
        }
        out(formatAgentTable(agents));
      }),
    );
}

// ── show ─────────────────────────────────────────────────────────────────────

function makeShowCmd(): Command {
  return new Command("show")
    .description("Show details for a single agent")
    .argument("<handle>", "Agent handle")
    .option("-n, --network <name>", "Target network", DEFAULT_NETWORK)
    .option("--json", "Emit machine-readable JSON", false)
    .action(
      wrap(async (handle: string, opts: NetworkJsonOpts) => {
        const client = await resolveClient(opts.network);
        const agent = await client.showAgent(handle);
        if (opts.json) {
          out(JSON.stringify(agent, null, 2));
          return;
        }
        printAgent(agent);
      }),
    );
}

// ── rm ───────────────────────────────────────────────────────────────────────

function makeRmCmd(): Command {
  return new Command("rm")
    .description("Remove an agent from a network")
    .argument("<handle>", "Agent handle")
    .option("-n, --network <name>", "Target network", DEFAULT_NETWORK)
    .action(
      wrap(async (handle: string, opts: { network: string }) => {
        const client = await resolveClient(opts.network);
        await client.removeAgent(handle);
        // Drop the locally stored bearer token so subsequent commands for
        // this handle hit the friendly "no credential — register again"
        // path rather than failing with 401 invalid_authorization.
        const credPath = agentCredentialPath(resolveStateRoot(), opts.network, handle);
        await rm(credPath, { force: true });
        out(`Removed agent ${handle} from network "${opts.network}".`);
      }),
    );
}

// ── rotate-token ─────────────────────────────────────────────────────────────

function makeRotateTokenCmd(): Command {
  return new Command("rotate-token")
    .description("Issue a new bearer token for an agent")
    .argument("<handle>", "Agent handle")
    .option("-n, --network <name>", "Target network", DEFAULT_NETWORK)
    .option("--json", "Emit machine-readable JSON", false)
    .action(
      wrap(async (handle: string, opts: NetworkJsonOpts) => {
        const client = await resolveClient(opts.network);
        const agent = await client.rotateToken(handle);
        if (opts.json) {
          out(JSON.stringify(agent, null, 2));
          return;
        }
        out(`Token rotated for ${handle}.`);
        printAgent(agent);
      }),
    );
}

// ── set-policy ───────────────────────────────────────────────────────────────

function makeSetPolicyCmd(): Command {
  return new Command("set-policy")
    .description("Update the inbound trust policy for an agent")
    .argument("<handle>", "Agent handle")
    .argument("<policy>", '"allowlist" or "open"')
    .option("-n, --network <name>", "Target network", DEFAULT_NETWORK)
    .option("--json", "Emit machine-readable JSON", false)
    .action(
      wrap(async (handle: string, policy: string, opts: NetworkJsonOpts) => {
        if (!isPolicy(policy)) {
          throw new Error(
            `invalid policy "${policy}" — expected "allowlist" or "open"`,
          );
        }
        const client = await resolveClient(opts.network);
        const agent = await client.setPolicy(handle, policy);
        if (opts.json) {
          out(JSON.stringify(agent, null, 2));
          return;
        }
        out(`Policy updated for ${handle}.`);
        printAgent(agent);
      }),
    );
}

// ── shared helpers ────────────────────────────────────────────────────────────

interface NetworkJsonOpts {
  readonly network: string;
  readonly json: boolean;
}

/**
 * Wrap an action function to convert infrastructure errors into clean
 * user-facing messages rather than stack traces.
 *
 * - NetworkNotRunningError → friendly hint to run `asp start`
 * - AdminApiError          → mapped error string based on code
 * - anything else          → re-thrown for the global handler in run()
 */
function wrap<Args extends unknown[]>(
  fn: (...args: Args) => Promise<void>,
): (...args: Args) => Promise<void> {
  return async (...args: Args): Promise<void> => {
    try {
      await fn(...args);
    } catch (err) {
      if (err instanceof NetworkNotRunningError) {
        process.stderr.write(`asp: ${err.message}\n`);
        process.exit(1);
      }
      if (err instanceof AdminApiError) {
        process.stderr.write(`asp: ${apiErrorMessage(err)}\n`);
        process.exit(1);
      }
      throw err;
    }
  };
}

/**
 * Resolve an AdminClient, exiting cleanly if the network is not running.
 * Kept separate from `wrap` so the network lookup error is surfaced before
 * any API call rather than inside the general catch.
 */
async function resolveClient(network: string) {
  try {
    return await connectAdmin(network);
  } catch (err) {
    if (err instanceof NetworkNotRunningError) {
      process.stderr.write(`asp: ${err.message}\n`);
      process.exit(1);
    }
    throw err;
  }
}

function apiErrorMessage(err: AdminApiError): string {
  switch (err.code) {
    case "not_found":
      return "agent not found";
    case "agent_exists":
      return "an agent with that handle is already registered";
    case "invalid_handle":
      return "invalid handle — expected @<owner>.<name> with lowercase letters, digits, _ or -";
    case "invalid_policy":
      return 'invalid policy — expected "allowlist" or "open"';
    case "missing_authorization":
    case "invalid_authorization":
      return "admin token rejected — is this the right network?";
    default:
      return `server returned ${err.status}: ${err.code}`;
  }
}

function printAgent(agent: AgentWire): void {
  const pad = 8;
  out(`  ${"handle".padEnd(pad)} ${agent.handle}`);
  out(`  ${"policy".padEnd(pad)} ${agent.policy}`);
  out(`  ${"token".padEnd(pad)} ${agent.token}`);
  if (agent.allowlist.length > 0) {
    out(`  ${"allowlist".padEnd(pad)} ${[...agent.allowlist].join(", ")}`);
  }
}

function formatAgentTable(agents: readonly AgentWire[]): string {
  const headers = ["HANDLE", "POLICY", "TOKEN"];
  const rows = agents.map((a) => [a.handle, a.policy, a.token]);
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => r[i]?.length ?? 0)),
  );
  const renderRow = (row: readonly string[]): string =>
    row.map((cell, i) => cell.padEnd(widths[i] ?? 0)).join("  ").trimEnd();
  return `${[headers, ...rows].map(renderRow).join("\n")}\n`;
}

function isPolicy(v: string): v is Policy {
  return v === "allowlist" || v === "open";
}

function out(line: string): void {
  process.stdout.write(`${line}\n`);
}
