# Agent Session Protocol

ASP is an open communication protocol for AI agents. It gives agents persistent identities, durable multi-party sessions, owner-controlled trust, and a transport model for communicating across runtimes — the four primitives of an *agent network* rather than just another tool protocol.

Website: [agentsessionprotocol.org](https://agentsessionprotocol.org)

## Status

ASP v0.1 is the current public specification. The spec, schemas, conformance suite, CLI, and reference operators are aligned, and future wire-format changes follow the versioning and conformance process in this repository.

## What's in this repo

| Path | What it is |
|---|---|
| [`WHITEPAPER.md`](./WHITEPAPER.md) | The spec — design principles, four protocol layers, full event vocabulary, conformance bar. |
| [`schemas/`](./schemas/) | JSON Schema 2020-12 definitions for the wire format and HTTP surface. |
| [`tests/conformance/`](./tests/conformance/) | A black-box test suite that any ASP operator can be pointed at. 32 tests covering the Whitepaper Appendix A MUSTs and key SHOULDs. |
| [`examples/local-operator/`](./examples/local-operator/) | First reference operator — Python, FastAPI, in-memory. Passes the conformance suite. |
| [`cli/`](./cli/) | Second reference operator and CLI — TypeScript, Hono, SQLite-backed. Published to npm as `@robotnetworks/asp`. Passes the same conformance suite. |

## Quick start: a local ASP network

The fastest path is the CLI, if you have Node.js 22+:

```bash
npm install -g @robotnetworks/asp
asp start                                    # network running in the background
asp agent register @alice.bot --policy open  # add an agent
asp status                                   # see what's running
```

Or run the Python reference operator directly:

```bash
# In one terminal — run the operator.
cd examples/local-operator
uv run python -m asp_operator

# In another — run the conformance suite against it.
cd tests/conformance
ASP_OPERATOR_URL=http://127.0.0.1:8080 \
ASP_TEST_AGENTS="$(cat ../../examples/local-operator/seed.json)" \
uv run pytest
```

You should see all 32 tests pass in under 20 seconds.

## How it fits together

The four artifacts have one job each:

- The **spec** is the human-readable source of truth.
- The **schemas** are the machine-readable wire shapes — what's on the WebSocket, what bodies the REST endpoints take.
- The **conformance suite** is the executable spec: a third-party operator can claim conformance by passing it.
- The **reference operator** proves the spec is implementable and gives anyone building agents a local network to develop against.

Changes propagate through all four: a change to a wire shape touches the spec, the schemas, a new conformance test, and the reference impl. See [`CONTRIBUTING.md`](./CONTRIBUTING.md).

## Reading order

If you want to understand ASP:
1. [`WHITEPAPER.md`](./WHITEPAPER.md) §§ 4-6 — what a network is, the four design principles, the protocol layers.
2. [`schemas/events.json`](./schemas/events.json) — the eight session events that make up the wire surface.
3. [`tests/conformance/`](./tests/conformance/) — what conforming behavior actually looks like in practice.

If you want to implement an ASP operator:
1. The spec, then [`schemas/`](./schemas/) for the exact wire shapes.
2. [`examples/local-operator/`](./examples/local-operator/) (Python) and [`cli/`](./cli/) (TypeScript) as references for two ways to structure an implementation.
3. [`tests/conformance/`](./tests/conformance/) as your test target — point it at your operator and iterate.

If you want to develop *agents* against ASP:
1. `npm install -g @robotnetworks/asp`, then `asp start` for a local network to talk to.
2. `asp agent register` and `asp listen` to wire up identities and watch the wire while your agent runs.
3. See [`cli/README.md`](./cli/README.md) for the full command surface.

## Licensing

Apache-2.0. See [`LICENSE`](./LICENSE).

## Contributing

Contributions are welcome. Spec changes, schema fixes, additional conformance tests, and reference-impl improvements all move the project forward. See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for how to propose changes and the bar new wire-format changes need to clear.

For security concerns, see [`SECURITY.md`](./SECURITY.md).
