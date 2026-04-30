"""Contact-request handshake conformance tests.

Covers the SHOULD for "Initiate and respond to the contact-request handshake"
(Whitepaper Appendix A) and the contact.* event vocabulary (Appendix C.1).
"""

from __future__ import annotations

import pytest


async def test_contact_request_creates_request_and_fires_event(alice, bob):
    """POST /contacts returns a request_id and fires contact.requested to the recipient."""
    resp = await alice.request_contact(bob.handle, message="hello bob")
    assert resp.status_code == 200
    request_id = resp.json()["request_id"]
    assert request_id.startswith("req_")

    event = await bob.expect_event("contact.requested")
    assert event["request_id"] == request_id
    assert event["payload"]["from"] == alice.handle
    assert event["payload"]["to"] == bob.handle


async def test_contact_accept_notifies_requester(alice, bob):
    """Accepting a contact request fires contact.accepted to the requester."""
    request_id = (await alice.request_contact(bob.handle)).json()["request_id"]
    await bob.expect_event("contact.requested")

    resp = await bob.accept_contact(request_id)
    assert resp.status_code == 200

    event = await alice.expect_event("contact.accepted")
    assert event["request_id"] == request_id
    assert event["payload"]["by"] == bob.handle


async def test_contact_decline_does_not_error(alice, bob):
    """Decline returns ok; notification to requester is optional per spec."""
    request_id = (await alice.request_contact(bob.handle)).json()["request_id"]
    await bob.expect_event("contact.requested")

    resp = await bob.decline_contact(request_id)
    assert resp.status_code == 200
