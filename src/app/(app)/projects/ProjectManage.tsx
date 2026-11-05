"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createProjectAction, setProjectActiveAction, updateProjectAction } from "@/app/actions/projects";
import { Icon } from "@/components/Icon";
import { useDrawer, useToast } from "@/components/ui/Overlays";

export type ProjectView = { id: string; name: string; fullName: string; place: string };

export function NewProjectButton() {
  const drawer = useDrawer();
  return (
    <button type="button" className="btn primary" onClick={() => drawer.open({ title: "פרויקט חדש", content: <ProjectForm /> })}>
      <Icon name="plus" />
      פרויקט חדש
    </button>
  );
}

export function EditProjectButton({ project }: { project: ProjectView }) {
  const drawer = useDrawer();
  return (
    <button type="button" className="btn" onClick={() => drawer.open({ title: project.name, content: <ProjectManage project={project} /> })}>
      עריכה
    </button>
  );
}

export function ReactivateProjectButton({ project }: { project: ProjectView }) {
  const toast = useToast();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function reactivate() {
    setBusy(true);
    const r = await setProjectActiveAction(project.id, true);
    setBusy(false);
    toast(r.ok ? (r.message ?? "הפרויקט חזר לפעילות") : r.error);
    if (r.ok) router.refresh();
  }
  return (
    <button type="button" className="btn" disabled={busy} onClick={reactivate}>
      {busy ? "מחזירים…" : "להחזיר לפעילות"}
    </button>
  );
}

function ProjectForm({ project }: { project?: ProjectView }) {
  const drawer = useDrawer();
  const toast = useToast();
  const router = useRouter();
  const [name, setName] = useState(project?.name ?? "");
  const [fullName, setFullName] = useState(project?.fullName ?? "");
  const [place, setPlace] = useState(project?.place ?? "");
  const [err, setErr] = useState<{ field?: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (name.trim().length < 2) return setErr({ field: "name", text: "צריך לכתוב שם קצר לפרויקט" });
    if (place.trim().length < 2) return setErr({ field: "place", text: "צריך לכתוב איפה הפרויקט" });
    setBusy(true);
    const input = { name, fullName, place };
    const r = project ? await updateProjectAction(project.id, input) : await createProjectAction(input);
    setBusy(false);
    if (!r.ok) return setErr({ field: r.field, text: r.error });
    toast(r.message ?? "נשמר");
    drawer.close();
    router.refresh();
  }

  const fe = (f: string) =>
    err?.field === f ? (
      <small className="err" role="alert">
        {err.text}
      </small>
    ) : null;

  return (
    <form className="rp-form" onSubmit={submit} noValidate>
      <label className="fld">
        <span className="req">שם קצר</span>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoComplete="off" aria-invalid={err?.field === "name"} />
        <small>כך הפרויקט מופיע ברשימות ובבחירת פרויקט לליד. למשל: מטרופארק</small>
        {fe("name")}
      </label>
      <label className="fld">
        <span>שם מלא</span>
        <input value={fullName} onChange={(e) => setFullName(e.target.value)} maxLength={80} autoComplete="off" aria-invalid={err?.field === "fullName"} />
        <small>מופיע בכרטיס הפרויקט. אם משאירים ריק, משתמשים בשם הקצר. למשל: מטרופארק פתח תקווה</small>
        {fe("fullName")}
      </label>
      <label className="fld">
        <span className="req">מקום</span>
        <input value={place} onChange={(e) => setPlace(e.target.value)} maxLength={60} autoComplete="off" aria-invalid={err?.field === "place"} />
        <small>עיר או ארץ. למשל: פתח תקווה, או יוון</small>
        {fe("place")}
      </label>
      {err && !["name", "fullName", "place"].includes(err.field ?? "") && (
        <p className="form-error" role="alert">
          {err.text}
        </p>
      )}
      <footer>
        <button type="button" className="btn ghost" onClick={drawer.close}>
          ביטול
        </button>
        <button type="submit" className="btn primary" disabled={busy}>
          {busy ? "שומרים…" : project ? "שמירה" : "הוספה"}
        </button>
      </footer>
    </form>
  );
}

function ProjectManage({ project }: { project: ProjectView }) {
  const drawer = useDrawer();
  const toast = useToast();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function deactivate() {
    setBusy(true);
    setError("");
    const r = await setProjectActiveAction(project.id, false);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    toast(r.message ?? "הפרויקט הושבת");
    drawer.close();
    // the project's detail view is gone with it
    router.replace("/projects", { scroll: false });
  }

  return (
    <div className="sheet-body">
      <ProjectForm project={project} />
      <h3 className="sec-h">פעולות</h3>
      <div className="opts">
        <button type="button" className="opt warn" disabled={busy} onClick={deactivate}>
          <span className="oi">
            <Icon name="lock" />
          </span>
          <span>
            <b>להשבית את הפרויקט</b>
            <small>לא יופיע בבחירת פרויקט לליד חדש ובדוח הפרויקטים. הלידים והעסקאות שלו נשמרים, ואפשר להחזיר אותו בכל רגע</small>
          </span>
        </button>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
