"""Clinic data layer: doctors, slots and appointments backed by SQLite.

Every tool the voice agent can call bottoms out in a function here, so the
booking rules live in one place instead of being spread through the prompt.
"""

import sqlite3
import threading
from contextlib import contextmanager
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Optional

DB_PATH = Path(__file__).parent / "clinic.db"

# SQLite connections aren't shareable across threads, and Pipecat runs tool
# handlers on the event loop while FastAPI serves reads from a threadpool.
_lock = threading.Lock()


@contextmanager
def _db():
    with _lock:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()


SCHEMA = """
CREATE TABLE IF NOT EXISTS doctors (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL,
    speciality  TEXT NOT NULL,
    room        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS slots (
    id          INTEGER PRIMARY KEY,
    doctor_id   INTEGER NOT NULL REFERENCES doctors(id),
    day         TEXT NOT NULL,          -- ISO date, e.g. 2026-11-25
    time        TEXT NOT NULL,          -- 24h, e.g. 09:30
    booked      INTEGER NOT NULL DEFAULT 0,
    UNIQUE (doctor_id, day, time)
);

CREATE TABLE IF NOT EXISTS appointments (
    id          INTEGER PRIMARY KEY,
    slot_id     INTEGER NOT NULL REFERENCES slots(id),
    phone       TEXT NOT NULL,
    patient     TEXT NOT NULL DEFAULT 'Caller',
    status      TEXT NOT NULL DEFAULT 'confirmed',
    created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_appt_phone ON appointments(phone);
"""

DOCTORS = [
    ("Dr. Anita Rao",      "Cardiology",   "Room 204"),
    ("Dr. Vikram Shetty",  "Dermatology",  "Room 112"),
    ("Dr. Meera Nair",     "Pediatrics",   "Room 301"),
    ("Dr. Imran Qureshi",  "Orthopaedics", "Room 118"),
]

# Each doctor keeps a different clinic rhythm so "what's available" is a real
# question rather than every doctor returning an identical grid.
SLOT_TIMES = {
    "Dr. Anita Rao":     ["09:00", "09:30", "10:00", "11:30", "15:00", "16:00"],
    "Dr. Vikram Shetty": ["10:00", "10:30", "11:00", "14:30", "15:30"],
    "Dr. Meera Nair":    ["09:30", "11:00", "12:00", "16:30", "17:00"],
    "Dr. Imran Qureshi": ["08:30", "09:00", "14:00", "14:30", "17:30"],
}


def normalise_phone(raw: str) -> str:
    """Keep digits only, then drop an Indian country code so that
    '+91 98765 43210', '09876543210' and '9876543210' are one patient."""
    digits = "".join(ch for ch in str(raw) if ch.isdigit())
    if len(digits) > 10 and digits.startswith("91"):
        digits = digits[2:]
    return digits[-10:] if len(digits) >= 10 else digits


def init_db(reset: bool = False) -> None:
    if reset and DB_PATH.exists():
        DB_PATH.unlink()
    with _db() as conn:
        conn.executescript(SCHEMA)
        if conn.execute("SELECT COUNT(*) FROM doctors").fetchone()[0]:
            return
        for name, spec, room in DOCTORS:
            conn.execute(
                "INSERT INTO doctors (name, speciality, room) VALUES (?,?,?)",
                (name, spec, room),
            )
        # Seed the next 7 days, skipping Sundays.
        for doc in conn.execute("SELECT id, name FROM doctors").fetchall():
            for offset in range(7):
                day = date.today() + timedelta(days=offset)
                if day.weekday() == 6:
                    continue
                for t in SLOT_TIMES[doc["name"]]:
                    conn.execute(
                        "INSERT OR IGNORE INTO slots (doctor_id, day, time) VALUES (?,?,?)",
                        (doc["id"], day.isoformat(), t),
                    )


# ---------------------------------------------------------------- resolvers
# The LLM passes through whatever the caller said, so these absorb the spread
# between "Dr Rao", "anita", "the heart doctor" and an exact row in the table.

# How callers actually describe a speciality out loud.
SYNONYMS = {
    "cardiology":   ["heart", "cardiac", "chest pain", "bp", "blood pressure", "cardiologist"],
    "dermatology":  ["skin", "rash", "acne", "hair", "dermatologist"],
    "pediatrics":   ["child", "kid", "baby", "infant", "paediatric", "pediatrician"],
    "orthopaedics": ["bone", "joint", "knee", "back pain", "fracture", "orthopedic", "ortho"],
}


def resolve_doctor(query: Optional[str]) -> Optional[dict]:
    if not query:
        return None
    q = query.lower().replace("dr.", "").replace("dr ", "").strip()
    with _db() as conn:
        rows = [dict(r) for r in conn.execute("SELECT * FROM doctors").fetchall()]
    for row in rows:                                    # exact name
        if q == row["name"].lower():
            return row
    for row in rows:                                    # surname or given name
        parts = row["name"].lower().replace("dr.", "").split()
        if any(p and (p == q or p in q or q in p) for p in parts):
            return row
    for row in rows:                                    # speciality fallback
        if q in row["speciality"].lower() or row["speciality"].lower() in q:
            return row
    for row in rows:                                    # colloquial speciality
        for word in SYNONYMS.get(row["speciality"].lower(), []):
            if word in q:
                return row
    return None


def parse_day(text: Optional[str]) -> Optional[str]:
    """Accept an ISO date, 'today', 'tomorrow' or a weekday name."""
    if not text:
        return None
    t = text.strip().lower()
    today = date.today()
    if t in ("today", "tonight"):
        return today.isoformat()
    if t == "tomorrow":
        return (today + timedelta(days=1)).isoformat()
    if t in ("day after tomorrow", "day after"):
        return (today + timedelta(days=2)).isoformat()
    weekdays = ["monday", "tuesday", "wednesday", "thursday",
                "friday", "saturday", "sunday"]
    for i, name in enumerate(weekdays):
        if name in t:
            ahead = (i - today.weekday()) % 7 or 7
            return (today + timedelta(days=ahead)).isoformat()
    for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%d %B", "%d %b", "%B %d", "%b %d"):
        try:
            parsed = datetime.strptime(text.strip(), fmt)
            if parsed.year == 1900:
                parsed = parsed.replace(year=today.year)
            return parsed.date().isoformat()
        except ValueError:
            continue
    return None


def parse_time(text: Optional[str]) -> Optional[str]:
    """Normalise '9', '9am', '9:30 PM', '09.30', '1530' to 24h HH:MM."""
    if not text:
        return None
    t = text.strip().lower().replace(".", ":").replace(" ", "")
    pm = t.endswith("pm")
    am = t.endswith("am")
    t = t.removesuffix("pm").removesuffix("am")
    if ":" in t:
        hh, _, mm = t.partition(":")
    elif len(t) == 4 and t.isdigit():
        hh, mm = t[:2], t[2:]
    else:
        hh, mm = t, "00"
    if not (hh.isdigit() and mm.isdigit()):
        return None
    h, m = int(hh), int(mm)
    if pm and h < 12:
        h += 12
    if am and h == 12:
        h = 0
    # A caller saying "3" for a clinic means 15:00, not 03:00.
    if not pm and not am and h < 8:
        h += 12
    return f"{h:02d}:{m:02d}" if 0 <= h < 24 and 0 <= m < 60 else None


def human_time(hhmm: str) -> str:
    h, m = int(hhmm[:2]), int(hhmm[3:])
    suffix = "AM" if h < 12 else "PM"
    hour = h % 12 or 12
    return f"{hour}:{m:02d} {suffix}" if m else f"{hour} {suffix}"


def human_day(iso: str) -> str:
    d = date.fromisoformat(iso)
    today = date.today()
    if d == today:
        return "today"
    if d == today + timedelta(days=1):
        return "tomorrow"
    return d.strftime("%A %-d %B")


def on_day(iso: str) -> str:
    """human_day with the right preposition, since the agent speaks these."""
    phrase = human_day(iso)
    return phrase if phrase in ("today", "tomorrow") else f"on {phrase}"


# --------------------------------------------------------------- operations

def list_doctors() -> list[dict]:
    with _db() as conn:
        docs = [dict(r) for r in conn.execute("SELECT * FROM doctors ORDER BY name")]
        for d in docs:
            now = datetime.now()
            d["open_slots"] = conn.execute(
                """SELECT COUNT(*) FROM slots WHERE doctor_id=? AND booked=0
                   AND (day > ? OR (day = ? AND time > ?))""",
                (d["id"], now.date().isoformat(), now.date().isoformat(),
                 now.strftime("%H:%M")),
            ).fetchone()[0]
    return docs


def availability(doctor: Optional[str] = None, day: Optional[str] = None,
                 limit: int = 40) -> dict[str, Any]:
    """Open slots, optionally narrowed to a doctor and/or a day."""
    doc = resolve_doctor(doctor)
    if doctor and not doc:
        return {"ok": False, "error": f"No doctor matching '{doctor}'.",
                "doctors": [d["name"] for d in list_doctors()]}

    iso_day = parse_day(day)
    if day and not iso_day:
        return {"ok": False, "error": f"Could not understand the date '{day}'."}

    # A slot earlier today is not available, so exclude it rather than let the
    # agent offer a time that has already passed.
    now = datetime.now()
    sql = ["""SELECT s.id, s.day, s.time, d.name AS doctor, d.speciality, d.room
              FROM slots s JOIN doctors d ON d.id = s.doctor_id
              WHERE s.booked = 0
                AND (s.day > ? OR (s.day = ? AND s.time > ?))"""]
    args: list[Any] = [now.date().isoformat(), now.date().isoformat(), now.strftime("%H:%M")]
    if doc:
        sql.append("AND s.doctor_id = ?")
        args.append(doc["id"])
    if iso_day:
        sql.append("AND s.day = ?")
        args.append(iso_day)
    sql.append("ORDER BY s.day, s.time LIMIT ?")
    args.append(limit)

    with _db() as conn:
        rows = [dict(r) for r in conn.execute(" ".join(sql), args)]

    for r in rows:
        r["label"] = f"{human_day(r['day'])} at {human_time(r['time'])}"
    return {
        "ok": True,
        "doctor": doc["name"] if doc else None,
        "speciality": doc["speciality"] if doc else None,
        "day": iso_day,
        "count": len(rows),
        "slots": rows,
    }


def book(doctor: str, day: str, time: str, phone: str,
         patient: str = "Caller") -> dict[str, Any]:
    doc = resolve_doctor(doctor)
    if not doc:
        return {"ok": False, "error": f"No doctor matching '{doctor}'."}
    iso_day, hhmm = parse_day(day), parse_time(time)
    if not iso_day:
        return {"ok": False, "error": f"Could not understand the date '{day}'."}
    if not hhmm:
        return {"ok": False, "error": f"Could not understand the time '{time}'."}

    digits = normalise_phone(phone)
    if len(digits) != 10:
        return {"ok": False, "error": "I need a complete 10 digit phone number."}

    with _db() as conn:
        slot = conn.execute(
            "SELECT * FROM slots WHERE doctor_id=? AND day=? AND time=?",
            (doc["id"], iso_day, hhmm),
        ).fetchone()
        if not slot:
            return {"ok": False, "error":
                    f"{doc['name']} has no {human_time(hhmm)} slot {on_day(iso_day)}."}
        if slot["booked"]:
            return {"ok": False, "error":
                    f"{human_time(hhmm)} {on_day(iso_day)} is already taken."}
        if datetime.fromisoformat(f"{iso_day}T{hhmm}") < datetime.now():
            return {"ok": False, "error":
                    f"{human_time(hhmm)} {on_day(iso_day)} has already passed."}
        # One live appointment per caller keeps the cancel flow unambiguous.
        clash = conn.execute(
            """SELECT a.id FROM appointments a JOIN slots s ON s.id = a.slot_id
               WHERE a.phone=? AND a.status='confirmed' AND s.day=?""",
            (digits, iso_day),
        ).fetchone()
        if clash:
            return {"ok": False, "error":
                    f"That number already has an appointment {on_day(iso_day)}."}

        conn.execute("UPDATE slots SET booked=1 WHERE id=?", (slot["id"],))
        cur = conn.execute(
            """INSERT INTO appointments (slot_id, phone, patient, created_at)
               VALUES (?,?,?,?)""",
            (slot["id"], digits, patient or "Caller", datetime.now().isoformat(timespec="seconds")),
        )
        appt_id = cur.lastrowid

    return {"ok": True, "appointment_id": appt_id, "doctor": doc["name"],
            "speciality": doc["speciality"], "room": doc["room"],
            "day": iso_day, "time": hhmm, "phone": digits,
            "confirmation": f"{doc['name']}, {human_day(iso_day)} at {human_time(hhmm)}, {doc['room']}"}


def cancel(phone: str) -> dict[str, Any]:
    digits = normalise_phone(phone)
    if len(digits) != 10:
        return {"ok": False, "error": "I need a complete 10 digit phone number."}
    with _db() as conn:
        rows = [dict(r) for r in conn.execute(
            """SELECT a.id, s.id AS slot_id, s.day, s.time, d.name AS doctor
               FROM appointments a
               JOIN slots s ON s.id = a.slot_id
               JOIN doctors d ON d.id = s.doctor_id
               WHERE a.phone=? AND a.status='confirmed'
               ORDER BY s.day, s.time""", (digits,))]
        if not rows:
            return {"ok": False, "error": f"No appointment found for {digits}."}
        appt = rows[0]
        conn.execute("UPDATE appointments SET status='cancelled' WHERE id=?", (appt["id"],))
        conn.execute("UPDATE slots SET booked=0 WHERE id=?", (appt["slot_id"],))
    return {"ok": True, "cancelled_id": appt["id"], "doctor": appt["doctor"],
            "day": appt["day"], "time": appt["time"], "phone": digits,
            "remaining": len(rows) - 1,
            "confirmation": f"{appt['doctor']} {on_day(appt['day'])} at {human_time(appt['time'])}"}


def list_appointments() -> list[dict]:
    with _db() as conn:
        rows = [dict(r) for r in conn.execute(
            """SELECT a.id, a.phone, a.patient, a.status, a.created_at,
                      s.day, s.time, d.name AS doctor, d.speciality, d.room
               FROM appointments a
               JOIN slots s ON s.id = a.slot_id
               JOIN doctors d ON d.id = s.doctor_id
               ORDER BY a.id DESC""")]
    for r in rows:
        r["label"] = f"{human_day(r['day'])} at {human_time(r['time'])}"
    return rows
