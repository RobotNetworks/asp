"""Trust and authorization conformance tests.

Covers Appendix A MUST #8: trust-policy denials use 404 (never 403).

These tests assume the operator can produce a "closed" agent — one whose
inbound policy refuses inbound traffic from at least one of the test handles.
The mechanism by which the operator achieves this is implementation-specific;
the tests only assert observable wire behavior.

If the operator cannot configure such a state for the conformance run, the
non-existent-handle test alone still asserts the 404 contract for the lookup
case.
"""

from __future__ import annotations

import pytest


async def test_invite_to_nonexistent_handle_returns_404(alice):
    """A session creation whose only invitee is unreachable must return 404,
    never 403, and never silently succeed (Whitepaper §6.2, Appendix A #8).

    The 404-not-403 rule is what gives the protocol its non-enumerating
    privacy property. Allowing a 200 with the unreachable invitee silently
    omitted would create a hole in that contract — the operator could mask
    any failed invite as a zero-invite session.
    """
    resp = await alice.create_session(invite=["@does-not-exist.nobody"])
    assert resp.status_code != 403, "policy denials must not surface as 403"
    assert resp.status_code == 404, (
        f"single-invitee request with an unreachable invitee must return 404, "
        f"got {resp.status_code}"
    )


async def test_allowlist_denial_returns_404(alice):
    """An allowlist denial must return 404, not 403, and must not silently
    succeed (Whitepaper §6.2).

    Assumes the operator has seeded `@closed.test` with `inbound_policy:
    allowlist` and an empty allowlist. Operators that do not seed this agent
    will see the test pass trivially against the doesn't-exist path — both
    return 404 by design (the non-enumeration property), so the test is
    correct in either case but only meaningful when the agent exists.
    """
    resp = await alice.create_session(invite=["@closed.test"])
    assert resp.status_code != 403, "policy denials must not surface as 403"
    assert resp.status_code == 404, (
        f"single-invitee request to a closed agent must return 404, "
        f"got {resp.status_code}"
    )


# ---- Self-authentication --------------------------------------------------


async def test_message_carries_authenticated_sender(alice, bob):
    """Messages from @alice.test arrive with sender == @alice.test, regardless
    of any client-side claim (Appendix A #1)."""
    sid = (await alice.create_session(invite=[bob.handle])).json()["session_id"]
    await bob.expect_event("session.invited", session_id=sid)
    await bob.join(sid)
    await alice.expect_event("session.joined", session_id=sid)

    await alice.send_message(sid, "hello")
    event = await bob.expect_event("session.message", session_id=sid)
    assert event["payload"]["sender"] == alice.handle
