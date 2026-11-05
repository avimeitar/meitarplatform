"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { undoAction } from "@/app/actions/undo";
import { Icon } from "@/components/Icon";

// ---------- toast: says what changed, with a big "ביטול" when the change can be undone ----------

type ToastFn = (message: string, opts?: { undoId?: string }) => void;
const ToastCtx = createContext<ToastFn>(() => {});
export const useToast = () => useContext(ToastCtx);

// ---------- drawer / bottom sheet ----------

type DrawerSpec = { title: string; content: ReactNode; sheet?: boolean };
type DrawerApi = { open: (d: DrawerSpec) => void; close: () => void; isOpen: boolean };
const DrawerCtx = createContext<DrawerApi>({ open: () => {}, close: () => {}, isOpen: false });
export const useDrawer = () => useContext(DrawerCtx);

export function Overlays({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [toast, setToast] = useState<{ msg: string; undoId?: string; key: number } | null>(null);
  const [drawer, setDrawer] = useState<DrawerSpec | null>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const lastFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.undoId ? 6500 : 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const show = useCallback<ToastFn>((msg, opts) => setToast({ msg, undoId: opts?.undoId, key: Date.now() }), []);

  const close = useCallback(() => {
    setDrawer(null);
    lastFocus.current?.focus?.();
  }, []);

  const open = useCallback((d: DrawerSpec) => {
    if (!drawerRef.current) lastFocus.current = document.activeElement as HTMLElement | null;
    // a toast never covers an open sheet
    setToast(null);
    setDrawer(d);
  }, []);

  useEffect(() => {
    if (!drawer) return;
    const first = drawerRef.current?.querySelector<HTMLElement>("input:not([type=hidden]), select, textarea, button:not(.ib)");
    first?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // focus only when a new drawer opens, not on every content change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawer?.title]);

  async function undo() {
    const id = toast?.undoId;
    if (!id) return;
    setToast(null);
    const r = await undoAction(id);
    show(r.ok ? r.message || "הפעולה בוטלה" : r.error);
    router.refresh();
  }

  return (
    <ToastCtx.Provider value={show}>
      <DrawerCtx.Provider value={{ open, close, isOpen: !!drawer }}>
        {children}
        {drawer && (
          <>
            <div className="scrim" onClick={close} />
            <aside ref={drawerRef} className={"drawer" + (drawer.sheet ? " sheet" : "")} role="dialog" aria-modal="true" aria-labelledby="drawerTitle">
              <header>
                <h2 id="drawerTitle">{drawer.title}</h2>
                <button type="button" className="ib" onClick={close} aria-label="סגירה">
                  <Icon name="x" />
                </button>
              </header>
              <div className="drawer-form">{drawer.content}</div>
            </aside>
          </>
        )}
        <div className={"toast" + (toast ? " show" : "")} role="status" aria-live="polite">
          {toast && (
            <>
              <span>{toast.msg}</span>
              {toast.undoId && (
                <button type="button" onClick={undo}>
                  ביטול
                </button>
              )}
            </>
          )}
        </div>
      </DrawerCtx.Provider>
    </ToastCtx.Provider>
  );
}
