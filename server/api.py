"""Read-only REST + SSE that the dashboard runs on.

Kept separate from the WebRTC/voice wiring so the dashboard can be developed
and demoed without a live call in progress.
"""

import asyncio

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

import clinic
import events

router = APIRouter(prefix="/api")


@router.get("/doctors")
async def doctors():
    return {"doctors": clinic.list_doctors()}


@router.get("/slots")
async def slots(doctor: str | None = None, day: str | None = None):
    return clinic.availability(doctor=doctor, day=day, limit=200)


@router.get("/appointments")
async def appointments():
    return {"appointments": clinic.list_appointments()}


@router.get("/state")
async def state():
    """One call for the dashboard's initial paint."""
    return {
        "doctors": clinic.list_doctors(),
        "appointments": clinic.list_appointments(),
        "slots": clinic.availability(limit=200)["slots"],
    }


@router.post("/reset")
async def reset():
    """Wipe back to seed data, for a clean demo recording."""
    clinic.init_db(reset=True)
    events.publish("refresh")
    return {"ok": True}


@router.get("/events")
async def stream(request: Request):
    """SSE feed: the dashboard re-reads state whenever a tool changes it."""
    queue = events.subscribe()

    async def gen():
        try:
            yield "retry: 2000\n\n"
            while True:
                if await request.is_disconnected():
                    break
                try:
                    msg = await asyncio.wait_for(queue.get(), timeout=15.0)
                    yield f"data: {msg}\n\n"
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"   # keeps proxies from closing it
        finally:
            events.unsubscribe(queue)

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache",
                                      "X-Accel-Buffering": "no"})
