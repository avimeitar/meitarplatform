"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { bulkAssignAction } from "@/app/actions/leads";
import { Icon } from "@/components/Icon";
import { useNewLead } from "@/components/Shell";
import { Due, Owner, StatusPill } from "@/components/crm/bits";
import { useLeadSheets, type SheetLead } from "@/components/crm/Sheets";
import { useRunner } from "@/components/ui/useRunner";

export type LeadRow = { id: string; name: string; phone: string; phoneRaw: string; email: string; source: string; projectName: string; status: string; lostReason: string | null; ownerName: string | null; nextAt: string | null };

export function LeadsTable({ rows, canBulk, people, query, canCreate }: { rows: LeadRow[]; canBulk: boolean; people: { id: string; name: string }[]; query: string; canCreate: boolean }) {
  const router = useRouter();
  const sheets = useLeadSheets();
  const newLead = useNewLead();
  const runner = useRunner();
  const [sel, setSel] = useState<Set<string>>(new Set());

  const toggle = (id: string) => {
    const n = new Set(sel);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    setSel(n);
  };
  const lead = (r: LeadRow): SheetLead => ({ id: r.id, name: r.name, phoneRaw: r.phoneRaw, projectName: r.projectName });

  // choosing a person only prepares the change; it happens after "כן, לשייך"
  const [target, setTarget] = useState("");
  const [asking, setAsking] = useState(false);
  const [moving, setMoving] = useState(false);
  async function bulkAssign() {
    if (!target || moving) return;
    setMoving(true);
    const r = await runner(bulkAssignAction([...sel], target));
    setMoving(false);
    setAsking(false);
    if (r.ok) {
      setSel(new Set());
      setTarget("");
    }
  }
  const targetName = people.find((p) => p.id === target)?.name ?? "";

  return (
    <>
      {canBulk && sel.size > 0 && (
        <div className="bulk">
          <b>{sel.size === 1 ? "ליד אחד נבחר" : `${sel.size} לידים נבחרו`}</b>
          {asking ? (
            <>
              <span className="bulk-q">{sel.size === 1 ? `לשייך את הליד ל${targetName}?` : `לשייך ${sel.size} לידים ל${targetName}?`}</span>
              <button type="button" className="btn sm primary" disabled={moving} onClick={bulkAssign}>
                {moving ? "משייכים…" : "כן, לשייך"}
              </button>
              <button type="button" className="btn sm" disabled={moving} onClick={() => setAsking(false)}>
                לא
              </button>
            </>
          ) : (
            <>
              <label>
                <span className="sr">לשייך ל</span>
                <select value={target} onChange={(e) => setTarget(e.target.value)}>
                  <option value="">לשייך ל…</option>
                  {people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" className="btn sm primary" disabled={!target} onClick={() => setAsking(true)}>
                שיוך
              </button>
              <button type="button" className="btn sm" onClick={() => setSel(new Set())}>
                ניקוי הבחירה
              </button>
            </>
          )}
        </div>
      )}
      <div className="table-wrap">
        <table className={"leads" + (canBulk ? "" : " nocb")}>
          <thead>
            <tr>
              {canBulk && (
                <th className="c-cb">
                  <label className="cbx">
                    <input type="checkbox" aria-label="בחירת כל הלידים המוצגים" checked={rows.length > 0 && rows.every((r) => sel.has(r.id))} onChange={(e) => setSel(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())} />
                  </label>
                </th>
              )}
              <th>שם</th>
              <th>טלפון</th>
              <th>אימייל</th>
              <th>מקור הגעה</th>
              <th>פרויקט</th>
              <th>סטטוס</th>
              <th>סוכן</th>
              <th>מתי לחזור</th>
              <th className="c-act">
                <span className="sr">פעולות</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={sel.has(r.id) ? "sel" : ""} onClick={() => router.push(`/leads/${r.id}`)}>
                {canBulk && (
                  <td className="c-cb" onClick={(e) => e.stopPropagation()}>
                    <label className="cbx">
                      <input type="checkbox" checked={sel.has(r.id)} onChange={() => toggle(r.id)} aria-label={`בחירת ${r.name}`} />
                    </label>
                  </td>
                )}
                <td className="c-name">
                  {/* a real link: reachable with the keyboard, and opens in a new tab with a middle click */}
                  <Link className="name" href={`/leads/${r.id}`} onClick={(e) => e.stopPropagation()}>
                    {r.name}
                  </Link>
                  <small className="m-only">
                    {r.projectName ? r.projectName + " · " : ""}
                    <span className="ltr">{r.phone}</span>
                  </small>
                </td>
                <td className="c-phone">
                  <span className="ltr">{r.phone}</span>
                </td>
                <td className="c-email">{r.email ? <span className="ltr">{r.email}</span> : null}</td>
                <td className="c-src">{r.source}</td>
                <td className="c-proj">{r.projectName}</td>
                <td className="c-status">
                  <StatusPill status={r.status} />
                  {r.status === "lost" && r.lostReason ? <span className="st-note">{r.lostReason}</span> : null}
                </td>
                <td className="c-owner">
                  <Owner name={r.ownerName} />
                </td>
                <td className="c-next">{r.nextAt ? <Due at={r.nextAt} /> : null}</td>
                <td className="c-act" onClick={(e) => e.stopPropagation()}>
                  <a className="ib" href={`tel:${r.phoneRaw}`} aria-label={`התקשרות ל${r.name}`} onClick={() => sheets.afterCall(lead(r))}>
                    <Icon name="phone" />
                  </a>
                  <button type="button" className="ib wa" aria-label={`וואטסאפ ל${r.name}`} onClick={() => sheets.wa(lead(r))}>
                    <Icon name="wa" />
                  </button>
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={10} className="empty" style={{ textAlign: "center" }}>
                  {query ? (
                    <>
                      לא מצאנו ליד עם ״{query}״.
                      {canCreate && (
                        <>
                          <br />
                          <button type="button" className="btn primary" style={{ marginTop: 12 }} onClick={() => newLead(query)}>
                            <Icon name="plus" />
                            להוסיף כליד חדש
                          </button>
                        </>
                      )}
                    </>
                  ) : (
                    "אין כאן לידים כרגע."
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
