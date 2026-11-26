import { useCallback, useEffect, useRef, useState } from "react";
import { fetchState, resetClinic, subscribeEvents, type ClinicState } from "./lib/api";
import { useVoiceCall } from "./lib/useVoiceCall";
import { clockTime, groupPhone } from "./lib/fmt";
import { PhoneCall } from "./components/PhoneCall";
import { Surface } from "./components/Panel";
import { Roster } from "./components/Roster";
import { Availability } from "./components/Availability";
import { Ledger } from "./components/Ledger";
import { Activity, type LogEntry, type LogKind } from "./components/Activity";

const EMPTY: ClinicState = { doctors: [], appointments: [], slots: [] };

const HandsetIcon = () => (
  <svg viewBox="0 0 24 24" className="h-[14px] w-[14px]" fill="currentColor" aria-hidden="true">
    <path d="M6.6 10.8c1.2 2.4 3.2 4.4 5.6 5.6l1.9-1.9c.3-.3.7-.4 1.1-.2 1.2.4 2.5.6 3.8.6.6 0 1 .4 1 1V19c0 .6-.4 1-1 1-7.7 0-14-6.3-14-14 0-.6.4-1 1-1h3.1c.6 0 1 .4 1 1 0 1.3.2 2.6.6 3.8.1.4 0 .8-.2 1.1l-1.9 1.9z" />
  </svg>
);

function useWallClock() {
  const [now, setNow] = useState(() => clockTime(new Date()));
  useEffect(() => {
    const id = setInterval(() => setNow(clockTime(new Date())), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export default function App() {
  const [data, setData] = useState<ClinicState>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [flashed, setFlashed] = useState<Set<number>>(new Set());
  const [booking, setBooking] = useState<any | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);

  const call = useVoiceCall();
  const phoneOpen = call.state !== "idle";
  const clock = useWallClock();
  const logId = useRef(0);

  const refresh = useCallback(async () => {
    try { setData(await fetchState()); } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  const flash = useCallback((id: number) => {
    setFlashed((prev) => new Set(prev).add(id));
    window.setTimeout(() => {
      setFlashed((prev) => { const n = new Set(prev); n.delete(id); return n; });
    }, 3200);
  }, []);

  const push = useCallback((kind: LogKind, text: string) => {
    setLog((prev) => [
      { id: ++logId.current, at: clockTime(new Date()), kind, text },
      ...prev,
    ].slice(0, 40));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // The server pushes a change the moment a tool runs, so the dashboard moves
  // in step with the conversation instead of polling behind it.
  useEffect(() => {
    return subscribeEvents((e) => {
      if (e.type === "booked") {
        setBooking(e.data);
        flash(e.data.appointment_id);
        push("booked", `Booked ${e.data.doctor}, ${e.data.label ?? e.data.day}, ${groupPhone(e.data.phone)}`);
        refresh();
      } else if (e.type === "cancelled") {
        flash(e.data.cancelled_id);
        push("cancelled", `Cancelled ${e.data.doctor}, ${groupPhone(e.data.phone)}`);
        refresh();
      } else if (e.type === "tool") {
        if (e.data?.name === "check_doctor_availability") {
          const scope = [e.data.doctor, e.data.day].filter(Boolean).join(", ");
          push("tool", `Checked availability${scope ? ` for ${scope}` : ""} and found ${e.data.count ?? 0}`);
        } else if (e.data?.error) {
          push("error", e.data.error);
        }
      } else if (e.type === "call") {
        push("call", e.data.state === "connected" ? "Caller connected" : "Call ended");
      } else if (e.type === "refresh") {
        refresh();
      }
    });
  }, [refresh, flash, push]);

  const startCall = () => { setBooking(null); call.start(); };

  const onReset = async () => {
    await resetClinic();
    setBooking(null);
    setSelected(null);
    setLog([]);
    refresh();
  };

  return (
    <div className="min-h-full">
      <audio ref={call.audioElRef} autoPlay playsInline className="hidden" />

      <header className="sticky top-0 z-20 border-b border-rule bg-bone/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-5 gap-y-3 px-5 py-3.5 sm:px-7">
          <div className="flex min-w-0 items-center gap-3">
            <img
              src="/logo.png"
              alt=""
              width={40}
              height={40}
              className="h-10 w-10 shrink-0"
            />
            <div className="min-w-0">
              <h1 className="truncate text-[17px] leading-tight font-semibold tracking-[-0.015em]">
                Lakeview Clinic
              </h1>
              <p className="mt-0.5 truncate text-[12.5px] leading-tight text-ink2">
                Voice reception desk
              </p>
            </div>
          </div>

          <div className="ml-auto flex items-center gap-4">
            <div className="hidden items-center gap-2 text-[12px] text-ink3 sm:flex">
              <span className={`h-1.5 w-1.5 rounded-full ${phoneOpen ? "bg-signal" : "bg-rule"}`} />
              <span>{phoneOpen ? "Call in progress" : "No active call"}</span>
              <span className="num text-ink3">{clock}</span>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={onReset}
                className="rounded-[3px] border border-rule bg-card px-3 py-[7px] text-[12.5px]
                           text-ink2 transition hover:border-ink3 hover:text-ink"
              >
                Reset
              </button>
              <button
                onClick={startCall}
                disabled={phoneOpen}
                className="flex items-center gap-2 rounded-[3px] bg-signal px-4 py-[7px]
                           text-[12.5px] font-medium text-white transition
                           hover:brightness-110 disabled:opacity-35"
              >
                <HandsetIcon />
                Try call
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-5 py-6 sm:px-7 sm:py-8">
        <div className="grid items-start gap-4 lg:grid-cols-[318px_minmax(0,1fr)]">
          <Surface>
            <Roster
              doctors={data.doctors} loading={loading}
              selected={selected} onSelect={setSelected}
            />
            <Activity entries={log} />
          </Surface>

          <Surface>
            <Availability slots={data.slots} loading={loading} selected={selected} />
            <Ledger appointments={data.appointments} flashed={flashed} />
          </Surface>
        </div>

        <footer className="mt-8 border-t border-rule pt-4 text-[12px] text-ink3">
          <p>
            Pipecat pipeline with ElevenLabs speech and Gemini 2.5 Flash, over WebRTC.
            Clinic data is mock; the booking rules live in{" "}
            <span className="num">clinic.py</span>, not in the prompt.
          </p>
        </footer>
      </main>

      {phoneOpen && (
        <PhoneCall
          state={call.state} turns={call.turns} muted={call.muted}
          agentSpeaking={call.agentSpeaking} levelRef={call.levelRef}
          booking={booking} error={call.error}
          onEnd={call.stop} onToggleMute={call.toggleMute}
          onClose={call.reset} onRedial={startCall}
        />
      )}
    </div>
  );
}
