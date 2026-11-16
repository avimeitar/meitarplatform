"use client";

import { useState } from "react";
import { saveLabelsAction, saveReasonsAction, saveSourcesAction, setMeetingHostAction } from "@/app/actions/lists";
import { Icon } from "@/components/Icon";
import { useRunner } from "@/components/ui/useRunner";
import { MEETING_STATE_ORDER, MEETING_STATES, TASK_STATE_ORDER, TASK_STATES } from "@/lib/crm/constants";
import type { Lists, Reason } from "@/lib/lists";

export function SettingsScreen({ lists, people, host }: { lists: Lists; people: { id: string; name: string }[]; host: string | null }) {
  const runner = useRunner();
  return (
    <section className="settings">
      <div className="page-head">
        <div>
          <h1>רשימות והגדרות</h1>
          <p className="sub">מה מופיע בבחירות של כל הצוות: מקורות הגעה, סיבות, שמות הסטטוסים, ועם מי נקבעות הפגישות.</p>
        </div>
      </div>

      <div className="panel">
        <h2>מי נפגש עם הלקוחות</h2>
        <p className="muted">כשקובעים פגישה, היא נקבעת עם האדם הזה והלקוח עובר אליו. בכל פגישה אפשר לבחור מישהו אחר.</p>
        <label className="sel set-host">
          <span className="sr">מי נפגש עם הלקוחות</span>
          <select value={host ?? ""} onChange={(e) => runner(setMeetingHostAction(e.target.value || null))}>
            <option value="">מי שקובע את הפגישה</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <ListEditor
        title="מקורות הגעה"
        hint="המקורות שאפשר לבחור כשמוסיפים ליד ידנית. לידים מטפסים וקמפיינים מגיעים עם המקור שלהם."
        initial={lists.sources}
        onSave={(items) => runner(saveSourcesAction(items))}
      />
      <ReasonsEditor initial={lists.reasons} onSave={(items) => runner(saveReasonsAction(items))} />
      <div className="grid-2 set-labels">
        <LabelsEditor title="שמות הסטטוסים של פגישות" order={MEETING_STATE_ORDER} defaults={MEETING_STATES} initial={lists.meeting} onSave={(m) => runner(saveLabelsAction("meeting", m))} />
        <LabelsEditor title="שמות הסטטוסים של משימות" order={TASK_STATE_ORDER} defaults={TASK_STATES} initial={lists.task} onSave={(m) => runner(saveLabelsAction("task", m))} />
      </div>
    </section>
  );
}

function move<T>(list: T[], i: number, by: number): T[] {
  const j = i + by;
  if (j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

function Order({ i, n, label, onMove }: { i: number; n: number; label: string; onMove: (by: number) => void }) {
  return (
    <>
      <button type="button" className="ib up" disabled={i === 0} aria-label={`${label}: להזיז למעלה`} onClick={() => onMove(-1)}>
        <Icon name="chev" />
      </button>
      <button type="button" className="ib" disabled={i === n - 1} aria-label={`${label}: להזיז למטה`} onClick={() => onMove(1)}>
        <Icon name="chev" />
      </button>
    </>
  );
}

function AddRow({ placeholder, onAdd }: { placeholder: string; onAdd: (v: string) => void }) {
  const [v, setV] = useState("");
  const add = () => {
    const t = v.replace(/\s+/g, " ").trim();
    if (t) onAdd(t);
    setV("");
  };
  return (
    <div className="set-add">
      <input
        value={v}
        maxLength={40}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add();
          }
        }}
      />
      <button type="button" className="btn" onClick={add}>
        <Icon name="plus" />
        הוספה
      </button>
    </div>
  );
}

function Save({ dirty, busy, onSave, onReset }: { dirty: boolean; busy: boolean; onSave: () => void; onReset: () => void }) {
  return (
    <div className="row-end">
      {dirty && <span className="muted">יש שינויים שעוד לא נשמרו</span>}
      {dirty && (
        <button type="button" className="btn ghost" onClick={onReset}>
          ביטול השינויים
        </button>
      )}
      <button type="button" className="btn primary" disabled={!dirty || busy} onClick={onSave}>
        {busy ? "שומרים…" : "שמירה"}
      </button>
    </div>
  );
}

function ListEditor({ title, hint, initial, onSave }: { title: string; hint: string; initial: string[]; onSave: (items: string[]) => Promise<{ ok: boolean }> }) {
  const [items, setItems] = useState(initial);
  const [busy, setBusy] = useState(false);
  const dirty = items.join("\n") !== initial.join("\n");
  return (
    <div className="panel">
      <h2>{title}</h2>
      <p className="muted">{hint}</p>
      <ul className="set-list">
        {items.map((it, i) => (
          <li key={it}>
            <span>{it}</span>
            <Order i={i} n={items.length} label={it} onMove={(by) => setItems(move(items, i, by))} />
            <button type="button" className="ib" aria-label={`הסרת ${it}`} disabled={items.length === 1} onClick={() => setItems(items.filter((x) => x !== it))}>
              <Icon name="x" />
            </button>
          </li>
        ))}
      </ul>
      <AddRow placeholder="מקור חדש" onAdd={(v) => !items.includes(v) && setItems([...items, v])} />
      <Save
        dirty={dirty}
        busy={busy}
        onReset={() => setItems(initial)}
        onSave={async () => {
          setBusy(true);
          await onSave(items);
          setBusy(false);
        }}
      />
    </div>
  );
}

function ReasonsEditor({ initial, onSave }: { initial: Reason[]; onSave: (items: Reason[]) => Promise<{ ok: boolean }> }) {
  const [items, setItems] = useState(initial);
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(items) !== JSON.stringify(initial);
  return (
    <div className="panel">
      <h2>סיבות ל״לא רלוונטי״</h2>
      <p className="muted">הסיבות שבוחרים כשליד לא רלוונטי. סיבה שמסומנת ״לא היה ליד אמיתי״ (למשל מספר לא תקין) לא נספרת במסך הביצועים כליד רלוונטי.</p>
      <ul className="set-list">
        {items.map((it, i) => (
          <li key={it.label}>
            <span>{it.label}</span>
            <label className="set-junk">
              <input type="checkbox" checked={it.junk} onChange={(e) => setItems(items.map((x) => (x.label === it.label ? { ...x, junk: e.target.checked } : x)))} />
              לא היה ליד אמיתי
            </label>
            <Order i={i} n={items.length} label={it.label} onMove={(by) => setItems(move(items, i, by))} />
            <button type="button" className="ib" aria-label={`הסרת ${it.label}`} disabled={items.length === 1} onClick={() => setItems(items.filter((x) => x.label !== it.label))}>
              <Icon name="x" />
            </button>
          </li>
        ))}
      </ul>
      <AddRow placeholder="סיבה חדשה" onAdd={(v) => !items.some((x) => x.label === v) && setItems([...items, { label: v, junk: false }])} />
      <Save
        dirty={dirty}
        busy={busy}
        onReset={() => setItems(initial)}
        onSave={async () => {
          setBusy(true);
          await onSave(items);
          setBusy(false);
        }}
      />
    </div>
  );
}

function LabelsEditor<K extends string>({
  title,
  order,
  defaults,
  initial,
  onSave,
}: {
  title: string;
  order: K[];
  defaults: Record<K, { l: string }>;
  initial: Record<K, string>;
  onSave: (names: Record<K, string>) => Promise<{ ok: boolean }>;
}) {
  const [names, setNames] = useState(initial);
  const [busy, setBusy] = useState(false);
  const dirty = order.some((k) => names[k] !== initial[k]);
  return (
    <div className="panel">
      <h2>{title}</h2>
      <p className="muted">אפשר לקרוא לסטטוס בשם אחר. שדה ריק חוזר לשם הרגיל.</p>
      <div className="set-names">
        {order.map((k) => (
          <label key={k} className="fld">
            <span>{defaults[k].l}</span>
            <input value={names[k] === defaults[k].l ? "" : names[k]} maxLength={30} placeholder={defaults[k].l} onChange={(e) => setNames({ ...names, [k]: e.target.value || defaults[k].l })} />
          </label>
        ))}
      </div>
      <Save
        dirty={dirty}
        busy={busy}
        onReset={() => setNames(initial)}
        onSave={async () => {
          setBusy(true);
          await onSave(names);
          setBusy(false);
        }}
      />
    </div>
  );
}
