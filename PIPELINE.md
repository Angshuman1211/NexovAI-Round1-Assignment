# Pipeline description

The browser sends audio over WebRTC into Pipecat.

```
transport.in → ElevenLabs STT → Gemini → ElevenLabs TTS → transport.out
```

Silero VAD sits on the user aggregator, not the transport. It ends the caller's
turn, and because the ElevenLabs realtime STT commits manually, its speech-stop
frame is also what finalises each transcript. With it wired wrong the caller was
transcribed but never answered, which is how I found it. I widened stop_secs
from 0.2 to 0.7 so reading out a phone number does not end the turn mid digits.

The three tools are Gemini function calls. The model chooses when to call them,
never the outcome. Whether a slot is free or already past is settled in
`clinic.py` against SQLite, and the tool returns a plain reason the agent reads
out, so it cannot invent a confirmation.

The caller is identified only by the number they speak. I normalise it to ten
digits and the agent reads it back before booking or cancelling. Every tool that
writes also publishes a server-sent event, so the dashboard moves with the call
instead of polling.

I used Gemini for the free quota.
