import { useCallback, useEffect, useRef, useState } from "react";
import { PipecatClient } from "@pipecat-ai/client-js";
import { SmallWebRTCTransport } from "@pipecat-ai/small-webrtc-transport";
import { fetchState } from "./api";
import { playEndTone, startRinging } from "./sounds";

export type CallState = "idle" | "connecting" | "ringing" | "connected" | "ending" | "ended";

export type Turn = {
  id: string;
  who: "caller" | "agent";
  text: string;
  done: boolean;
};

/** Owns the Pipecat client for one call: state machine, transcript and the
 *  audio levels the waveform draws from. */
export function useVoiceCall() {
  const [state, setState] = useState<CallState>("idle");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [muted, setMuted] = useState(false);
  const [agentSpeaking, setAgentSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clientRef = useRef<PipecatClient | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const levelRef = useRef(0);                 // 0..1, read by the waveform
  const analysers = useRef<{ ctx?: AudioContext; nodes: AnalyserNode[] }>({ nodes: [] });
  const rafRef = useRef<number | null>(null);
  const watchdog = useRef<number | null>(null);
  const stopRing = useRef<(() => void) | null>(null);

  const silenceRing = useCallback(() => {
    stopRing.current?.();
    stopRing.current = null;
  }, []);

  // Append a streaming chunk to the open turn, or start a new one.
  const pushChunk = useCallback((who: Turn["who"], text: string, final: boolean) => {
    if (!text) return;
    setTurns((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.who === who && !last.done) {
        const merged = [...prev];
        merged[merged.length - 1] = {
          ...last,
          text: who === "agent" ? last.text + text : text,
          done: final,
        };
        return merged;
      }
      return [...prev, { id: `${who}-${Date.now()}-${prev.length}`, who, text, done: final }];
    });
  }, []);

  const closeTurn = useCallback((who: Turn["who"]) => {
    setTurns((prev) => {
      const last = prev[prev.length - 1];
      if (!last || last.who !== who || last.done) return prev;
      const merged = [...prev];
      merged[merged.length - 1] = { ...last, done: true };
      return merged;
    });
  }, []);

  /** Feed a track into an analyser so the waveform has something to draw. */
  const attachAnalyser = useCallback((track: MediaStreamTrack) => {
    try {
      const store = analysers.current;
      if (!store.ctx) store.ctx = new AudioContext();
      const src = store.ctx.createMediaStreamSource(new MediaStream([track]));
      const node = store.ctx.createAnalyser();
      node.fftSize = 512;
      node.smoothingTimeConstant = 0.75;
      src.connect(node);
      store.nodes.push(node);
    } catch (e) {
      console.warn("analyser attach failed", e);
    }
  }, []);

  // Single rAF loop samples every analyser and keeps one shared level value,
  // so adding tracks never multiplies the work per frame.
  useEffect(() => {
    const buf = new Uint8Array(256);
    const tick = () => {
      let peak = 0;
      for (const node of analysers.current.nodes) {
        node.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128;
          sum += v * v;
        }
        peak = Math.max(peak, Math.sqrt(sum / buf.length));
      }
      levelRef.current = Math.min(1, peak * 3.2);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, []);

  const start = useCallback(async () => {
    if (clientRef.current) return;
    setError(null);
    setTurns([]);
    setState("connecting");

    // Check the server answers before dialling. Without this, an unreachable
    // server looks identical to a bad API key: connect() hangs rather than
    // throwing, and the watchdog below reports the wrong cause.
    try {
      await fetchState();
    } catch {
      setError("Cannot reach the voice server. Start it with uvicorn on port 7860, then call again.");
      setState("ended");
      return;
    }

    const transport = new SmallWebRTCTransport({
      webrtcRequestParams: { endpoint: "/api/offer" },
    });
    const client = new PipecatClient({
      transport,
      enableMic: true,
      enableCam: false,
      callbacks: {
        onBotReady: () => {
          if (watchdog.current) window.clearTimeout(watchdog.current);
          silenceRing();
          setState("connected");
        },
        onUserTranscript: (d: any) => pushChunk("caller", d?.text ?? "", d?.final ?? false),
        onBotTranscript: (d: any) => pushChunk("agent", d?.text ?? "", false),
        onBotStartedSpeaking: () => setAgentSpeaking(true),
        onBotStoppedSpeaking: () => { setAgentSpeaking(false); closeTurn("agent"); },
        onUserStoppedSpeaking: () => closeTurn("caller"),
        onTrackStarted: (track: MediaStreamTrack, participant?: any) => {
          if (track.kind !== "audio") return;
          attachAnalyser(track);
          // The bot's audio has to be attached to an element to be heard.
          if (!participant?.local && audioElRef.current) {
            audioElRef.current.srcObject = new MediaStream([track]);
            audioElRef.current.play().catch(() => {});
          }
        },
        onDisconnected: () => { silenceRing(); setState("ended"); },
        onError: (e: any) => setError(typeof e === "string" ? e : e?.message ?? "Call failed"),
      },
    });

    clientRef.current = client;

    // Without this, a missing API key or a blocked microphone leaves the
    // phone ringing with no explanation.
    if (watchdog.current) window.clearTimeout(watchdog.current);
    watchdog.current = window.setTimeout(() => {
      setState((s) => {
        if (s === "connected") return s;
        silenceRing();
        setError(
          "The server answered but the agent never picked up. Check " +
          "ELEVENLABS_API_KEY and GOOGLE_API_KEY in .env, then call again."
        );
        return "ended";
      });
    }, 20000);

    try {
      setState("ringing");
      stopRing.current = startRinging();
      // Ask for the microphone explicitly so a denied prompt reports itself
      // instead of stalling inside connect().
      await client.initDevices();
      await client.connect();
    } catch (e: any) {
      console.error(e);
      silenceRing();
      const msg = String(e?.message ?? e);
      const denied = /permission|denied|NotAllowed|device/i.test(msg);
      setError(denied
        ? "Microphone access is blocked. Allow the mic for this site, then call again."
        : "Could not reach the voice agent. Is the server running on port 7860?");
      setState("ended");
      clientRef.current = null;
    }
  }, [pushChunk, closeTurn, attachAnalyser, silenceRing]);

  const stop = useCallback(async () => {
    const client = clientRef.current;
    if (!client) { setState("idle"); return; }
    silenceRing();
    playEndTone();
    setState("ending");
    if (watchdog.current) window.clearTimeout(watchdog.current);
    try { await client.disconnect(); } catch { /* already gone */ }
    clientRef.current = null;
    analysers.current.nodes = [];
    setState("ended");
  }, [silenceRing]);

  const reset = useCallback(() => { setState("idle"); setTurns([]); setMuted(false); }, []);

  const toggleMute = useCallback(() => {
    const client = clientRef.current;
    if (!client) return;
    setMuted((m) => { client.enableMic(m); return !m; });
  }, []);

  useEffect(() => () => {
    stopRing.current?.();
    clientRef.current?.disconnect().catch(() => {});
  }, []);

  return { state, turns, muted, agentSpeaking, error,
           levelRef, audioElRef, start, stop, reset, toggleMute };
}
