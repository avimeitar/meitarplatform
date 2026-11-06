import Link from "next/link";
import { AUDIT_LABELS } from "@/lib/audit";
import { fD, fT } from "@/lib/crm/dates";
import { prisma } from "@/lib/db";
import { requirePageUser } from "@/lib/session";

export const metadata = { title: "יומן פעולות" };
const PAGE = 100;

const GROUPS: Record<string, string> = { auth: "כניסות", user: "משתמשים", role: "הרשאות", lead: "לידים", apikey: "קליטת לידים", project: "פרויקטים" };

function describe(meta: unknown): string {
  if (!meta || typeof meta !== "object") return "";
  const m = meta as Record<string, unknown>;
  const parts: string[] = [];
  if (m.channel) parts.push(m.channel === "whatsapp" ? "בוואטסאפ" : "ב-SMS");
  if (m.from && m.to) parts.push(`מ״${m.from}״ ל״${m.to}״`);
  else if (m.to) parts.push(`ל${m.to}`);
  if (m.role) parts.push(String(m.role));
  if (typeof m.leads === "number") parts.push(`${m.leads} לידים הועברו`);
  if (typeof m.count === "number") parts.push(`${m.count} לידים`);
  if (Array.isArray(m.added) && m.added.length) parts.push("נוסף: " + m.added.join(", "));
  if (Array.isArray(m.removed) && m.removed.length) parts.push("הוסר: " + m.removed.join(", "));
  if (m.smsSent === true) parts.push("נשלח ב-SMS");
  return parts.join(" · ");
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePageUser("audit.view");
  const sp = await searchParams;
  const group = sp.g && GROUPS[sp.g] ? sp.g : "";
  const page = Math.max(0, Number(sp.p) || 0);
  const where = group ? { action: { startsWith: group + "." } } : {};
  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: page * PAGE, take: PAGE }),
    prisma.auditLog.count({ where }),
  ]);
  const href = (g: string, p = 0) => `/audit?${new URLSearchParams({ ...(g ? { g } : {}), ...(p ? { p: String(p) } : {}) })}`;
  return (
    <section>
      <div className="page-head">
        <div>
          <h1>יומן פעולות</h1>
          <p className="sub">מי נכנס, מי קיבל קוד, ומי שינה משתמשים, הרשאות ולידים. נשמר לפי דרישות אבטחת המידע.</p>
        </div>
      </div>
      <div className="toolbar">
        <div className="seg" role="group" aria-label="סינון">
          <Link className={!group ? "on" : ""} href={href("")}>
            הכול
          </Link>
          {Object.entries(GROUPS).map(([k, v]) => (
            <Link key={k} className={group === k ? "on" : ""} href={href(k)}>
              {v}
            </Link>
          ))}
        </div>
      </div>
      <div className="panel flush">
        <table className="data audit">
          <thead>
            <tr>
              <th>מתי</th>
              <th>מי</th>
              <th>מה קרה</th>
              <th>על מי או על מה</th>
              <th>פרטים</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={r.action.includes("failed") || r.action.includes("limit") || r.action.includes("blocked") ? "warn-row" : ""}>
                <td className="num">
                  {fD(r.createdAt)}.{String(r.createdAt.getFullYear()).slice(2)} {fT(r.createdAt)}
                </td>
                <td>{r.actorName ?? <span className="muted">לא מזוהה</span>}</td>
                <td>{AUDIT_LABELS[r.action] ?? r.action}</td>
                <td>
                  <bdi>{r.targetName ?? ""}</bdi>
                </td>
                <td className="muted">
                  {describe(r.meta)}
                  {r.ip ? <small className="ltr">{r.ip}</small> : null}
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={5} className="empty">
                  אין עדיין פעולות ביומן.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {total > PAGE && (
        <div className="more-row">
          {page > 0 && (
            <Link className="btn" href={href(group, page - 1)}>
              חדשים יותר
            </Link>
          )}
          {(page + 1) * PAGE < total && (
            <Link className="btn" href={href(group, page + 1)}>
              ישנים יותר
            </Link>
          )}
        </div>
      )}
    </section>
  );
}
