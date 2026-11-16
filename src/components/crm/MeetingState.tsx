"use client";

import { meetingStateAction } from "@/app/actions/leads";
import { Icon, type IconName } from "@/components/Icon";
import { useRunner } from "@/components/ui/useRunner";
import { MEETING_STATE_ORDER, MEETING_STATES, meetingState, type MeetingState } from "@/lib/crm/constants";

type M = { id: string; status: string; confirmed: boolean };

/** The meeting's status as a pill (read only). */
export function MeetingStatePill({ status, confirmed }: Omit<M, "id">) {
  const s = MEETING_STATES[meetingState({ status, confirmed })];
  return <span className={"st-pill " + s.c}>{s.l}</span>;
}

/** A compact choice of the six states, for rows in a list. */
export function MeetingStateSelect({ m, disabled }: { m: M; disabled?: boolean }) {
  const runner = useRunner();
  const st = meetingState(m);
  return (
    <label className={"msel " + MEETING_STATES[st].c}>
      <span className="sr">סטטוס הפגישה</span>
      <Icon name={MEETING_STATES[st].icon as IconName} />
      <select value={st} disabled={disabled} onChange={(e) => e.target.value !== st && runner(meetingStateAction(m.id, e.target.value))}>
        {MEETING_STATE_ORDER.map((s) => (
          <option key={s} value={s}>
            {MEETING_STATES[s].l}
          </option>
        ))}
      </select>
    </label>
  );
}

/** All six states as buttons, for the meeting card. */
export function MeetingStateButtons({ m, disabled, onChange }: { m: M; disabled?: boolean; onChange?: (s: MeetingState) => void }) {
  const runner = useRunner();
  const st = meetingState(m);
  return (
    <div className="mstates" role="group" aria-label="סטטוס פגישה">
      {MEETING_STATE_ORDER.map((s) => {
        const on = s === st;
        return (
          <button
            key={s}
            type="button"
            className={on ? "on " + MEETING_STATES[s].c : ""}
            aria-pressed={on}
            disabled={disabled}
            onClick={async () => {
              if (on) return;
              const r = await runner(meetingStateAction(m.id, s));
              if (r.ok) onChange?.(s);
            }}
          >
            <Icon name={MEETING_STATES[s].icon as IconName} />
            {MEETING_STATES[s].l}
          </button>
        );
      })}
    </div>
  );
}
