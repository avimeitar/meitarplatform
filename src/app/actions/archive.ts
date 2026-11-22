"use server";

import { revalidatePath } from "next/cache";
import { run, type ActionResult } from "@/lib/action";
import { archiveAll, archivePreview, CONFIRM_WORDS, type ArchiveCounts } from "@/lib/archive";
import { audit } from "@/lib/audit";
import { ActionError, requestIp, requireActionUser } from "@/lib/session";

const ids = (list: unknown) => (Array.isArray(list) ? list.filter((x): x is string => typeof x === "string" && x.length < 60).slice(0, 200) : []);

/** How much a move would take, with these projects staying. */
export async function archivePreviewAction(keepProjectIds: string[]): Promise<ActionResult<ArchiveCounts>> {
  return run(async () => {
    await requireActionUser("archive.manage");
    return { data: await archivePreview(ids(keepProjectIds)) };
  });
}

/** Moves every client, meeting and task, and every project except the ones kept, to the archive. System administrators only. */
export async function archiveRunAction(keepProjectIds: string[], confirm: string): Promise<ActionResult<ArchiveCounts>> {
  return run(async () => {
    const u = await requireActionUser("archive.manage");
    if (String(confirm ?? "").trim() !== CONFIRM_WORDS) throw new ActionError(`כדי לאשר צריך לכתוב ״${CONFIRM_WORDS}״`, "confirm");
    const r = await archiveAll({ id: u.id, name: u.name }, ids(keepProjectIds));
    await audit({ actorId: u.id, actorName: u.name, action: "archive.run", targetType: "archive", targetId: r.batchId, meta: { ...r.counts, kept: r.kept.join(", ") || "אף פרויקט" }, ip: await requestIp() });
    // every screen changes
    revalidatePath("/", "layout");
    const c = r.counts;
    return { message: `הועברו לארכיון ${c.leads} לקוחות, ${c.meetings} פגישות, ${c.tasks} משימות ו-${c.projects} פרויקטים`, data: c };
  });
}
