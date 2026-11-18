"use client";

import { createContext, useContext, type ReactNode } from "react";
import { MANUAL_SOURCES, MEETING_STATE_ORDER, MEETING_STATES, REASONS, TASK_STATE_ORDER, TASK_STATES } from "@/lib/crm/constants";
import { DEFAULT_TEMPLATES } from "@/lib/crm/messages";
import type { ClientLists } from "@/lib/lists";

/**
 * What any screen or sheet may need: who is signed in (and their first name, for the messages they send), who is active,
 * who meets the clients by default, the lists a manager can change, and the site's address (for links in messages).
 */
export type ShellData = { meId: string; meName: string; appUrl: string; people: { id: string; name: string }[]; meetingHost: string | null; lists: ClientLists };

const DEFAULT_LISTS: ClientLists = {
  sources: [...MANUAL_SOURCES],
  reasons: [...REASONS],
  meeting: Object.fromEntries(MEETING_STATE_ORDER.map((s) => [s, MEETING_STATES[s].l])) as ClientLists["meeting"],
  task: Object.fromEntries(TASK_STATE_ORDER.map((s) => [s, TASK_STATES[s].l])) as ClientLists["task"],
  messages: DEFAULT_TEMPLATES,
};

const Ctx = createContext<ShellData>({ meId: "", meName: "", appUrl: "", people: [], meetingHost: null, lists: DEFAULT_LISTS });

export function ShellDataProvider({ value, children }: { value: ShellData; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useShellData = () => useContext(Ctx);
/** The manager's lists and names (sources, reasons, status names). */
export const useLists = () => useContext(Ctx).lists;
