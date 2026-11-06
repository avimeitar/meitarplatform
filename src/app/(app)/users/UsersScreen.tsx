"use client";

import { useState } from "react";
import { setRequireCodeAction, setSignInLockAction } from "@/app/actions/security";
import { createUserAction, deleteUserAction, revokeUserSessionsAction, sendLinkAction, setUserActiveAction, updateUserAction, type InviteInfo } from "@/app/actions/users";
import { Icon } from "@/components/Icon";
import { useDrawer, useToast } from "@/components/ui/Overlays";
import { useRunner } from "@/components/ui/useRunner";
import { relTime } from "@/lib/crm/dates";
import { normalizePhone } from "@/lib/phone";

export type UserRow = {
  id: string;
  name: string;
  phone: string;
  email: string;
  roleId: string;
  roleName: string;
  active: boolean;
  hasPassword: boolean;
  lastLogin: string | null;
  autoAssign: boolean;
  manageable: boolean;
  isMe: boolean;
};
export type RoleRow = { id: string; name: string; key: string | null; grantable: boolean };

function status(u: UserRow, codeOn: boolean) {
  if (!u.active) return <span className="st-pill s-lost">מושבת</span>;
  if (!u.hasPassword) return <span className="st-pill s-resched">טרם נקבעה סיסמה</span>;
  return (
    <span className="badge2fa">
      <Icon name="shield" />
      {codeOn ? "פעיל, עם קוד לנייד" : "פעיל"}
    </span>
  );
}

function initials(name: string) {
  const p = name.trim().split(/\s+/);
  return (p[0]?.[0] ?? "") + (p[1]?.[0] ?? "");
}

export type SecurityState = { requireCode: boolean; locked: boolean; codesReady: boolean } | null;

export function UsersScreen({ users, roles, security, codeOn }: { users: UserRow[]; roles: RoleRow[]; security: SecurityState; codeOn: boolean }) {
  const drawer = useDrawer();
  const active = users.filter((u) => u.active);
  const inactive = users.filter((u) => !u.active);

  function openNew() {
    drawer.open({ title: "משתמש חדש", content: <UserForm roles={roles} /> });
  }

  function openUser(u: UserRow) {
    drawer.open({ title: u.name, content: <UserManage user={u} roles={roles} people={active.filter((x) => x.id !== u.id)} /> });
  }

  const list = (rows: UserRow[]) => (
    <ul className="ulist">
      {rows.map((u) => (
        <li key={u.id}>
          <span className="av">{initials(u.name)}</span>
          <div className="u-main">
            <b>
              {u.name}
              {u.isMe && <span className="muted"> (אני)</span>}
            </b>
            <small>
              <span className="ltr">{u.phone}</span> · {u.roleName}
              {u.autoAssign && " · בחלוקה האוטומטית"}
            </small>
          </div>
          <div className="u-status">
            {status(u, codeOn)}
            <small className="muted">{u.lastLogin ? "כניסה אחרונה " + relTime(new Date(u.lastLogin)) : "עוד לא היו כניסות"}</small>
          </div>
          {u.manageable ? (
            <button type="button" className="btn" onClick={() => openUser(u)}>
              ניהול
            </button>
          ) : (
            <span className="muted u-locked">
              <Icon name="lock" />
              <small>למשתמש הזה יש הרשאות שאין לך</small>
            </span>
          )}
        </li>
      ))}
    </ul>
  );

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>משתמשים</h1>
          <p className="sub">{codeOn ? "כל משתמש נכנס עם הטלפון, סיסמה וקוד שנשלח לנייד." : "כל משתמש נכנס עם הטלפון וסיסמה."} מה כל אחד יכול לעשות נקבע לפי התפקיד.</p>
        </div>
        <div className="head-actions">
          <button type="button" className="btn primary" onClick={openNew}>
            <Icon name="plus" />
            משתמש חדש
          </button>
        </div>
      </div>
      {security && <SecurityPanel s={security} />}
      <div className="panel">{active.length ? list(active) : <p className="empty">אין משתמשים פעילים.</p>}</div>
      {inactive.length > 0 && (
        <>
          <h2 className="sec-h">מושבתים</h2>
          <div className="panel">{list(inactive)}</div>
        </>
      )}
    </section>
  );
}

function UserForm({ roles, user }: { roles: RoleRow[]; user?: UserRow }) {
  const drawer = useDrawer();
  const toast = useToast();
  const runner = useRunner();
  const agentRole = roles.find((r) => r.key === "agent");
  const [name, setName] = useState(user?.name ?? "");
  const [phone, setPhone] = useState(user?.phone ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [roleId, setRoleId] = useState(user?.roleId ?? agentRole?.id ?? "");
  const [autoAssign, setAutoAssign] = useState(user ? user.autoAssign : true);
  const [err, setErr] = useState<{ field?: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (name.trim().length < 2) return setErr({ field: "name", text: "צריך לכתוב שם מלא" });
    if (!normalizePhone(phone)) return setErr({ field: "phone", text: "המספר לא נראה תקין. למשל 050-1234567" });
    if (!roleId) return setErr({ field: "roleId", text: "צריך לבחור תפקיד" });
    setBusy(true);
    const input = { name, phone, email, roleId, autoAssign };
    if (user) {
      const r = await runner(updateUserAction(user.id, input));
      setBusy(false);
      if (!r.ok) return setErr({ field: r.field, text: r.error });
      drawer.close();
      return;
    }
    const r = await createUserAction(input);
    setBusy(false);
    if (!r.ok) return setErr({ field: r.field, text: r.error });
    toast(r.message ?? "המשתמש נוסף");
    if (r.data) drawer.open({ title: "לשלוח קישור כניסה", content: <InviteResult info={r.data.invite} name={name} /> });
  }

  const fe = (f: string) =>
    err?.field === f ? (
      <small className="err" role="alert">
        {err.text}
      </small>
    ) : null;

  return (
    <form onSubmit={submit} noValidate>
      <label className="fld">
        <span className="req">שם מלא</span>
        <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" aria-invalid={err?.field === "name"} />
        {fe("name")}
      </label>
      <label className="fld">
        <span className="req">נייד</span>
        <input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" dir="ltr" autoComplete="off" placeholder="050-1234567" aria-invalid={err?.field === "phone"} />
        <small>לכאן יישלח קוד בכל כניסה, ב-SMS או בוואטסאפ</small>
        {fe("phone")}
      </label>
      <label className="fld">
        <span>אימייל (לא חובה)</span>
        <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" dir="ltr" autoComplete="off" aria-invalid={err?.field === "email"} />
        {fe("email")}
      </label>
      <div className="fld">
        <span className="req">תפקיד</span>
        <div className="chips pchips" role="radiogroup" aria-label="תפקיד">
          {roles
            .filter((r) => r.grantable || r.id === user?.roleId)
            .map((r) => (
              <label key={r.id}>
                <input type="radio" className="sr" name="role" value={r.id} checked={roleId === r.id} onChange={() => setRoleId(r.id)} disabled={!r.grantable} />
                <span>{r.name}</span>
              </label>
            ))}
        </div>
        <small>
          מה כל תפקיד יכול לעשות: <a href="/roles">מסך ההרשאות</a>
        </small>
        {fe("roleId")}
      </div>
      <label className="check">
        <input type="checkbox" checked={autoAssign} onChange={(e) => setAutoAssign(e.target.checked)} />
        לכלול בחלוקה האוטומטית של לידים חדשים
      </label>
      {err && !["name", "phone", "email", "roleId"].includes(err.field ?? "") && (
        <p className="form-error" role="alert">
          {err.text}
        </p>
      )}
      <footer>
        <button type="button" className="btn ghost" onClick={drawer.close}>
          ביטול
        </button>
        <button type="submit" className="btn primary" disabled={busy}>
          {busy ? "שומרים…" : user ? "שמירה" : "הוספה ושליחת קישור"}
        </button>
      </footer>
    </form>
  );
}

function InviteResult({ info, name }: { info: InviteInfo; name: string }) {
  const toast = useToast();
  const drawer = useDrawer();
  async function copy() {
    try {
      await navigator.clipboard.writeText(info.url);
      toast("הקישור הועתק");
    } catch {
      toast("לא הצלחנו להעתיק. אפשר לסמן את הקישור ולהעתיק ידנית", { error: true });
    }
  }
  return (
    <div className="sheet-body">
      {info.smsSent ? (
        <p className="login-ok">
          שלחנו ל{name.split(/\s+/)[0]} SMS עם קישור לקביעת סיסמה, לנייד <span className="ltr">{info.phone}</span>.
        </p>
      ) : (
        <p className="muted">שולחים את הקישור ל{name.split(/\s+/)[0]}. בקישור קובעים סיסמה, ואז נכנסים. הקישור עובד פעם אחת, ל-72 שעות.</p>
      )}
      <a className="bigbtn wa" href={info.waUrl} target="_blank" rel="noopener noreferrer">
        <Icon name="wa" />
        לשלוח את הקישור בוואטסאפ
      </a>
      <button type="button" className="bigbtn light" onClick={copy}>
        <Icon name="link" />
        להעתיק את הקישור
      </button>
      <p className="link-box ltr">{info.url}</p>
      <button type="button" className="btn full" onClick={drawer.close}>
        סיום
      </button>
    </div>
  );
}

function UserManage({ user, roles, people }: { user: UserRow; roles: RoleRow[]; people: UserRow[] }) {
  const drawer = useDrawer();
  const runner = useRunner();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [ask, setAsk] = useState<"revoke" | "deactivate" | null>(null);
  const [heir, setHeir] = useState("");
  const [busy, setBusy] = useState(false);

  async function link(purpose: "invite" | "reset") {
    setBusy(true);
    const r = await runner(sendLinkAction(user.id, purpose), { quiet: true });
    setBusy(false);
    if (r.ok && r.data) drawer.open({ title: "לשלוח קישור כניסה", content: <InviteResult info={r.data} name={user.name} /> });
  }

  async function act(p: Promise<{ ok: boolean }>) {
    setBusy(true);
    const r = await runner(p as never);
    setBusy(false);
    if ((r as { ok: boolean }).ok) drawer.close();
  }

  if (ask) {
    const first = user.name.split(/\s+/)[0];
    return (
      <div className="sheet-body">
        <p className="confirm-q">{ask === "revoke" ? `לנתק את ${user.name} מכל המכשירים?` : `להשבית את החשבון של ${user.name}?`}</p>
        <p className="muted">{ask === "revoke" ? "בכל המכשירים צריך יהיה להיכנס שוב." : "החשבון ינותק מיד מכל המכשירים, ואי אפשר יהיה להיכנס איתו. אפשר להחזיר אותו לפעילות בכל רגע."}</p>
        <button type="button" className="bigbtn danger" disabled={busy} onClick={() => act(ask === "revoke" ? revokeUserSessionsAction(user.id) : setUserActiveAction(user.id, false))}>
          <Icon name={ask === "revoke" ? "out" : "lock"} />
          {ask === "revoke" ? `כן, לנתק את ${first}` : `כן, להשבית את ${first}`}
        </button>
        <button type="button" className="bigbtn light" onClick={() => setAsk(null)}>
          לא, לחזור
        </button>
      </div>
    );
  }

  if (confirmDelete)
    return (
      <div className="sheet-body">
        <p className="confirm-q">למחוק את {user.name}?</p>
        <p className="muted">ההיסטוריה נשמרת עם השם. הלידים הפתוחים, המשימות והפגישות הבאות יעברו למי שבוחרים כאן. אי אפשר לבטל מחיקה.</p>
        <label className="fld">
          <span className="req">למי להעביר את הלידים הפתוחים?</span>
          <select value={heir} onChange={(e) => setHeir(e.target.value)}>
            <option value="">בוחרים…</option>
            <option value="auto">חלוקה אוטומטית בין הסוכנים</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="bigbtn danger" disabled={!heir || busy} onClick={() => act(deleteUserAction(user.id, heir))}>
          <Icon name="x" />
          כן, למחוק את {user.name.split(/\s+/)[0]}
        </button>
        <button type="button" className="bigbtn light" onClick={() => setConfirmDelete(false)}>
          לא, לחזור
        </button>
      </div>
    );

  return (
    <div className="sheet-body">
      <UserForm roles={roles} user={user} />
      <h3 className="sec-h">פעולות</h3>
      <div className="opts">
        {user.active && (
          <button type="button" className="opt" disabled={busy} onClick={() => link(user.hasPassword ? "reset" : "invite")}>
            <span className="oi">
              <Icon name="link" />
            </span>
            <span>
              <b>{user.hasPassword ? "קישור לסיסמה חדשה" : "לשלוח שוב את קישור ההזמנה"}</b>
              <small>{user.hasPassword ? "כששכחו את הסיסמה" : "הקישור הקודם יפסיק לעבוד"}</small>
            </span>
          </button>
        )}
        {user.active && !user.isMe && (
          <button type="button" className="opt" disabled={busy} onClick={() => setAsk("revoke")}>
            <span className="oi">
              <Icon name="out" />
            </span>
            <span>
              <b>לנתק מכל המכשירים</b>
              <small>למשל כשטלפון אבד. בכניסה הבאה יידרש קוד חדש</small>
            </span>
          </button>
        )}
        {!user.isMe && (
          <button type="button" className={"opt " + (user.active ? "warn" : "good")} disabled={busy} onClick={() => (user.active ? setAsk("deactivate") : act(setUserActiveAction(user.id, true)))}>
            <span className="oi">
              <Icon name={user.active ? "lock" : "check"} />
            </span>
            <span>
              <b>{user.active ? "להשבית את החשבון" : "להחזיר לפעילות"}</b>
              <small>{user.active ? "אי אפשר יהיה להיכנס עם החשבון. אפשר להחזיר בכל רגע" : "החשבון יחזור לעבוד"}</small>
            </span>
          </button>
        )}
        {!user.isMe && (
          <button type="button" className="opt bad" disabled={busy} onClick={() => setConfirmDelete(true)}>
            <span className="oi">
              <Icon name="x" />
            </span>
            <span>
              <b>למחוק את המשתמש</b>
              <small>קודם בוחרים למי לעבור הלידים שלו</small>
            </span>
          </button>
        )}
      </div>
    </div>
  );
}

/** Two switches only system administrators see: the sign-in code, and closing sign-in for everyone else. */
function SecurityPanel({ s }: { s: NonNullable<SecurityState> }) {
  const runner = useRunner();
  const [busy, setBusy] = useState(false);
  // turning the code off and locking sign-in affect everyone, so they ask first
  const [ask, setAsk] = useState<"codeOff" | "lock" | null>(null);
  async function flip(p: Promise<{ ok: boolean }>) {
    setBusy(true);
    setAsk(null);
    await runner(p as never);
    setBusy(false);
  }
  if (ask)
    return (
      <div className="panel sec-panel">
        <h2>אבטחת כניסה</h2>
        <p className="confirm-q">{ask === "lock" ? "לנעול את הכניסה?" : "לכבות את הקוד לנייד?"}</p>
        <p className="muted">
          {ask === "lock" ? "כל המשתמשים חוץ ממנהלי המערכת ינותקו עכשיו, ולא יוכלו להיכנס עד שהכניסה תיפתח." : "מעכשיו נכנסים עם טלפון וסיסמה בלבד, בלי קוד. זה פחות בטוח."}
        </p>
        <div className="row-end">
          <button type="button" className="btn" onClick={() => setAsk(null)}>
            לא, לחזור
          </button>
          <button type="button" className="btn danger" disabled={busy} onClick={() => flip(ask === "lock" ? setSignInLockAction(true) : setRequireCodeAction(false))}>
            {ask === "lock" ? "כן, לנעול" : "כן, לכבות"}
          </button>
        </div>
      </div>
    );
  return (
    <div className="panel sec-panel">
      <h2>אבטחת כניסה</h2>
      <div className="sec-row">
        <div>
          <b>קוד לנייד בכל כניסה</b>
          <small>
            {s.requireCode
              ? "פעיל: נכנסים עם טלפון, סיסמה וקוד שנשלח ב-SMS או בוואטסאפ."
              : s.codesReady
                ? "כבוי: נכנסים עם טלפון וסיסמה בלבד. מומלץ להפעיל."
                : "כבוי: נכנסים עם טלפון וסיסמה בלבד. אפשר להפעיל אחרי שמחברים SMS או וואטסאפ."}
          </small>
        </div>
        <button type="button" className={"btn " + (s.requireCode ? "" : "primary")} disabled={busy || (!s.requireCode && !s.codesReady)} onClick={() => (s.requireCode ? setAsk("codeOff") : flip(setRequireCodeAction(true)))}>
          {s.requireCode ? "לכבות" : "להפעיל"}
        </button>
      </div>
      <div className="sec-row">
        <div>
          <b>כניסת משתמשים</b>
          <small>{s.locked ? "נעולה: רק מנהלי מערכת יכולים להיכנס." : "פתוחה לכל המשתמשים הפעילים."}</small>
        </div>
        <button type="button" className={"btn " + (s.locked ? "primary" : "danger-outline")} disabled={busy} onClick={() => (s.locked ? flip(setSignInLockAction(false)) : setAsk("lock"))}>
          {s.locked ? "לפתוח" : "לנעול"}
        </button>
      </div>
    </div>
  );
}
