import type { Appointment } from "../lib/api";
import { dayParts, groupPhone, splitTime } from "../lib/fmt";
import { SectionHead } from "./Panel";

/** The book. A real table because this is tabular data, and a reviewer should
 *  be able to scan a column of times without reading sideways. */
export function Ledger({
  appointments, flashed,
}: {
  appointments: Appointment[];
  flashed: Set<number>;
}) {
  const confirmed = appointments.filter((a) => a.status === "confirmed").length;
  const cancelled = appointments.length - confirmed;

  return (
    <>
      <SectionHead
        title="Appointments"
        divided
        aside={
          <span className="flex items-baseline gap-3 text-[12px]">
            <span className="num text-ink3">{confirmed} confirmed</span>
            {cancelled > 0 && <span className="num text-ink3">{cancelled} cancelled</span>}
          </span>
        }
      />

      {appointments.length === 0 ? (
        <div className="px-4 py-12 text-center">
          <p className="text-[13px] text-ink2">Nothing in the book yet.</p>
          <p className="mt-1 text-[12.5px] text-ink3">
            Start a call and ask for a cardiologist tomorrow.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-rule2">
                <th className="col px-4 py-2 font-medium">When</th>
                <th className="col px-4 py-2 font-medium">Doctor</th>
                <th className="col hidden px-4 py-2 font-medium sm:table-cell">Room</th>
                <th className="col px-4 py-2 font-medium">Caller</th>
                <th className="col px-4 py-2 text-right font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {appointments.map((a, i) => {
                const live = a.status === "confirmed";
                const { relative, weekday, date } = dayParts(a.day);
                const { time, suffix } = splitTime(a.time);
                return (
                  <tr
                    key={a.id}
                    className={`${i > 0 ? "border-t border-rule2" : ""}
                                ${flashed.has(a.id) ? "settle" : ""}
                                ${live ? "" : "opacity-55"}`}
                  >
                    <td className="px-4 py-3 align-top whitespace-nowrap">
                      <span className="num block text-[13px] leading-tight">
                        {time}
                        <span className="ml-0.5 text-[10px] text-ink3">{suffix}</span>
                      </span>
                      <span className="sub mt-1 block">
                        {relative ?? `${weekday} ${date}`}
                      </span>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <span className="block text-[13px] leading-tight font-medium">{a.doctor}</span>
                      <span className="mt-0.5 block text-[12px] leading-tight text-ink2">
                        {a.speciality}
                      </span>
                    </td>
                    <td className="num hidden px-4 py-3 align-top text-[12.5px] whitespace-nowrap text-ink2 sm:table-cell">
                      {a.room.replace("Room ", "")}
                    </td>
                    <td className="num px-4 py-3 align-top text-[12.5px] whitespace-nowrap text-ink2">
                      {groupPhone(a.phone)}
                    </td>
                    <td className="px-4 py-3 text-right align-top whitespace-nowrap">
                      <span
                        className={`inline-flex items-center gap-1.5 text-[12px]
                                    ${live ? "text-signal" : "text-alert"}`}
                      >
                        <span className={`h-1 w-1 rounded-full ${live ? "bg-signal" : "bg-alert"}`} />
                        {live ? "Confirmed" : "Cancelled"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
