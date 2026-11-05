"use client";

import { confirmMeetingAction, meetingStatusAction } from "@/app/actions/leads";
import { Icon, type IconName } from "@/components/Icon";
import { LeadLink, nOf, Owner } from "@/components/crm/bits";
import { useLeadSheets } from "@/components/crm/Sheets";
import { useRunner } from "@/components/ui/useRunner";
import { MS, type MeetingStatus } from "@/lib/crm/constants";
import { dayFull, fT, iso } from "@/lib/crm/dates";

export type MeetingRowData = { id: string; leadId: string; leadName: string; phoneRaw: string; projectName: string; startAt: string; place: string; status: string; confirmed: boolean; setByName: string | null; hostName: string | null; canEdit: boolean };

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
  const runner = useRunner();
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
            <th>ליד</th>
            <th>פרויקט</th>
            <th>מקום</th>
            <th>מי קבע</th>
            <th>מי נפגש</th>
            <th>סטטוס</th>
            <th>אישור הגעה</th>
          </tr>
        </thead>
        <tbody>
          {days.map((g) => [
            <tr key={g.key} className="grp">
              <td colSpan={8}>
                <div className="grp-h">
                  <span>{dayFull(g.date)}</span>
                  <small>{nOf(g.list.length, "פגישה אחת", "פגישות")}</small>
                </div>
              </td>
            </tr>,
            ...g.list.map((m) => (
              <tr key={m.id}>
                <td className="c-time">{fT(new Date(m.startAt))}</td>
                <td className="c-lead">
                  <LeadLink id={m.leadId} name={m.leadName} sub={[m.projectName, m.place].filter(Boolean).join(", ")} />
                </td>
                <td className="c-proj">{m.projectName}</td>
                <td className="c-place">{m.place}</td>
                <td className="c-set">
                  <Owner name={m.setByName} />
                </td>
                <td className="c-host">
                  <Owner name={m.hostName} />
                </td>
                <td className="c-st">
                  <div className="mseg" role="group" aria-label="סטטוס הפגישה">
                    {(["set", "cancel", "held"] as MeetingStatus[]).map((s) => {
                      const on = m.status === s;
                      return (
                        <button key={s} type="button" className={on ? "on " + MS[s].c : ""} aria-pressed={on} disabled={!m.canEdit} onClick={() => !on && runner(meetingStatusAction(m.id, s))}>
                          <Icon name={MS[s].icon as IconName} />
                          {MS[s].l}
                        </button>
                      );
                    })}
                  </div>
                </td>
                <td className="c-st">
                  {m.status === "set" && (
                    <button type="button" className={"cfm" + (m.confirmed ? " on" : "")} aria-pressed={m.confirmed} disabled={!m.canEdit} onClick={() => runner(confirmMeetingAction(m.id, !m.confirmed))}>
                      <Icon name="cc" />
                      {m.confirmed ? "הגעה אושרה" : "לאשר הגעה"}
                    </button>
                  )}
                </td>
              </tr>
            )),
          ])}
        </tbody>
      </table>
    </div>
  );
}
