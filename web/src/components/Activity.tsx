import { SectionHead } from "./Panel";

export type LogKind = "tool" | "booked" | "cancelled" | "call" | "error";

export type LogEntry = {
  id: number;
  at: string;
  kind: LogKind;
  text: string;
};

/** A running log instead of a toast.
 *
 *  Every tool the agent calls lands here with a timestamp and stays. A message
 *  that vanishes after four seconds is invisible on a screen recording, and
 *  this is what shows the voice side and the data side are one system rather
 *  than two things that happen to agree. */
export function Activity({ entries }: { entries: LogEntry[] }) {
  return (
    <>
      <SectionHead
        title="Activity"
        divided
        aside={
          entries.length > 0 ? (
            <span className="num text-[12px] text-ink3">{entries.length}</span>
          ) : undefined
        }
      />

      {entries.length === 0 ? (
        <p className="px-4 py-4 text-[12.5px] leading-relaxed text-ink3">
          Tool calls appear here as the agent makes them.
        </p>
      ) : (
        <ul className="max-h-[260px] overflow-y-auto">
          {entries.map((e, i) => (
            <li
              key={e.id}
              className={`flex gap-3 px-4 py-2.5 ${i > 0 ? "border-t border-rule2" : ""}
                          ${i === 0 ? "rise" : ""}`}
            >
              <span className="num shrink-0 pt-px text-[11px] text-ink3">{e.at}</span>
              <span
                className={`text-[12.5px] leading-snug ${
                  e.kind === "error" ? "text-alert" : "text-ink2"
                }`}
              >
                {e.text}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
