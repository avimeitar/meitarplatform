"use client";

import { useEffect, useState } from "react";
import { archivePreviewAction, archiveRunAction } from "@/app/actions/archive";
import { Icon } from "@/components/Icon";
import { useDrawer } from "@/components/ui/Overlays";
import { useRunner } from "@/components/ui/useRunner";
import { CONFIRM_WORDS, type ArchiveCounts } from "@/lib/archive-words";

type ProjectOption = { id: string; name: string; active: boolean; suggested: boolean };

/** "העברה לארכיון": choose the projects that stay, see what moves, and confirm in words. */
export function ArchiveRun({ projects }: { projects: ProjectOption[] }) {
  const drawer = useDrawer();
  return (
    <button type="button" className="btn primary" onClick={() => drawer.open({ title: "העברה לארכיון", content: <RunForm projects={projects} /> })}>
      <Icon name="archive" />
      העברה לארכיון
    </button>
  );
}

function RunForm({ projects }: { projects: ProjectOption[] }) {
  const drawer = useDrawer();
  const runner = useRunner();
  const [keep, setKeep] = useState<string[]>(projects.filter((p) => p.suggested).map((p) => p.id));
  const [counts, setCounts] = useState<ArchiveCounts | null>(null);
  const [words, setWords] = useState("");
  const [busy, setBusy] = useState(false);
  const ready = words.trim() === CONFIRM_WORDS && !!counts && !busy;

  useEffect(() => {
    let live = true;
    archivePreviewAction(keep).then((r) => live && r.ok && r.data && setCounts(r.data));
    return () => {
      live = false;
    };
  }, [keep]);

  async function go() {
    setBusy(true);
    const r = await runner(archiveRunAction(keep, words));
    setBusy(false);
    if (r.ok) drawer.close();
  }

  const kept = projects.filter((p) => keep.includes(p.id));
  return (
    <div className="sheet-body ar-run">
      <p>
        כל הלקוחות, הפגישות והמשימות עוברים לארכיון, עם כל ההיסטוריה שלהם. פרויקט שמסומן כאן נשאר במערכת, ריק. משתמשים, שעות עבודה, הגדרות ומפתחות לקליטת לידים לא משתנים.
      </p>
      <fieldset className="ar-keep">
        <legend>אילו פרויקטים נשארים במערכת?</legend>
        {projects.map((p) => (
          <label key={p.id} className="check">
            <input type="checkbox" checked={keep.includes(p.id)} onChange={(e) => setKeep(e.target.checked ? [...keep, p.id] : keep.filter((x) => x !== p.id))} />
            <span>
              {p.name}
              {p.active ? "" : " (לא פעיל)"}
            </span>
          </label>
        ))}
        {!projects.length && <p className="muted">אין פרויקטים במערכת.</p>}
      </fieldset>
      <div className="ar-sum" role="status">
        <span className="ik-lbl">יעברו לארכיון</span>
        {counts ? (
          <p>
            <b>{counts.leads}</b> לקוחות · <b>{counts.meetings}</b> פגישות · <b>{counts.tasks}</b> משימות · <b>{counts.projects}</b> פרויקטים
          </p>
        ) : (
          <p className="muted">סופרים…</p>
        )}
        <small className="muted">{kept.length ? `נשארים במערכת: ${kept.map((p) => p.name).join(", ")}` : "לא נשאר אף פרויקט במערכת"}</small>
      </div>
      <p className="warn-line">
        <Icon name="alert" />
        <span>אחרי ההעברה המערכת מתחילה נקייה, ורק מנהלי מערכת רואים את מה שבארכיון. לפני ההעברה כדאי לגבות את מסד הנתונים ב-Railway.</span>
      </p>
      <label className="fld">
        <span>כדי לאשר, כתבו: {CONFIRM_WORDS}</span>
        <input value={words} onChange={(e) => setWords(e.target.value)} autoComplete="off" />
      </label>
      <button type="button" className="bigbtn danger" disabled={!ready} onClick={go}>
        <Icon name="archive" />
        {busy ? "מעבירים לארכיון…" : "להעביר לארכיון"}
      </button>
      <button type="button" className="bigbtn light" onClick={drawer.close}>
        ביטול
      </button>
    </div>
  );
}
