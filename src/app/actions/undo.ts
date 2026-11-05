"use server";

import { revalidatePath } from "next/cache";
import { run, type ActionResult } from "@/lib/action";
import { ActionError, requireActionUser } from "@/lib/session";
import { undo } from "@/lib/undo";

export async function undoAction(id: string): Promise<ActionResult> {
  return run(async () => {
    const u = await requireActionUser();
    const r = await undo(u.id, String(id));
    if (!r.ok) throw new ActionError(r.error);
    revalidatePath("/", "layout");
    return { message: "בוטל: " + r.label };
  });
}
