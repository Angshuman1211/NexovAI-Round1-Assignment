import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { Waveform } from "./Waveform";
import { mmss } from "../lib/fmt";
import type { CallState, Turn } from "../lib/useVoiceCall";

const MicIcon = ({ off }: { off: boolean }) => (
  <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor"
       strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2.5a2.75 2.75 0 0 0-2.75 2.75v6.5a2.75 2.75 0 0 0 5.5 0v-6.5A2.75 2.75 0 0 0 12 2.5z" />
    <path d="M18.5 11v1a6.5 6.5 0 0 1-13 0v-1M12 18.5V21.5" />
    {off && <path d="M4 4l16 16" />}
  </svg>
);

const HandsetIcon = ({ down = false }: { down?: boolean }) => (
  <svg viewBox="0 0 24 24" className="h-[19px] w-[19px]" fill="currentColor" aria-hidden="true">
    <g transform={down ? "rotate(135 12 12)" : undefined}>
      <path d="M6.6 10.8c1.2 2.4 3.2 4.4 5.6 5.6l1.9-1.9c.3-.3.7-.4 1.1-.2 1.2.4 2.5.6 3.8.6.6 0 1 .4 1 1V19c0 .6-.4 1-1 1-7.7 0-14-6.3-14-14 0-.6.4-1 1-1h3.1c.6 0 1 .4 1 1 0 1.3.2 2.6.6 3.8.1.4 0 .8-.2 1.1l-1.9 1.9z" />
    </g>
  </svg>
);

function useTimer(running: boolean) {
  const [secs, setSecs] = useState(0);
  const startedAt = useRef<number | null>(null);
  useEffect(() => {
    if (!running) return;
    startedAt.current = Date.now();
    const id = setInterval(() => {
      setSecs(Math.floor((Date.now() - (startedAt.current ?? Date.now())) / 1000));
    }, 500);
    return () => clearInterval(id);
  }, [running]);
  return secs;
}

export function PhoneCall({
  state, turns, muted, agentSpeaking, levelRef, booking, error,
  onEnd, onToggleMute, onClose, onRedial,
}: {
  state: CallState;
  turns: Turn[];
  muted: boolean;
  agentSpeaking: boolean;
  levelRef: MutableRefObject<number>;
  booking: any | null;
  error: string | null;
  onEnd: () => void;
  onToggleMute: () => void;
  onClose: () => void;
  onRedial: () => void;
}) {
  const live = state === "connected";
  const secs = useTimer(live);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, booking]);

  const phase =
    state === "connecting" ? "Dialling"
    : state === "ringing"  ? "Ringing"
    : state === "connected" ? "Connected"
    : state === "ending"   ? "Hanging up"
    : "Call ended";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Call in progress"
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/45 p-4 backdrop-blur-[3px]"
    >
      <div className="rise flex w-full max-w-[392px] flex-col overflow-hidden rounded-[18px]
                      bg-night text-white ring-1 ring-white/10">

        <div className="flex items-center justify-between border-b border-white/8 px-4 py-2.5">
          <span className="flex items-center gap-2 text-[12px] text-white/50">
            <span
              className={`h-1.5 w-1.5 rounded-full
                ${live ? "bg-glow" : state === "ended" ? "bg-white/25" : "bg-warn"}`}
            />
            {phase}
          </span>
          <span className="num text-[12px] text-white/45">{live ? mmss(secs) : "--:--"}</span>
        </div>

        <div className="flex flex-col items-center px-6 pt-7 pb-5">
          {/* A light disc behind the mark: its deep teal would disappear
              straight into the phone body otherwise. */}
          <div
            className={`relative flex h-14 w-14 items-center justify-center rounded-full
                        bg-bone ring-1 transition-opacity
                        ${live ? "ring-white/25" : "opacity-80 ring-white/10"}
                        ${state === "ringing" ? "halo text-white/45" : ""}`}
          >
            <img src="/logo.png" alt="" width={40} height={40} className="h-10 w-10" />
          </div>
          <div className="mt-3 text-[16px] leading-none font-semibold tracking-[-0.01em]">
            Lakeview Clinic
          </div>
          <div className="mt-2 text-[12px] text-white/40">
            Reception
            {live && muted && <span className="ml-2 text-warn">muted</span>}
          </div>

          <Waveform levelRef={levelRef} active={live && !muted} className="mt-5 h-8 w-full max-w-[232px]" />
          <div className="mt-2.5 h-4 text-[11.5px] text-white/35">
            {live ? (agentSpeaking ? "Riya is speaking" : "Listening") : ""}
          </div>
        </div>

        {/* Transcript as a call log rather than chat bubbles. */}
        <div ref={scrollRef} className="h-[244px] overflow-y-auto border-t border-white/8 bg-black/25">
          {turns.length === 0 && !error && (
            <p className="px-5 pt-20 text-center text-[12.5px] text-white/25">
              {live
                ? "Say hello to begin"
                : state === "ended"
                  ? "Nothing was said"
                  : "Opening the line"}
            </p>
          )}

          {error && (
            <div className="m-4 rounded-[3px] border border-white/15 px-3.5 py-3">
              <div className="text-[12px] font-medium text-warn">Call failed</div>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-white/70">{error}</p>
            </div>
          )}

          {turns.map((t, i) => (
            <div key={t.id} className={`flex gap-3 px-5 py-2.5 ${i > 0 ? "border-t border-white/6" : ""}`}>
              <span
                className={`w-[42px] shrink-0 pt-px text-[11.5px]
                            ${t.who === "agent" ? "text-white/55" : "text-white/35"}`}
              >
                {t.who === "agent" ? "Riya" : "Caller"}
              </span>
              <span
                className={`text-[13px] leading-relaxed
                            ${t.who === "agent" ? "text-white/90" : "text-white/65"}`}
              >
                {t.text}
              </span>
            </div>
          ))}

          {booking && (
            <div className="rise m-4 rounded-[3px] border border-white/15 p-3.5">
              <div className="flex items-center gap-2 text-[12px] text-glow">
                <span className="h-1.5 w-1.5 rounded-full bg-glow" />
                Appointment confirmed
              </div>
              <div className="mt-2 text-[14px] leading-tight font-medium">{booking.doctor}</div>
              <div className="num mt-1 text-[12px] text-white/55">
                {booking.confirmation?.split(", ").slice(1).join(", ")}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-center gap-5 border-t border-white/8 px-6 py-5">
          {state === "ended" ? (
            <>
              <button
                onClick={onClose}
                className="rounded-[3px] px-4 py-2.5 text-[12.5px] text-white/50 transition hover:text-white"
              >
                Close
              </button>
              <button
                onClick={onRedial}
                className="flex items-center gap-2 rounded-[3px] bg-white px-4 py-2.5 text-[12.5px]
                           font-medium text-night transition hover:bg-white/85"
              >
                <HandsetIcon />
                Call again
              </button>
            </>
          ) : (
            <>
              <button
                onClick={onToggleMute}
                disabled={!live}
                aria-label={muted ? "Unmute microphone" : "Mute microphone"}
                className={`flex h-11 w-11 items-center justify-center rounded-full ring-1 transition
                            disabled:opacity-25
                            ${muted
                              ? "bg-warn/20 text-warn ring-warn/30"
                              : "bg-white/5 text-white/70 ring-white/15 hover:bg-white/10"}`}
              >
                <MicIcon off={muted} />
              </button>
              <button
                onClick={onEnd}
                aria-label="End call"
                className="flex h-[3.25rem] w-[3.25rem] items-center justify-center rounded-full
                           bg-alert text-white transition hover:brightness-110 active:scale-95"
              >
                <HandsetIcon down />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
