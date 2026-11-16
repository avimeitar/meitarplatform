"use client";

import { useEffect, useState } from "react";
import { pushKeyAction, removePushAction, savePushAction, testPushAction } from "@/app/actions/push";
import { Icon } from "@/components/Icon";
import { useToast } from "@/components/ui/Overlays";
import { useRunner } from "@/components/ui/useRunner";

type Mode = "loading" | "unsupported" | "install" | "denied" | "off" | "on";

function keyBytes(base64: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

const ios = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
const installed = () => window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

/** Turns task reminders on or off for this phone or browser. On an iPhone they work once the system is added to the home screen. */
export function PushToggle() {
  const runner = useRunner();
  const toast = useToast();
  const [mode, setMode] = useState<Mode>("loading");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return setMode(ios() && !installed() ? "install" : "unsupported");
      if (Notification.permission === "denied") return setMode("denied");
      const reg = await navigator.serviceWorker.getRegistration("/");
      const sub = await reg?.pushManager.getSubscription();
      if (!sub) return setMode("off");
      setMode("on");
      // the same phone, now signed in as this person
      await savePushAction(sub.toJSON() as never);
    })().catch(() => setMode("unsupported"));
  }, []);

  async function enable() {
    setBusy(true);
    try {
      // first thing on the tap: the phone asks for permission only from a tap
      const permission = await Notification.requestPermission();
      if (permission !== "granted") return setMode(permission === "denied" ? "denied" : "off");
      const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
      await navigator.serviceWorker.ready;
      const k = await pushKeyAction();
      if (!k.ok || !k.data) throw new Error(k.ok ? "no key" : k.error);
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(k.data.key) });
      const r = await runner(savePushAction(sub.toJSON() as never));
      if (r.ok) setMode("on");
    } catch {
      toast("לא הצלחנו להפעיל התראות. אפשר לנסות שוב.", { error: true });
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration("/");
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await runner(removePushAction(sub.endpoint));
        await sub.unsubscribe();
      }
      setMode("off");
    } finally {
      setBusy(false);
    }
  }

  if (mode === "loading") return <p className="muted">בודקים את הטלפון…</p>;
  if (mode === "install")
    return (
      <p className="login-hint">
        באייפון, התראות עובדות כשהמערכת מותקנת במסך הבית: לוחצים בספארי על כפתור השיתוף <Icon name="upload" /> ואז ״הוספה למסך הבית״. פותחים את המערכת מהאייקון החדש, וחוזרים לכאן.
      </p>
    );
  if (mode === "unsupported") return <p className="muted">הדפדפן הזה לא תומך בהתראות. בטלפון, אפשר לפתוח את המערכת ב-Chrome או ב-Safari.</p>;
  if (mode === "denied") return <p className="muted">ההתראות חסומות בהגדרות של הדפדפן לאתר הזה. אחרי שמאשרים אותן שם, חוזרים לכאן.</p>;
  if (mode === "on")
    return (
      <div className="push-on">
        <p>
          <Icon name="checks" /> התזכורות פועלות במכשיר הזה: כשמגיע הזמן של משימה, תופיע התראה גם כשהמערכת סגורה.
        </p>
        <div className="row-end">
          <button type="button" className="btn" disabled={busy} onClick={() => runner(testPushAction())}>
            שליחת התראת בדיקה
          </button>
          <button type="button" className="btn ghost" disabled={busy} onClick={disable}>
            כיבוי
          </button>
        </div>
      </div>
    );
  return (
    <button type="button" className="bigbtn call" disabled={busy} onClick={enable}>
      <Icon name="bell" />
      {busy ? "מפעילים…" : "הפעלת תזכורות בטלפון הזה"}
    </button>
  );
}
