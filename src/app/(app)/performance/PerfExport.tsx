"use client";

import { Icon } from "@/components/Icon";
import type { MixRow, RepRow, Tiles } from "@/lib/crm/performance";
import { pctText, ratio } from "@/lib/crm/perfFormat";

const cell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  // keep Excel from treating text as a formula
  const safe = /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
const line = (xs: unknown[]) => xs.map(cell).join(",");
const hours = (m: number) => (m ? (m / 60).toFixed(2) : "");

/** The screen's numbers as a file that opens in Excel with Hebrew intact. Made in the browser from what is on screen. */
export function PerfExport({ period, tiles, reps, sources, projects }: { period: { title: string; from: string; to: string }; tiles: Tiles; reps: RepRow[]; sources: MixRow[]; projects: MixRow[] }) {
  function download() {
    const out: string[] = [];
    out.push(line(["ביצועים", period.title]), "");
    out.push(line(["סיכום", ""]));
    out.push(line(["לידים חדשים", tiles.leads]));
    out.push(line(["פניות חוזרות", tiles.returning]));
    out.push(line(["רלוונטיים", pctText(tiles.relevantPct)]));
    out.push(line(["פגישות שנקבעו", tiles.set]));
    out.push(line(["פגישות שהתקיימו", tiles.held]));
    out.push(line(["אחוז הגעה", pctText(tiles.showUpPct)]));
    out.push(line(["עסקאות", tiles.deals]));
    out.push(line(["זמן תגובה, חציון בדקות", tiles.responseMin ?? ""]), "");
    out.push(line(["נציג", "לידים שקיבל", "לא טופלו", "שיחות", "עם מענה", "זמן תגובה, חציון בדקות", "פגישות שנקבעו", "התקיימו", "בוטלו", "לא עודכנו", "אחוז הגעה", "עסקאות", "שעות עבודה"]));
    for (const r of reps) out.push(line([r.name, r.received, r.untouched, r.calls, r.answered, r.responseMin ?? "", r.set, r.held, r.canceled, r.unmarked, pctText(r.showUpPct), r.deals, hours(r.minutes)]));
    for (const [title, rows] of [
      ["מקור הגעה", sources],
      ["פרויקט", projects],
    ] as const) {
      out.push("", line([title, "לידים", "רלוונטיים", "לא רלוונטיים", "אחוז רלוונטיים", "נקבעה פגישה", "התקיימה פגישה", "עסקאות", "לא נוצר קשר", "עוד לא טופלו", "סיבת נשירה עיקרית"]));
      for (const r of rows) out.push(line([r.label, r.leads, r.relevant, r.junk, pctText(ratio(r.relevant, r.relevant + r.junk)), r.met, r.held, r.won, r.unreached, r.untreated, r.topReason ?? ""]));
    }
    const url = URL.createObjectURL(new Blob(["﻿" + out.join("\r\n")], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `performance-${period.from}-${period.to}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  return (
    <button type="button" className="btn" onClick={download}>
      <Icon name="upload" />
      ייצוא לאקסל
    </button>
  );
}
