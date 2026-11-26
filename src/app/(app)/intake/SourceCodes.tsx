"use client";

import { useState } from "react";
import { deleteSourceCodeAction, saveSourceCodeAction } from "@/app/actions/sourceCodes";
import { Icon } from "@/components/Icon";
import { useRunner } from "@/components/ui/useRunner";

export type CodeRow = { code: string; source: string | null; projectId: string | null; seen: number; last: string | null; lastKey: string | null };

/** Source numbers, the way suppliers who worked with Fireberry send them: each gets a name and, if wanted, a project. */
export function SourceCodes({ rows, projects }: { rows: CodeRow[]; projects: { id: string; name: string }[] }) {
  const waiting = rows.filter((r) => !r.source);
  return (
    <section className="codes" id="codes">
      <h2 className="sec-h">מספרי מקור (כמו בפיירברי)</h2>
      <div className="panel">
        <p className="muted">
          ספקים שעבדו עם פיירברי שולחים את המקור כמספר (<code className="ik-inline">originatingleadcode</code>). כאן נותנים לכל מספר שם ופרויקט. מספר שעוד אין לו שם לא עוצר
          לידים: הם נכנסים עם המקור של המפתח ומספר המקור, ומקבלים את השם ברגע שנשמר.
        </p>
        {waiting.length > 0 && (
          <p className="warn-line">
            <Icon name="alert" />
            <span>{waiting.length === 1 ? "מספר מקור אחד הגיע ועוד אין לו שם" : `${waiting.length} מספרי מקור הגיעו ועוד אין להם שם`}</span>
          </p>
        )}
        <table className="data codes-table">
          <thead>
            <tr>
              <th>מספר</th>
              <th>שם המקור</th>
              <th>פרויקט</th>
              <th>הגיעו</th>
              <th>
                <span className="sr">פעולות</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <CodeEdit key={r.code} row={r} projects={projects} />
            ))}
            <CodeEdit key="new" projects={projects} />
          </tbody>
        </table>
      </div>
    </section>
  );
}

function CodeEdit({ row, projects }: { row?: CodeRow; projects: { id: string; name: string }[] }) {
  const runner = useRunner();
  const [code, setCode] = useState(row?.code ?? "");
  const [source, setSource] = useState(row?.source ?? "");
  const [projectId, setProjectId] = useState(row?.projectId ?? "");
  const [busy, setBusy] = useState(false);
  const dirty = !row || source !== (row.source ?? "") || projectId !== (row.projectId ?? "");
  async function save() {
    setBusy(true);
    const r = await runner(saveSourceCodeAction({ code, source, projectId: projectId || null }));
    setBusy(false);
    if (r.ok && !row) {
      setCode("");
      setSource("");
      setProjectId("");
    }
  }
  return (
    <tr className={row && !row.source ? "waiting" : undefined}>
      <td>
        {row ? (
          <b className="ltr">{row.code}</b>
        ) : (
          <input className="codes-in num" value={code} onChange={(e) => setCode(e.target.value)} placeholder="מספר חדש" aria-label="מספר מקור חדש" maxLength={40} />
        )}
      </td>
      <td data-label="שם המקור">
        <input className="codes-in" value={source} onChange={(e) => setSource(e.target.value)} placeholder={row && !row.source ? "עוד אין שם" : "למשל: מטרו רעננה - צביקה"} aria-label={`שם למספר ${row?.code ?? "חדש"}`} maxLength={60} />
      </td>
      <td data-label="פרויקט">
        <label className="sel">
          <span className="sr">פרויקט למספר {row?.code ?? "חדש"}</span>
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">לפי המפתח</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      </td>
      <td data-label="הגיעו">{row ? <span className="muted">{row.seen ? `${row.seen}${row.last ? `, אחרון ${row.last}` : ""}${row.lastKey ? ` (${row.lastKey})` : ""}` : "עוד לא"}</span> : null}</td>
      <td className="codes-act">
        <button type="button" className="btn sm primary" disabled={busy || !dirty || !source.trim() || !code.trim()} onClick={save}>
          {row ? "שמירה" : "הוספה"}
        </button>
        {row && (
          <button type="button" className="ib" aria-label={`הסרת מספר ${row.code}`} onClick={() => runner(deleteSourceCodeAction(row.code))}>
            <Icon name="x" />
          </button>
        )}
      </td>
    </tr>
  );
}
