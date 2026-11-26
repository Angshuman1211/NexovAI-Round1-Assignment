# Lakeview Clinic voice appointment agent

A voice agent that books and cancels doctor appointments over a live call, with
a dashboard that updates as the conversation happens. Built with Pipecat,
ElevenLabs for speech in and out, and Google Gemini for the reasoning and tool
calls.

The caller is identified only by the phone number they say out loud. There is no
login, no OTP and no caller ID.

---

## What it does

| | |
|---|---|
| **Voice pipeline** | `caller audio → ElevenLabs STT → Gemini → ElevenLabs TTS → caller audio`, over WebRTC straight to the browser |
| **Tools** | `check_doctor_availability`, `book_appointment`, `cancel_appointment`, registered as Gemini function calls inside the pipeline |
| **Dashboard** | Doctors on duty, open slots as a week board, the appointment book, and a running log of every tool the agent calls |
| **Call screen** | Phone style overlay with ringing and end call tones, a live waveform, call timer, mute, and the transcript inside the phone |
| **Live updates** | A tool call pushes a server sent event, so the appointment list moves in step with the call rather than on a poll |

---

## Running it

### 1. Keys

```bash
cp .env.example .env
```

Fill in two keys.

`ELEVENLABS_API_KEY` from https://elevenlabs.io/app/settings/api-keys. The free
tier is enough and covers both Scribe speech to text and text to speech.

`GOOGLE_API_KEY` from https://aistudio.google.com/apikey. Gemini has a free
quota.

Two optional values are already filled in. `ELEVENLABS_VOICE_ID` defaults to
Sarah, which must stay a *premade* voice because the free plan rejects Voice
Library voices through the API with HTTP 402. `GEMINI_MODEL` pins the model, see
below.

> The project's `.env` wins over your shell environment. A stale
> `GOOGLE_API_KEY` exported in a shell profile would otherwise shadow the real
> one, and the call would only fail once it reached the LLM, mid conversation.

### 2. Backend

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r server/requirements.txt
cd server && python server.py
```

Runs on **http://localhost:7860**. The SQLite database seeds itself on first
start with four doctors and a week of slots.

### 3. Frontend

In a second terminal:

```bash
cd web
npm install
npm run dev
```

Open **http://localhost:5173** and click **Try call**. Allow the microphone when
the browser asks, or the call cannot start.

> To serve everything from one port instead, run `npm run build` in `web/` and
> restart the backend. FastAPI picks up `web/dist` automatically and the whole
> app is then on http://localhost:7860.

---

## Which LLM

**Google Gemini `gemini-2.5-flash`**, through Pipecat's `GoogleLLMService`.
Chosen for the free quota and because its function calling is reliable enough to
drive three tools in one conversation.

The model is pinned rather than left to Pipecat's default, which tracks the
newest flash release and returned HTTP 503 under load while I was testing. On a
live call a 503 is just silence, so the stable model is worth the slightly
higher latency. Override it with `GEMINI_MODEL` in `.env`.

---

## How the pieces fit

```
server/
  server.py    FastAPI. WebRTC signalling at /api/offer, dashboard API, serves the build
  bot.py       The Pipecat pipeline and the three tool handlers
  clinic.py    Doctors, slots and appointments in SQLite. All booking rules live here
  prompts.py   The agent's instructions, written for speech rather than for a screen
  api.py       Read only REST plus the SSE stream the dashboard listens on
  events.py    Tiny pub/sub so a tool call reaches every open dashboard

web/src/
  App.tsx                    Dashboard shell, SSE subscription, activity log, row highlighting
  lib/useVoiceCall.ts        Owns the Pipecat client. Call state, transcript, audio levels
  lib/sounds.ts              Ring and end call tones, synthesised instead of shipped as files
  lib/fmt.ts                 Display formatting for times, days and phone numbers
  components/PhoneCall.tsx   The call screen
  components/Availability.tsx  Open slots laid out as a week, one column per day
  components/Ledger.tsx      The appointment book
  components/Roster.tsx      Doctors on duty, click one to filter availability
  components/Activity.tsx    Running log of what the agent just did
  components/Waveform.tsx    Canvas waveform driven by the live audio
```

### Choices worth explaining

**`SmallWebRTCTransport`, not Daily.** The browser talks WebRTC directly to the
Python server. Most Pipecat examples use Daily, which would mean a third API key
to provision before anything runs. This way the only accounts needed are
ElevenLabs and Gemini.

**Silero VAD is load-bearing, and it lives on the user aggregator.** Not on the
transport, which is where Pipecat used to take it. `ElevenLabsRealtimeSTTService`
defaults to a manual commit strategy, so Pipecat's own VAD decides when a speech
segment ends and gets transcribed. Wire the VAD wrong and the caller is
transcribed but never answered. `stop_secs` is widened from the 0.2 default to
0.7, because 0.2 ends the turn between groups of digits when someone reads out a
phone number.

**All booking rules sit in `clinic.py`, not in the prompt.** The model decides
*when* to call a tool. It never decides whether a slot is free, whether a time
has already passed, or whether a number already has a booking that day. Those
return plain error strings the agent reads out, so a confused model cannot
invent a confirmation.

**Phone numbers are normalised, not trusted.** `+91 98765 43210`, `098765 43210`
and `9876543210` are one patient, because a caller will not say it the same way
twice.

**Transcript comes from the client, bookings from the server.** The transcript is
lowest latency where Pipecat already emits it in the browser. A booking has to be
server pushed, since the dashboard must react the moment the tool runs.

**The dashboard checks the server before it dials.** An unreachable server and a
bad API key look identical otherwise, because `connect()` hangs rather than
throwing, and the watchdog reports the wrong cause.

---

## Notes

- `server/clinic.db` is gitignored and rebuilt on first run. **Reset** on the
  dashboard restores the seed, which is useful before recording a demo.
- No API keys are committed. `.env` is gitignored, `.env.example` lists what is
  needed.
