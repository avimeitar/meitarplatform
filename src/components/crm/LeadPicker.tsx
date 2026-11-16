"use client";

import { useEffect, useState } from "react";
import { searchLeadsAction } from "@/app/actions/leads";
import { Icon } from "@/components/Icon";

export type PickedLead = { id: string; name: string };

/** Finds a client by name or phone. With nothing typed, it suggests the person's own open clients. */
export function LeadPicker({ value, onChange, label = "לקוח" }: { value: PickedLead | null; onChange: (v: PickedLead | null) => void; label?: string }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<{ id: string; name: string; phone: string; projectName: string }[]>([]);

  useEffect(() => {
    if (!open) return;
    let live = true;
    const t = setTimeout(async () => {
      const r = await searchLeadsAction(q).catch(() => null);
      if (live && r?.ok && r.data) setRows(r.data);
    }, 200);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q, open]);

  if (value)
    return (
      <div className="fld">
        <span>{label}</span>
        <div className="lead-chip">
          <Icon name="users" />
          <b>{value.name}</b>
          <button type="button" className="ib" aria-label={`הסרת ${value.name}`} onClick={() => onChange(null)}>
            <Icon name="x" />
          </button>
        </div>
      </div>
    );
  return (
    <div className="fld lead-pick">
      <label htmlFor="lead-pick-q">{label}</label>
      <input id="lead-pick-q" type="search" autoComplete="off" value={q} placeholder="חיפוש לפי שם או טלפון" onFocus={() => setOpen(true)} onChange={(e) => (setQ(e.target.value), setOpen(true))} />
      {open && rows.length > 0 && (
        <ul className="lead-pick-list" role="listbox" aria-label="לקוחות">
          {rows.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                role="option"
                aria-selected={false}
                onClick={() => {
                  onChange({ id: r.id, name: r.name });
                  setOpen(false);
                  setQ("");
                }}
              >
                <b>{r.name}</b>
                <small>{[r.projectName, r.phone].filter(Boolean).join(" · ")}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
