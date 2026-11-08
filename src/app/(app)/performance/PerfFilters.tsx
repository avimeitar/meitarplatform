"use client";

import { useRouter } from "next/navigation";
import { startTransition, useOptimistic, useState } from "react";
import { PERIODS, type PeriodKey } from "@/lib/crm/perfFormat";

type Option = { id: string; label: string };
type View = { p: PeriodKey; project: string; source: string; rep: string };

/** Period, project, source and rep. They live in the address, so a view can be shared or bookmarked. */
export function PerfFilters({
  period,
  projects,
  sources,
  reps,
  value,
}: {
  period: { key: PeriodKey; from: string; to: string };
  projects: Option[];
  sources: string[];
  reps: Option[];
  value: { project: string; source: string; rep: string };
}) {
  const router = useRouter();
  // the new choice shows at once, while the server counts
  const [view, setView] = useOptimistic<View>({ p: period.key, ...value });
  const [pending, setPending] = useOptimistic(false);

  function go(next: Partial<View>, range?: { from: string; to: string }) {
    const f = { ...view, ...next };
    const q = new URLSearchParams();
    if (f.p !== "month") q.set("p", f.p);
    if (f.p === "custom") {
      q.set("from", range?.from ?? period.from);
      q.set("to", range?.to ?? period.to);
    }
    if (f.project) q.set("project", f.project);
    if (f.source) q.set("source", f.source);
    if (f.rep) q.set("rep", f.rep);
    const qs = q.toString();
    startTransition(async () => {
      setView(f);
      setPending(true);
      router.push(qs ? `/performance?${qs}` : "/performance", { scroll: false });
    });
  }

  return (
    <div className="toolbar perf-tools" data-pending={pending ? "" : undefined} aria-busy={pending || undefined}>
      <div className="seg" role="group" aria-label="תקופה">
        {PERIODS.map((p) => (
          <button key={p.key} type="button" className={view.p === p.key ? "on" : ""} aria-pressed={view.p === p.key} onClick={() => go({ p: p.key })}>
            {p.label}
          </button>
        ))}
        <button type="button" className={view.p === "custom" ? "on" : ""} aria-pressed={view.p === "custom"} onClick={() => go({ p: "custom" })}>
          טווח אחר
        </button>
      </div>
      {view.p === "custom" && <CustomRange key={period.from + period.to} from={period.from} to={period.to} onShow={(r) => go({ p: "custom" }, r)} />}
      <div className="perf-sels">
        <label className="sel">
          <span className="sr">פרויקט</span>
          <select value={view.project} onChange={(e) => go({ project: e.target.value })}>
            <option value="">כל הפרויקטים</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className="sel">
          <span className="sr">מקור הגעה</span>
          <select value={view.source} onChange={(e) => go({ source: e.target.value })}>
            <option value="">כל המקורות</option>
            {sources.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className="sel">
          <span className="sr">נציג</span>
          <select value={view.rep} onChange={(e) => go({ rep: e.target.value })}>
            <option value="">כל הנציגים</option>
            {reps.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        {(view.project || view.source || view.rep) && (
          <button type="button" className="btn ghost sm" onClick={() => go({ project: "", source: "", rep: "" })}>
            להציג הכול
          </button>
        )}
      </div>
    </div>
  );
}

function CustomRange({ from, to, onShow }: { from: string; to: string; onShow: (r: { from: string; to: string }) => void }) {
  const [a, setA] = useState(from);
  const [b, setB] = useState(to);
  return (
    <form
      className="perf-range"
      onSubmit={(e) => {
        e.preventDefault();
        if (a && b) onShow({ from: a, to: b });
      }}
    >
      <label className="sel">
        <span>מ-</span>
        <input type="date" value={a} max={b || undefined} onChange={(e) => setA(e.target.value)} required />
      </label>
      <label className="sel">
        <span>עד</span>
        <input type="date" value={b} min={a || undefined} onChange={(e) => setB(e.target.value)} required />
      </label>
      <button type="submit" className="btn sm">
        הצגה
      </button>
    </form>
  );
}
