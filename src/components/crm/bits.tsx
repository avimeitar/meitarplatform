import Link from "next/link";
import { MS, ST, type LeadStatus, type MeetingStatus } from "@/lib/crm/constants";
import { dayLabel, fT, sameDay, sod } from "@/lib/crm/dates";

export function initials(name: string): string {
  const p = name.trim().split(/\s+/);
  return (p[0]?.[0] ?? "") + (p[1]?.[0] ?? "");
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

export function StatusPill({ status }: { status: string }) {
  const s = ST[status as LeadStatus];
  return <span className={"st-pill " + (s?.c ?? "")}>{s?.l ?? status}</span>;
}

export function MeetingPill({ status }: { status: string }) {
  const s = MS[status as MeetingStatus];
  return <span className={"st-pill " + (s?.c ?? "")}>{s?.l ?? status}</span>;
}

export function Owner({ name }: { name: string | null }) {
  if (!name)
    return (
      <span className="owner">
        <span className="av sm ghost">?</span>
        <span className="muted">לא שויך</span>
      </span>
    );
  return (
    <span className="owner">
      <span className="av sm">{initials(name)}</span>
      {name}
    </span>
  );
}

export function LeadLink({ id, name, sub }: { id: string; name: string; sub?: React.ReactNode }) {
  return (
    <Link className="lk" href={`/leads/${id}`}>
      <b>{name}</b>
      {sub ? <small>{sub}</small> : null}
    </Link>
  );
}

/** "היום 16:00" in amber, overdue in red. */
export function Due({ at, now }: { at: string | null; now?: Date }) {
  if (!at) return <span className="muted">—</span>;
  const d = new Date(at);
  const n = now ?? new Date();
  const late = d < sod(n) && !sameDay(d, n);
  const today = sameDay(d, n);
  return <span suppressHydrationWarning className={"due" + (late ? " late" : today ? " today" : "")}>{late ? "באיחור, " : ""}{dayLabel(d, n)} {fT(d)}</span>;
}

/** Phone numbers stay left-to-right inside Hebrew text. */
export function Phone({ value }: { value: string }) {
  return <span className="ltr">{value}</span>;
}

export function nOf(n: number, one: string, many: string): string {
  return n === 1 ? one : `${n} ${many}`;
}
