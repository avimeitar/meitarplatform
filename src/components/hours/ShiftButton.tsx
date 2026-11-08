"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { clockAction, clockOptionsAction } from "@/app/actions/hours";
import { Icon } from "@/components/Icon";
import { useDrawer, useToast } from "@/components/ui/Overlays";
import { useRunner } from "@/components/ui/useRunner";
import { fT } from "@/lib/crm/dates";
import { onPhone, signNow, usePrepared } from "./sign";

export type ShiftInfo = { tracked: boolean; openSince: string | null; missingExit: boolean; hasDevice: boolean };

const elapsed = (since: string, now: number) => {
  const m = Math.max(0, Math.round((now - new Date(since).getTime()) / 60_000));
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
};

/** A clock that ticks on the client only, so the server and the browser render the same first frame. */
export function useNow(everyMs = 30_000): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const t = setInterval(tick, everyMs);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [everyMs]);
  return now;
}

/**
 * Signing in or out of a shift. The signing options are fetched when the sheet opens,
 * so the tap on the button opens the phone's prompt at once.
 */
export function ClockSheet({ action, since }: { action: "in" | "out"; since?: string | null }) {
  const drawer = useDrawer();
  const runner = useRunner();
  const toast = useToast();
  const router = useRouter();
  const now = useNow(action === "in" ? 10_000 : 30_000);
  const { state, reload } = usePrepared(action, () => clockOptionsAction(action));
  const [busy, setBusy] = useState(false);
  const [phone, setPhone] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setPhone(onPhone()), 0);
    return () => clearTimeout(t);
  }, []);

  async function sign() {
    if (busy || !state?.ok || !state.data) return;
    setBusy(true);
    // no waiting before this call: the phone opens its prompt only straight from the tap
    const s = await signNow(state.data);
    if (!s.ok) {
      setBusy(false);
      toast(s.error, { error: true });
      void reload();
      return;
    }
    const r = await runner(clockAction(action, s.response));
    setBusy(false);
    if (r.ok) drawer.close();
    else void reload();
  }

  const blocked = state && !state.ok ? state : null;
  const ready = !!state?.ok && !!state.data;
  return (
    <div className="sheet-body clock-sheet">
      {action === "in" ? (
        <p className="clock-now">
          <span className="num">{now !== null ? fT(new Date(now)) : ""}</span>
          <small>השעה נרשמת לפי השעון של המערכת, ברגע החתימה</small>
        </p>
      ) : (
        since && (
          <p className="clock-now">
            <span className="num">{now !== null ? elapsed(since, now) : ""}</span>
            <small>שעות מאז הכניסה ב-{fT(new Date(since))}</small>
          </p>
        )
      )}
      {blocked ? (
        <>
          <p className="form-error" role="alert">
            {blocked.error}
          </p>
          {(blocked.field === "missing" || blocked.field === "setup") && (
            <button
              type="button"
              className="bigbtn call"
              onClick={() => {
                drawer.close();
                router.push("/hours");
              }}
            >
              <Icon name="clock" />
              {blocked.field === "missing" ? "להשלמת שעת היציאה" : "להגדרת החתימה"}
            </button>
          )}
        </>
      ) : (
        <button type="button" className={"bigbtn " + (action === "in" ? "call" : "clock-out")} disabled={!ready || busy} onClick={sign}>
          <Icon name={action === "in" ? "in" : "out"} />
          {!ready ? "מכינים את החתימה…" : busy ? "מחכים לאישור בטלפון…" : action === "in" ? "לחתום ולהיכנס למשמרת" : "לחתום ולצאת מהמשמרת"}
        </button>
      )}
      <button type="button" className="bigbtn light" onClick={drawer.close}>
        לא עכשיו
      </button>
      <p className="muted">
        {phone
          ? "אחרי הלחיצה מאשרים בטלפון, עם טביעת אצבע, זיהוי פנים או קוד הנעילה. כך הרישום נחתם."
          : "במחשב, הדפדפן יבקש לאשר עם הטלפון שהוגדר. אפשר גם לחתום ישירות מהטלפון."}
      </p>
    </div>
  );
}

/** Opens the sign-in or sign-out sheet. */
export function useClockSheet() {
  const drawer = useDrawer();
  return (action: "in" | "out", since?: string | null) =>
    drawer.open({ title: action === "in" ? "כניסה למשמרת" : "יציאה מהמשמרת", content: <ClockSheet action={action} since={since} />, sheet: true });
}

/** The shift button in the top bar: the state at a glance, and signing in or out from any screen. */
export function ShiftButton({ info }: { info: ShiftInfo }) {
  const openClock = useClockSheet();
  const now = useNow();
  if (!info.tracked) return null;
  if (!info.hasDevice)
    return (
      <Link className="shift-btn setup" href="/hours">
        <Icon name="clock" />
        <span className="sb-long">הגדרת חתימה למשמרות</span>
        <span className="sb-short">משמרת</span>
      </Link>
    );
  if (info.missingExit)
    return (
      <Link className="shift-btn warn" href="/hours">
        <Icon name="alert" />
        <span className="sb-long">חסרה שעת יציאה</span>
        <span className="sb-short">יציאה?</span>
      </Link>
    );
  if (info.openSince) {
    const since = info.openSince;
    const t = now !== null ? elapsed(since, now) : "";
    return (
      <button type="button" className="shift-btn on" aria-label={`במשמרת ${t} שעות. יציאה מהמשמרת`} onClick={() => openClock("out", since)}>
        <span className="sb-dot" aria-hidden="true" />
        <span className="sb-long">במשמרת {t}</span>
        <span className="sb-short num">{t || "במשמרת"}</span>
      </button>
    );
  }
  return (
    <button type="button" className="shift-btn" onClick={() => openClock("in")}>
      <Icon name="clock" />
      <span className="sb-long">כניסה למשמרת</span>
      <span className="sb-short">כניסה</span>
    </button>
  );
}
