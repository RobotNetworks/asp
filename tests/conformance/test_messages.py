"""Message conformance tests.

Covers Appendix A MUST #5: send and receive session.message events with
monotonic per-session sequence numbers and idempotency keys.
"""

from __future__ import annotations

import pytest

from conftest import fresh_idempotency_key


async def _join_session(alice, bob) -> str:
    sid = (await alice.create_session(invite=[bob.handle])).json()["session_id"]
    await bob.expect_event("session.invited", session_id=sid)
    await bob.join(sid)
    await alice.expect_event("session.joined", session_id=sid)
    return sid


async def test_send_message_returns_message_id_and_sequence(alice, bob):
    sid = await _join_session(alice, bob)
    resp = await alice.send_message(sid, "hello")
    assert resp.status_code == 201
    body = resp.json()
    assert body["message_id"].startswith("msg_")
    assert isinstance(body["sequence"], int)


async def test_joined_participant_receives_message(alice, bob):
    sid = await _join_session(alice, bob)
    await alice.send_message(sid, "hello bob")
    event = await bob.expect_event("session.message", session_id=sid)
    payload = event["payload"]
    assert payload["sender"] == alice.handle
    # content may be a string or a list of parts; both are valid (Whitepaper §6.3).
    assert payload["content"] is not None


async def test_sequence_is_monotonic_per_session(alice, bob):
    """Sequence numbers within a session are strictly ordered (Appendix A #5)."""
    sid = await _join_session(alice, bob)

    seqs = []
    for i in range(5):
        resp = await alice.send_message(sid, f"msg {i}")
        seqs.append(resp.json()["sequence"])

    assert seqs == sorted(seqs), f"sequence not monotonic: {seqs}"
    assert len(set(seqs)) == len(seqs), f"sequence has duplicates: {seqs}"


async def test_received_messages_arrive_in_sequence_order(alice, bob):
    sid = await _join_session(alice, bob)

    sent_seqs = []
    for i in range(5):
        resp = await alice.send_message(sid, f"msg {i}")
        sent_seqs.append(resp.json()["sequence"])

    received = []
    for _ in range(5):
        event = await bob.expect_event("session.message", session_id=sid)
        received.append(event["payload"]["sequence"])

    assert received == sent_seqs


async def test_idempotency_key_dedupes_retries(alice, bob):
    """Two sends with the same idempotency_key produce one message."""
    sid = await _join_session(alice, bob)
    key = fresh_idempotency_key()

    r1 = await alice.send_message(sid, "duplicate", idempotency_key=key)
    r2 = await alice.send_message(sid, "duplicate", idempotency_key=key)

    # Both calls return 201 (idempotent replay returns the original 201, not 200) —
    # spec accepts either, but the local operator currently returns 201 on both.
    assert r1.status_code == 201
    assert r2.status_code == 201
    assert r1.json()["message_id"] == r2.json()["message_id"]
    assert r1.json()["sequence"] == r2.json()["sequence"]


async def test_multipart_content_is_supported(alice, bob):
    """Messages may carry text + file + data parts (Whitepaper §6.3)."""
    sid = await _join_session(alice, bob)
    parts = [
        {"type": "text", "text": "see attached"},
        {
            "type": "file",
            "url": "https://example.com/r.pdf",
            "name": "r.pdf",
            "mime_type": "application/pdf",
        },
        {"type": "data", "data": {"action": "review_complete", "doc_id": "abc"}},
    ]
    resp = await alice.send_message(sid, parts)
    assert resp.status_code == 201

    event = await bob.expect_event("session.message", session_id=sid)
    received = event["payload"]["content"]
    assert isinstance(received, list)
    assert {p["type"] for p in received} == {"text", "file", "data"}


@pytest.mark.parametrize(
    "empty_content",
    [
        pytest.param("", id="empty-string"),
        pytest.param([], id="empty-array"),
        pytest.param([{"type": "text", "text": ""}], id="empty-text-part"),
    ],
)
async def test_empty_content_is_rejected(alice, bob, empty_content):
    """Operators MUST reject empty message payloads (Content schema:
    string `minLength: 1`, array `minItems: 1`, TextPart.text
    `minLength: 1`). An empty payload carries no information and would
    create a meaningless `session.message` event.
    """
    sid = await _join_session(alice, bob)
    resp = await alice.send_message(sid, empty_content)
    assert 400 <= resp.status_code < 500, (
        f"expected 4xx for empty content {empty_content!r}, got {resp.status_code}"
    )


async def test_event_validates_against_schema(alice, bob, event_validator):
    """Wire events conform to schemas/events.json (Appendix A #9)."""
    sid = await _join_session(alice, bob)
    await alice.send_message(sid, "schema check")
    event = await bob.expect_event("session.message", session_id=sid)

    errors = list(event_validator.iter_errors(event))
    assert not errors, "\n".join(e.message for e in errors)
