"use client";

import { createContext, useContext, type ReactNode } from "react";

/** What any sheet may need about the team: who is active, and who meets the clients by default. */
export type ShellData = { meId: string; people: { id: string; name: string }[]; meetingHost: string | null };

const Ctx = createContext<ShellData>({ meId: "", people: [], meetingHost: null });

export function ShellDataProvider({ value, children }: { value: ShellData; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useShellData = () => useContext(Ctx);
