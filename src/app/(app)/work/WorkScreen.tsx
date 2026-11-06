"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import { firstName, nOf, StatusPill } from "@/components/crm/bits";
import { useLeadSheets, type SheetLead } from "@/components/crm/Sheets";
import type { QueueRow } from "@/lib/crm/views";

export function WorkScreen({ rows }: { rows: QueueRow[] }) {
  const sheets = useLeadSheets();
  // the order is fixed when the queue starts, so handled leads don't jump around while data refreshes
  const snapshot = useRef<Map<string, QueueRow>>(new Map(rows.map((r) => [r.leadId, r])));
  const [ids] = useState<string[]>(() => rows.map((r) => r.leadId));
  const [i, setI] = useState(0);
  const [handled, setHandled] = useState(0);
  const live = useMemo(() => new Map(rows.map((r) => [r.leadId, r])), [rows]);
  for (const r of rows) if (!snapshot.current.has(r.leadId)) snapshot.current.set(r.leadId, r);

  const n = ids.length;
  const current = i < n ? (live.get(ids[i]) ?? snapshot.current.get(ids[i])) : undefined;
  const next = () => {
    setI((x) => x + 1);
    window.scrollTo(0, 0);
  };
  const doneOne = () => {
    setHandled((h) => h + 1);
    next();
  };

  if (!n)
    return (
      <section className="work">
        <div className="page-head">
          <div>
            <h1>תור שיחות</h1>
            <p className="sub">המערכת מסדרת לך את הלידים לפי מה שהכי דחוף. מטפלים בליד אחד בכל פעם.</p>
          </div>
        </div>
        <div className="wcard wdone">
          <p className="big">0</p>
          <h2>אין לידים שמחכים לך עכשיו</h2>
          <p className="sub" style={{ justifyContent: "center" }}>
            כשייכנס ליד חדש או שיגיע זמן לחזור למישהו, הוא יופיע כאן.
          </p>
        </div>
      </section>
    );

  if (!current)
    return (
      <section className="work">
        <div className="wcard wdone">
          <p className="big">{handled}</p>
          <h2>סיימת את התור. כל הכבוד!</h2>
          <p className="sub" style={{ justifyContent: "center" }}>
            {nOf(handled, "ליד אחד טופל", "לידים טופלו")}.
          </p>
          <div className="wacts">
            <Link className="bigbtn light" href="/dashboard">
              <Icon name="home" />
              חזרה למסך הראשי
            </Link>
          </div>
        </div>
      </section>
    );

  const lead: SheetLead = { id: current.leadId, name: current.name, phoneRaw: current.phoneRaw, projectName: current.projectName };
  const fn = firstName(current.name);
  return (
    <section className="work">
      <div className="work-top">
        <b>
          ליד {i + 1} מתוך {n}
        </b>
        <Link className="link" href="/dashboard">
          יציאה מהתור
        </Link>
      </div>
      <div className="prog" role="progressbar" aria-label="התקדמות בתור" aria-valuemin={0} aria-valuemax={n} aria-valuenow={i}>
        <i style={{ width: `${Math.round((i / n) * 100)}%` }} />
      </div>
      <div className="wcard">
        <span className={"why" + (current.meetingId ? " meet" : current.late ? " late" : "")}>{current.why}</span>
        <h1 className="wname">{current.name}</h1>
        <p className="wmeta">
          {[current.projectName, current.source ? `מקור: ${current.source}` : ""].filter(Boolean).join(". ")} <StatusPill status={current.status} />
        </p>
        <a className="wphone ltr" href={`tel:${current.phoneRaw}`}>
          {current.phone}
        </a>
        {current.attempts > 0 && (
          <p className="att">
            <Icon name="phone-x" />
            {current.attempts >= 3 ? `${current.attempts} ניסיונות בלי מענה` : `ניסיון ${current.attempts} מתוך 3 בלי מענה`}
          </p>
        )}
        {current.lastWa && <p className="wlast">{current.lastWa}</p>}
        <div className="wacts">
          <a className="bigbtn call" href={`tel:${current.phoneRaw}`} onClick={() => sheets.afterCall(lead, { meetingId: current.meetingId, onDone: doneOne })}>
            <Icon name="phone" />
            להתקשר ל{fn}
          </a>
          <button type="button" className="bigbtn wa" onClick={() => sheets.wa(lead)}>
            <Icon name="wa" />
            לשלוח וואטסאפ
          </button>
        </div>
      </div>
      <div className="work-foot">
        <button type="button" onClick={next}>
          דילוג לליד הבא
        </button>
        <Link href={`/leads/${current.leadId}`}>כרטיס הליד המלא</Link>
      </div>
    </section>
  );
}
