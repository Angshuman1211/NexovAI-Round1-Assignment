"""Tiny pub/sub so a tool call in the voice pipeline can push a change to
every open dashboard. Server-sent events, because the dashboard only listens.
"""

import asyncio
import json
from typing import Any

_subscribers: set[asyncio.Queue] = set()


def subscribe() -> asyncio.Queue:
    q: asyncio.Queue = asyncio.Queue(maxsize=50)
    _subscribers.add(q)
    return q


def unsubscribe(q: asyncio.Queue) -> None:
    _subscribers.discard(q)


def publish(kind: str, payload: Any = None) -> None:
    """Fire-and-forget. A slow dashboard must never stall the voice pipeline,
    so a full queue drops the event rather than awaiting space."""
    msg = json.dumps({"type": kind, "data": payload})
    for q in list(_subscribers):
        try:
            q.put_nowait(msg)
        except asyncio.QueueFull:
            pass
