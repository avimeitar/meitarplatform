"use client";

import { Fragment, useState } from "react";
import { createRoleAction, deleteRoleAction, updateRoleAction } from "@/app/actions/roles";
import { Icon } from "@/components/Icon";
import { useDrawer } from "@/components/ui/Overlays";
import { useRunner } from "@/components/ui/useRunner";
import type { Permission } from "@/lib/permissions";

export type RoleView = { id: string; name: string; description: string; locked: boolean; builtIn: boolean; users: number; permissions: Permission[]; editable: boolean };
type Group = { group: string; items: { key: Permission; label: string }[] };

export function RolesScreen({ roles, groups, mine }: { roles: RoleView[]; groups: Group[]; mine: Permission[] }) {
  const drawer = useDrawer();
  const open = (r?: RoleView) => drawer.open({ title: r ? r.name : "תפקיד חדש", content: <RoleForm role={r} groups={groups} mine={mine} /> });
  return (
    <section>
      <div className="page-head">
        <div>
          <h1>הרשאות</h1>
          <p className="sub">כל משתמש מקבל תפקיד, והתפקיד קובע מה מותר לו. אפשר לשנות כל תפקיד חוץ ממנהל מערכת, שתמיד יכול הכול.</p>
        </div>
        <div className="head-actions">
          <button type="button" className="btn primary" onClick={() => open()}>
            <Icon name="plus" />
            תפקיד חדש
          </button>
        </div>
      </div>
      <div className="panel flush">
        <table className="data perm">
          <thead>
            <tr>
              <th>מה מותר</th>
              {roles.map((r) => (
                <th key={r.id}>
                  <button type="button" className="link" onClick={() => open(r)} disabled={!r.editable && !r.locked}>
                    {r.name}
                  </button>
                  <small>{r.users === 1 ? "משתמש אחד" : `${r.users} משתמשים`}</small>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <Fragment key={g.group}>
                <tr className="grp">
                  <td colSpan={roles.length + 1}>{g.group}</td>
                </tr>
                {g.items.map((it) => (
                  <tr key={it.key}>
                    <td>{it.label}</td>
                    {roles.map((r) => {
                      const yes = r.permissions.includes(it.key);
                      return (
                        <td key={r.id} className={yes ? "yes" : "no"}>
                          {yes ? "כן" : "לא"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ marginTop: 10 }}>
        לחיצה על שם התפקיד פותחת אותו לעריכה. אפשר לתת לתפקיד רק הרשאות שיש לך.
      </p>
    </section>
  );
}

function RoleForm({ role, groups, mine }: { role?: RoleView; groups: Group[]; mine: Permission[] }) {
  const drawer = useDrawer();
  const runner = useRunner();
  const [name, setName] = useState(role?.name ?? "");
  const [description, setDescription] = useState(role?.description ?? "");
  const [perms, setPerms] = useState<Set<Permission>>(new Set(role?.permissions ?? ["leads.view_all", "leads.create", "leads.edit"]));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const locked = !!role?.locked;

  function toggle(p: Permission) {
    const n = new Set(perms);
    if (n.has(p)) n.delete(p);
    else n.add(p);
    setPerms(n);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (name.trim().length < 2) return setError("צריך לתת שם לתפקיד");
    setBusy(true);
    const input = { name, description, permissions: [...perms] };
    const r = await runner(role ? updateRoleAction(role.id, input) : createRoleAction(input));
    setBusy(false);
    if (!r.ok) return setError(r.error);
    drawer.close();
  }

  async function remove() {
    if (!role) return;
    setBusy(true);
    const r = await runner(deleteRoleAction(role.id));
    setBusy(false);
    if (r.ok) drawer.close();
    else setConfirmDel(false);
  }

  return (
    <form onSubmit={save} noValidate>
      <label className="fld">
        <span className="req">שם התפקיד</span>
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="fld">
        <span>תיאור קצר</span>
        <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="למשל: סוכן שמטפל רק בלידים מחו״ל" />
      </label>
      {locked ? (
        <p className="login-hint">למנהל מערכת יש תמיד את כל ההרשאות, כדי שתמיד יהיה מי שיכול לנהל את המערכת.</p>
      ) : (
        groups.map((g) => (
          <fieldset key={g.group} className="perm-group">
            <legend>{g.group}</legend>
            {g.items.map((it) => {
              const allowed = mine.includes(it.key);
              return (
                <label key={it.key} className={"check perm-row" + (allowed ? "" : " is-off")}>
                  <input type="checkbox" checked={perms.has(it.key)} disabled={!allowed || busy} onChange={() => toggle(it.key)} />
                  <span>
                    {it.label}
                    {!allowed && <small>אין לך את ההרשאה הזו, ולכן אי אפשר לתת אותה</small>}
                  </span>
                </label>
              );
            })}
          </fieldset>
        ))
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <footer>
        {role && !role.builtIn && !confirmDel && (
          <button type="button" className="btn ghost danger-text" onClick={() => setConfirmDel(true)}>
            מחיקת התפקיד
          </button>
        )}
        {confirmDel && (
          <button type="button" className="btn danger" onClick={remove} disabled={busy}>
            כן, למחוק
          </button>
        )}
        <button type="button" className="btn ghost" onClick={drawer.close}>
          ביטול
        </button>
        <button type="submit" className="btn primary" disabled={busy}>
          {busy ? "שומרים…" : "שמירה"}
        </button>
      </footer>
    </form>
  );
}
