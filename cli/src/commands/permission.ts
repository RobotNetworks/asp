import { Command } from "commander";

import {
  AdminApiError,
  NetworkNotRunningError,
  connectAdmin,
  type AgentWire,
} from "../client/admin.js";
import { allowlistEntriesArg, handleArg, isValidAllowlistEntry } from "../handles.js";

const DEFAULT_NETWORK = "default";

/**
 * Register `asp permission` and its sub-commands on the program.
 *
 * Allowlist management is an admin operation (requires the network's admin
 * token, read from disk). Each sub-command accepts -n/--network (default:
 * "default") and --json for machine-readable output.
 */
export function registerPermissionCommand(program: Command): void {
  const permission = new Command("permission").description(
    "Manage agent allowlists on a local ASP network",
  );

  permission.addCommand(makeAddCmd());
  permission.addCommand(makeRemoveCmd());
  permission.addCommand(makeShowCmd());

  program.addCommand(permission);
}

// ── add ───────────────────────────────────────────────────────────────────────

function makeAddCmd(): Command {
  return new Command("add")
    .description("Add one or more entries to an agent's allowlist")
    .argument("<handle>", "Agent handle", handleArg)
    .argument(
      "<entries...>",
      "Allowlist entries (handle or owner glob like @acme.*)",
      allowlistEntriesArg,
    )
    .option("-n, --network <name>", "Target network", DEFAULT_NETWORK)
    .option("--json", "Emit machine-readable JSON", false)
    .action(
      wrap(async (handle: string, entries: string[], opts: NetworkJsonOpts) => {
        const client = await resolveClient(opts.network);
        const agent = await client.addToAllowlist(handle, entries);
        if (opts.json) {
          out(JSON.stringify(agent, null, 2));
          return;
        }
        out(`Added ${entries.length} entry/entries to ${handle}'s allowlist.`);
        printAllowlist(agent);
      }),
    );
}

// ── remove ────────────────────────────────────────────────────────────────────

function makeRemoveCmd(): Command {
  return new Command("remove")
    .description("Remove an entry from an agent's allowlist")
    .argument("<handle>", "Agent handle", handleArg)
    .argument("<entry>", "Allowlist entry to remove", (value: string) => {
      if (!isValidAllowlistEntry(value)) {
        throw new Error(
          `invalid allowlist entry "${value}" (expected @<owner>.<name> or @<owner>.*)`,
        );
      }
      return value;
    })
    .option("-n, --network <name>", "Target network", DEFAULT_NETWORK)
    .option("--json", "Emit machine-readable JSON", false)
    .action(
      wrap(async (handle: string, entry: string, opts: NetworkJsonOpts) => {
        const client = await resolveClient(opts.network);
        const agent = await client.removeFromAllowlist(handle, entry);
        if (opts.json) {
          out(JSON.stringify(agent, null, 2));
          return;
        }
        out(`Removed "${entry}" from ${handle}'s allowlist.`);
        printAllowlist(agent);
      }),
    );
}

// ── show ──────────────────────────────────────────────────────────────────────

function makeShowCmd(): Command {
  return new Command("show")
    .description("Show an agent's current allowlist")
    .argument("<handle>", "Agent handle", handleArg)
    .option("-n, --network <name>", "Target network", DEFAULT_NETWORK)
    .option("--json", "Emit machine-readable JSON", false)
    .action(
      wrap(async (handle: string, opts: NetworkJsonOpts) => {
        const client = await resolveClient(opts.network);
        const agent = await client.showAgent(handle);
        if (opts.json) {
          out(JSON.stringify({ handle: agent.handle, allowlist: agent.allowlist }, null, 2));
          return;
        }
        printAllowlist(agent);
      }),
    );
}

// ── shared helpers ────────────────────────────────────────────────────────────

interface NetworkJsonOpts {
  readonly network: string;
  readonly json: boolean;
}

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
    case "invalid_entries":
      return "invalid allowlist entry — expected @<owner>.<name> or @<owner>.*";
    case "missing_authorization":
    case "invalid_authorization":
      return "admin token rejected — is this the right network?";
    default:
      return `server returned ${err.status}: ${err.code}`;
  }
}

function printAllowlist(agent: AgentWire): void {
  out(`  handle    ${agent.handle}`);
  out(`  policy    ${agent.policy}`);
  if (agent.allowlist.length === 0) {
    out(`  allowlist (empty)`);
  } else {
    out(`  allowlist`);
    for (const entry of agent.allowlist) {
      out(`    ${entry}`);
    }
  }
}

function out(line: string): void {
  process.stdout.write(`${line}\n`);
}
