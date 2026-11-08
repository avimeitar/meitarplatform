"use client";

import { useState, type CSSProperties } from "react";
import type { Bucket } from "@/lib/crm/performance";

type Series = { key: "leads" | "set" | "held"; label: string; tone: "c1" | "c3" };

/**
 * Columns over time, oldest on the right. A single series is named by the panel's title; two get a legend with totals.
 * Hovering, focusing or tapping a column shows its numbers; each column also reads out its numbers to screen readers.
 */
export function Columns({ label, buckets, series }: { label: string; buckets: Bucket[]; series: Series[] }) {
  const [tip, setTip] = useState<number | null>(null);
  const max = Math.max(1, ...buckets.flatMap((b) => series.map((s) => b[s.key])));
  const total = (s: Series) => buckets.reduce((n, b) => n + b[s.key], 0);
  const words = (b: Bucket) => `${b.long}: ` + series.map((s) => `${s.label} ${b[s.key]}`).join(", ");
  // with many columns every other date is left out, so the dates stay readable
  const many = buckets.length > 8;
  const lots = buckets.length > 12;
  if (!buckets.some((b) => series.some((s) => b[s.key] > 0))) return <p className="empty">אין עדיין נתונים בתקופה הזו.</p>;
  return (
    <figure className={"pc" + (many ? " many" : "") + (lots ? " lots" : "") + (series.length > 1 ? " multi" : "")} style={{ "--n": buckets.length } as CSSProperties} aria-label={label}>
      {series.length > 1 && (
        <figcaption className="pc-legend">
          {series.map((s) => (
            <span key={s.key}>
              <i className={"sw " + s.tone} aria-hidden="true" />
              {s.label} <b className="num">{total(s)}</b>
            </span>
          ))}
        </figcaption>
      )}
      <div className="pc-plot" onPointerLeave={() => setTip(null)}>
        {buckets.map((b, i) => (
          <div
            key={i}
            className={"pc-col" + (tip === i ? " on" : "") + (i < 2 ? " first" : i >= buckets.length - 2 ? " last" : "")}
            tabIndex={0}
            role="img"
            aria-label={words(b)}
            onPointerEnter={() => setTip(i)}
            onFocus={() => setTip(i)}
            onBlur={() => setTip((t) => (t === i ? null : t))}
            onClick={() => setTip(i)}
          >
            {series.map((s) => {
              const v = b[s.key];
              return (
                <span key={s.key} className={"pc-bar " + s.tone} style={{ height: `${(v / max) * 100}%` }}>
                  {v > 0 && <b className="num">{v}</b>}
                </span>
              );
            })}
            {tip === i && (
              <span className="pc-tip" aria-hidden="true">
                <b>{b.long}</b>
                {series.map((s) => (
                  <span key={s.key}>
                    <i className={"sw " + s.tone} />
                    {s.label}: <b className="num">{b[s.key]}</b>
                  </span>
                ))}
              </span>
            )}
          </div>
        ))}
      </div>
      <div className="pc-x" aria-hidden="true">
        {buckets.map((b, i) => (
          <span key={i}>{b.short}</span>
        ))}
      </div>
    </figure>
  );
}
