import { ZodError } from "zod";
import { ActionError } from "./session";

export type ActionResult<T = undefined> =
  | { ok: true; message?: string; undoId?: string; data?: T }
  | { ok: false; error: string; field?: string };

/** Runs a server action body and turns expected failures into messages people can read. */
export async function run<T>(fn: () => Promise<{ message?: string; undoId?: string; data?: T } | void>): Promise<ActionResult<T>> {
  try {
    const r = (await fn()) || {};
    return { ok: true, ...r };
  } catch (err) {
    if (err instanceof ActionError) return { ok: false, error: err.userMessage, field: err.field };
    if (err instanceof ZodError) {
      const first = err.issues[0];
      return { ok: false, error: first?.message || "חלק מהפרטים לא תקינים", field: first?.path?.[0] ? String(first.path[0]) : undefined };
    }
    // Next.js redirects and not-found are thrown as errors and must keep travelling.
    if (err && typeof err === "object" && "digest" in err && String((err as { digest: unknown }).digest).startsWith("NEXT_")) throw err;
    console.error("[action] unexpected error", err);
    return { ok: false, error: "משהו השתבש. אפשר לנסות שוב, ואם זה חוזר לפנות למנהל המערכת." };
  }
}
