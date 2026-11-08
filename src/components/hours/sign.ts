"use client";

import { browserSupportsWebAuthn, startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ActionResult } from "@/lib/action";

export type AuthOptions = Parameters<typeof startAuthentication>[0]["optionsJSON"];
export type RegOptions = Parameters<typeof startRegistration>[0]["optionsJSON"];
export type AuthResponse = Awaited<ReturnType<typeof startAuthentication>>;
export type RegResponse = Awaited<ReturnType<typeof startRegistration>>;

const NO_SUPPORT = "הדפדפן הזה לא יכול לחתום. אפשר לפתוח את המערכת בטלפון.";

export function canSign(): boolean {
  return typeof window !== "undefined" && browserSupportsWebAuthn();
}

/** Setting up is meant for the phone the person carries. */
export function onPhone(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua));
}

type Signed<T> = { ok: true; response: T } | { ok: false; error: string; name?: string };

/**
 * Opens the phone's signing prompt (fingerprint, face or screen lock).
 * Call it straight from the tap, with options fetched beforehand: an iPhone opens the prompt only from a tap,
 * not after waiting for the server.
 */
export async function signNow(options: AuthOptions): Promise<Signed<AuthResponse>> {
  if (!canSign()) return { ok: false, error: NO_SUPPORT };
  try {
    return { ok: true, response: await startAuthentication({ optionsJSON: options }) };
  } catch (e) {
    const name = (e as { name?: string })?.name;
    return { ok: false, name, error: onPhone() ? "החתימה לא הושלמה. אפשר לנסות שוב." : "החתימה לא הושלמה. אפשר לנסות שוב, או לחתום מהטלפון." };
  }
}

/** The one-time setup: the phone makes its key and the server keeps only the public half. Also called straight from the tap. */
export async function registerNow(options: RegOptions): Promise<Signed<RegResponse>> {
  if (!canSign()) return { ok: false, error: NO_SUPPORT };
  try {
    return { ok: true, response: await startRegistration({ optionsJSON: options }) };
  } catch (e) {
    const name = (e as { name?: string })?.name;
    // already set up on this phone
    if (name === "InvalidStateError") return { ok: false, name, error: "הטלפון הזה כבר מוגדר לחתימה" };
    return { ok: false, name, error: "ההגדרה לא הושלמה. אפשר לנסות שוב." };
  }
}

/** A server challenge lives 3 minutes; a waiting screen gets a fresh one before that. */
const REFRESH_MS = 150_000;

/**
 * Fetches signing options ahead of the tap and keeps them fresh. `key` names what is being prepared;
 * null prepares nothing. `reload()` gets new options, after a failed or finished attempt.
 */
export function usePrepared<T>(key: string | null, load: () => Promise<ActionResult<T>>) {
  const [state, setState] = useState<ActionResult<T> | null>(null);
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });
  const seq = useRef(0);
  const reload = useCallback(async () => {
    const n = ++seq.current;
    setState(null);
    const r = await loadRef.current();
    if (n === seq.current) setState(r);
  }, []);
  useEffect(() => {
    if (key === null) return;
    void reload();
    const t = setInterval(() => void reload(), REFRESH_MS);
    return () => {
      clearInterval(t);
      seq.current++;
    };
  }, [key, reload]);
  return { state, reload };
}
