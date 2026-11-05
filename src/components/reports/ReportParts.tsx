// Small pieces shared by the report screens (projects, closed deals). Rendered on the server.
import { MON } from "@/lib/crm/dates";

const TONES = ["p1", "p2", "p3", "p4"];
const MON_SHORT = ["ינו׳", "פבר׳", "מרץ", "אפר׳", "מאי", "יוני", "יולי", "אוג׳", "ספט׳", "אוק׳", "נוב׳", "דצמ׳"];

/** The same person always gets the same avatar color. */
function tone(id: string): string {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TONES[h % TONES.length];
}

function initials(name: string): string {
  const p = name.trim().split(/\s+/);
  return (p[0]?.[0] ?? "") + (p[1]?.[0] ?? "");
}

/** A person with their initials. Without a person: "לא שויך". */
export function Owner({ id, name, inactive }: { id: string | null; name: string | null; inactive?: boolean }) {
  if (!id || !name)
    return (
      <span className="owner muted">
        <span className="av sm ghost" aria-hidden="true">
          ?
        </span>
        לא שויך
      </span>
    );
  return (
    <span className="owner">
      <span className={"av sm " + tone(id)} aria-hidden="true">
        {initials(name)}
      </span>
      {name}
      {inactive && <small className="rp-off">לא פעיל</small>}
    </span>
  );
}

/** A short bar and its number, scaled to the biggest value in the list. The full length can be narrowed with --ibar-w (phones). */
export function IBar({ n, max, width = 140 }: { n: number; max: number; width?: number }) {
  const share = Math.round((n / Math.max(1, max)) * 1000) / 1000;
  return (
    <div className="ibar">
      <i style={{ width: `calc(${share} * var(--ibar-w, ${width}px))` }} />
      <b>{n}</b>
    </div>
  );
}

const dealsWord = (n: number) => (n === 1 ? "עסקה אחת" : n ? `${n} עסקאות` : "אין עסקאות");

/** Deals per month as columns, oldest on the right. Every column shows its number, since phones have no hover. */
export function MonthChart({ months }: { months: { start: Date; deals: number }[] }) {
  const max = Math.max(1, ...months.map((m) => m.deals));
  const label = months.map((m) => `${MON[m.start.getMonth()]}: ${m.deals}`).join(", ");
  return (
    <>
      <div className="vchart" role="img" aria-label={"עסקאות שנחתמו בכל חודש. " + label}>
        {months.map((m) => {
          const h = Math.round((m.deals / max) * 100);
          return (
            <div key={m.start.toISOString()} className="vbar" title={`${MON[m.start.getMonth()]} ${m.start.getFullYear()}: ${dealsWord(m.deals)}`}>
              <b className="num" style={{ bottom: `calc(${h}% + 4px)` }}>
                {m.deals}
              </b>
              <i style={{ height: h + "%" }} />
            </div>
          );
        })}
      </div>
      <div className="vx" aria-hidden="true">
        {months.map((m) => (
          <span key={m.start.toISOString()}>
            <span className="rp-mon">{MON[m.start.getMonth()]}</span>
            <span className="rp-mon-s">{MON_SHORT[m.start.getMonth()]}</span>
          </span>
        ))}
      </div>
    </>
  );
}
