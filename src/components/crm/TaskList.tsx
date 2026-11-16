"use client";

import Link from "next/link";
import { taskDoneAction, taskStateAction } from "@/app/actions/leads";
import { useRunner } from "@/components/ui/useRunner";
import { TASK_STATE_ORDER, TASK_STATES, type TaskState } from "@/lib/crm/constants";
import { Due } from "./bits";

export type TaskItem = { id: string; title: string; dueAt: string; done: boolean; state?: TaskState; leadId: string | null; leadName: string | null; userName: string | null };

/** פתוחה, בטיפול, הושלמה, בוטלה: a compact choice next to the task. */
function TaskStateSelect({ id, state }: { id: string; state: TaskState }) {
  const runner = useRunner();
  return (
    <label className={"tsel " + TASK_STATES[state].c}>
      <span className="sr">סטטוס המשימה</span>
      <select value={state} onChange={(e) => e.target.value !== state && runner(taskStateAction(id, e.target.value))}>
        {TASK_STATE_ORDER.map((s) => (
          <option key={s} value={s}>
            {TASK_STATES[s].l}
          </option>
        ))}
      </select>
    </label>
  );
}

/** The row is the tap target for "done". A task done a moment ago stays where it was (struck through) so the list doesn't jump. */
export function TaskList({ tasks, showUser = false, empty = "אין משימות." }: { tasks: TaskItem[]; showUser?: boolean; empty?: string }) {
  const runner = useRunner();
  if (!tasks.length) return <p className="empty">{empty}</p>;
  return (
    <ul className="tlist">
      {tasks.map((t) => {
        const state = t.state ?? (t.done ? "done" : "open");
        return (
          <li key={t.id}>
            <label className="trow">
              <input type="checkbox" checked={t.done} onChange={(e) => runner(taskDoneAction(t.id, e.target.checked))} aria-label={`סימון ${t.title} כבוצעה`} />
              <div className="t-main">
                <span className={t.done ? "t-done" : ""}>{t.title}</span>
                <small>
                  {t.done ? <span className="due">{TASK_STATES[state].l}</span> : <Due at={t.dueAt} />}
                  {t.leadName ? ` · ${t.leadName}` : ""}
                  {showUser && t.userName ? ` · ${t.userName}` : ""}
                </small>
              </div>
              {t.leadId && (
                <Link className="link" href={`/leads/${t.leadId}`} onClick={(e) => e.stopPropagation()}>
                  לכרטיס
                </Link>
              )}
            </label>
            <TaskStateSelect id={t.id} state={state} />
          </li>
        );
      })}
    </ul>
  );
}
