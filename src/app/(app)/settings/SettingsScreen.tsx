"use client";

import { useRef, useState } from "react";
import { saveLabelsAction, saveMessagesAction, saveReasonsAction, saveSourcesAction, setMeetingHostAction } from "@/app/actions/lists";
import { Icon } from "@/components/Icon";
import { useShellData } from "@/components/ShellData";
import { useRunner } from "@/components/ui/useRunner";
import { MEETING_STATE_ORDER, MEETING_STATES, OFFICE, TASK_STATE_ORDER, TASK_STATES } from "@/lib/crm/constants";
import { addDays, sod, WD } from "@/lib/crm/dates";
import { DEFAULT_TEMPLATES, FIELDS, fillTemplate, MAX_TEMPLATES, MAX_TEXT, MAX_TITLE, MEETING_TEMPLATE, needsMeeting, unknownFields, type WaTemplate } from "@/lib/crm/messages";
import type { Lists, Reason } from "@/lib/lists";

export function SettingsScreen({ lists, people, host }: { lists: Lists; people: { id: string; name: string }[]; host: string | null }) {
  const runner = useRunner();
  return (
    <section className="settings">
      <div className="page-head">
        <div>
          <h1>רשימות והגדרות</h1>
          <p className="sub">מה מופיע בבחירות של כל הצוות: מקורות הגעה, סיבות, שמות הסטטוסים, הודעות הוואטסאפ, ועם מי נקבעות הפגישות.</p>
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
        hint="המקורות שאפשר לבחור כשמוסיפים לקוח ידנית. לקוחות מטפסים וקמפיינים מגיעים עם המקור שלהם."
        initial={lists.sources}
        onSave={(items) => runner(saveSourcesAction(items))}
      />
      <ReasonsEditor initial={lists.reasons} onSave={(items) => runner(saveReasonsAction(items))} />
      <MessagesEditor initial={lists.messages} hostName={people.find((p) => p.id === host)?.name ?? null} onSave={(items) => runner(saveMessagesAction(items))} />
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
      <p className="muted">הסיבות שבוחרים כשלקוח לא רלוונטי. סיבה שמסומנת ״לא היה לקוח אמיתי״ (למשל מספר לא תקין) לא נספרת במסך הביצועים כלקוח רלוונטי.</p>
      <ul className="set-list">
        {items.map((it, i) => (
          <li key={it.label}>
            <span>{it.label}</span>
            <label className="set-junk">
              <input type="checkbox" checked={it.junk} onChange={(e) => setItems(items.map((x) => (x.label === it.label ? { ...x, junk: e.target.checked } : x)))} />
              לא היה לקוח אמיתי
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

/** The ready WhatsApp messages: their names, their words and their order, with a preview of how a client gets them. */
function MessagesEditor({ initial, hostName, onSave }: { initial: WaTemplate[]; hostName: string | null; onSave: (items: WaTemplate[]) => Promise<{ ok: boolean }> }) {
  const { meName, appUrl } = useShellData();
  const [items, setItems] = useState(initial);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(items) !== JSON.stringify(initial);
  const tomorrow = addDays(sod(new Date()), 1);
  const sample = {
    לקוח: "נועה",
    נציג: meName || "אורנה",
    פרויקט: "מטרופארק",
    יום: `${WD[tomorrow.getDay()]} ${tomorrow.getDate()}.${tomorrow.getMonth() + 1}`,
    שעה: "10:30",
    "נפגשים עם": hostName ?? meName,
    כתובת: OFFICE.address,
    ווייז: `${appUrl || ""}/waze`,
  };
  const change = (id: string, patch: Partial<WaTemplate>) => setItems(items.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  function add() {
    const t: WaTemplate = { id: "m" + Date.now().toString(36), title: "הודעה חדשה", text: "היי {לקוח}, כאן {נציג} מקבוצת מיתר. " };
    setItems([...items, t]);
    setOpen(t.id);
  }
  return (
    <div className="panel set-msgs">
      <h2>הודעות וואטסאפ</h2>
      <p className="muted">
        ההודעות המוכנות שהצוות שולח ללקוחות. מה שבסוגריים מסולסלים מתמלא לבד בשליחה, למשל {"{לקוח}"} הופך לשם של הלקוח. שורה שהפרט שלה חסר, כמו ״בנושא: {"{פרויקט}"}״ ללקוח בלי
        פרויקט, לא נשלחת. הודעה עם יום או שעה של פגישה מוצעת רק ללקוח שיש לו פגישה.
      </p>
      <ul className="set-list set-msg-list">
        {items.map((t, i) => (
          <li key={t.id} className={open === t.id ? "open" : undefined}>
            <div className="set-msg-head">
              <button type="button" className="set-msg-title" aria-expanded={open === t.id} onClick={() => setOpen(open === t.id ? null : t.id)}>
                <Icon name="wa" />
                <span>{t.title || "בלי שם"}</span>
                {t.id === MEETING_TEMPLATE ? <small>נשלחת אחרי קביעת פגישה</small> : needsMeeting(t) ? <small>ללקוח עם פגישה</small> : null}
              </button>
              <Order i={i} n={items.length} label={t.title} onMove={(by) => setItems(move(items, i, by))} />
              <button type="button" className="ib" aria-label={`הסרת ${t.title}`} disabled={t.id === MEETING_TEMPLATE} title={t.id === MEETING_TEMPLATE ? "הודעת פרטי הפגישה נשארת תמיד" : undefined} onClick={() => setItems(items.filter((x) => x.id !== t.id))}>
                <Icon name="x" />
              </button>
            </div>
            {open === t.id && <MessageForm t={t} sample={sample} onChange={(patch) => change(t.id, patch)} />}
          </li>
        ))}
      </ul>
      <div className="row-start">
        <button type="button" className="btn" disabled={items.length >= MAX_TEMPLATES} onClick={add}>
          <Icon name="plus" />
          הודעה חדשה
        </button>
        {JSON.stringify(items) !== JSON.stringify(DEFAULT_TEMPLATES) && (
          <button type="button" className="btn ghost" onClick={() => (setItems(DEFAULT_TEMPLATES), setOpen(null))}>
            חזרה לנוסחים המקוריים
          </button>
        )}
      </div>
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

function MessageForm({ t, sample, onChange }: { t: WaTemplate; sample: Record<string, string>; onChange: (patch: Partial<WaTemplate>) => void }) {
  const box = useRef<HTMLTextAreaElement>(null);
  const unknown = unknownFields(t.text);
  // a field goes where the cursor is
  function insert(key: string) {
    const el = box.current;
    const at = el ? el.selectionStart : t.text.length;
    const end = el ? el.selectionEnd : at;
    const token = `{${key}}`;
    onChange({ text: t.text.slice(0, at) + token + t.text.slice(end) });
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(at + token.length, at + token.length);
    });
  }
  return (
    <div className="set-msg-form">
      <label className="fld">
        <span>שם ההודעה, כמו שמופיע על הכפתור</span>
        <input value={t.title} maxLength={MAX_TITLE} onChange={(e) => onChange({ title: e.target.value })} />
      </label>
      <label className="fld">
        <span>הנוסח</span>
        <textarea ref={box} rows={Math.min(14, Math.max(4, t.text.split("\n").length + 1))} maxLength={MAX_TEXT} value={t.text} onChange={(e) => onChange({ text: e.target.value })} />
      </label>
      <div className="set-fields" role="group" aria-label="פרטים שמתמלאים לבד">
        <span className="muted">להוסיף פרט:</span>
        {FIELDS.map((f) => (
          <button key={f.key} type="button" className="tpl" title={f.label} onClick={() => insert(f.key)}>
            {`{${f.key}}`}
          </button>
        ))}
      </div>
      {unknown.length > 0 && (
        <p className="warn-line">
          <Icon name="alert" />
          <span>{unknown.map((k) => `{${k}}`).join(", ")} לא מוכר למערכת, ויישלח כמו שהוא. הפרטים שמתמלאים לבד מופיעים בכפתורים למעלה.</span>
        </p>
      )}
      <div className="set-preview">
        <span className="muted">כך הלקוח יקבל את ההודעה:</span>
        <p>{fillTemplate(t.text, sample)}</p>
      </div>
    </div>
  );
}
