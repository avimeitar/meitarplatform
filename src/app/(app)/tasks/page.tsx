import Link from "next/link";
import type { Prisma } from "@/generated/prisma/client";
import { TaskList } from "@/components/crm/TaskList";
import { addDays, sod, weekStart } from "@/lib/crm/dates";
import { openTaskWhere, taskRow } from "@/lib/crm/views";
import { prisma } from "@/lib/db";
import { can, requirePageUser } from "@/lib/session";
import { NewTaskButton } from "./NewTaskButton";

export const metadata = { title: "משימות" };

export default async function TasksPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const u = await requirePageUser();
  const sp = await searchParams;
  const canOthers = can(u, "tasks.assign");
  const today = sod(new Date());
  const f = ["open", "late", "today", "done"].includes(sp.f ?? "") ? (sp.f as string) : "open";
  const people = canOthers ? await prisma.user.findMany({ where: { active: true, deletedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true } }) : [];
  const userId = canOthers ? (sp.user && people.some((p) => p.id === sp.user) ? sp.user : sp.user === "all" ? null : null) : u.id;
  const who: Prisma.TaskWhereInput = userId ? { userId } : {};
  const where: Prisma.TaskWhereInput =
    f === "done"
      ? { ...who, done: true, voided: false, doneAt: { gte: weekStart() } }
      : f === "late"
        ? openTaskWhere({ ...who, dueAt: { lt: today } })
        : f === "today"
          ? openTaskWhere({ ...who, dueAt: { gte: today, lt: addDays(today, 1) } })
          : openTaskWhere(who);
  const tasks = await prisma.task.findMany({ where, orderBy: f === "done" ? { doneAt: "desc" } : { dueAt: "asc" }, take: 300, include: { lead: { select: { name: true } }, user: { select: { name: true } } } });
  const href = (extra: Record<string, string>) => `/tasks?${new URLSearchParams({ f, ...(userId ? { user: userId } : {}), ...extra })}`;
  const F: [string, string][] = [
    ["open", "פתוחות"],
    ["late", "באיחור"],
    ["today", "להיום"],
    ["done", "בוצעו השבוע"],
  ];
  return (
    <section>
      <div className="page-head">
        <div>
          <h1>משימות</h1>
          <p className="sub">{canOthers ? "המשימות של כל הצוות. אפשר לתת משימה לכל אחד." : "המשימות שלך. משימה שמסמנים כבוצעה נשארת במקום כמה דקות, למקרה של טעות."}</p>
        </div>
        <div className="head-actions">
          <NewTaskButton people={people} meId={u.id} canAssign={canOthers} />
        </div>
      </div>
      <div className="toolbar">
        <div className="seg" role="group" aria-label="אילו משימות">
          {F.map(([k, l]) => (
            <Link key={k} className={k === f ? "on" : ""} href={href({ f: k })}>
              {l}
            </Link>
          ))}
        </div>
        {canOthers && (
          <form action="/tasks" className="filters">
            <input type="hidden" name="f" value={f} />
            <label className="sel">
              <span className="sr">של מי</span>
              <select name="user" defaultValue={userId ?? ""}>
                <option value="">כל הצוות</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="btn sm">
              הצגה
            </button>
          </form>
        )}
      </div>
      <div className="panel">
        <TaskList tasks={tasks.map(taskRow)} showUser={canOthers} empty={f === "done" ? "עוד לא בוצעו משימות השבוע." : "אין משימות כאן."} />
      </div>
    </section>
  );
}
