// Formatting shared by the performance screen and its Excel export (no server code here, so the browser can use it too).

/** Minutes as people say them: "12 דק׳", "1:20 שע׳", "26 שע׳". */
export function fmtMin(m: number | null): string {
  if (m === null) return "—";
  if (m < 60) return `${m} דק׳`;
  if (m < 600) return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")} שע׳`;
  return `${Math.round(m / 60)} שע׳`;
}

export const pctText = (v: number | null) => (v === null ? "—" : `${v}%`);

/** a out of b, as a whole percent; null when there is nothing to divide by. */
export const ratio = (a: number, b: number): number | null => (b ? Math.round((a / b) * 100) : null);

export type PeriodKey = "week" | "lweek" | "month" | "lmonth" | "2m" | "3m" | "custom";
export const PERIODS: { key: Exclude<PeriodKey, "custom">; label: string }[] = [
  { key: "week", label: "השבוע" },
  { key: "lweek", label: "שבוע שעבר" },
  { key: "month", label: "החודש" },
  { key: "lmonth", label: "חודש שעבר" },
  { key: "2m", label: "חודשיים" },
  { key: "3m", label: "3 חודשים" },
];
