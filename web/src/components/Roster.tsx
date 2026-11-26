import type { Doctor } from "../lib/api";
import { initials } from "../lib/fmt";
import { SectionHead } from "./Panel";

function Skeleton() {
  return (
    <ul>
      {[0, 1, 2, 3].map((i) => (
        <li key={i} className={`flex items-center gap-3 px-4 py-3 ${i > 0 ? "border-t border-rule2" : ""}`}>
          <span className="skeleton h-8 w-8 rounded-[2px]" />
          <span className="flex-1">
            <span className="skeleton block h-3 w-28 rounded-[2px]" />
            <span className="skeleton mt-1.5 block h-2.5 w-20 rounded-[2px]" />
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Who is on duty. Selecting a doctor filters the availability board, which
 *  is the only reason this list is interactive. */
export function Roster({
  doctors, loading, selected, onSelect,
}: {
  doctors: Doctor[];
  loading: boolean;
  selected: string | null;
  onSelect: (name: string | null) => void;
}) {
  return (
    <>
      <SectionHead
        title="On duty"
        aside={
          selected ? (
            <button
              onClick={() => onSelect(null)}
              className="text-[12px] text-ink3 underline-offset-2 transition hover:text-ink hover:underline"
            >
              Clear filter
            </button>
          ) : (
            <span className="num text-[12px] text-ink3">{doctors.length}</span>
          )
        }
      />

      {loading ? (
        <Skeleton />
      ) : (
        <ul>
          {doctors.map((d, i) => {
            const active = selected === d.name;
            return (
              <li key={d.id} className={i > 0 ? "border-t border-rule2" : ""}>
                <button
                  onClick={() => onSelect(active ? null : d.name)}
                  aria-pressed={active}
                  className={`group flex w-full items-center gap-3 px-4 py-3 text-left transition-colors
                              ${active ? "bg-bone" : "hover:bg-bone/60"}`}
                >
                  <span
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-[2px]
                                text-[11px] font-semibold transition-colors
                                ${active
                                  ? "bg-ink text-card"
                                  : "bg-bone text-ink2 group-hover:bg-rule2"}`}
                  >
                    {initials(d.name)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] leading-tight font-medium">
                      {d.name}
                    </span>
                    <span className="mt-0.5 block truncate text-[12px] leading-tight text-ink2">
                      {d.speciality}, {d.room.toLowerCase()}
                    </span>
                  </span>
                  <span className="num shrink-0 text-[12.5px] text-ink3">{d.open_slots} open</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
