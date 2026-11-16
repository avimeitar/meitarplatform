"use client";

import Link from "next/link";
import { Icon } from "@/components/Icon";
import { MeetingStateSelect } from "@/components/crm/MeetingState";
import { nOf, Owner } from "@/components/crm/bits";
import { useLeadSheets } from "@/components/crm/Sheets";
import { dayFull, fT, iso } from "@/lib/crm/dates";

export type MeetingRowData = { id: string; leadId: string | null; leadName: string; phoneRaw: string; projectName: string; subject: string; startAt: string; place: string; status: string; confirmed: boolean; setByName: string | null; hostName: string | null; canEdit: boolean };

export function NewMeetingButton() {
  const sheets = useLeadSheets();
  return (
    <button type="button" className="btn primary" onClick={() => sheets.newMeeting()}>
      <Icon name="plus" />
      פגישה חדשה
    </button>
  );
}

export function MeetingsList({ rows }: { rows: MeetingRowData[] }) {
  if (!rows.length)
    return (
      <div className="panel">
        <p className="empty">אין פגישות כאן.</p>
      </div>
    );
  const days: { key: string; date: Date; list: MeetingRowData[] }[] = [];
  for (const m of rows) {
    const d = new Date(m.startAt);
    const k = iso(d);
    let g = days.find((x) => x.key === k);
    if (!g) days.push((g = { key: k, date: d, list: [] }));
    g.list.push(m);
  }
  return (
    <div className="table-wrap">
      <table className="mtable">
        <thead>
          <tr>
            <th>שעה</th>
            <th>לקוח</th>
            <th>פרויקט</th>
            <th>מקום</th>
            <th>נקבעה ע״י</th>
            <th>נפגשים עם</th>
            <th>סטטוס</th>
          </tr>
        </thead>
        <tbody>
          {days.map((g) => [
            <tr key={g.key} className="grp">
              <td colSpan={7}>
                <div className="grp-h">
                  <span>{dayFull(g.date)}</span>
                  <small>{nOf(g.list.length, "פגישה אחת", "פגישות")}</small>
                </div>
              </td>
            </tr>,
            ...g.list.map((m) => (
              <tr key={m.id} className={m.hostName ? undefined : "no-host"}>
                <td className="c-time">{fT(new Date(m.startAt))}</td>
                <td className="c-lead">
                  {/* the meeting card: its own page, with the client one click further */}
                  <Link className="lk" href={`/meetings/${m.id}`}>
                    <b>{m.leadName}</b>
                    <small>{[m.projectName, m.subject && m.subject !== m.projectName ? m.subject : "", m.place].filter(Boolean).join(", ")}</small>
                  </Link>
                </td>
                <td className="c-proj">{m.projectName}</td>
                <td className="c-place">{m.place || <span className="muted">—</span>}</td>
                <td className="c-set">
                  <Owner name={m.setByName} />
                </td>
                <td className="c-host">
                  <Owner name={m.hostName} />
                </td>
                <td className="c-st">
                  <MeetingStateSelect m={m} disabled={!m.canEdit} />
                </td>
              </tr>
            )),
          ])}
        </tbody>
      </table>
    </div>
  );
}
