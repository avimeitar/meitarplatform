// Date helpers shared by the server and the screens. Everything is local time (Asia/Jerusalem):
// the server runs with TZ=Asia/Jerusalem and the team's phones are in Israel.

export const WD = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
export const MON = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];
export const MIN = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;

export const pad = (n: number) => String(n).padStart(2, "0");
export function sod(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
export function at(d: Date, h: number, m = 0): Date {
  const x = new Date(d);
  x.setHours(h, m, 0, 0);
  return x;
}
// Israel wall-clock time, whatever time zone the device is set to (someone abroad sees the same hours).
const IL = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Jerusalem", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric", hourCycle: "h23" });
export function wall(d: Date): Date {
  const p: Record<string, string> = {};
  for (const part of IL.formatToParts(d)) p[part.type] = part.value;
  return new Date(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
}
const local = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
export const sameDay = (a: Date, b: Date) => local(wall(a), wall(b));
export const fT = (d: Date) => {
  const x = wall(d);
  return pad(x.getHours()) + ":" + pad(x.getMinutes());
};
export const fD = (d: Date) => {
  const x = wall(d);
  return x.getDate() + "." + (x.getMonth() + 1);
};
export const iso = (d: Date) => {
  const x = wall(d);
  return x.getFullYear() + "-" + pad(x.getMonth() + 1) + "-" + pad(x.getDate());
};
export const weekday = (d: Date) => WD[wall(d).getDay()];

/** Friday and Saturday are not working days. */
export const isWorkday = (d: Date) => d.getDay() !== 5 && d.getDay() !== 6;

export function nextWorkday(now = new Date()): Date {
  let x = addDays(sod(now), 1);
  while (!isWorkday(x)) x = addDays(x, 1);
  return x;
}
export function prevWorkday(now = new Date()): Date {
  let x = addDays(sod(now), -1);
  while (!isWorkday(x)) x = addDays(x, -1);
  return x;
}
/** "Since last night": 19:00 on the previous working day. */
export const nightStart = (now = new Date()) => at(prevWorkday(now), 19, 0);
export const weekStart = (now = new Date()) => addDays(sod(now), -sod(now).getDay());
export const monthStart = (now = new Date()) => new Date(now.getFullYear(), now.getMonth(), 1);

export function dayLabel(d: Date, now = new Date()): string {
  const x = wall(d);
  const today = sod(wall(now));
  if (local(x, today)) return "היום";
  if (local(x, addDays(today, 1))) return "מחר";
  if (local(x, addDays(today, -1))) return "אתמול";
  return WD[x.getDay()] + " " + fD(d);
}

/** "היום, חמישי 5.11" / "ראשון 8.11" */
export function dayFull(d: Date, now = new Date()): string {
  const x = wall(d);
  const today = sod(wall(now));
  const rel = local(x, today) ? "היום, " : local(x, addDays(today, 1)) ? "מחר, " : "";
  return rel + WD[x.getDay()] + " " + fD(d);
}

export function relTime(d: Date, now = new Date()): string {
  const diff = now.getTime() - d.getTime();
  if (diff >= 0 && diff < HOUR) return "לפני " + Math.max(1, Math.round(diff / MIN)) + " דק׳";
  const today = sod(wall(now));
  const x = wall(d);
  if (local(x, today)) return "היום " + fT(d);
  if (local(x, addDays(today, -1))) return "אתמול " + fT(d);
  const days = Math.round((today.getTime() - sod(x).getTime()) / DAY);
  if (days === 2) return "לפני יומיים";
  if (days > 2 && days < 7) return "לפני " + days + " ימים";
  return fD(d) + "." + String(d.getFullYear()).slice(2);
}

// ---------- booking a meeting ----------

export const BOOK_HOURS = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19];
export const FRI_HOURS = [9, 10, 11, 12];

/** The next six days you can book on (no Saturday). Today only until 18:00. */
export function meetDays(now = new Date()): Date[] {
  const out: Date[] = [];
  let d = now.getHours() < 18 ? sod(now) : addDays(sod(now), 1);
  for (let g = 0; out.length < 6 && g < 14; g++) {
    if (d.getDay() !== 6) out.push(d);
    d = addDays(d, 1);
  }
  return out;
}

export function slotsFor(d: Date, now = new Date()): string[] {
  return (d.getDay() === 5 ? FRI_HOURS : BOOK_HOURS)
    .map((h) => at(d, h, 0))
    .filter((t) => t.getTime() > now.getTime() + 30 * MIN)
    .map(fT);
}

export function timeWarning(d: Date | null, t: string | null): string {
  if (!d || !t) return "";
  const h = Number(t.split(":")[0]);
  if (d.getDay() === 6) return "שבת לא מתאימה לפגישות.";
  if (d.getDay() === 5 && h >= 13) return "שישי אחרי 13:00 זה כבר קרוב לשבת. כדאי לבחור שעה מוקדמת יותר או יום אחר.";
  if (h < 8 || h >= 21) return "השעה הזו מחוץ לשעות הפעילות (08:00 עד 21:00).";
  return "";
}

// ---------- calling back later ----------

export const LATER = ["1h", "3h", "tm", "ta", "wk"] as const;
export type LaterKey = (typeof LATER)[number];

export function laterDate(k: LaterKey, now = new Date()): Date {
  const next = nextWorkday(now);
  if (k === "1h") return new Date(now.getTime() + HOUR);
  if (k === "3h") return new Date(now.getTime() + 3 * HOUR);
  if (k === "tm") return at(next, 10, 0);
  if (k === "ta") return at(next, 16, 0);
  let d = addDays(sod(now), 7);
  while (!isWorkday(d)) d = addDays(d, 1);
  return at(d, 10, 0);
}

export function laterLabel(k: LaterKey, now = new Date()): string {
  const next = nextWorkday(now);
  const nw = sameDay(next, addDays(sod(now), 1)) ? "מחר" : "ב" + WD[next.getDay()];
  return { "1h": "בעוד שעה", "3h": "בעוד 3 שעות", tm: nw + " בבוקר", ta: nw + " אחר הצהריים", wk: "בעוד שבוע" }[k];
}
