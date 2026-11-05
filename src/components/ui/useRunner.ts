"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";
import type { ActionResult } from "@/lib/action";
import { useToast } from "./Overlays";

/** Runs a server action, shows what happened (with undo when possible) and refreshes the screen. */
export function useRunner() {
  const router = useRouter();
  const toast = useToast();
  return useCallback(
    async <T,>(p: Promise<ActionResult<T>>, opts: { quiet?: boolean } = {}): Promise<ActionResult<T>> => {
      const r = await p;
      if (r.ok) {
        if (!opts.quiet) toast(r.message ?? "נשמר", { undoId: r.undoId });
        router.refresh();
      } else toast(r.error);
      return r;
    },
    [router, toast],
  );
}
