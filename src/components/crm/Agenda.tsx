import Link from "next/link";
import { Icon } from "@/components/Icon";
import { dayFull, fT, sameDay, sod } from "@/lib/crm/dates";
import type { AgendaItem } from "@/lib/crm/views";
import { MeetingStatePill } from "./MeetingState";
import { initials, nOf } from "./bits";

export function Agenda({ items }: { items: AgendaItem[] }) {
  const now = new Date();
  if (!items.length) return <p className="empty">אין פגישות היום וביום העבודה הבא.</p>;
  // today, then every day up to the next working day that has meetings (on Thursday also Friday)
  const days: Date[] = [];
  for (const m of items) {
    const d = sod(new Date(m.startAt));
    if (!days.some((x) => sameDay(x, d))) days.push(d);
  }
  days.sort((a, b) => a.getTime() - b.getTime());
  return (
    <>
      {days.map((d) => {
        const list = items.filter((m) => sameDay(new Date(m.startAt), d));
        if (!list.length) return null;
        const ok = list.filter((m) => m.confirmed || m.status === "held").length;
        return (
          <div key={d.toISOString()}>
            <div className="day-h">
              {dayFull(d, now)}
              <small>
                {nOf(list.length, "פגישה אחת", "פגישות")}, אושרו או התקיימו: {ok}
              </small>
            </div>
            <ul className="agenda">
              {list.map((m) => (
                <li key={m.id}>
                  <time>{fT(new Date(m.startAt))}</time>
                  {/* the meeting card, with the client one click further */}
                  <Link className="lk" href={`/meetings/${m.id}`}>
                    <b>{m.leadName}</b>
                    <small>{[m.projectName, m.place].filter(Boolean).join(", ")}</small>
                  </Link>
                  {m.status !== "set" ? (
                    <MeetingStatePill status={m.status} confirmed={m.confirmed} />
                  ) : (
                    <span className={"cf-ic" + (m.confirmed ? " on" : "")} title={m.confirmed ? "הגעה אושרה" : "הגעה לא אושרה"}>
                      <Icon name="cc" />
                      <span className="sr">{m.confirmed ? "הגעה אושרה" : "הגעה לא אושרה"}</span>
                    </span>
                  )}
                  {m.hostName ? <span className="av sm" title={m.hostName}>{initials(m.hostName)}</span> : <span />}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </>
  );
}
