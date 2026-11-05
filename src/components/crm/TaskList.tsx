"use client";

import Link from "next/link";
import { taskDoneAction } from "@/app/actions/leads";
import { useRunner } from "@/components/ui/useRunner";
import { Due } from "./bits";

export type TaskItem = { id: string; title: string; dueAt: string; done: boolean; leadId: string | null; leadName: string | null; userName: string | null };

/** The whole row is the tap target. A task done a moment ago stays where it was (struck through) so the list doesn't jump. */
export function TaskList({ tasks, showUser = false, empty = "אין משימות." }: { tasks: TaskItem[]; showUser?: boolean; empty?: string }) {
  const runner = useRunner();
  if (!tasks.length) return <p className="empty">{empty}</p>;
  return (
    <ul className="tlist">
      {tasks.map((t) => (
        <li key={t.id}>
          <label className="trow">
            <input type="checkbox" checked={t.done} onChange={(e) => runner(taskDoneAction(t.id, e.target.checked))} aria-label={`סימון ${t.title} כבוצעה`} />
            <div className="t-main">
              <span className={t.done ? "t-done" : ""}>{t.title}</span>
              <small>
                {t.done ? <span className="due">בוצעה</span> : <Due at={t.dueAt} />}
                {showUser && t.userName ? ` · ${t.userName}` : ""}
              </small>
            </div>
            {t.leadId && (
              <Link className="link" href={`/leads/${t.leadId}`} onClick={(e) => e.stopPropagation()}>
                לכרטיס
              </Link>
            )}
          </label>
        </li>
      ))}
    </ul>
  );
}
