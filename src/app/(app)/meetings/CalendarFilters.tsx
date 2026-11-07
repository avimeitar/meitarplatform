"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/Icon";

/** Person, project and cancelled meetings: each change updates the calendar right away. */
export function CalendarFilters({ people, projects, person, project, cancelled }: { people: { id: string; name: string }[]; projects: { id: string; name: string }[]; person: string; project: string; cancelled: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  // on a phone the filters fold away behind one button, so the calendar starts higher
  const active = [person, project, cancelled ? "1" : ""].filter(Boolean).length;
  const [open, setOpen] = useState(active > 0);
  function set(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    next.set("view", "cal");
    if (value) next.set(key, value);
    else next.delete(key);
    // choosing a person shows the whole team's calendar for that person
    if (key === "person" && value) next.set("who", "all");
    router.push(`${pathname}?${next.toString()}`);
  }
  return (
    <>
      <button type="button" className={"filter cal-ftoggle" + (active ? " on" : "")} aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="filter" />
        {open ? "הסתרת הסינון" : "סינון"}
        {active ? ` (${active})` : ""}
      </button>
    <div className={"cal-filters" + (open ? " open" : "")}>
      {people.length > 0 && (
        <label className="sel">
          <span className="sr">של מי</span>
          <select value={person} onChange={(e) => set("person", e.target.value)}>
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
        <select value={project} onChange={(e) => set("project", e.target.value)}>
          <option value="">כל הפרויקטים</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label className="check cal-cancel">
        <input type="checkbox" checked={cancelled} onChange={(e) => set("cancelled", e.target.checked ? "1" : "")} />
        <span>להציג גם פגישות שבוטלו</span>
      </label>
    </div>
    </>
  );
}
