"""FastAPI entry point.

Serves three things: the WebRTC signalling endpoint that starts a call, the
read-only dashboard API, and (in production) the built frontend.
"""

import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
from fastapi import BackgroundTasks, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from loguru import logger

sys.path.insert(0, str(Path(__file__).parent))
# override=True: a stale GOOGLE_API_KEY exported in a shell profile would
# otherwise shadow the real one and the call would fail only once the LLM
# was reached, mid conversation. The .env next to the code wins.
load_dotenv(Path(__file__).parent.parent / ".env", override=True)

import clinic              # noqa: E402
import events              # noqa: E402
from api import router     # noqa: E402

from pipecat.transports.smallwebrtc.connection import IceServer, SmallWebRTCConnection  # noqa: E402

# One live connection per browser tab, keyed by peer-connection id so a
# renegotiation reuses its existing call instead of starting a second one.
connections: dict[str, SmallWebRTCConnection] = {}

ICE = [IceServer(urls="stun:stun.l.google.com:19302")]


@asynccontextmanager
async def lifespan(app: FastAPI):
    clinic.init_db()
    logger.info("clinic database ready")
    yield
    for conn in list(connections.values()):
        await conn.disconnect()
    connections.clear()


app = FastAPI(title="Lakeview Clinic Voice Agent", lifespan=lifespan)

# The Vite dev server runs on a different port during development.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True, allow_methods=["*"], allow_headers=["*"],
)

app.include_router(router)


@app.post("/api/offer")
async def offer(request: dict, background_tasks: BackgroundTasks):
    """WebRTC signalling. The browser POSTs an SDP offer, we answer and, for a
    new connection, start the voice pipeline in the background."""
    from bot import run_bot

    pc_id = request.get("pc_id")
    if pc_id and pc_id in connections:
        conn = connections[pc_id]
        logger.info(f"renegotiating {pc_id}")
        await conn.renegotiate(sdp=request["sdp"], type=request["type"])
    else:
        conn = SmallWebRTCConnection(ICE)
        await conn.initialize(sdp=request["sdp"], type=request["type"])

        @conn.event_handler("closed")
        async def on_closed(c: SmallWebRTCConnection):
            logger.info(f"connection {c.pc_id} closed")
            connections.pop(c.pc_id, None)
            events.publish("call", {"state": "ended"})

        background_tasks.add_task(run_bot, conn)

    answer = conn.get_answer()
    connections[answer["pc_id"]] = conn
    return answer


# Serve the built dashboard if it exists, so one process runs the whole demo.
DIST = Path(__file__).parent.parent / "web" / "dist"
if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/{full_path:path}")
    async def spa(full_path: str):
        candidate = DIST / full_path
        if full_path and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(DIST / "index.html")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app", host=os.getenv("HOST", "0.0.0.0"),
                port=int(os.getenv("PORT", 7860)), reload=False)
