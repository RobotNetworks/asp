"""ASP test client.

A minimal async client for driving a conforming ASP operator. Wraps the REST
surface in Whitepaper Appendix C.1 and the WS event stream from /connect.

Authentication convention for the conformance suite: each agent presents
`Authorization: Bearer <token>` and `X-ASP-Agent: <handle>`. Operators that
authenticate differently can wrap or subclass this client; the protocol does
not mandate a mechanism (Whitepaper §10).
"""

from __future__ import annotations

import asyncio
import contextlib
import json
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Awaitable, Callable

import httpx
import websockets


@dataclass
class Agent:
    """A test client for one ASP agent identity.

    Use as an async context manager. Inside the block, the agent has an open
    HTTP client and (after `connect()`) a live WebSocket consuming events.
    """

    handle: str
    token: str
    base_url: str

    _http: httpx.AsyncClient | None = None
    _ws: Any = None
    _ws_task: asyncio.Task | None = None
    _events: asyncio.Queue = field(default_factory=asyncio.Queue)

    @property
    def headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.token}",
            "X-ASP-Agent": self.handle,
        }

    async def __aenter__(self) -> "Agent":
        self._http = httpx.AsyncClient(
            base_url=self.base_url,
            headers=self.headers,
            timeout=10.0,
        )
        return self

    async def __aexit__(self, *exc: object) -> None:
        await self.disconnect()
        if self._http is not None:
            await self._http.aclose()
            self._http = None

    # ---- WebSocket transport -------------------------------------------------

    async def connect(self) -> None:
        """Open the WS event stream for this agent."""
        ws_url = self.base_url.replace("http", "ws", 1) + "/connect"
        self._ws = await websockets.connect(
            ws_url,
            additional_headers=self.headers,
            close_timeout=1,
        )
        self._ws_task = asyncio.create_task(self._reader())

    async def disconnect(self) -> None:
        if self._ws_task is not None:
            self._ws_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._ws_task
            self._ws_task = None
        if self._ws is not None:
            await self._ws.close()
            self._ws = None

    async def _reader(self) -> None:
        assert self._ws is not None
        async for raw in self._ws:
            event = json.loads(raw)
            await self._events.put(event)

    async def next_event(
        self,
        predicate: Callable[[dict], bool] | None = None,
        *,
        timeout: float = 2.0,
    ) -> dict:
        """Wait for the next event, optionally matching a predicate.

        Non-matching events are dropped from the queue. Raises asyncio.TimeoutError
        if no matching event arrives within `timeout`.
        """
        deadline = asyncio.get_event_loop().time() + timeout
        while True:
            remaining = deadline - asyncio.get_event_loop().time()
            if remaining <= 0:
                raise asyncio.TimeoutError(f"no matching event within {timeout}s")
            event = await asyncio.wait_for(self._events.get(), timeout=remaining)
            if predicate is None or predicate(event):
                return event

    async def expect_event(
        self,
        type: str,
        *,
        session_id: str | None = None,
        timeout: float = 2.0,
        **payload_match: Any,
    ) -> dict:
        """Convenience: wait for an event of `type`, optionally matched by session_id and payload fields."""

        def matches(event: dict) -> bool:
            if event.get("type") != type:
                return False
            if session_id is not None and event.get("session_id") != session_id:
                return False
            payload = event.get("payload", {})
            for k, v in payload_match.items():
                if payload.get(k) != v:
                    return False
            return True

        return await self.next_event(matches, timeout=timeout)

    async def assert_no_event(
        self,
        predicate: Callable[[dict], bool],
        *,
        within: float = 0.5,
    ) -> None:
        """Assert that no event matching `predicate` arrives within `within` seconds."""
        try:
            event = await self.next_event(predicate, timeout=within)
        except asyncio.TimeoutError:
            return
        raise AssertionError(f"unexpected event arrived: {event}")

    # ---- REST surface --------------------------------------------------------

    async def _request(self, method: str, path: str, **kwargs: Any) -> httpx.Response:
        assert self._http is not None
        return await self._http.request(method, path, **kwargs)

    async def create_session(
        self,
        invite: list[str] | None = None,
        *,
        topic: str | None = None,
        initial_message: dict | None = None,
        end_after_send: bool = False,
        idempotency_key: str | None = None,
    ) -> httpx.Response:
        body: dict[str, Any] = {}
        if invite is not None:
            body["invite"] = invite
        if topic is not None:
            body["topic"] = topic
        if initial_message is not None:
            body["initial_message"] = initial_message
        if end_after_send:
            body["end_after_send"] = True
        if idempotency_key is not None:
            body["idempotency_key"] = idempotency_key
        return await self._request("POST", "/sessions", json=body)

    async def join(self, session_id: str) -> httpx.Response:
        return await self._request("POST", f"/sessions/{session_id}/join")

    async def invite(self, session_id: str, invite: list[str]) -> httpx.Response:
        return await self._request(
            "POST", f"/sessions/{session_id}/invite", json={"invite": invite}
        )

    async def send_message(
        self,
        session_id: str,
        content: Any,
        *,
        idempotency_key: str | None = None,
        metadata: dict | None = None,
    ) -> httpx.Response:
        body: dict[str, Any] = {"content": content}
        if idempotency_key is not None:
            body["idempotency_key"] = idempotency_key
        if metadata is not None:
            body["metadata"] = metadata
        return await self._request(
            "POST", f"/sessions/{session_id}/messages", json=body
        )

    async def leave(self, session_id: str) -> httpx.Response:
        return await self._request("POST", f"/sessions/{session_id}/leave")

    async def end(self, session_id: str) -> httpx.Response:
        return await self._request("POST", f"/sessions/{session_id}/end")

    async def reopen(
        self,
        session_id: str,
        *,
        invite: list[str] | None = None,
        initial_message: dict | None = None,
    ) -> httpx.Response:
        body: dict[str, Any] = {}
        if invite is not None:
            body["invite"] = invite
        if initial_message is not None:
            body["initial_message"] = initial_message
        return await self._request("POST", f"/sessions/{session_id}/reopen", json=body)

    async def get_session(self, session_id: str) -> httpx.Response:
        return await self._request("GET", f"/sessions/{session_id}")

    async def get_events(
        self,
        session_id: str,
        *,
        after_sequence: int | None = None,
        limit: int | None = None,
    ) -> httpx.Response:
        params: dict[str, Any] = {}
        if after_sequence is not None:
            params["after_sequence"] = after_sequence
        if limit is not None:
            params["limit"] = limit
        return await self._request(
            "GET", f"/sessions/{session_id}/events", params=params
        )

