"""Transport, eligibility, and replay conformance tests.

Covers Appendix A MUSTs #4 (live events via WS), #7 (event history with
participant-status filtering), and the SHOULD for reconnect-with-replay.
"""

from __future__ import annotations

import asyncio

import pytest

from asp_client import Agent


async def _join_session(alice, bob) -> str:
    sid = (await alice.create_session(invite=[bob.handle])).json()["session_id"]
    await bob.expect_event("session.invited", session_id=sid)
    await bob.join(sid)
    await alice.expect_event("session.joined", session_id=sid)
    return sid


# ---- Live delivery --------------------------------------------------------


async def test_invitee_does_not_receive_messages(alice, bob):
    """An invited (not joined) participant does not see session.message events
    (Whitepaper §6.3 message delivery rule)."""
    sid = (await alice.create_session(invite=[bob.handle])).json()["session_id"]
    await bob.expect_event("session.invited", session_id=sid)
    # alice is the only joined participant. She sends; bob should not see it.
    await alice.send_message(sid, "should not reach bob")

    await bob.assert_no_event(
        lambda e: e.get("type") == "session.message" and e.get("session_id") == sid,
        within=0.5,
    )


async def test_left_participant_receives_no_further_messages(alice, bob):
    """A left participant receives no content events past their session.left.

    Lifecycle events that may already be queued (e.g. the joiner's own
    session.joined broadcast, the leaver's own session.left) are
    implementation-dependent and not asserted here — the meaningful spec
    contract is that no session.message arrives after leave.
    """
    sid = await _join_session(alice, bob)
    await bob.leave(sid)
    await alice.expect_event("session.left", session_id=sid)

    # alice sends a fresh message after bob's leave is acknowledged.
    # bob, no longer joined, must not receive it.
    await alice.send_message(sid, "post-leave message")
    await bob.assert_no_event(
        lambda e: (
            e.get("type") == "session.message" and e.get("session_id") == sid
        ),
        within=0.5,
    )


# ---- Event history (GET /sessions/{id}/events) ----------------------------


async def test_get_events_returns_messages_for_joined_participant(alice, bob):
    """A joined participant can fetch the full event log."""
    sid = await _join_session(alice, bob)
    await alice.send_message(sid, "msg one")
    await alice.send_message(sid, "msg two")
    await bob.expect_event("session.message", session_id=sid)
    await bob.expect_event("session.message", session_id=sid)

    resp = await bob.get_events(sid)
    assert resp.status_code == 200
    events = resp.json()["events"]
    msg_events = [e for e in events if e["type"] == "session.message"]
    assert len(msg_events) >= 2


async def test_get_events_filters_for_invited_only_participant(
    alice, bob, carol
):
    """An invited-but-never-joined participant sees only session.invited (and
    session.ended if applicable). No content events (Whitepaper §6.4)."""
    sid = (await alice.create_session(invite=[bob.handle, carol.handle])).json()[
        "session_id"
    ]
    await bob.expect_event("session.invited", session_id=sid)
    await carol.expect_event("session.invited", session_id=sid)

    await bob.join(sid)
    await alice.send_message(sid, "secret content")

    # carol never joined. Her event-history view excludes the message.
    resp = await carol.get_events(sid)
    assert resp.status_code == 200
    types = [e["type"] for e in resp.json()["events"]]
    assert "session.message" not in types
    assert "session.invited" in types


async def test_get_events_supports_after_sequence(alice, bob):
    """after_sequence returns events strictly past the given sequence."""
    sid = await _join_session(alice, bob)
    seqs = []
    for i in range(3):
        seqs.append((await alice.send_message(sid, f"m{i}")).json()["sequence"])
    for _ in range(3):
        await bob.expect_event("session.message", session_id=sid)

    resp = await bob.get_events(sid, after_sequence=seqs[0])
    assert resp.status_code == 200
    received = [e["sequence"] for e in resp.json()["events"]]
    assert all(s > seqs[0] for s in received)


# ---- Reconnect with replay (SHOULD) ---------------------------------------


async def test_reconnect_replays_missed_events(operator_url, agent_tokens, alice):
    """When an agent reconnects, missed events are replayed in order before
    live delivery resumes (Appendix A SHOULD: reconnection within grace)."""
    # Create bob, join a session, then disconnect and let alice send while bob
    # is offline. On reconnect, bob should receive the missed messages.
    async with Agent(
        "@bob.test", agent_tokens["@bob.test"], operator_url
    ) as bob:
        await bob.connect()

        sid = (await alice.create_session(invite=[bob.handle])).json()[
            "session_id"
        ]
        await bob.expect_event("session.invited", session_id=sid)
        await bob.join(sid)
        await alice.expect_event("session.joined", session_id=sid)

        # bob disconnects (transport drop, within grace).
        await bob.disconnect()

        # alice sends while bob is offline.
        sent = []
        for i in range(3):
            sent.append(
                (await alice.send_message(sid, f"missed {i}")).json()["sequence"]
            )

        # bob reconnects — events should be replayed in order.
        await bob.connect()
        replayed = []
        for _ in range(3):
            event = await bob.expect_event(
                "session.message", session_id=sid, timeout=5.0
            )
            replayed.append(event["payload"]["sequence"])

        assert replayed == sent
