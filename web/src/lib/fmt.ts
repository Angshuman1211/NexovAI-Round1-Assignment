/** Display formatting. The server sends machine values (2026-11-27, 09:00,
 *  9876543210); everything a human reads is shaped here. */

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
               "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** Split a 24h time so the hour can be set large and the meridiem small. */
export function splitTime(hhmm: string): { time: string; suffix: string } {
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return { time: `${hour}:${String(m).padStart(2, "0")}`, suffix };
}

export function dayParts(iso: string) {
  const d = new Date(`${iso}T00:00:00`);
  const days = Math.round((midnight(d).getTime() - midnight(new Date()).getTime()) / 86_400_000);
  return {
    weekday: WEEKDAY[d.getDay()],
    date: `${d.getDate()} ${MONTH[d.getMonth()]}`,
    relative: days === 0 ? "Today" : days === 1 ? "Tomorrow" : null,
    isToday: days === 0,
  };
}

/** 9876543210 -> 98765 43210, the way the number is read out loud. */
export const groupPhone = (p: string) =>
  p.length === 10 ? `${p.slice(0, 5)} ${p.slice(5)}` : p;

export const initials = (name: string) =>
  name.replace(/^Dr\.?\s*/, "").split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase();

export const clockTime = (d: Date) =>
  [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((n) => String(n).padStart(2, "0")).join(":");

export const mmss = (s: number) =>
  `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

/** Group slots by ISO day, keeping the server's ordering within each day. */
export function byDay<T extends { day: string }>(rows: T[]): [string, T[]][] {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const bucket = map.get(row.day);
    if (bucket) bucket.push(row);
    else map.set(row.day, [row]);
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
}
