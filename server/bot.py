"""The voice pipeline.

caller audio -> ElevenLabs STT -> Gemini (with tools) -> ElevenLabs TTS -> caller audio

The three clinic tools are registered on the LLM service, so Gemini decides
when to call them and Pipecat runs them inside the pipeline. Every tool that
changes data also publishes an event, which is how the dashboard stays in
step with the conversation.
"""

import os

from loguru import logger
from pipecat.adapters.llm.schemas.function_schema import FunctionSchema
from pipecat.adapters.llm.schemas.tools_schema import ToolsSchema
from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.audio.vad.vad_analyzer import VADParams
from pipecat.frames.frames import EndFrame, LLMRunFrame
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineParams, PipelineTask
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import (
    LLMContextAggregatorPair,
    LLMUserAggregatorParams,
)
from pipecat.processors.frameworks.rtvi import RTVIObserver, RTVIProcessor
from pipecat.services.elevenlabs.stt import ElevenLabsRealtimeSTTService
from pipecat.services.elevenlabs.tts import ElevenLabsTTSService
from pipecat.services.google.llm import GoogleLLMService
from pipecat.services.llm_service import FunctionCallParams
from pipecat.transports.base_transport import TransportParams
from pipecat.transports.smallwebrtc.transport import SmallWebRTCTransport

import clinic
import events
from prompts import GREETING, SYSTEM_PROMPT


# ------------------------------------------------------------------- tools
# Each handler is a thin shell: validate nothing here, let clinic.py own the
# rules, then push a dashboard event if the call changed anything.

async def check_doctor_availability(params: FunctionCallParams):
    doctor = params.arguments.get("doctor")
    day = params.arguments.get("day")
    result = clinic.availability(doctor=doctor, day=day, limit=12)
    logger.info(f"check_doctor_availability(doctor={doctor!r}, day={day!r}) -> {result['count'] if result['ok'] else result['error']}")
    events.publish("tool", {"name": "check_doctor_availability",
                            "doctor": doctor, "day": day,
                            "count": result.get("count", 0)})
    await params.result_callback(result)


async def book_appointment(params: FunctionCallParams):
    a = params.arguments
    result = clinic.book(
        doctor=a.get("doctor", ""), day=a.get("day", ""), time=a.get("time", ""),
        phone=a.get("phone", ""), patient=a.get("patient_name") or "Caller",
    )
    logger.info(f"book_appointment({a}) -> {result}")
    if result["ok"]:
        events.publish("booked", result)
    else:
        events.publish("tool", {"name": "book_appointment", "error": result["error"]})
    await params.result_callback(result)


async def cancel_appointment(params: FunctionCallParams):
    phone = params.arguments.get("phone", "")
    result = clinic.cancel(phone=phone)
    logger.info(f"cancel_appointment(phone={phone!r}) -> {result}")
    if result["ok"]:
        events.publish("cancelled", result)
    else:
        events.publish("tool", {"name": "cancel_appointment", "error": result["error"]})
    await params.result_callback(result)


TOOLS = ToolsSchema(standard_tools=[
    FunctionSchema(
        name="check_doctor_availability",
        description=(
            "Look up free appointment slots. Call this before offering any time to "
            "the caller. Both arguments are optional: omit the doctor to search "
            "every doctor, omit the day to search the next week."
        ),
        properties={
            "doctor": {"type": "string", "description":
                       "Doctor name or speciality as the caller said it, e.g. 'Dr Rao', 'skin'."},
            "day": {"type": "string", "description":
                    "Day as the caller said it, e.g. 'tomorrow', 'Friday', '2026-11-27'."},
        },
        required=[],
    ),
    FunctionSchema(
        name="book_appointment",
        description=(
            "Book one slot for the caller. Only call this after the caller has "
            "chosen a slot you offered AND you have read their phone number back "
            "to them and they confirmed it."
        ),
        properties={
            "doctor": {"type": "string", "description": "Doctor for the chosen slot."},
            "day":    {"type": "string", "description": "Day of the chosen slot."},
            "time":   {"type": "string", "description": "Time of the chosen slot, e.g. '9:30 AM'."},
            "phone":  {"type": "string", "description":
                       "The caller's 10 digit phone number, digits only."},
            "patient_name": {"type": "string", "description": "Caller's name if they gave one."},
        },
        required=["doctor", "day", "time", "phone"],
    ),
    FunctionSchema(
        name="cancel_appointment",
        description=(
            "Cancel the caller's existing appointment, found by their phone number. "
            "Only call this after reading the number back and having it confirmed."
        ),
        properties={
            "phone": {"type": "string", "description":
                      "The caller's 10 digit phone number, digits only."},
        },
        required=["phone"],
    ),
])


# ---------------------------------------------------------------- pipeline

def build_services():
    """Fail loudly and early if a key is missing, rather than mid-call."""
    el_key = os.getenv("ELEVENLABS_API_KEY")
    google_key = os.getenv("GOOGLE_API_KEY")
    missing = [n for n, v in
               (("ELEVENLABS_API_KEY", el_key), ("GOOGLE_API_KEY", google_key)) if not v]
    if missing:
        raise RuntimeError(
            f"Missing {', '.join(missing)}. Copy .env.example to .env and fill it in."
        )

    stt = ElevenLabsRealtimeSTTService(api_key=el_key)
    tts = ElevenLabsTTSService(
        api_key=el_key,
        settings=ElevenLabsTTSService.Settings(
            voice=os.getenv("ELEVENLABS_VOICE_ID", "EXAVITQu4vr4xnSDxMaL"),
        ),
    )
    # The model is pinned rather than left to Pipecat's default: the newest
    # flash model returns 503 under load, which on a live call is just silence.
    llm = GoogleLLMService(
        api_key=google_key,
        settings=GoogleLLMService.Settings(
            model=os.getenv("GEMINI_MODEL", "gemini-2.5-flash"),
            system_instruction=SYSTEM_PROMPT,
        ),
        retry_on_timeout=True,
    )

    llm.register_function("check_doctor_availability", check_doctor_availability)
    llm.register_function("book_appointment", book_appointment)
    llm.register_function("cancel_appointment", cancel_appointment)
    return stt, tts, llm


async def run_bot(webrtc_connection):
    """One call. Lives for as long as the browser stays connected."""
    stt, tts, llm = build_services()

    transport = SmallWebRTCTransport(
        webrtc_connection=webrtc_connection,
        params=TransportParams(audio_in_enabled=True, audio_out_enabled=True),
    )

    context = LLMContext(messages=[{"role": "assistant", "content": GREETING}], tools=TOOLS)

    # Silero VAD belongs to the user aggregator, not the transport. It is load
    # bearing twice: it ends the caller's turn, and because the ElevenLabs
    # realtime STT commits manually, its speech-stop frame travels back up the
    # pipeline and is what finalises each transcript. Without it the caller is
    # transcribed but never answered.
    aggregators = LLMContextAggregatorPair(
        context,
        user_params=LLMUserAggregatorParams(
            # stop_secs defaults to 0.2, which cuts a caller off between
            # groups of digits when they read a phone number out. 0.7 holds
            # the turn open across a natural pause.
            vad_analyzer=SileroVADAnalyzer(params=VADParams(stop_secs=0.7)),
        ),
    )
    rtvi = RTVIProcessor()

    pipeline = Pipeline([
        transport.input(),
        rtvi,                      # mirrors events to the browser client
        stt,
        aggregators.user(),        # caller's words into the context
        llm,                       # decides to speak or to call a tool
        tts,
        transport.output(),
        aggregators.assistant(),   # agent's words back into the context
    ])

    task = PipelineTask(
        pipeline,
        params=PipelineParams(enable_metrics=True, enable_usage_metrics=True),
        observers=[RTVIObserver(rtvi)],
        idle_timeout_secs=180,
    )

    @transport.event_handler("on_client_connected")
    async def on_connected(_transport, _client):
        logger.info("caller connected")
        events.publish("call", {"state": "connected"})
        # Speak the fixed greeting instead of generating it: the caller hears
        # a voice immediately rather than waiting on a first LLM round trip.
        from pipecat.frames.frames import TTSSpeakFrame
        await task.queue_frames([TTSSpeakFrame(GREETING)])

    @transport.event_handler("on_client_disconnected")
    async def on_disconnected(_transport, _client):
        # The "ended" event is published by the connection's own close handler
        # in server.py, which also fires when the pipeline never started. One
        # publisher, so the dashboard log does not show the hangup twice.
        logger.info("caller disconnected")
        await task.cancel()

    await PipelineRunner(handle_sigint=False).run(task)
