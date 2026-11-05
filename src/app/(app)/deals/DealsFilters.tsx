"use client";

import { useRouter } from "next/navigation";
import { startTransition, useOptimistic } from "react";

type Option = { id: string; label: string };
type Filters = { agent: string; project: string };

/** Agent and project filters. They live in the address (?agent=&project=), so a filtered report can be shared or bookmarked. */
export function DealsFilters({ agents, projects, agent, project }: { agents: Option[]; projects: Option[] } & Filters) {
  const router = useRouter();
  // show the new choice right away, while the server prepares the filtered report
  const [view, setView] = useOptimistic<Filters>({ agent, project });
  const [pending, setPending] = useOptimistic(false);

  function change(next: Partial<Filters>) {
    const f = { ...view, ...next };
    const q = new URLSearchParams();
    if (f.agent) q.set("agent", f.agent);
    if (f.project) q.set("project", f.project);
    const qs = q.toString();
    startTransition(async () => {
      setView(f);
      setPending(true);
      router.push(qs ? `/deals?${qs}` : "/deals", { scroll: false });
    });
  }

  return (
    <div className="toolbar" data-pending={pending ? "" : undefined} aria-busy={pending || undefined}>
      <label className="sel">
        <span className="sr">סוכן</span>
        <select value={view.agent} onChange={(e) => change({ agent: e.target.value })}>
          <option value="">כל הצוות</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </select>
      </label>
      <label className="sel">
        <span className="sr">פרויקט</span>
        <select value={view.project} onChange={(e) => change({ project: e.target.value })}>
          <option value="">כל הפרויקטים</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      {(view.agent || view.project) && (
        <button type="button" className="btn ghost sm" onClick={() => change({ agent: "", project: "" })}>
          להציג הכול
        </button>
      )}
    </div>
  );
}
