"use client";

import { createContext, useContext, type ReactNode } from "react";
import { MANUAL_SOURCES, MEETING_STATE_ORDER, MEETING_STATES, REASONS, TASK_STATE_ORDER, TASK_STATES } from "@/lib/crm/constants";
import type { ClientLists } from "@/lib/lists";

/** What any screen or sheet may need: who is active, who meets the clients by default, and the lists a manager can change. */
export type ShellData = { meId: string; people: { id: string; name: string }[]; meetingHost: string | null; lists: ClientLists };

const DEFAULT_LISTS: ClientLists = {
  sources: [...MANUAL_SOURCES],
  reasons: [...REASONS],
  meeting: Object.fromEntries(MEETING_STATE_ORDER.map((s) => [s, MEETING_STATES[s].l])) as ClientLists["meeting"],
  task: Object.fromEntries(TASK_STATE_ORDER.map((s) => [s, TASK_STATES[s].l])) as ClientLists["task"],
};

const Ctx = createContext<ShellData>({ meId: "", people: [], meetingHost: null, lists: DEFAULT_LISTS });

export function ShellDataProvider({ value, children }: { value: ShellData; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useShellData = () => useContext(Ctx);
/** The manager's lists and names (sources, reasons, status names). */
export const useLists = () => useContext(Ctx).lists;
