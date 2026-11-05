"use client";

import { useState } from "react";
import { addTaskAction } from "@/app/actions/leads";
import { Icon } from "@/components/Icon";
import { useDrawer } from "@/components/ui/Overlays";
import { useRunner } from "@/components/ui/useRunner";
import { addDays, dayLabel, fD, iso, nextWorkday, sod } from "@/lib/crm/dates";

function TaskForm({ people, meId, canAssign }: { people: { id: string; name: string }[]; meId: string; canAssign: boolean }) {
  const drawer = useDrawer();
  const runner = useRunner();
  const [title, setTitle] = useState("");
  const [day, setDay] = useState(iso(nextWorkday()));
  const [time, setTime] = useState("10:00");
  const [userId, setUserId] = useState(meId);
  const [error, setError] = useState("");
  const days = Array.from({ length: 10 }, (_, i) => addDays(sod(new Date()), i)).filter((d) => d.getDay() !== 6);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (title.trim().length < 2) return setError("צריך לכתוב מה לעשות");
    const r = await runner(addTaskAction({ title, day, time, userId }));
    if (r.ok) drawer.close();
    else setError(r.error);
  }
  return (
    <form onSubmit={submit} noValidate>
      <label className="fld">
        <span className="req">מה צריך לעשות?</span>
        <textarea rows={2} value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <div className="frow">
        <label className="fld">
          <span>מתי</span>
          <select value={day} onChange={(e) => setDay(e.target.value)}>
            {days.map((d) => (
              <option key={iso(d)} value={iso(d)}>
                {dayLabel(d)}
                {dayLabel(d).includes(" ") ? "" : ` (${fD(d)})`}
              </option>
            ))}
          </select>
        </label>
        <label className="fld">
          <span>שעה</span>
          <input type="time" step={900} value={time} onChange={(e) => setTime(e.target.value)} />
        </label>
      </div>
      {canAssign && (
        <label className="fld">
          <span>למי</span>
          <select value={userId} onChange={(e) => setUserId(e.target.value)}>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.id === meId ? " (אני)" : ""}
              </option>
            ))}
          </select>
        </label>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <footer>
        <button type="button" className="btn ghost" onClick={drawer.close}>
          ביטול
        </button>
        <button type="submit" className="btn primary">
          הוספת משימה
        </button>
      </footer>
    </form>
  );
}

export function NewTaskButton(props: { people: { id: string; name: string }[]; meId: string; canAssign: boolean }) {
  const drawer = useDrawer();
  return (
    <button type="button" className="btn primary" onClick={() => drawer.open({ title: props.canAssign ? "משימה חדשה" : "משימה חדשה לעצמי", content: <TaskForm {...props} /> })}>
      <Icon name="plus" />
      {props.canAssign ? "משימה חדשה" : "משימה"}
    </button>
  );
}
