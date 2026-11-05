import { parsePhoneNumberFromString } from "libphonenumber-js";

/** Turns what people type ("050-1234567", "0501234567", "+972 50…") into E.164, or null. */
export function normalizePhone(input: string | null | undefined): string | null {
  if (!input) return null;
  const cleaned = String(input).trim();
  if (!cleaned) return null;
  const parsed = parsePhoneNumberFromString(cleaned, "IL");
  if (!parsed || !parsed.isPossible()) return null;
  return parsed.number;
}

/** Israeli numbers as people write them (050-123-4567); foreign numbers in international form. */
export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return "";
  const parsed = parsePhoneNumberFromString(e164);
  if (!parsed) return e164;
  return parsed.country === "IL" ? parsed.formatNational() : parsed.formatInternational();
}

/** Digits for wa.me links: 972501234567. */
export function waDigits(e164: string): string {
  return e164.replace(/\D/g, "");
}
