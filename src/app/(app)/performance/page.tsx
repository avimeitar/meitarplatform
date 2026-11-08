import Link from "next/link";
import { Owner } from "@/components/reports/ReportParts";
import { hhmm } from "@/lib/hours";
import { performance, performanceOptions, periodOf, type MixRow, type PerfFilter, type RepRow, type Tiles } from "@/lib/crm/performance";
import { fmtMin, pctText, ratio } from "@/lib/crm/perfFormat";
import { requirePageUser } from "@/lib/session";
import { Columns } from "./PerfCharts";
import { PerfExport } from "./PerfExport";
import { PerfFilters } from "./PerfFilters";
import "../reports.css";

export const metadata = { title: "ביצועים" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/**
 * The change from the period before: an arrow and the earlier value ("▲ לעומת 31").
 * The earlier value, not a percent: on small numbers a percent jumps (1 → 13 is "1200%") and says little.
 * Up is not "good" or "bad" here (a faster response is a lower number), so there are no colors.
 */
function Delta({ cur, prev, kind }: { cur: number | null; prev: number | null; kind: "count" | "pct" | "minutes" }) {
  if (cur === null || prev === null) return null;
  const was = kind === "pct" ? `${prev}%` : kind === "minutes" ? fmtMin(prev) : String(prev);
  if (cur === prev) return <span className="dl">כמו בתקופה הקודמת</span>;
  const up = cur > prev;
  return (
    <span className="dl" title={`בתקופה הקודמת: ${was}`}>
      <span aria-hidden="true">{up ? "▲" : "▼"} </span>
      <span className="sr">{up ? "עלה" : "ירד"} </span>
      לעומת {was}
    </span>
  );
}

function Kpis({ t, prev }: { t: Tiles; prev: Tiles }) {
  return (
    <div className="kpis perf-kpis">
      <div className="kpi">
        <span>לידים חדשים</span>
        <b>{t.leads}</b>
        <Delta cur={t.leads} prev={prev.leads} kind="count" />
        <small>{t.returning ? `ועוד ${t.returning} פניות חוזרות` : "בלי פניות חוזרות"}</small>
      </div>
      <div className="kpi">
        <span>רלוונטיים</span>
        <b>{pctText(t.relevantPct)}</b>
        <Delta cur={t.relevantPct} prev={prev.relevantPct} kind="pct" />
        <small>{t.judged ? `${t.relevant} מתוך ${t.judged} שנבדקו` : "עוד אין לידים שנבדקו"}</small>
      </div>
      <div className="kpi">
        <span>פגישות שנקבעו</span>
        <b>{t.set}</b>
        <Delta cur={t.set} prev={prev.set} kind="count" />
        <small>{t.held === 1 ? "פגישה אחת התקיימה" : `${t.held} התקיימו`}</small>
      </div>
      <div className="kpi">
        <span>אחוז הגעה</span>
        <b>{pctText(t.showUpPct)}</b>
        <Delta cur={t.showUpPct} prev={prev.showUpPct} kind="pct" />
        <small>
          {t.held + t.canceled ? `${t.held} הגיעו מתוך ${t.held + t.canceled}` : "עוד אין פגישות שעברו"}
          {t.unmarked ? <em className="warn-text">, {t.unmarked} לא עודכנו</em> : null}
        </small>
      </div>
      <div className="kpi">
        <span>עסקאות</span>
        <b>{t.deals}</b>
        <Delta cur={t.deals} prev={prev.deals} kind="count" />
        <small>שנחתמו בתקופה</small>
      </div>
      <div className="kpi">
        <span>זמן תגובה</span>
        <b>{fmtMin(t.responseMin)}</b>
        <Delta cur={t.responseMin} prev={prev.responseMin} kind="minutes" />
        <small>חציון, בשעות העבודה</small>
      </div>
    </div>
  );
}

const FUNNEL = ["לידים", "רלוונטיים", "נקבעה פגישה", "התקיימה פגישה", "נחתמה עסקה"];

export default async function PerformancePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePageUser("reports.view");
  const sp = await searchParams;
  const now = new Date();
  const opts = await performanceOptions();
  const period = periodOf({ p: one(sp.p), from: one(sp.from), to: one(sp.to) }, now);
  // only filters that point at something real
  const f: PerfFilter = {
    projectId: opts.projects.find((x) => x.id === one(sp.project))?.id ?? null,
    source: opts.sources.includes(one(sp.source)) ? one(sp.source) : null,
    repId: opts.reps.find((x) => x.id === one(sp.rep))?.id ?? null,
  };
  const r = await performance(period, f, now);

  const here = (extra: Record<string, string | null>) => {
    const q = new URLSearchParams();
    const all: Record<string, string | null> = {
      p: period.key === "month" ? null : period.key,
      from: period.key === "custom" ? period.from : null,
      to: period.key === "custom" ? period.to : null,
      project: f.projectId,
      source: f.source,
      rep: f.repId,
      ...extra,
    };
    for (const [k, v] of Object.entries(all)) if (v) q.set(k, v);
    const s = q.toString();
    return s ? `/performance?${s}` : "/performance";
  };
  // the leads behind a number, on the leads list
  const leads = (extra: Record<string, string | null>) => {
    const q = new URLSearchParams({ view: "all", from: period.from, to: period.to });
    const all: Record<string, string | null> = { project: f.projectId, source: f.source, owner: f.repId, ...extra };
    for (const [k, v] of Object.entries(all)) if (v) q.set(k, v);
    else q.delete(k);
    return `/leads?${q}`;
  };
  const filtered = !!(f.projectId || f.source || f.repId);
  const repName = f.repId ? opts.reps.find((x) => x.id === f.repId)?.label : null;

  return (
    <section className="reports perf">
      <div className="page-head">
        <div>
          <h1>ביצועים</h1>
          <p className="sub">לידים, פגישות ועסקאות לפי נציג, מקור הגעה ופרויקט. נציגים לא רואים את המסך הזה.</p>
        </div>
        <div className="head-actions">
          <PerfExport period={{ title: period.title, from: period.from, to: period.to }} tiles={r.tiles} reps={r.reps} sources={r.sources} projects={r.projects} />
        </div>
      </div>
      <PerfFilters
        period={{ key: period.key, from: period.from, to: period.to }}
        projects={opts.projects}
        sources={opts.sources}
        reps={opts.reps}
        value={{ project: f.projectId ?? "", source: f.source ?? "", rep: f.repId ?? "" }}
      />
      <div className="rp-body">
        <p className="perf-when">
          <b>{period.title}</b>
          {repName ? <> · {repName}</> : null}
          <span className="muted"> · השינוי מחושב {period.vs}</span>
        </p>
        <Kpis t={r.tiles} prev={r.prev} />

        <div className="panel funnel perf-funnel">
          <div className="panel-head">
            <h2>הלידים שנכנסו בתקופה: מה קרה איתם עד היום</h2>
          </div>
          <ol className="metro big" aria-label="מליד לעסקה">
            {r.funnel.map((n, i) => (
              <li key={FUNNEL[i]}>
                <b className="n">{n}</b>
                <span className="dot" />
                <span className="lbl">{FUNNEL[i]}</span>
                {i > 0 && <em className="rate">{pctText(ratio(n, r.funnel[i - 1]))}</em>}
              </li>
            ))}
          </ol>
          <ul className="fates" aria-label="מצב הלידים שנכנסו">
            <li>
              <b className="num">{r.mix.relevant}</b> רלוונטיים
              {r.mix.dropped ? <small>מהם {r.mix.dropped} ירדו מהפרק</small> : null}
            </li>
            <li>
              <Link href={leads({ view: "lost" })}>
                <b className="num">{r.mix.junk}</b> לא רלוונטיים
              </Link>
              <small>הכחשת פנייה או מספר לא תקין</small>
            </li>
            <li>
              <Link href={leads({ view: "noans" })}>
                <b className="num">{r.mix.unreached}</b> לא נוצר קשר
              </Link>
              <small>התקשרו או כתבו, ועוד אין מענה</small>
            </li>
            <li>
              <Link href={leads({ view: "new" })}>
                <b className="num">{r.mix.untreated}</b> עוד לא טופלו
              </Link>
              <small>עוד לא התקשרו ולא כתבו</small>
            </li>
          </ul>
        </div>

        <div className="grid-2 perf-charts">
          <div className="panel">
            <div className="panel-head">
              <h2>לידים שנכנסו</h2>
              <span className="muted">{period.bucket === "day" ? "בכל יום" : period.bucket === "week" ? "בכל שבוע" : "בכל חודש"}</span>
            </div>
            <Columns label="לידים שנכנסו" buckets={r.buckets} series={[{ key: "leads", label: "לידים", tone: "c1" }]} />
          </div>
          <div className="panel">
            <div className="panel-head">
              <h2>פגישות</h2>
              <span className="muted">{period.bucket === "day" ? "בכל יום" : period.bucket === "week" ? "בכל שבוע" : "בכל חודש"}</span>
            </div>
            <Columns
              label="פגישות שנקבעו ופגישות שהתקיימו"
              buckets={r.buckets}
              series={[
                { key: "set", label: "נקבעו", tone: "c1" },
                { key: "held", label: "התקיימו", tone: "c3" },
              ]}
            />
          </div>
        </div>

        <div className="panel perf-table" id="reps">
          <div className="panel-head">
            <h2>לפי נציג</h2>
            <span className="muted">סוכנים ומנהלי מכירות. לחיצה על שם מסננת את כל המסך לפיו</span>
          </div>
          <RepTable rows={r.reps} here={here} leads={leads} active={f.repId} />
        </div>
        <div className="panel perf-table" id="sources">
          <div className="panel-head">
            <h2>לפי מקור הגעה</h2>
            <span className="muted">הלידים שנכנסו בתקופה</span>
          </div>
          <MixTable rows={r.sources} first="מקור" link={(row) => leads({ source: row.key })} filter={(row) => here({ source: row.key })} />
        </div>
        <div className="panel perf-table" id="projects">
          <div className="panel-head">
            <h2>לפי פרויקט</h2>
            <span className="muted">הלידים שנכנסו בתקופה</span>
          </div>
          <MixTable rows={r.projects} first="פרויקט" link={(row) => (row.key ? leads({ project: row.key }) : null)} filter={(row) => (row.key ? here({ project: row.key }) : null)} />
        </div>

        <details className="perf-how">
          <summary>איך סופרים</summary>
          <dl>
            <dt>לידים חדשים</dt>
            <dd>ליד שנכנס בתקופה בפעם הראשונה. ליד קיים שפנה שוב נספר בנפרד, כ״פנייה חוזרת״.</dd>
            <dt>רלוונטיים</dt>
            <dd>מתוך הלידים שנבדקו: כל מי שדיברו איתו (שיחה שנענתה, פגישה, או סטטוס שמגיעים אליו רק אחרי שיחה) ולא התברר כלא רלוונטי. גם מי שירד מהפרק בהמשך (אין עניין, אין תקציב, קנה במקום אחר) נספר כרלוונטי.</dd>
            <dt>לא רלוונטיים</dt>
            <dd>ליד שסומן ״לא רלוונטי״ בגלל הכחשת פנייה או מספר לא תקין.</dd>
            <dt>לא נוצר קשר, עוד לא טופלו</dt>
            <dd>לא נוצר קשר: התקשרו או כתבו, ועוד לא היה מענה. עוד לא טופלו: אף אחד עוד לא התקשר ולא כתב. שניהם לא נכנסים לאחוז הרלוונטיים.</dd>
            <dt>פגישות שנקבעו</dt>
            <dd>פגישות שנקבעו בתקופה. בטבלת הנציגים כל פגישה נספרת בשורה של מי שקבע אותה.</dd>
            <dt>אחוז הגעה</dt>
            <dd>מתוך הפגישות שמועדן היה בתקופה: כמה התקיימו, מתוך אלה שהתקיימו או בוטלו. פגישה שעוד לא עודכנה לא נספרת עד שמעדכנים אותה.</dd>
            <dt>עסקאות</dt>
            <dd>לידים שעברו ל״נחתמה עסקה״ בתקופה. בטבלת הנציגים הם נספרים לפי השיוך של הליד.</dd>
            <dt>זמן תגובה</dt>
            <dd>הזמן מהכניסה של הליד (בטבלת הנציגים: מהרגע שהליד שויך) ועד השיחה או ההודעה הראשונה. נספרות רק שעות העבודה, א׳ עד ה׳ בין 8:00 ל-20:00. חציון: חצי מהלידים קיבלו מענה מהר יותר.</dd>
            <dt>שעות עבודה</dt>
            <dd>מהמשמרות שנחתמו במסך שעות עבודה.</dd>
          </dl>
          {filtered && <p className="muted">המספרים במסך מסוננים לפי מה שנבחר למעלה.</p>}
        </details>
      </div>
    </section>
  );
}

function RepTable({ rows, here, leads, active }: { rows: RepRow[]; here: (x: Record<string, string | null>) => string; leads: (x: Record<string, string | null>) => string; active: string | null }) {
  if (!rows.length) return <p className="empty">אין נציגים להציג.</p>;
  return (
    <div className="rp-scroll">
      <table className="mini rp-break perf-reps">
        <thead>
          <tr>
            <th scope="col">נציג</th>
            <th scope="col" className="num">לידים ששויכו</th>
            <th scope="col" className="num">שיחות</th>
            <th scope="col" className="num">זמן תגובה</th>
            <th scope="col" className="num">פגישות שנקבעו</th>
            <th scope="col" className="num">התקיימו</th>
            <th scope="col" className="num">אחוז הגעה</th>
            <th scope="col" className="num">עסקאות</th>
            <th scope="col" className="num">שעות עבודה</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((x) => (
            <tr key={x.id} className={x.id === active ? "sel" : ""}>
              <td className="rp-name">
                <Link className="lk" href={here({ rep: x.id === active ? null : x.id })} aria-current={x.id === active ? "true" : undefined}>
                  <Owner id={x.id} name={x.name} inactive={x.inactive} />
                </Link>
              </td>
              <td className="num" data-label="לידים ששויכו">
                {x.received ? <Link href={leads({ owner: x.id })}>{x.received}</Link> : 0}
                {x.untouched ? <small className="warn-text">{x.untouched} לא טופלו</small> : null}
              </td>
              <td className="num" data-label="שיחות">
                {x.calls}
                {x.calls ? <small>{x.answered} עם מענה</small> : null}
              </td>
              <td className="num" data-label="זמן תגובה">
                {fmtMin(x.responseMin)}
              </td>
              <td className="num" data-label="פגישות שנקבעו">
                {x.set}
              </td>
              <td className="num" data-label="התקיימו">
                {x.held}
              </td>
              <td className="num" data-label="אחוז הגעה">
                {pctText(x.showUpPct)}
                {x.unmarked ? <small className="warn-text">{x.unmarked} לא עודכנו</small> : null}
              </td>
              <td className="num" data-label="עסקאות">
                {x.deals}
              </td>
              <td className="num" data-label="שעות עבודה">
                {x.minutes ? hhmm(x.minutes) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MixTable({ rows, first, link, filter }: { rows: MixRow[]; first: string; link: (r: MixRow) => string | null; filter: (r: MixRow) => string | null }) {
  if (!rows.length) return <p className="empty">לא נכנסו לידים בתקופה.</p>;
  return (
    <div className="rp-scroll">
      <table className="mini rp-break perf-mix">
        <thead>
          <tr>
            <th scope="col">{first}</th>
            <th scope="col" className="num">לידים</th>
            <th scope="col" className="num">רלוונטיים</th>
            <th scope="col" className="num">נקבעה פגישה</th>
            <th scope="col" className="num">התקיימה פגישה</th>
            <th scope="col" className="num">עסקאות</th>
            <th scope="col" className="num">לא נוצר קשר</th>
            <th scope="col" className="num">עוד לא טופלו</th>
            <th scope="col">סיבת נשירה עיקרית</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((x) => {
            const href = link(x);
            const narrow = filter(x);
            return (
              <tr key={x.key || "none"}>
                <td className="rp-name">{narrow ? <Link className="lk" href={narrow}>{x.label}</Link> : <span className="muted">{x.label}</span>}</td>
                <td className="num" data-label="לידים">
                  {href ? <Link href={href}>{x.leads}</Link> : x.leads}
                </td>
                <td className="num" data-label="רלוונטיים">
                  {pctText(ratio(x.relevant, x.relevant + x.junk))}
                  {x.relevant + x.junk ? <small>{x.relevant} מתוך {x.relevant + x.junk}</small> : null}
                </td>
                <td className="num" data-label="נקבעה פגישה">
                  {x.met}
                  {x.leads ? <small>{pctText(ratio(x.met, x.leads))}</small> : null}
                </td>
                <td className="num" data-label="התקיימה פגישה">
                  {x.held}
                  {x.leads ? <small>{pctText(ratio(x.held, x.leads))}</small> : null}
                </td>
                <td className="num" data-label="עסקאות">
                  {x.won}
                </td>
                <td className="num" data-label="לא נוצר קשר">
                  {x.unreached}
                </td>
                <td className="num" data-label="עוד לא טופלו">
                  {x.untreated}
                </td>
                <td className="txt" data-label="סיבת נשירה">
                  {x.topReason ?? "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
