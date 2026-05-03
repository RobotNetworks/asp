# ASP Conformance Suite

A black-box test suite for ASP operators. Point it at any operator URL with credentials for three test agents; pytest reports which conformance bars pass and which fail.

These tests are the executable form of the MUST and high-priority SHOULD clauses in `WHITEPAPER.md` Appendix A.

## What's covered

| File | Invariants |
|---|---|
| `test_sessions.py` | Session creation, invite, join, leave, end, reopen, send-and-end, GET /sessions/{id} |
| `test_messages.py` | Sequence monotonicity, idempotency keys, multi-part content, schema validation |
| `test_transport.py` | Live event delivery, eligibility filtering, event history (`GET /events`), reconnect-with-replay |
| `test_trust.py` | 404-not-403 for trust denials, sender authentication |

## Configuration

Environment variables:

- `ASP_OPERATOR_URL` — base URL of the operator under test, e.g. `http://localhost:8080`
- `ASP_TEST_AGENTS` — JSON object mapping handle to either a bare token string or a `{token, ...}` object. Both shapes are accepted, so the operator's full seed file can be passed straight through. Example:
  ```json
  {"@alice.test": "tok_alice", "@bob.test": "tok_bob", "@carol.test": "tok_carol"}
  ```

The suite assumes those three agents are pre-provisioned with `open` inbound policy. How the operator gets them into that state is operator-specific (seed file, fixture, startup hook). The protocol does not specify a provisioning surface.

For the full conformance run including the policy-denial test, the operator should additionally seed `@closed.test` with `inbound_policy: allowlist` and an empty allowlist. If the operator does not seed it, the test still passes — both "doesn't exist" and "policy denial" return 404 by design (the non-enumeration property in Whitepaper §6.2) — but only the doesn't-exist code path is exercised.

## Authentication convention

The protocol does not mandate an authentication mechanism (Whitepaper §10). For conformance, the suite presents:

- `Authorization: Bearer <token>`

Operators that authenticate differently can subclass `Agent` in `asp_client.py` and override the `headers` property.

## Running

```bash
cd tests/conformance
uv run pytest                            # or: pip install -e . && pytest
```

Filter to one family:

```bash
uv run pytest test_messages.py
```

Run a single test:

```bash
uv run pytest test_sessions.py::test_create_session_returns_session_id
```

## What's not covered yet

- Full ordering invariants under concurrent senders
- Block semantics end-to-end
- Cross-session isolation in the WS multiplex
- Auth profile (`asp.auth.*`) — separate suite when the profile is published

These are tracked for v0.2.
