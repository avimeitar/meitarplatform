"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { undoAction } from "@/app/actions/undo";
import { Icon } from "@/components/Icon";

// ---------- toast: says what changed, with a big "ביטול הפעולה" when the change can be undone ----------
// A failure looks different (red), is announced at once, and stays until it is closed.

type ToastFn = (message: string, opts?: { undoId?: string; error?: boolean }) => void;
const ToastCtx = createContext<ToastFn>(() => {});
export const useToast = () => useContext(ToastCtx);

// ---------- drawer / bottom sheet ----------

type DrawerSpec = { title: string; content: ReactNode; sheet?: boolean };
type DrawerApi = { open: (d: DrawerSpec) => void; close: () => void; retitle: (t: string) => void; isOpen: boolean };
const DrawerCtx = createContext<DrawerApi>({ open: () => {}, close: () => {}, retitle: () => {}, isOpen: false });
export const useDrawer = () => useContext(DrawerCtx);

export function Overlays({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [toast, setToast] = useState<{ msg: string; undoId?: string; error?: boolean; key: number } | null>(null);
  const [hold, setHold] = useState(false);
  const [drawer, setDrawer] = useState<DrawerSpec | null>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const lastFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    // errors stay until closed; the timer waits while the pointer or focus is on the toast
    if (!toast || toast.error || hold) return;
    const t = setTimeout(() => setToast(null), toast.undoId ? 10_000 : 4000);
    return () => clearTimeout(t);
  }, [toast, hold]);

  const show = useCallback<ToastFn>((msg, opts) => {
    setHold(false);
    setToast({ msg, undoId: opts?.undoId, error: opts?.error, key: Date.now() });
  }, []);

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

  const retitle = useCallback((t: string) => setDrawer((d) => (d ? { ...d, title: t } : d)), []);

  useEffect(() => {
    if (!drawer) return;
    // a new step starts at the top
    drawerRef.current?.querySelector(".drawer-form")?.scrollTo(0, 0);
    // focus the first field; when there is none, the sheet itself, so Enter never confirms something by accident
    const first = drawerRef.current?.querySelector<HTMLElement>("input:not([type=hidden]), select, textarea");
    (first ?? drawerRef.current)?.focus();
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
    show(r.ok ? r.message || "הפעולה בוטלה" : r.error, { error: !r.ok });
    router.refresh();
  }

  return (
    <ToastCtx.Provider value={show}>
      <DrawerCtx.Provider value={{ open, close, retitle, isOpen: !!drawer }}>
        {/* while a drawer is open, the page behind it can't be reached with the keyboard or a screen reader */}
        <div className="ov-root" inert={drawer ? true : undefined}>
          {children}
        </div>
        {drawer && (
          <>
            <div className="scrim" onClick={close} />
            <aside ref={drawerRef} tabIndex={-1} className={"drawer" + (drawer.sheet ? " sheet" : "")} role="dialog" aria-modal="true" aria-labelledby="drawerTitle">
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
        <div
          className={"toast" + (toast && !toast.error ? " show" : "")}
          role="status"
          aria-live="polite"
          onPointerEnter={() => setHold(true)}
          onPointerLeave={() => setHold(false)}
          onFocus={() => setHold(true)}
          onBlur={() => setHold(false)}
        >
          {toast && !toast.error && (
            <>
              <span>{toast.msg}</span>
              {toast.undoId && (
                <button type="button" onClick={undo}>
                  ביטול הפעולה
                </button>
              )}
            </>
          )}
        </div>
        <div className={"toast err" + (toast?.error ? " show" : "")} role="alert">
          {toast?.error && (
            <>
              <span>{toast.msg}</span>
              <button type="button" onClick={() => setToast(null)}>
                סגירה
              </button>
            </>
          )}
        </div>
      </DrawerCtx.Provider>
    </ToastCtx.Provider>
  );
}
