import type { Slot } from "../lib/api";
import { byDay, dayParts, initials, splitTime } from "../lib/fmt";
import { SectionHead } from "./Panel";

function Skeleton() {
  return (
    <div className="flex">
      {[0, 1, 2, 3, 4].map((c) => (
        <div key={c} className={`min-w-[104px] flex-1 ${c > 0 ? "border-l border-rule2" : ""}`}>
          <div className="border-b border-rule2 px-3 py-2.5">
            <span className="skeleton block h-2.5 w-8 rounded-[2px]" />
            <span className="skeleton mt-1.5 block h-3 w-14 rounded-[2px]" />
          </div>
          <div className="flex flex-col gap-1 p-2">
            {[0, 1, 2, 3, 4].map((r) => (
              <span key={r} className="skeleton h-7 rounded-[2px]" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Open slots laid out as a week, one column per day.
 *
 *  The agent reads availability from the same endpoint, so this is a view of
 *  what it can actually offer. A flat list of times could not show that one
 *  day is nearly full and the next is wide open, which is the thing you want
 *  to see while a caller is on the line. */
export function Availability({
  slots, loading, selected,
}: {
  slots: Slot[];
  loading: boolean;
  selected: string | null;
}) {
  const shown = selected ? slots.filter((s) => s.doctor === selected) : slots;
  const days = byDay(shown);

  return (
    <>
      <SectionHead
        title="Availability"
        aside={
          <span className="flex items-baseline gap-2.5">
            {selected && (
              <span className="text-[12px] text-ink2">{selected.replace(/^Dr\.?\s*/, "Dr ")}</span>
            )}
            <span className="num text-[12px] text-ink3">{shown.length} open</span>
          </span>
        }
      />

      {loading ? (
        <Skeleton />
      ) : days.length === 0 ? (
        <p className="px-4 py-14 text-center text-[12.5px] text-ink3">
          {selected ? "No open slots for this doctor." : "No open slots in the next week."}
        </p>
      ) : (
        <div className="board flex max-h-[348px] overflow-auto">
          {days.map(([iso, rows], i) => {
            const { weekday, date, relative, isToday } = dayParts(iso);
            return (
              <div
                key={iso}
                className={`min-w-[104px] flex-1 ${i > 0 ? "border-l border-rule2" : ""}`}
              >
                <div
                  className={`sticky top-0 z-10 border-b border-rule2 px-3 py-2.5
                              ${isToday ? "bg-bone" : "bg-card"}`}
                >
                  <div className="text-[11px] leading-none text-ink3">{weekday}</div>
                  <div className="num mt-1.5 text-[12.5px] leading-none text-ink">{date}</div>
                  <div className="sub mt-1.5 h-3">{relative ?? ""}</div>
                </div>

                <div className="flex flex-col gap-1 p-2">
                  {rows.map((s) => {
                    const { time, suffix } = splitTime(s.time);
                    return (
                      <div
                        key={s.id}
                        title={`${s.doctor}, ${s.room}`}
                        className="flex items-baseline justify-between rounded-[2px] border
                                   border-rule2 bg-bone px-2 py-1.5 transition-colors
                                   hover:border-rule"
                      >
                        <span className="num text-[12px] leading-none text-ink">
                          {time}
                          <span className="ml-0.5 text-[9px] text-ink3">{suffix}</span>
                        </span>
                        {/* Unfiltered, two doctors' 9:00 look identical. Say whose. */}
                        {!selected && (
                          <span className="text-[9.5px] leading-none font-medium text-ink3">
                            {initials(s.doctor)}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
