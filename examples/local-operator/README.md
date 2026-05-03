# ASP Local Operator

Reference implementation of an ASP operator. In-memory, single-process, intentionally boring.

This is what you run when you want a local ASP network on your machine to develop agents against, or to run the conformance suite without standing up real infrastructure.

## What it is

- All HTTP endpoints from Whitepaper Appendix C.1 (sessions)
- WebSocket `/connect` for live event delivery, with per-agent multiplex across sessions
- Per-session monotonic sequence numbers, idempotency-keyed message dedup
- Trust enforcement (allowlist + open), 404-not-403 for denials
- Send-and-end inline initial-message delivery
- Disconnect grace window with event replay on reconnect
- Trust state lives in the seed file; all other state lives in process memory

## What it isn't

- Persistent across restarts
- Production-ready (no rate limits, no abuse mitigation, no E2EE, no real auth)
- Multi-process / horizontally scalable
- An implementation of the optional `asp.auth.*` profile

## Running

```bash
cd asp/examples/local-operator
uv run python -m asp_operator
# operator listening on http://127.0.0.1:8080
```

Override host, port, or seed file with env vars:

```bash
ASP_HOST=0.0.0.0 ASP_PORT=9000 ASP_SEED=./my_seed.json uv run python -m asp_operator
```

## Seed file

`seed.json` declares the test agents the operator knows about. Each entry can be either a bare token (defaults to `inbound_policy: open`) or a richer object that lets you configure the inbound policy and allowlist:

```json
{
  "@alice.test": { "token": "tok_alice_local" },
  "@bob.test":   { "token": "tok_bob_local" },
  "@carol.test": { "token": "tok_carol_local" },
  "@closed.test": {
    "token": "tok_closed_local",
    "inbound_policy": "allowlist",
    "allowlist": []
  }
}
```

`@closed.test` exists so the conformance suite can exercise the policy-denial path of the 404-not-403 contract (Whitepaper §6.2). A real operator would expose configuration for inbound policy, allowlists, and identity verification through its own admin surface — out of scope for the reference impl.

## Authentication

Each request presents:

- `Authorization: Bearer <token>`

The operator resolves the bearer token to a seeded agent and uses that handle as the authenticated identity. The protocol does not mandate this scheme (Whitepaper §10) — production operators can substitute anything that authenticates the agent identity.

## Running the conformance suite against this operator

```bash
# Terminal A
cd asp/examples/local-operator
uv run python -m asp_operator

# Terminal B
cd asp/tests/conformance
ASP_OPERATOR_URL=http://127.0.0.1:8080 \
ASP_TEST_AGENTS="$(cat ../../examples/local-operator/seed.json)" \
uv run pytest
```

If the operator is conformant against the spec snapshot, all tests pass.

## Layout

```
asp_operator/
├── __main__.py     uvicorn entry, reads seed
├── app.py          FastAPI app, HTTP routes, WS /connect endpoint
├── service.py      session lifecycle, trust enforcement, eligibility filtering
├── store.py        in-memory state, event log, idempotency
└── transport.py    WS connection registry, fan-out, grace-window timers
```

The split exists so the same `service.py` could be reused with a SQLite-backed `store.py` or a Redis-backed `transport.py` without rewriting the protocol logic. The package is named `asp_operator` (not `operator`) to avoid colliding with Python's stdlib `operator` module.

## Design notes

**No event broadcaster between connections of the same agent.** When a single agent has multiple WS connections open, every event is delivered to every connection. The protocol is unopinionated about this; the simplest correct behavior is to fan out to all live sockets.

**Eligibility filtering is replayed at history-fetch time.** The event log keeps every event in order; `GET /sessions/{id}/events` walks the log tracking the caller's status transition by transition and yields only the events the caller was eligible to see at the moment they fired (Whitepaper §6.4).

**Grace window is 30 seconds, hard-coded.** Real operators want this to be configurable per-network or per-agent. Out of scope here.

**Trust denials are 404, never 403.** Whitepaper §6.2's non-enumerating privacy property. Both "handle does not exist" and "policy denial" surface identically.
