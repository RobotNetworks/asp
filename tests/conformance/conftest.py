"""Shared pytest fixtures for the ASP conformance suite.

Configuration is read from environment variables:

  ASP_OPERATOR_URL    Base URL of the operator under test, e.g. http://localhost:8080
  ASP_TEST_AGENTS     JSON object mapping handle -> auth token, e.g.
                      '{"@alice.test": "tok_alice", "@bob.test": "tok_bob"}'

The suite assumes the listed agents are pre-provisioned with `open` inbound
policy unless a test explicitly reconfigures them. How those agents come into
existence is operator-specific and outside the protocol surface.
"""

from __future__ import annotations

import json
import os
import pathlib
import uuid

import pytest
from jsonschema import Draft202012Validator
from referencing import Registry, Resource

from asp_client import Agent

REQUIRED_HANDLES = ["@alice.test", "@bob.test", "@carol.test"]


def _load_config() -> tuple[str, dict[str, str]]:
    base_url = os.environ.get("ASP_OPERATOR_URL")
    raw_agents = os.environ.get("ASP_TEST_AGENTS")
    if not base_url or not raw_agents:
        pytest.skip(
            "ASP_OPERATOR_URL and ASP_TEST_AGENTS must be set to run conformance tests",
            allow_module_level=True,
        )
    try:
        agents_raw = json.loads(raw_agents)
    except json.JSONDecodeError as e:
        pytest.fail(f"ASP_TEST_AGENTS is not valid JSON: {e}")

    # Accept both `{handle: token_str}` (the lean test-suite shape) and
    # `{handle: {token, inbound_policy, ...}}` (the operator's seed shape).
    agents: dict[str, str] = {}
    for handle, value in agents_raw.items():
        if isinstance(value, str):
            agents[handle] = value
        elif isinstance(value, dict) and "token" in value:
            agents[handle] = value["token"]
        else:
            pytest.fail(
                f"ASP_TEST_AGENTS[{handle!r}] must be a token string or an "
                f"object containing a 'token' field"
            )

    missing = [h for h in REQUIRED_HANDLES if h not in agents]
    if missing:
        pytest.fail(
            f"ASP_TEST_AGENTS missing required handles: {missing}. "
            f"Required: {REQUIRED_HANDLES}"
        )
    return base_url, agents


@pytest.fixture(scope="session")
def operator_url() -> str:
    base_url, _ = _load_config()
    return base_url


@pytest.fixture(scope="session")
def agent_tokens() -> dict[str, str]:
    _, agents = _load_config()
    return agents


@pytest.fixture
async def alice(operator_url: str, agent_tokens: dict[str, str]):
    async with Agent("@alice.test", agent_tokens["@alice.test"], operator_url) as a:
        await a.connect()
        yield a


@pytest.fixture
async def bob(operator_url: str, agent_tokens: dict[str, str]):
    async with Agent("@bob.test", agent_tokens["@bob.test"], operator_url) as a:
        await a.connect()
        yield a


@pytest.fixture
async def carol(operator_url: str, agent_tokens: dict[str, str]):
    async with Agent("@carol.test", agent_tokens["@carol.test"], operator_url) as a:
        await a.connect()
        yield a


@pytest.fixture
async def closed(operator_url: str, agent_tokens: dict[str, str]):
    """An agent with `inbound_policy: allowlist` and an empty allowlist.

    Optional — skipped when the operator does not provide a token for
    `@closed.test`. Used to exercise allowlist denials in both directions
    (the agent's own outbound allowlist is also empty, so it cannot
    initiate sessions with anyone).
    """
    token = agent_tokens.get("@closed.test")
    if token is None:
        pytest.skip("operator did not provide a token for @closed.test")
    async with Agent("@closed.test", token, operator_url) as a:
        # Note: @closed.test cannot establish a /connect session reaching it
        # from peers under a strict-allowlist posture, but the WS itself is
        # an authentication-only channel — connect anyway so tests can
        # exercise REST endpoints with an authenticated identity.
        await a.connect()
        yield a


# ---------------------------------------------------------------------------
# Schema-validating fixture
# ---------------------------------------------------------------------------


SCHEMA_DIR = pathlib.Path(__file__).resolve().parents[2] / "schemas"


@pytest.fixture(scope="session")
def event_validator() -> Draft202012Validator:
    """A validator for events.json with cross-file refs resolved."""
    if not SCHEMA_DIR.exists():
        pytest.fail(f"schemas dir not found at {SCHEMA_DIR}")
    resources = [
        (p.name, Resource.from_contents(json.loads(p.read_text())))
        for p in SCHEMA_DIR.glob("*.json")
    ]
    registry = Registry().with_resources(resources)
    schema = json.loads((SCHEMA_DIR / "events.json").read_text())
    return Draft202012Validator(schema, registry=registry)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def fresh_idempotency_key() -> str:
    return f"test-{uuid.uuid4().hex}"
