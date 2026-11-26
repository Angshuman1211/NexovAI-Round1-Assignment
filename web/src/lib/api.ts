export type Doctor = {
  id: number; name: string; speciality: string; room: string; open_slots: number;
};
export type Slot = {
  id: number; day: string; time: string; doctor: string;
  speciality: string; room: string; label: string;
};
export type Appointment = {
  id: number; phone: string; patient: string; status: string; created_at: string;
  day: string; time: string; doctor: string; speciality: string; room: string; label: string;
};
export type ClinicState = {
  doctors: Doctor[]; appointments: Appointment[]; slots: Slot[];
};

export async function fetchState(): Promise<ClinicState> {
  const r = await fetch("/api/state");
  if (!r.ok) throw new Error(`state ${r.status}`);
  return r.json();
}

export async function resetClinic(): Promise<void> {
  await fetch("/api/reset", { method: "POST" });
}

export type ServerEvent =
  | { type: "booked"; data: any }
  | { type: "cancelled"; data: any }
  | { type: "tool"; data: any }
  | { type: "call"; data: { state: string } }
  | { type: "refresh"; data: null };

/** SSE subscription. EventSource reconnects on its own, so this only has to
 *  hand events upward and close on unmount. */
export function subscribeEvents(onEvent: (e: ServerEvent) => void): () => void {
  const es = new EventSource("/api/events");
  es.onmessage = (m) => {
    try { onEvent(JSON.parse(m.data)); } catch { /* keepalive */ }
  };
  return () => es.close();
}
