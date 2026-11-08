"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { correctAction, correctionOptionsAction, removeDeviceAction, setupFinishAction, setupOptionsAction } from "@/app/actions/hours";
import { Icon } from "@/components/Icon";
import { useClockSheet, useNow } from "@/components/hours/ShiftButton";
import { onPhone, registerNow, signNow, usePrepared, type AuthOptions } from "@/components/hours/sign";
import { useDrawer, useToast } from "@/components/ui/Overlays";
import { useRunner } from "@/components/ui/useRunner";
import type { TeamRow } from "@/lib/hours";

export type ShiftRow = {
  id: string;
  day: string;
  dayLabel: string;
  start: string;
  end: string | null;
  endNextDay: boolean;
  minutes: number;
  startKind: string;
  endKind: string | null;
  missingExit: boolean;
  open: boolean;
  edits: { by: string; reason: string; at: string; signed: boolean; added: boolean }[];
  canEdit: boolean;
};

type Me = {
  tracked: boolean;
  name: string;
  openSince: string | null;
  missing: { shiftId: string; day: string; start: string; canEdit: boolean } | null;
  hasDevice: boolean;
  devices: { id: string; name: string; createdAt: string; lastUsedAt: string | null }[];
};

type Preset = { shiftId: string; day: string; start: string };

const hhmm = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
const shortDate = (s: string) => {
  const d = new Date(s);
  return `${d.getDate()}.${d.getMonth() + 1}.${String(d.getFullYear()).slice(2)}`;
};
const WD = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
const dayLabel = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return `${WD[new Date(y, m - 1, d).getDay()]} ${d}.${m}`;
};
/** "ביום שני 3.11", "בשבת 8.11" */
const onDay = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  const wd = new Date(y, m - 1, d).getDay();
  return `${wd === 6 ? "בשבת" : "ביום " + WD[wd]} ${d}.${m}`;
};

export function HoursScreen(p: {
  me: Me;
  month: { key: string; label: string; prev: string; next: string | null; current: string };
  viewing: { id: string; name: string; self: boolean } | null;
  rows: ShiftRow[];
  totalMinutes: number;
  days: number;
  team: TeamRow[] | null;
  manager: boolean;
  editFrom: string;
  today: string;
}) {
  const drawer = useDrawer();
  const monthHref = (m: string) => `/hours?${new URLSearchParams({ month: m, ...(p.viewing && !p.viewing.self ? { user: p.viewing.id } : {}) })}`;
  const self = !!p.viewing?.self;
  function correct(row?: ShiftRow, preset?: Preset) {
    // the person's own missing exit (from the card above) is always their own
    const mine = preset ? true : self;
    const fill = preset ?? (row?.missingExit ? { shiftId: row.id, day: row.day, start: row.start } : undefined);
    drawer.open({
      title: fill ? "השלמת שעת יציאה" : row ? "תיקון שעות" : "הוספת משמרת שנשכחה",
      content: <CorrectionForm row={row} preset={fill} self={mine} userId={p.viewing?.id ?? ""} editFrom={mine ? p.editFrom : undefined} today={p.today} />,
      sheet: true,
    });
  }
  return (
    <section className="hours-page">
      <div className="page-head">
        <div>
          <h1>שעות עבודה</h1>
          <p className="sub">כל כניסה ויציאה ממשמרת נחתמת בטלפון האישי. השעה נרשמת לפי השעון של המערכת.</p>
        </div>
        {p.manager && (
          <div className="head-actions">
            <a className="btn" href={`/api/export/hours?month=${p.month.key}`}>
              <Icon name="upload" />
              ייצוא החודש לשכר
            </a>
          </div>
        )}
      </div>

      {p.me.tracked && <MyShift me={p.me} onFixMissing={() => p.me.missing && correct(undefined, p.me.missing)} />}

      <div className="cal-nav hours-month">
        <Link className="ib" href={monthHref(p.month.prev)} aria-label="החודש הקודם">
          <Icon name="chev-r" />
        </Link>
        {p.month.next ? (
          <Link className="ib" href={monthHref(p.month.next)} aria-label="החודש הבא">
            <Icon name="chev-l" />
          </Link>
        ) : (
          <span className="ib" aria-hidden="true" />
        )}
        <h2 className="cal-title">{p.month.label}</h2>
        {p.month.key !== p.month.current && (
          <Link className="btn sm" href={monthHref(p.month.current)}>
            לחודש הנוכחי
          </Link>
        )}
      </div>

      {p.team && <TeamTable team={p.team} month={p.month.key} viewingId={p.viewing && !p.viewing.self ? p.viewing.id : null} />}

      {p.viewing && (
        <div className="panel hours-panel" id="shifts">
          <div className="panel-head">
            <h2>{p.viewing.self ? "המשמרות שלי" : `המשמרות של ${p.viewing.name}`}</h2>
            <span className="muted">
              {p.days === 1 ? "יום עבודה אחד" : `${p.days} ימי עבודה`}, <b className="num">{hhmm(p.totalMinutes)}</b> שעות
            </span>
          </div>
          <ShiftTable rows={p.rows} onEdit={(r) => correct(r)} />
          {(p.viewing.self || p.manager) && (
            <div className="row-end">
              <span className="muted">{p.viewing.self ? "אפשר לתקן או להוסיף משמרת עד 7 ימים אחורה, עם סיבה וחתימה. כל תיקון נשמר ומופיע להנהלה." : "התיקון נשמר עם השם שלך והסיבה."}</span>
              <button type="button" className="btn" onClick={() => correct()}>
                <Icon name="plus" />
                הוספת משמרת שנשכחה
              </button>
            </div>
          )}
        </div>
      )}

      {p.me.tracked && p.me.hasDevice && <MyPhones devices={p.me.devices} />}
    </section>
  );
}

/** The one-time setup on the phone. The options are fetched ahead, so the tap opens the phone's prompt at once. */
function SetupButton({ label }: { label: string }) {
  const runner = useRunner();
  const toast = useToast();
  const { state, reload } = usePrepared("register", () => setupOptionsAction());
  const [busy, setBusy] = useState(false);
  const ready = !!state?.ok && !!state.data;
  async function go() {
    if (busy || !state?.ok || !state.data) return;
    setBusy(true);
    const s = await registerNow(state.data);
    if (!s.ok) {
      setBusy(false);
      toast(s.error, { error: true });
      void reload();
      return;
    }
    const r = await runner(setupFinishAction(s.response));
    setBusy(false);
    if (!r.ok) void reload();
  }
  if (state && !state.ok)
    return (
      <p className="form-error" role="alert">
        {state.error}
      </p>
    );
  return (
    <button type="button" className="bigbtn call" disabled={!ready || busy} onClick={go}>
      <Icon name="lock" />
      {!ready ? "מכינים את ההגדרה…" : busy ? "מחכים לאישור בטלפון…" : label}
    </button>
  );
}

function usePhone() {
  const [phone, setPhone] = useState<boolean | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setPhone(onPhone()), 0);
    return () => clearTimeout(t);
  }, []);
  return phone;
}

/** The shift right now: set up the signature, or sign in and out. */
function MyShift({ me, onFixMissing }: { me: Me; onFixMissing: () => void }) {
  const openClock = useClockSheet();
  const phone = usePhone();
  const now = useNow();

  if (!me.hasDevice)
    return (
      <div className="panel hours-now setup">
        <div className="hn-text">
          <h2>הגדרת חתימה, פעם אחת</h2>
          <p>כדי שהשעות יהיו רשמיות לשכר, כל כניסה ויציאה ממשמרת נחתמת בטלפון האישי שלך. מגדירים פעם אחת: לוחצים על הכפתור ומאשרים עם טביעת אצבע, זיהוי פנים או קוד הנעילה של הטלפון.</p>
        </div>
        {phone === true && <SetupButton label="הגדרת חתימה בטלפון הזה" />}
        {phone === false && <p className="login-hint">את ההגדרה עושים בטלפון: נכנסים למערכת מהטלפון, פותחים ״שעות עבודה״ בתפריט ולוחצים שם על ״הגדרת חתימה בטלפון הזה״.</p>}
      </div>
    );

  if (me.missing)
    return (
      <div className="panel hours-now warn">
        <div className="hn-text">
          <h2>חסרה שעת יציאה</h2>
          <p>
            המשמרת שהתחילה {onDay(me.missing.day)} בשעה <span className="num">{me.missing.start}</span> לא נסגרה.{" "}
            {me.missing.canEdit ? "משלימים את שעת היציאה, עם סיבה וחתימה, ואז אפשר להיכנס למשמרת חדשה." : "עברו יותר מ-7 ימים, ולכן את שעת היציאה משלימים דרך ההנהלה."}
          </p>
        </div>
        {me.missing.canEdit && (
          <button type="button" className="bigbtn call" onClick={onFixMissing}>
            <Icon name="clock" />
            השלמת שעת יציאה
          </button>
        )}
      </div>
    );

  if (me.openSince) {
    const since = me.openSince;
    const mins = now !== null ? Math.max(0, Math.round((now - new Date(since).getTime()) / 60_000)) : null;
    return (
      <div className="panel hours-now on">
        <div className="hn-text">
          <h2>
            <span className="sb-dot" aria-hidden="true" />
            במשמרת מ-<span className="num">{new Date(since).toTimeString().slice(0, 5)}</span>
          </h2>
          <p className="hours-clock">
            <span className="num">{mins !== null ? hhmm(mins) : "—"}</span> שעות
          </p>
        </div>
        <button type="button" className="bigbtn clock-out" onClick={() => openClock("out", since)}>
          <Icon name="out" />
          יציאה מהמשמרת
        </button>
      </div>
    );
  }

  return (
    <div className="panel hours-now">
      <div className="hn-text">
        <h2>לא במשמרת</h2>
        <p className="muted">בתחילת המשמרת לוחצים כאן, או על ״כניסה למשמרת״ בראש המסך, ומאשרים בטלפון.</p>
      </div>
      <button type="button" className="bigbtn call" onClick={() => openClock("in")}>
        <Icon name="in" />
        כניסה למשמרת
      </button>
    </div>
  );
}

function kindOf(r: ShiftRow): { label: string; cls: string } {
  if (r.edits.some((e) => !e.added)) return { label: "תוקן", cls: "k-edited" };
  if (r.startKind === "manual" || r.endKind === "manual") return { label: "ידני", cls: "k-manual" };
  return { label: "חתום", cls: "k-signed" };
}

function ShiftTable({ rows, onEdit }: { rows: ShiftRow[]; onEdit: (r: ShiftRow) => void }) {
  if (!rows.length) return <p className="empty hours-empty">אין משמרות בחודש הזה.</p>;
  return (
    <div className="tscroll">
      <table className="data hours-table">
        <thead>
          <tr>
            <th>יום</th>
            <th>כניסה</th>
            <th>יציאה</th>
            <th className="num">שעות</th>
            <th>רישום</th>
            <th>
              <span className="sr">פעולה</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const k = kindOf(r);
            return (
              <tr key={r.id} className={r.missingExit ? "missing" : ""}>
                <td className="c-day">{r.dayLabel}</td>
                <td className="c-in">
                  <span className="m-lbl">כניסה </span>
                  <span className="num">{r.start}</span>
                </td>
                <td className="c-out">
                  <span className="m-lbl">יציאה </span>
                  {r.end ? (
                    <>
                      <span className="num">{r.end}</span>
                      {r.endNextDay && <span className="muted"> (למחרת)</span>}
                    </>
                  ) : r.open ? (
                    <span className="muted">במשמרת</span>
                  ) : (
                    <b className="warn-text">חסרה</b>
                  )}
                </td>
                <td className="c-hrs num">{r.end ? hhmm(r.minutes) : "—"}</td>
                <td className="c-kind">
                  <span className={"kind " + k.cls}>
                    {k.cls === "k-signed" && <Icon name="checks" />}
                    {k.label}
                  </span>
                  {r.edits.map((e, i) => (
                    <small key={i} className="edit-note">
                      {e.added ? "נוספה" : "תוקנה"} על ידי {e.by}, {shortDate(e.at)}
                      {e.signed ? " בחתימה" : ""}: {e.reason}
                    </small>
                  ))}
                </td>
                <td className="c-act">
                  {r.canEdit && (
                    <button type="button" className="btn sm" onClick={() => onEdit(r)}>
                      {r.missingExit ? "השלמה" : "תיקון"}
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TeamTable({ team, month, viewingId }: { team: TeamRow[]; month: string; viewingId: string | null }) {
  return (
    <div className="panel hours-panel">
      <div className="panel-head">
        <h2>הצוות בחודש הזה</h2>
        <span className="muted">לחיצה על שם פותחת את המשמרות</span>
      </div>
      {team.length ? (
        <div className="tscroll">
          <table className="data hours-team">
            <thead>
              <tr>
                <th>שם</th>
                <th className="num">ימי עבודה</th>
                <th className="num">שעות</th>
                <th className="num">חסרה יציאה</th>
                <th className="num">רישום ידני</th>
                <th className="num">תיקונים</th>
              </tr>
            </thead>
            <tbody>
              {team.map((t) => (
                <tr key={t.id} className={t.id === viewingId ? "sel" : ""}>
                  <td>
                    <Link className="lk" href={`/hours?${new URLSearchParams({ month, user: t.id })}#shifts`} aria-current={t.id === viewingId ? "true" : undefined}>
                      <b>{t.name}</b>
                    </Link>
                    {!t.active && <small>לא פעיל</small>}
                  </td>
                  <td className="num">{t.days}</td>
                  <td className="num">{hhmm(t.minutes)}</td>
                  <td className="num">{t.missing ? <b className="warn-text">{t.missing}</b> : 0}</td>
                  <td className="num">{t.manual}</td>
                  <td className="num">{t.edits}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="empty hours-empty">אין עדיין עובדים שמדווחים שעות.</p>
      )}
    </div>
  );
}

function MyPhones({ devices }: { devices: Me["devices"] }) {
  const runner = useRunner();
  const phone = usePhone();
  const [adding, setAdding] = useState(false);
  return (
    <div className="panel">
      <div className="panel-head">
        <h2>הטלפונים שחותמים בשמך</h2>
      </div>
      <ul className="phones">
        {devices.map((d) => (
          <li key={d.id}>
            <Icon name="mobile" />
            <span>
              <b>{d.name}</b>
              <small>
                הוגדר ב-{shortDate(d.createdAt)}
                {d.lastUsedAt ? `, חתם לאחרונה ב-${shortDate(d.lastUsedAt)}` : ""}
              </small>
            </span>
            <button type="button" className="btn sm" onClick={() => runner(removeDeviceAction(d.id))}>
              הסרה
            </button>
          </li>
        ))}
      </ul>
      {adding ? (
        <div className="phones-add">
          {phone ? <SetupButton label="הגדרת חתימה בטלפון הזה" /> : <p className="login-hint">את ההגדרה עושים בטלפון החדש: נכנסים ממנו למערכת, פותחים ״שעות עבודה״ ולוחצים שם על ״הגדרת חתימה״.</p>}
        </div>
      ) : (
        <p className="muted">
          החלפת טלפון?{" "}
          <button type="button" className="link" onClick={() => setAdding(true)}>
            הגדרת חתימה בטלפון חדש
          </button>
          , ואחר כך מסירים מכאן את הישן.
        </p>
      )}
    </div>
  );
}

/**
 * A correction. The employee's own correction is signed on the phone in two steps: first the details are checked,
 * then one tap signs them. A manager's correction of someone else is recorded with the manager's name.
 */
function CorrectionForm({ row, preset, self, userId, editFrom, today }: { row?: ShiftRow; preset?: Preset; self: boolean; userId: string; editFrom?: string; today: string }) {
  const drawer = useDrawer();
  const runner = useRunner();
  const [day, setDay] = useState(row?.day ?? preset?.day ?? today);
  const [start, setStart] = useState(row?.start ?? preset?.start ?? "09:00");
  const [end, setEnd] = useState(row?.end ?? "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ready, setReady] = useState<{ input: Parameters<typeof correctAction>[0]; options: AuthOptions } | null>(null);

  async function check(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError("");
    if (!end) return setError("צריך שעת יציאה");
    if (reason.trim().length < 3) return setError("צריך לכתוב למה מתקנים");
    const input = { shiftId: row?.id ?? preset?.shiftId, userId: self ? undefined : userId, day, start, end, reason: reason.trim() };
    setBusy(true);
    if (self) {
      const o = await correctionOptionsAction(input);
      setBusy(false);
      if (!o.ok) return setError(o.error);
      if (o.data) setReady({ input, options: o.data });
      return;
    }
    const r = await runner(correctAction(input));
    setBusy(false);
    if (r.ok) drawer.close();
    else setError(r.error);
  }

  async function sign() {
    if (!ready || busy) return;
    setBusy(true);
    setError("");
    // straight from the tap: the phone opens its prompt only then
    const s = await signNow(ready.options);
    if (!s.ok) {
      setBusy(false);
      setError(s.error);
      setReady(null);
      return;
    }
    const r = await runner(correctAction(ready.input, s.response));
    setBusy(false);
    if (r.ok) drawer.close();
    else {
      setError(r.error);
      setReady(null);
    }
  }

  if (ready)
    return (
      <div className="sheet-body">
        <p className="confirm-q">לחתום על התיקון?</p>
        <dl className="kv fix-summary">
          <dt>יום</dt>
          <dd>{dayLabel(ready.input.day)}</dd>
          <dt>שעות</dt>
          <dd>
            <span className="num">{ready.input.start}</span> עד <span className="num">{ready.input.end}</span>
          </dd>
          <dt>סיבה</dt>
          <dd>{ready.input.reason}</dd>
        </dl>
        <button type="button" className="bigbtn call" disabled={busy} onClick={sign}>
          <Icon name="lock" />
          {busy ? "מחכים לאישור בטלפון…" : "לחתום על התיקון"}
        </button>
        <button type="button" className="bigbtn light" disabled={busy} onClick={() => setReady(null)}>
          חזרה לעריכה
        </button>
        <p className="muted">אחרי הלחיצה מאשרים בטלפון. התיקון נשמר עם הסיבה ומופיע להנהלה.</p>
      </div>
    );

  return (
    <form className="sheet-body" onSubmit={check} noValidate>
      {row && (
        <p className="muted">
          עכשיו רשום: <span className="num">{row.start}</span> עד <span className="num">{row.end ?? "—"}</span>
        </p>
      )}
      <label className="fld">
        <span className="req">יום</span>
        <input type="date" value={day} min={editFrom} max={today} disabled={!!preset} onChange={(e) => setDay(e.target.value)} />
      </label>
      <div className="frow">
        <label className="fld">
          <span className="req">כניסה</span>
          <input type="time" step={60} value={start} disabled={!!preset} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label className="fld">
          <span className="req">יציאה</span>
          <input type="time" step={60} value={end} autoFocus={!!preset} onChange={(e) => setEnd(e.target.value)} />
        </label>
      </div>
      <label className="fld">
        <span className="req">למה מתקנים?</span>
        <textarea rows={2} value={reason} maxLength={300} placeholder="למשל: שכחתי לצאת מהמשמרת" onChange={(e) => setReason(e.target.value)} />
      </label>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="bigbtn call" disabled={busy}>
        <Icon name={self ? "lock" : "check"} />
        {busy ? "בודקים…" : self ? "המשך לחתימה" : "לשמור את התיקון"}
      </button>
      <p className="muted">יציאה אחרי חצות נרשמת ליום שאחרי.{self ? " בשלב הבא מאשרים בטלפון." : ""}</p>
    </form>
  );
}
