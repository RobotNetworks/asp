"""Session lifecycle conformance tests.

Covers Whitepaper Appendix A MUSTs #3 (open a session), #6 (lifecycle events),
and the SHOULD for reopening ended sessions.
"""

from __future__ import annotations

import pytest


# ---- Creation -------------------------------------------------------------


async def test_create_session_returns_session_id(alice, bob):
    """POST /sessions with one invitee returns a session_id (Appendix C.1)."""
    resp = await alice.create_session(invite=[bob.handle])
    assert resp.status_code == 201
    body = resp.json()
    assert "session_id" in body
    assert body["session_id"].startswith("sess_")


async def test_create_session_with_zero_invitees(alice):
    """A session with zero invitees is permitted (Whitepaper §6.3)."""
    resp = await alice.create_session()
    assert resp.status_code == 201
    assert "session_id" in resp.json()


async def test_create_session_fires_session_invited_to_invitees(alice, bob):
    """Each invitee receives a session.invited event."""
    resp = await alice.create_session(invite=[bob.handle])
    sid = resp.json()["session_id"]
    event = await bob.expect_event("session.invited", session_id=sid)
    assert event["payload"]["invitee"] == bob.handle


async def test_create_session_with_multiple_invitees(alice, bob, carol):
    """All listed invitees receive session.invited."""
    resp = await alice.create_session(invite=[bob.handle, carol.handle])
    sid = resp.json()["session_id"]
    await bob.expect_event("session.invited", session_id=sid)
    await carol.expect_event("session.invited", session_id=sid)


# ---- Join ------------------------------------------------------------------


async def test_invitee_can_join(alice, bob):
    """An invited agent can call POST /sessions/{id}/join."""
    sid = (await alice.create_session(invite=[bob.handle])).json()["session_id"]
    await bob.expect_event("session.invited", session_id=sid)
    resp = await bob.join(sid)
    assert resp.status_code == 200


async def test_join_fires_session_joined_to_existing_participants(alice, bob):
    """Joining fires session.joined to other current participants."""
    sid = (await alice.create_session(invite=[bob.handle])).json()["session_id"]
    await bob.expect_event("session.invited", session_id=sid)
    await bob.join(sid)
    event = await alice.expect_event("session.joined", session_id=sid)
    assert event["payload"]["agent"] == bob.handle


# ---- Invite to existing session -------------------------------------------


async def test_invite_to_existing_session(alice, bob, carol):
    """A joined participant can invite additional agents (POST /sessions/{id}/invite)."""
    sid = (await alice.create_session(invite=[bob.handle])).json()["session_id"]
    await bob.expect_event("session.invited", session_id=sid)
    await bob.join(sid)
    await alice.expect_event("session.joined", session_id=sid)

    resp = await alice.invite(sid, [carol.handle])
    assert resp.status_code == 200
    assert carol.handle in resp.json()["invited"]
    await carol.expect_event("session.invited", session_id=sid)


# ---- Leave -----------------------------------------------------------------


async def test_leave_fires_session_left(alice, bob):
    """Leaving fires session.left to remaining participants."""
    sid = (await alice.create_session(invite=[bob.handle])).json()["session_id"]
    await bob.expect_event("session.invited", session_id=sid)
    await bob.join(sid)
    await alice.expect_event("session.joined", session_id=sid)

    await bob.leave(sid)
    event = await alice.expect_event("session.left", session_id=sid)
    assert event["payload"]["agent"] == bob.handle


# ---- End -------------------------------------------------------------------


async def test_end_fires_session_ended(alice, bob):
    """POST /sessions/{id}/end fires session.ended to all current participants."""
    sid = (await alice.create_session(invite=[bob.handle])).json()["session_id"]
    await bob.expect_event("session.invited", session_id=sid)
    await bob.join(sid)
    await alice.expect_event("session.joined", session_id=sid)

    await alice.end(sid)
    await alice.expect_event("session.ended", session_id=sid)
    await bob.expect_event("session.ended", session_id=sid)


async def test_ended_session_rejects_new_messages(alice, bob):
    """No new messages can be sent in an ended session (Whitepaper Appendix C.2)."""
    sid = (await alice.create_session(invite=[bob.handle])).json()["session_id"]
    await bob.expect_event("session.invited", session_id=sid)
    await bob.join(sid)
    await alice.expect_event("session.joined", session_id=sid)
    await alice.end(sid)

    resp = await alice.send_message(sid, "after end")
    assert resp.status_code >= 400


# ---- Reopen (SHOULD) -------------------------------------------------------


async def test_reopen_keeps_same_session_id(alice, bob):
    """Reopening an ended session preserves the session_id (Whitepaper §6.3)."""
    sid = (await alice.create_session(invite=[bob.handle])).json()["session_id"]
    await bob.expect_event("session.invited", session_id=sid)
    await bob.join(sid)
    await alice.expect_event("session.joined", session_id=sid)
    await alice.end(sid)
    await alice.expect_event("session.ended", session_id=sid)

    resp = await alice.reopen(sid, invite=[bob.handle])
    assert resp.status_code == 200
    # GET /sessions/{id} should still return the same id, now active.
    info = (await alice.get_session(sid)).json()
    assert info["id"] == sid
    assert info["state"] == "active"


# ---- GET /sessions/{id} ---------------------------------------------------


async def test_get_session_returns_state_and_participants(alice, bob):
    """GET /sessions/{id} returns state + participant snapshots (Appendix C.1)."""
    sid = (await alice.create_session(invite=[bob.handle])).json()["session_id"]
    await bob.expect_event("session.invited", session_id=sid)
    await bob.join(sid)
    await alice.expect_event("session.joined", session_id=sid)

    resp = await alice.get_session(sid)
    assert resp.status_code == 200
    body = resp.json()
    assert body["id"] == sid
    assert body["state"] == "active"
    handles = {p["handle"] for p in body["participants"]}
    assert {alice.handle, bob.handle} <= handles


# ---- Send-and-end (SHOULD) ------------------------------------------------


async def test_send_and_end_carries_inline_initial_message(alice, bob):
    """end_after_send delivers initial_message inline on session.invited (Whitepaper §6.3, §7.2)."""
    resp = await alice.create_session(
        invite=[bob.handle],
        initial_message={"content": "ping and goodbye"},
        end_after_send=True,
    )
    sid = resp.json()["session_id"]

    invited = await bob.expect_event("session.invited", session_id=sid)
    assert "initial_message" in invited["payload"]
    await bob.expect_event("session.ended", session_id=sid)
