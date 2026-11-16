"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { startTransition, useOptimistic, useState } from "react";
import { Icon } from "@/components/Icon";

type Chosen = { person: string; project: string; cancelled: boolean };

/**
 * Person and project, in the calendar and in the list, and cancelled meetings in the calendar.
 * Each change updates the meetings right away; the new choice shows at once, while the server prepares them.
 */
export function CalendarFilters({
  view,
  people,
  projects,
  person,
  project,
  cancelled,
}: {
  view: "cal" | "list";
  people: { id: string; name: string }[];
  projects: { id: string; name: string }[];
  person: string;
  project: string;
  cancelled: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [shown, setShown] = useOptimistic<Chosen>({ person, project, cancelled });
  const [pending, setPending] = useOptimistic(false);
  // on a phone the filters fold away behind one button, so the meetings start higher
  const active = [shown.person, shown.project, view === "cal" && shown.cancelled ? "1" : ""].filter(Boolean).length;
  const [open, setOpen] = useState(active > 0);
  function set(change: Partial<Chosen>) {
    const f = { ...shown, ...change };
    const next = new URLSearchParams(params.toString());
    next.set("view", view);
    for (const [k, v] of [
      ["person", f.person],
      ["project", f.project],
      ["cancelled", f.cancelled ? "1" : ""],
    ] as const) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    // choosing a person shows the whole team's meetings for that person; the list starts again from the top
    if (change.person) next.set("who", "all");
    next.delete("limit");
    startTransition(async () => {
      setShown(f);
      setPending(true);
      router.push(`${pathname}?${next.toString()}`, { scroll: false });
    });
  }
  return (
    <>
      <button type="button" className={"filter cal-ftoggle" + (active ? " on" : "")} aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="filter" />
        {open ? "הסתרת הסינון" : "סינון"}
        {active ? ` (${active})` : ""}
      </button>
      <div className={"cal-filters" + (open ? " open" : "")} data-pending={pending ? "" : undefined} aria-busy={pending || undefined}>
        {people.length > 0 && (
          <label className="sel">
            <span className="sr">של מי</span>
            <select value={shown.person} onChange={(e) => set({ person: e.target.value })}>
              <option value="">כל האנשים</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="sel">
          <span className="sr">פרויקט</span>
          <select value={shown.project} onChange={(e) => set({ project: e.target.value })}>
            <option value="">כל הפרויקטים</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        {view === "cal" && (
          <label className="check cal-cancel">
            <input type="checkbox" checked={shown.cancelled} onChange={(e) => set({ cancelled: e.target.checked })} />
            <span>להציג גם פגישות שבוטלו</span>
          </label>
        )}
        {(shown.person || shown.project) && (
          <button type="button" className="btn ghost sm" onClick={() => set({ person: "", project: "" })}>
            להציג הכול
          </button>
        )}
      </div>
    </>
  );
}
