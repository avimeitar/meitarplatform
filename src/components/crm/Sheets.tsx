"use client";

import { useEffect, useMemo, useState } from "react";
import {
  bookMeetingAction,
  callbackAction,
  confirmMeetingAction,
  logWhatsAppAction,
  lostAction,
  meetingStatusAction,
  moveMeetingAction,
  noAnswerAction,
  searchLeadsAction,
  setLeadStatusAction,
} from "@/app/actions/leads";
import { Icon, type IconName } from "@/components/Icon";
import { useDrawer } from "@/components/ui/Overlays";
import { useRunner } from "@/components/ui/useRunner";
import type { ActionResult } from "@/lib/action";
import { OFFICE_ADDRESS, PLACES, REASONS } from "@/lib/crm/constants";
import { LATER, dayFull, fT, laterDate, laterLabel, meetDays, pad, slotsFor, sod, addDays, timeWarning, WD } from "@/lib/crm/dates";
import { firstName } from "./bits";

// Booking works on the device's own calendar days; the server reads day + time as Israel time.
const dayKey = (x: Date) => x.getFullYear() + "-" + pad(x.getMonth() + 1) + "-" + pad(x.getDate());
const sameLocal = (a: Date, b: Date) => dayKey(a) === dayKey(b);

export type SheetLead = { id: string; name: string; phoneRaw: string; projectName: string };
type Done = () => void;

function Opt({ icon, tone, title, sub, onClick, disabled }: { icon: IconName; tone?: "good" | "warn" | "bad"; title: string; sub: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" className={"opt " + (tone ?? "")} onClick={onClick} disabled={disabled}>
      <span className="oi">
        <Icon name={icon} />
      </span>
      <span>
        <b>{title}</b>
        <small>{sub}</small>
      </span>
    </button>
  );
}

function Back({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="sheet-back" onClick={onClick}>
      <Icon name="back" />
      חזרה
    </button>
  );
}

/** Runs the action; on success closes the sheet, toasts with undo, refreshes, then calls onDone. */
function useFinish(onDone?: Done) {
  const drawer = useDrawer();
  const runner = useRunner();
  const [busy, setBusy] = useState(false);
  async function finish(p: Promise<ActionResult<unknown>>) {
    if (busy) return;
    setBusy(true);
    const r = await runner(p);
    setBusy(false);
    if (r.ok) {
      drawer.close();
      onDone?.();
    }
  }
  return { finish, busy };
}

// ---------------------------------------------------------------- after a call

type Step = "1" | "meet" | "move" | "later" | "lost";

export function OutcomeSheet({ lead, meetingId, onDone }: { lead: SheetLead; meetingId?: string; onDone?: Done }) {
  const drawer = useDrawer();
  const [step, setStep] = useState<Step>("1");
  const { finish, busy } = useFinish(onDone);
  const fn = firstName(lead.name);

  useEffect(() => {
    const titles: Record<Step, string> = {
      "1": meetingId ? `מה התשובה של ${fn} לגבי הפגישה?` : `מה קרה בשיחה עם ${fn}?`,
      meet: `מתי הפגישה עם ${fn}?`,
      move: "מה המועד החדש לפגישה?",
      later: `מתי לחזור ל${fn}?`,
      lost: `למה הליד של ${fn} לא רלוונטי?`,
    };
    drawer.retitle(titles[step]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  if (step === "meet" || step === "move")
    return <BookingStep lead={lead} meetingId={step === "move" ? meetingId : undefined} direct={false} onBack={() => setStep("1")} onDone={onDone} />;

  if (step === "later")
    return (
      <div className="sheet-body">
        <Back onClick={() => setStep("1")} />
        <div className="opts">
          {LATER.map((k) => {
            const d = laterDate(k);
            return <Opt key={k} icon="clock" title={laterLabel(k)} sub={`${dayFull(d)} בשעה ${fT(d)}`} disabled={busy} onClick={() => finish(callbackAction(lead.id, k))} />;
          })}
        </div>
      </div>
    );

  if (step === "lost")
    return (
      <div className="sheet-body">
        <Back onClick={() => setStep("1")} />
        <div className="chips">
          {REASONS.map((r) => (
            <button key={r} type="button" disabled={busy} onClick={() => finish(lostAction(lead.id, r, true))}>
              {r}
            </button>
          ))}
        </div>
      </div>
    );

  if (meetingId)
    return (
      <div className="sheet-body">
        <div className="opts">
          <Opt icon="cc" tone="good" title="ההגעה אושרה" sub="הפגישה תסומן כמאושרת" disabled={busy} onClick={() => finish(confirmMeetingAction(meetingId, true))} />
          <Opt icon="cal" tone="warn" title="צריך לשנות מועד" sub="בוחרים יום ושעה חדשים" disabled={busy} onClick={() => setStep("move")} />
          <Opt icon="x" tone="bad" title="הפגישה מבוטלת" sub="הליד יעבור ל״לתאם מחדש״" disabled={busy} onClick={() => finish(meetingStatusAction(meetingId, "cancel"))} />
          <Opt icon="phone-x" tone="warn" title="אין מענה" sub="נזכיר לך לנסות שוב בעוד שעתיים" disabled={busy} onClick={() => finish(noAnswerAction(lead.id))} />
        </div>
      </div>
    );

  return (
    <div className="sheet-body">
      <div className="opts">
        <Opt icon="cal" tone="good" title="קבענו פגישה" sub="בוחרים יום ושעה" disabled={busy} onClick={() => setStep("meet")} />
        <Opt icon="clock" title="לחזור אחר כך" sub="בוחרים מתי" disabled={busy} onClick={() => setStep("later")} />
        <Opt icon="phone-x" tone="warn" title="אין מענה" sub="נזכיר לך לנסות שוב בעוד שעתיים" disabled={busy} onClick={() => finish(noAnswerAction(lead.id))} />
        <Opt icon="x" tone="bad" title="לא רלוונטי" sub="בוחרים סיבה" disabled={busy} onClick={() => setStep("lost")} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- booking a meeting

export function BookingStep({ lead, meetingId, direct, onBack, onDone }: { lead: SheetLead; meetingId?: string; direct: boolean; onBack?: () => void; onDone?: Done }) {
  const { finish, busy } = useFinish(onDone);
  const days = useMemo(() => meetDays(), []);
  const [day, setDay] = useState<string | null>(null);
  const [time, setTime] = useState<string | null>(null);
  const [other, setOther] = useState(false);
  const [place, setPlace] = useState(PLACES[0].value);
  const d = day ? days.find((x) => dayKey(x) === day) ?? null : null;
  const times = d ? slotsFor(d) : [];
  const warn = timeWarning(d, time);
  const ready = !!(d && time);
  const placeLabel = PLACES.find((p) => p.value === place)?.label ?? place;

  function save() {
    if (!d || !time) return;
    finish(meetingId ? moveMeetingAction(meetingId, dayKey(d), time) : bookMeetingAction(lead.id, dayKey(d), time, place, direct));
  }

  return (
    <div className="sheet-body">
      {onBack && <Back onClick={onBack} />}
      <p className="q">באיזה יום?</p>
      <div className="chips days">
        {days.map((x) => {
          const on = dayKey(x) === day;
          const today = sod(new Date());
          const rel = sameLocal(x, today) ? "היום" : sameLocal(x, addDays(today, 1)) ? "מחר" : "";
          return (
            <button key={dayKey(x)} type="button" className={on ? "on" : ""} aria-pressed={on} onClick={() => (setDay(dayKey(x)), setTime(null), setOther(false))}>
              <b>{rel || WD[x.getDay()]}</b>
              <small>{(rel ? WD[x.getDay()] + " " : "") + x.getDate() + "." + (x.getMonth() + 1)}</small>
            </button>
          );
        })}
      </div>
      {d && (
        <>
          <p className="q">באיזו שעה?</p>
          <div className="chips">
            {times.map((t) => (
              <button key={t} type="button" className={time === t && !other ? "on" : ""} aria-pressed={time === t && !other} onClick={() => (setTime(t), setOther(false))}>
                {t}
              </button>
            ))}
            <button type="button" className={other ? "on" : ""} aria-pressed={other} onClick={() => (setOther(true), setTime(null))}>
              שעה אחרת
            </button>
          </div>
          {other && (
            <label className="fld">
              <span>איזו שעה?</span>
              <input type="time" step={900} autoFocus value={time ?? ""} onChange={(e) => setTime(e.target.value || null)} />
            </label>
          )}
          {!times.length && !other && <p className="muted">אין יותר שעות פנויות ביום הזה. אפשר לבחור יום אחר או ״שעה אחרת״.</p>}
          {warn && (
            <p className="warn-line" role="alert">
              <Icon name="alert" />
              <span>{warn}</span>
            </p>
          )}
        </>
      )}
      {!meetingId && (
        <>
          <p className="q">איפה?</p>
          <div className="chips">
            {PLACES.map((p) => (
              <button key={p.value} type="button" className={place === p.value ? "on" : ""} aria-pressed={place === p.value} onClick={() => setPlace(p.value)}>
                {p.label}
              </button>
            ))}
          </div>
        </>
      )}
      <div className="sheet-foot">
        <button type="button" className="bigbtn call" disabled={!ready || busy} onClick={save}>
          <Icon name="cal" />
          <span>{ready && d ? `${meetingId ? "מועד חדש" : "לקבוע"}: ${(sameLocal(d, sod(new Date())) ? "היום, " : sameLocal(d, addDays(sod(new Date()), 1)) ? "מחר, " : "") + WD[d.getDay()] + " " + d.getDate() + "." + (d.getMonth() + 1)}, ${time}${meetingId ? "" : ", " + placeLabel}` : d ? "בוחרים שעה" : "בוחרים יום ושעה"}</span>
        </button>
      </div>
    </div>
  );
}

/** "+ פגישה חדשה" without a lead yet: first find the person, then book. */
export function NewMeetingSheet({ onDone }: { onDone?: Done }) {
  const drawer = useDrawer();
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<{ id: string; name: string; phone: string; projectName: string }[]>([]);
  const [lead, setLead] = useState<SheetLead | null>(null);
  const [state, setState] = useState<"idle" | "searching" | "failed">("idle");

  useEffect(() => {
    let live = true;
    setState("searching");
    const t = setTimeout(async () => {
      const r = await searchLeadsAction(q).catch(() => null);
      if (!live) return;
      if (r?.ok && r.data) {
        setRows(r.data);
        setState("idle");
      } else setState("failed");
    }, 200);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q]);

  useEffect(() => {
    drawer.retitle(lead ? `מתי הפגישה עם ${firstName(lead.name)}?` : "עם מי הפגישה?");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead]);

  if (lead) return <BookingStep lead={lead} direct onBack={() => setLead(null)} onDone={onDone} />;
  return (
    <div className="sheet-body">
      <label className="fld">
        <span>חיפוש לפי שם או טלפון</span>
        <input type="search" autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      {!q && rows.length > 0 && <p className="q">הלידים שלך</p>}
      <div className="opts">
        {rows.map((r) => (
          <Opt key={r.id} icon="users" title={r.name} sub={[r.projectName, "⁦" + r.phone + "⁩"].filter(Boolean).join(" · ")} onClick={() => setLead({ id: r.id, name: r.name, phoneRaw: "", projectName: r.projectName })} />
        ))}
      </div>
      {state === "searching" && <p className="muted" role="status">מחפשים…</p>}
      {state === "failed" && (
        <p className="form-error" role="alert">
          החיפוש לא הצליח. אפשר לבדוק את החיבור ולנסות שוב.
        </p>
      )}
      {state === "idle" && q && !rows.length && <p className="muted">לא מצאנו ליד בשם או בטלפון הזה.</p>}
    </div>
  );
}

// ---------------------------------------------------------------- WhatsApp

export function waLink(phoneRaw: string, text: string): string {
  return `https://wa.me/${phoneRaw.replace(/\D/g, "")}?text=${encodeURIComponent(text)}`;
}

export function readyMessages(lead: SheetLead): [string, string][] {
  const fn = firstName(lead.name);
  const p = lead.projectName || "הפרויקט";
  return [
    [`פרטים על ${p}`, `היי ${fn}, כאן מקבוצת מיתר. שולחים לך את כל הפרטים על ${p}. נשמח לענות על כל שאלה.`],
    ["ניסינו להשיג אותך", `היי ${fn}, ניסינו להשיג אותך בקשר ל${p}. מתי נוח לך שנחזור?`],
    ["מיקום המשרד", OFFICE_ADDRESS],
  ];
}

/** Opens the person's own WhatsApp with the text ready, and records it on the lead. */
export function WaSheet({ lead, onDone }: { lead: SheetLead; onDone?: Done }) {
  const drawer = useDrawer();
  const runner = useRunner();
  return (
    <div className="sheet-body">
      <p className="muted">ההודעה תיפתח בוואטסאפ שלך, מוכנה לשליחה. שם לוחצים ״שליחה״.</p>
      <div className="opts">
        {readyMessages(lead).map(([title, text]) => (
          <a
            key={title}
            className="opt good"
            href={waLink(lead.phoneRaw, text)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => {
              runner(logWhatsAppAction(lead.id, text));
              drawer.close();
              onDone?.();
            }}
          >
            <span className="oi">
              <Icon name="wa" />
            </span>
            <span>
              <b>{title}</b>
              <small>{text}</small>
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- confirmations

export function WonConfirm({ lead }: { lead: SheetLead }) {
  const { finish, busy } = useFinish();
  const drawer = useDrawer();
  return (
    <div className="sheet-body">
      <p className="confirm-q">
        {lead.name}
        {lead.projectName ? `, ${lead.projectName}` : ""}
      </p>
      <p className="muted">הליד יעבור ל״נחתמה עסקה״ ויופיע בעסקאות הסגורות של הפרויקט.</p>
      <button type="button" className="bigbtn call" disabled={busy} onClick={() => finish(setLeadStatusAction(lead.id, "won"))}>
        <Icon name="check" />
        כן, נחתמה עסקה
      </button>
      <button type="button" className="bigbtn light" onClick={drawer.close}>
        עוד לא
      </button>
    </div>
  );
}

/** One place to open the sheets from any screen. */
export function useLeadSheets() {
  const drawer = useDrawer();
  return {
    afterCall: (lead: SheetLead, opts: { meetingId?: string; onDone?: Done } = {}) =>
      drawer.open({ title: opts.meetingId ? `מה התשובה של ${firstName(lead.name)} לגבי הפגישה?` : `מה קרה בשיחה עם ${firstName(lead.name)}?`, content: <OutcomeSheet lead={lead} meetingId={opts.meetingId} onDone={opts.onDone} />, sheet: true }),
    book: (lead: SheetLead, opts: { meetingId?: string; onDone?: Done } = {}) =>
      drawer.open({ title: opts.meetingId ? "מה המועד החדש לפגישה?" : `מתי הפגישה עם ${firstName(lead.name)}?`, content: <BookingStep lead={lead} meetingId={opts.meetingId} direct onDone={opts.onDone} />, sheet: true }),
    newMeeting: () => drawer.open({ title: "עם מי הפגישה?", content: <NewMeetingSheet />, sheet: true }),
    wa: (lead: SheetLead, onDone?: Done) => drawer.open({ title: `איזו הודעה לשלוח ל${firstName(lead.name)}?`, content: <WaSheet lead={lead} onDone={onDone} />, sheet: true }),
    won: (lead: SheetLead) => drawer.open({ title: "לסמן שנחתמה עסקה?", content: <WonConfirm lead={lead} />, sheet: true }),
  };
}
