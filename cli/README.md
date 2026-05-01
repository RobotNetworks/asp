# `@robotnetworks/asp`

A CLI and reference TypeScript implementation of the [Agent Session Protocol](../README.md). Spin up a local ASP network on your machine for protocol verification and agent-to-agent development.

The Python operator at [`examples/local-operator/`](../examples/local-operator/) is the protocol's first reference; this is the second. Both pass the conformance suite at [`tests/conformance/`](../tests/conformance/).

## Install

```sh
npm install -g @robotnetworks/asp
```

Requires Node.js 22 or newer (uses the built-in `node:sqlite` module).

## Quick start

```sh
# Start a network on localhost (background; runs as a detached process).
asp start

# Register two agents with open inbound policy.
asp agent register @alice.bot --policy open
asp agent register @bob.bot   --policy open

# Bind the current directory to act as @alice.bot by default,
# so subsequent commands don't need --as.
asp identity set @alice.bot

# Open a session inviting bob and send a message.
sid=$(asp session create --invite @bob.bot --json | jq -r .session_id)
asp session send "$sid" "hello bob"

# In another terminal, watch the wire as @bob.bot.
asp listen --as @bob.bot
```

## Commands

| Command | What it does |
| --- | --- |
| `asp start` / `stop` / `status` / `logs` | Lifecycle for local networks (multi-network, supervised, persistent) |
| `asp agent` | Register, list, show, rotate-token, remove agents; set inbound policy |
| `asp permission` | Manage per-agent allowlists |
| `asp session` | Create, join, invite, send, leave, end, reopen, list events |
| `asp contact` | Send, list, show, accept, decline contact requests (the §6.2 handshake) |
| `asp listen` | Stream live session events for one agent over WebSocket |
| `asp identity` | Bind a directory to a default agent (`.robotnet/asp.json`, walked up like `.git`) |
| `asp tap` | Admin-level stream of every event on the network — useful for debugging |
| `asp seed` | Register a batch of open-policy test agents |
| `asp reset` | Wipe a network's agents, sessions, and contacts |

`asp <command> --help` for full options on any subcommand.

## Picking the acting agent

Most commands need an agent identity. Three ways to provide it, in order of precedence:

1. `--as <handle>` — per-command flag.
2. `ASP_AGENT=<handle>` env var — per-shell override. Useful when two terminals in the same project want to act as different agents.
3. `.robotnet/asp.json` — directory binding (walked up like `.git`); set with `asp identity set <handle>`.

The `--network`/`-n` flag wins over the directory's network when explicit; `ASP_AGENT` only overrides the handle, not the network.

```sh
# Bind the project to alice by default
asp identity set @alice.bot

# In another terminal, act as bob just for this shell
export ASP_AGENT=@bob.bot
asp session list                  # runs as @bob.bot
unset ASP_AGENT                   # back to @alice.bot

# One-off: act as carol for this single command
asp session list --as @carol.bot
```

## What you get

- **Multi-network.** Run multiple isolated ASP networks side-by-side; each has its own port, admin token, and SQLite store.
- **Persistent.** State lives in `$XDG_STATE_HOME/asp/networks/<name>/` (defaulting to `~/.local/state/asp/networks/<name>/`) — agents, sessions, and the event log survive restarts.
- **Conformance-passing.** The full Python pytest conformance suite runs against the in-process server as part of `npm test`.
- **Composable.** Every command supports `--json` for piping into `jq` and other tools.

## Develop

```sh
npm install
npm run typecheck
npm test                     # 375+ tests including the Python conformance suite (skipped if `uv` is not installed)
npm run build
```

The conformance run is automatic when `uv` is on `PATH`; otherwise it skips so the suite stays portable.

## License

Apache-2.0. See [`../LICENSE`](../LICENSE).
