const COMMON = new Set([
  "12345678", "123456789", "1234567890", "87654321", "11111111", "00000000", "password", "password1", "qwerty123", "qwertyui",
  "abcd1234", "1q2w3e4r", "iloveyou", "11223344", "12341234", "meitar123", "admin123", "aa123456", "a1234567", "12qwaszx",
]);

/** A short reason the password can't be used, in plain Hebrew, or null when it is fine. */
export function passwordProblem(pw: string): string | null {
  if (!pw || pw.length < 8) return "הסיסמה צריכה להיות לפחות 8 תווים";
  if (pw.length > 128) return "הסיסמה ארוכה מדי";
  if (COMMON.has(pw.toLowerCase())) return "הסיסמה הזו נפוצה מדי וקל לנחש אותה. כדאי לבחור אחרת.";
  if (/^(.)\1+$/.test(pw)) return "הסיסמה הזו קלה מדי לניחוש. כדאי לבחור אחרת.";
  return null;
}
