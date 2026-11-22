// How archived records read: their status in words, and their dates.
import { isMeetingState, isTaskState, MEETING_STATES, meetingState, ST, TASK_STATES, type LeadStatus } from "@/lib/crm/constants";
import { fD, fT } from "@/lib/crm/dates";
import type { ArchiveKind } from "@/lib/archive";

export function statusText(kind: ArchiveKind | string, status: string | null, confirmed = false): string {
  if (!status) return "";
  if (kind === "lead") return ST[status as LeadStatus]?.l ?? status;
  if (kind === "meeting") {
    const s = meetingState({ status, confirmed });
    return isMeetingState(s) ? MEETING_STATES[s].l : status;
  }
  if (kind === "task") return isTaskState(status) ? TASK_STATES[status].l : status;
  if (kind === "project") return status === "active" ? "פעיל" : "סגור";
  return status;
}

export const day = (d: Date | string | null | undefined) => {
  if (!d) return "";
  const x = new Date(d);
  return `${fD(x)}.${String(x.getFullYear()).slice(2)}`;
};
export const dayTime = (d: Date | string | null | undefined) => (d ? `${day(d)} ${fT(new Date(d))}` : "");
