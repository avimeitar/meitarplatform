"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { dueTasksAction, taskDoneAction } from "@/app/actions/leads";
import { Icon } from "@/components/Icon";
import { useRunner } from "@/components/ui/useRunner";
import { fT } from "@/lib/crm/dates";

type DueTask = { id: string; title: string; dueAt: string; leadId: string | null; leadName: string | null };

// which reminders this browser already showed, and until when to stay quiet about them
const KEY = "meitar.task-seen";
function readSeen(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}") as Record<string, number>;
  } catch {
    return {};
  }
}
function markSeen(id: string, until: number) {
  try {
    const s = readSeen();
    s[id] = until;
    const now = Date.now();
    for (const k of Object.keys(s)) if (s[k] < now) delete s[k];
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // private browsing: the reminder may show again, nothing worse
  }
}

/** When a task's time comes, it pops up on screen for the person it belongs to (checked every minute while the system is open). */
export function TaskReminders() {
  const runner = useRunner();
  const router = useRouter();
  const [queue, setQueue] = useState<DueTask[]>([]);

  const check = useCallback(async () => {
    if (document.visibilityState !== "visible") return;
    const r = await dueTasksAction().catch(() => null);
    if (!r?.ok || !r.data) return;
    const seen = readSeen();
    const now = Date.now();
    setQueue(r.data.filter((t) => !(seen[t.id] > now)));
  }, []);

  useEffect(() => {
    const start = setTimeout(check, 3000);
    const every = setInterval(check, 60_000);
    const onShow = () => document.visibilityState === "visible" && check();
    document.addEventListener("visibilitychange", onShow);
    return () => {
      clearTimeout(start);
      clearInterval(every);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [check]);

  const t = queue[0];
  if (!t) return null;

  // a dismissed reminder stays quiet until the task is no longer "just due"
  const done = () => markSeen(t.id, new Date(t.dueAt).getTime() + 3_600_000);
  const next = () => setQueue((q) => q.slice(1));
  // docked at the bottom, without blocking the screen or taking the cursor from what the person is typing
  return (
    <div className="remind-dock">
      <div className="remind" role="dialog" aria-modal="false" aria-live="assertive" aria-labelledby="remind-h" aria-describedby="remind-d">
        <p className="remind-kicker">
          <Icon name="bell" />
          הגיע הזמן למשימה
        </p>
        <h2 id="remind-h">{t.title}</h2>
        <p id="remind-d" className="muted">
          {t.leadName ? `${t.leadName} · ` : ""}עד {fT(new Date(t.dueAt))}
        </p>
        <div className="remind-acts">
          <button
            type="button"
            className="bigbtn call"
            onClick={async () => {
              done();
              next();
              await runner(taskDoneAction(t.id, true));
            }}
          >
            <Icon name="check" />
            בוצע
          </button>
          <button
            type="button"
            className="bigbtn light"
            onClick={() => {
              done();
              next();
              router.push(t.leadId ? `/leads/${t.leadId}` : "/tasks");
            }}
          >
            {t.leadId ? "לכרטיס הלקוח" : "למשימות"}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              markSeen(t.id, Date.now() + 15 * 60_000);
              next();
            }}
          >
            להזכיר בעוד 15 דקות
          </button>
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              done();
              next();
            }}
          >
            סגירה
          </button>
        </div>
        {queue.length > 1 && <p className="muted">ועוד {queue.length - 1 === 1 ? "משימה אחת" : `${queue.length - 1} משימות`} שהגיע זמנן</p>}
      </div>
    </div>
  );
}
