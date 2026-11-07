"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { confirmMeetingAction, meetingStatusAction } from "@/app/actions/leads";
import { Icon, type IconName } from "@/components/Icon";
import { useLeadSheets } from "@/components/crm/Sheets";
import { useDrawer } from "@/components/ui/Overlays";
import { useRunner } from "@/components/ui/useRunner";
import { MS, type MeetingStatus } from "@/lib/crm/constants";
import { dayFull, fT, iso, pad, wall, WD } from "@/lib/crm/dates";

export type CalMeeting = {
  id: string;
  leadId: string | null;
  name: string;
  startAt: string;
  place: string;
  status: string;
  confirmed: boolean;
  projectName: string;
  subject: string;
  setByName: string | null;
  hostName: string | null;
  /** who the meeting is with on our side: host, else whoever set it, else the rep's name from Fireberry */
  person: string;
  source: string;
  note: string;
  canEdit: boolean;
  phoneRaw: string;
};

export type CalendarProps = {
  mode: "day" | "week" | "month";
  /** the days shown, as Israel dates "2026-11-08"; for a month, every cell of the grid */
  days: string[];
  /** month view: "2026-11", to mute the days of the months around it */
  month?: string;
  todayKey: string;
  meetings: CalMeeting[];
  startHour: number;
  endHour: number;
  /** a day of the whole team: one column per person */
  byPerson: boolean;
  canCreate: boolean;
  dayHref: Record<string, string>;
};

/** pixels per hour: a day has room for more detail in each meeting */
const hourPx = (mode: CalendarProps["mode"]) => (mode === "day" ? 76 : 56);
/** a meeting fills an hour on the calendar */
const LENGTH = 60;

const minutes = (m: CalMeeting) => {
  const w = wall(new Date(m.startAt));
  return w.getHours() * 60 + w.getMinutes();
};
const keyOf = (m: CalMeeting) => iso(new Date(m.startAt));
const parseKey = (k: string) => {
  const [y, mo, d] = k.split("-").map(Number);
  return new Date(y, mo - 1, d);
};

type Placed = { m: CalMeeting; top: number; lane: number; lanes: number };

/** Meetings that overlap sit side by side; each group gets as many lanes as it needs. */
function place(list: CalMeeting[], startHour: number, px: number): Placed[] {
  const items = list.map((m) => ({ m, s: minutes(m), e: minutes(m) + LENGTH, lane: 0, lanes: 1 })).sort((a, b) => a.s - b.s || a.m.name.localeCompare(b.m.name, "he"));
  const out: Placed[] = [];
  let group: typeof items = [];
  let groupEnd = -1;
  const flush = () => {
    const ends: number[] = [];
    for (const it of group) {
      let i = ends.findIndex((end) => end <= it.s);
      if (i < 0) {
        i = ends.length;
        ends.push(it.e);
      } else ends[i] = it.e;
      it.lane = i;
    }
    for (const it of group) out.push({ m: it.m, top: (it.s - startHour * 60) * px, lane: it.lane, lanes: ends.length });
    group = [];
  };
  for (const it of items) {
    if (group.length && it.s >= groupEnd) flush();
    group.push(it);
    groupEnd = Math.max(groupEnd, it.e);
  }
  if (group.length) flush();
  return out;
}

function describe(m: CalMeeting): string {
  const parts = [fT(new Date(m.startAt)), m.name, m.projectName || m.subject, m.place, m.person, MS[m.status as MeetingStatus]?.l ?? m.status];
  if (m.status === "set") parts.push(m.confirmed ? "הגעה אושרה" : "הגעה לא אושרה");
  return parts.filter(Boolean).join(", ");
}

function stale(m: CalMeeting, now: number) {
  return m.status === "set" && new Date(m.startAt).getTime() < now;
}

export function MeetingsCalendar(p: CalendarProps) {
  const drawer = useDrawer();
  const sheets = useLeadSheets();
  const [now, setNow] = useState<number | null>(null);
  // the time is only known in the browser: the "now" line and past slots wait for it
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const byDay = useMemo(() => {
    const map = new Map<string, CalMeeting[]>();
    for (const m of p.meetings) {
      const k = keyOf(m);
      map.set(k, [...(map.get(k) ?? []), m]);
    }
    return map;
  }, [p.meetings]);

  function open(m: CalMeeting) {
    drawer.open({ title: m.name, content: <MeetingDetails m={m} />, sheet: true });
  }

  /** a tap on a free spot books a meeting there, on the half hour */
  function book(e: React.MouseEvent<HTMLDivElement>, day: string) {
    if (!p.canCreate || (e.target as HTMLElement).closest(".ev")) return;
    const y = e.clientY - e.currentTarget.getBoundingClientRect().top;
    const mins = p.startHour * 60 + Math.floor(y / (hourPx(p.mode) / 60) / 30) * 30;
    const when = parseKey(day);
    when.setHours(Math.floor(mins / 60), mins % 60);
    if (when.getDay() === 6 || when.getTime() < Date.now()) return;
    sheets.newMeeting({ day, time: pad(Math.floor(mins / 60)) + ":" + pad(mins % 60) });
  }

  if (p.mode === "month") return <MonthGrid {...p} byDay={byDay} open={open} />;

  // the columns: days, or (a team's day) the people meeting clients that day
  const day0 = p.days[0];
  const columns: { key: string; title: string; sub: string; day: string; list: CalMeeting[] }[] = p.byPerson
    ? [...new Set((byDay.get(day0) ?? []).map((m) => m.person))]
        .map((person) => ({ person, list: (byDay.get(day0) ?? []).filter((m) => m.person === person) }))
        .sort((a, b) => b.list.length - a.list.length || a.person.localeCompare(b.person, "he"))
        .map(({ person, list }) => ({ key: person, title: person, sub: list.length === 1 ? "פגישה אחת" : `${list.length} פגישות`, day: day0, list }))
    : p.days.map((k) => {
        const d = parseKey(k);
        const list = byDay.get(k) ?? [];
        return { key: k, title: WD[d.getDay()], sub: `${d.getDate()}.${d.getMonth() + 1}`, day: k, list };
      });

  return (
    <TimeGrid
      {...p}
      columns={columns}
      now={now}
      open={open}
      book={book}
      empty={p.byPerson ? false : p.mode === "day" && !(byDay.get(day0) ?? []).length}
    />
  );
}

function TimeGrid({
  mode,
  startHour,
  endHour,
  todayKey,
  columns,
  now,
  open,
  book,
  canCreate,
  dayHref,
  byPerson,
  empty,
}: CalendarProps & {
  columns: { key: string; title: string; sub: string; day: string; list: CalMeeting[] }[];
  now: number | null;
  open: (m: CalMeeting) => void;
  book: (e: React.MouseEvent<HTMLDivElement>, day: string) => void;
  empty: boolean;
}) {
  const hours = Array.from({ length: endHour - startHour }, (_, i) => startHour + i);
  const HOUR_PX = hourPx(mode);
  const PX = HOUR_PX / 60;
  const height = hours.length * HOUR_PX;
  // on a phone the week shows one day at a time: today, or the first day with meetings
  const initial = columns.find((c) => c.day === todayKey)?.key ?? columns.find((c) => c.list.length)?.key ?? columns[0]?.key;
  const [sel, setSel] = useState(initial);
  useEffect(() => setSel(initial), [initial]);
  const strip = mode === "week" && !byPerson;
  const wrap = useRef<HTMLDivElement>(null);

  const nowTop = (() => {
    if (now === null) return null;
    const w = wall(new Date(now));
    const t = (w.getHours() * 60 + w.getMinutes() - startHour * 60) * PX;
    return t >= 0 && t <= height ? t : null;
  })();
  const showsToday = columns.some((c) => c.day === todayKey);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const fit = () => {
      if (window.innerWidth <= 760) return void (el.style.maxHeight = "");
      // measured from the top of the page, so it fits the screen when the page is at the top
      const top = el.getBoundingClientRect().top + window.scrollY;
      el.style.maxHeight = Math.max(420, window.innerHeight - top - 16) + "px";
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);
  // on a computer the hours scroll inside the calendar: start a little before now
  const scrolled = useRef(false);
  useEffect(() => {
    const el = wrap.current;
    if (!el || scrolled.current || nowTop === null || !showsToday) return;
    scrolled.current = true;
    if (el.scrollHeight > el.clientHeight && nowTop > el.clientHeight - 120) el.scrollTop = nowTop - 120;
  }, [nowTop, showsToday]);

  return (
    <div className={"cal cal-" + mode + (byPerson ? " by-person" : "")}>
      {strip && (
        <div className="cal-strip" role="tablist" aria-label="יום בשבוע">
          {columns.map((c) => (
            <button key={c.key} type="button" role="tab" aria-selected={c.key === sel} className={(c.key === sel ? "on" : "") + (c.day === todayKey ? " today" : "")} onClick={() => setSel(c.key)}>
              <b>{c.day === todayKey ? "היום" : c.title}</b>
              <small>{c.sub}</small>
              {c.list.length ? <em>{c.list.length}</em> : null}
            </button>
          ))}
        </div>
      )}
      <div className="cal-wrap" ref={wrap}>
        <div className="cal-grid" style={{ ["--cols" as string]: columns.length || 1 }}>
          <div className="cal-h corner" aria-hidden="true" />
          {columns.map((c) => (
            <div key={c.key} className={"cal-h" + (c.day === todayKey && !byPerson ? " today" : "") + (c.key === sel ? " sel" : "")}>
              {byPerson ? (
                <>
                  <b>{c.title}</b>
                  <small>{c.sub}</small>
                </>
              ) : (
                <Link href={dayHref[c.day] ?? "#"} className="cal-hlink" aria-label={`${c.title} ${c.sub}, תצוגת יום`}>
                  <b>{c.title}</b>
                  <small>{c.sub}</small>
                  {mode === "week" && c.list.length ? <em>{c.list.length}</em> : null}
                </Link>
              )}
            </div>
          ))}
          <div className="cal-hours" style={{ height }} aria-hidden="true">
            {hours.map((h) => (
              <span key={h} style={{ height: HOUR_PX }}>
                {pad(h)}:00
              </span>
            ))}
          </div>
          {columns.map((c) => (
            <div
              key={c.key}
              className={"cal-col" + (c.day === todayKey && !byPerson ? " today" : "") + (c.key === sel ? " sel" : "") + (canCreate ? " can" : "")}
              style={{ height, ["--hour" as string]: HOUR_PX + "px" }}
              onClick={(e) => book(e, c.day)}
            >
              {place(c.list, startHour, PX).map(({ m, top, lane, lanes }) => (
                <button
                  key={m.id}
                  type="button"
                  className={"ev " + (MS[m.status as MeetingStatus]?.c ?? "") + (m.confirmed && m.status === "set" ? " ok" : "") + (now !== null && stale(m, now) ? " stale" : "")}
                  style={{
                    top: Math.max(0, top),
                    height: LENGTH * PX - 3,
                    insetInlineStart: `calc(${lane} * (100% - 6px) / ${lanes} + 3px)`,
                    width: `calc((100% - 6px) / ${lanes} - 2px)`,
                  }}
                  title={describe(m)}
                  aria-label={describe(m)}
                  onClick={() => open(m)}
                >
                  <b>
                    {m.confirmed && m.status === "set" ? <Icon name="cc" className="ev-ok" /> : null}
                    {lanes < 3 && <span className="ev-t">{fT(new Date(m.startAt))} </span>}
                    {m.name}
                  </b>
                  <span>{[m.projectName || m.subject, mode === "day" || lanes === 1 ? m.place : ""].filter(Boolean).join(" · ")}</span>
                  {(mode === "day" && !byPerson) || lanes === 1 ? <span className="ev-p">{m.person}</span> : null}
                </button>
              ))}
              {c.day === todayKey && nowTop !== null && <div className="cal-now" style={{ top: nowTop }} aria-hidden="true" />}
            </div>
          ))}
        </div>
      </div>
      {empty && <p className="cal-empty">אין פגישות ביום הזה.{canCreate ? " לחיצה על שעה ביומן קובעת בה פגישה." : ""}</p>}
    </div>
  );
}

function MonthGrid({ days, month, todayKey, byDay, open, dayHref }: CalendarProps & { byDay: Map<string, CalMeeting[]>; open: (m: CalMeeting) => void }) {
  return (
    <div className="cal-wrap">
      <div className="cal-month">
        {WD.map((w) => (
          <div key={w} className="mh">
            {w}
          </div>
        ))}
        {days.map((k) => {
          const d = parseKey(k);
          const list = (byDay.get(k) ?? []).sort((a, b) => minutes(a) - minutes(b));
          const out = month && k.slice(0, 7) !== month;
          return (
            <div key={k} className={"mcell" + (k === todayKey ? " today" : "") + (out ? " out" : "") + (d.getDay() === 6 ? " sat" : "")}>
              <Link className="mnum" href={dayHref[k] ?? "#"} aria-label={`${WD[d.getDay()]} ${d.getDate()}.${d.getMonth() + 1}, ${list.length ? `${list.length} פגישות` : "אין פגישות"}`}>
                <span>{d.getDate()}</span>
                {list.length ? <em>{list.length}</em> : null}
              </Link>
              <div className="mlist">
                {list.slice(0, 3).map((m) => (
                  <button key={m.id} type="button" className={"mev " + (MS[m.status as MeetingStatus]?.c ?? "")} title={describe(m)} aria-label={describe(m)} onClick={() => open(m)}>
                    <span className="ev-t">{fT(new Date(m.startAt))}</span> {m.name}
                  </button>
                ))}
                {list.length > 3 && (
                  <Link className="mmore" href={dayHref[k] ?? "#"}>
                    ועוד {list.length - 3}
                  </Link>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Everything about one meeting, and what can be done with it, without leaving the calendar. */
function MeetingDetails({ m }: { m: CalMeeting }) {
  const runner = useRunner();
  const drawer = useDrawer();
  const sheets = useLeadSheets();
  const [busy, setBusy] = useState(false);
  const d = new Date(m.startAt);
  const past = d.getTime() < Date.now();
  async function act(p: ReturnType<typeof meetingStatusAction>) {
    if (busy) return;
    setBusy(true);
    const r = await runner(p);
    setBusy(false);
    if (r.ok) drawer.close();
  }
  const rows: [string, string][] = [
    ["מתי", `${dayFull(d)} בשעה ${fT(d)}`],
    ["איפה", m.place || "לא צוין"],
    ["פרויקט", m.projectName || "לא צוין"],
    ...(m.subject && m.subject !== m.projectName ? ([["נושא", m.subject]] as [string, string][]) : []),
    ["נקבעה ע״י", m.setByName ?? "לא ידוע"],
    ["נפגשים עם", m.hostName ?? (m.person !== m.setByName ? m.person : "לא שויך")],
    ...(m.source ? ([["מקור הגעה", m.source]] as [string, string][]) : []),
    ...(m.note ? ([["הערה", m.note]] as [string, string][]) : []),
  ];
  return (
    <div className="sheet-body mdetail">
      <p className={"md-status " + (MS[m.status as MeetingStatus]?.c ?? "")}>
        <Icon name={(MS[m.status as MeetingStatus]?.icon ?? "cal") as IconName} />
        {MS[m.status as MeetingStatus]?.l ?? m.status}
        {m.status === "set" ? (m.confirmed ? ". ההגעה אושרה" : past ? ". עוד לא סומן מה קרה" : ". ההגעה עוד לא אושרה") : ""}
      </p>
      <dl className="kv md-kv">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {m.canEdit && (
        <>
          <p className="q">{past ? "מה קרה בפגישה?" : "עדכון הפגישה"}</p>
          <div className="mseg big" role="group" aria-label="סטטוס הפגישה">
            {(["set", "cancel", "held"] as MeetingStatus[]).map((s) => {
              const on = m.status === s;
              return (
                <button key={s} type="button" className={on ? "on " + MS[s].c : ""} aria-pressed={on} disabled={busy} onClick={() => !on && act(meetingStatusAction(m.id, s))}>
                  <Icon name={MS[s].icon as IconName} />
                  {MS[s].l}
                </button>
              );
            })}
          </div>
          <div className="md-acts">
            {m.status === "set" && !past && (
              <button type="button" className={"cfm" + (m.confirmed ? " on" : "")} aria-pressed={m.confirmed} disabled={busy} onClick={() => act(confirmMeetingAction(m.id, !m.confirmed))}>
                <Icon name="cc" />
                {m.confirmed ? "הגעה אושרה" : "לאשר הגעה"}
              </button>
            )}
            <button type="button" className="btn" disabled={busy} onClick={() => sheets.book({ id: m.leadId ?? "", name: m.name, phoneRaw: m.phoneRaw, projectName: m.projectName }, { meetingId: m.id })}>
              <Icon name="cal" />
              שינוי מועד
            </button>
          </div>
        </>
      )}
      {m.leadId && (
        <Link className="btn full" href={`/leads/${m.leadId}`} onClick={() => drawer.close()}>
          לכרטיס הליד
        </Link>
      )}
    </div>
  );
}
