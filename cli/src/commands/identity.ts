import { Command } from "commander";

import { assertValidHandle } from "../handles.js";
import {
  clearIdentity,
  resolveIdentity,
  writeIdentity,
} from "../identity.js";

const DEFAULT_NETWORK = "default";

/**
 * Register `asp identity` and its sub-commands on the program.
 *
 * Directory-bound identity lets a project directory declare which agent handle
 * (and on which network) represents it. Commands that require `--as <handle>`
 * will fall back to this identity if the flag is omitted.
 *
 * The identity is stored in `.robotnet/asp.json` in the current directory.
 * It is discovered by walking up the directory tree, like `.git`.
 */
export function registerIdentityCommand(program: Command): void {
  const identity = new Command("identity").description(
    "Manage the directory-bound default agent identity (.robotnet/asp.json)",
  );

  identity.addCommand(makeSetCmd());
  identity.addCommand(makeShowCmd());
  identity.addCommand(makeClearCmd());

  program.addCommand(identity);
}

// ── set ───────────────────────────────────────────────────────────────────────

function makeSetCmd(): Command {
  return new Command("set")
    .description(
      "Write a default agent identity for this directory to .robotnet/asp.json",
    )
    .argument("<handle>", "Agent handle (e.g. @mybot.bot)")
    .option("-n, --network <name>", "Network the agent lives on", DEFAULT_NETWORK)
    .action(async (handle: string, opts: SetOpts) => {
      try {
        assertValidHandle(handle);
      } catch {
        process.stderr.write(`asp: invalid handle "${handle}"\n`);
        process.exit(1);
      }
      await writeIdentity(process.cwd(), { handle, network: opts.network });
      process.stdout.write(
        `Identity set: ${handle} on network "${opts.network}"\n` +
          `  (stored in .robotnet/asp.json)\n`,
      );
    });
}

interface SetOpts {
  readonly network: string;
}

// ── show ──────────────────────────────────────────────────────────────────────

function makeShowCmd(): Command {
  return new Command("show")
    .description("Show the resolved directory identity (walks up from the current directory)")
    .option("--json", "Emit machine-readable JSON", false)
    .action(async (opts: ShowOpts) => {
      const identity = await resolveIdentity();
      if (!identity) {
        if (opts.json) {
          process.stdout.write(JSON.stringify(null) + "\n");
        } else {
          process.stdout.write(
            "No identity set. Run `asp identity set <handle>` to create one.\n",
          );
        }
        return;
      }
      if (opts.json) {
        process.stdout.write(
          JSON.stringify(
            { handle: identity.handle, network: identity.network, filePath: identity.filePath },
            null,
            2,
          ) + "\n",
        );
        return;
      }
      const pad = 10;
      process.stdout.write(
        `${"handle".padEnd(pad)}  ${identity.handle}\n` +
          `${"network".padEnd(pad)}  ${identity.network}\n` +
          `${"file".padEnd(pad)}  ${identity.filePath}\n`,
      );
    });
}

interface ShowOpts {
  readonly json: boolean;
}

// ── clear ─────────────────────────────────────────────────────────────────────

function makeClearCmd(): Command {
  return new Command("clear")
    .description("Remove .robotnet/asp.json from the current directory")
    .action(async () => {
      const removed = await clearIdentity(process.cwd());
      if (removed) {
        process.stdout.write("Identity cleared (.robotnet/asp.json removed).\n");
      } else {
        process.stdout.write("No identity file found in this directory.\n");
      }
    });
}
