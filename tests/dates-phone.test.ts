import { describe, expect, it } from "vitest";
import { fT, laterDate, meetDays, nextWorkday, slotsFor, timeWarning, wall } from "@/lib/crm/dates";
import { formatPhone, normalizePhone } from "@/lib/phone";

const thu = new Date(2026, 10, 5, 9, 20); // Thursday 5.11.2026 09:20

describe("working days", () => {
  it("the next working day after Thursday is Sunday (no Friday or Saturday)", () => {
    expect(nextWorkday(thu).getDay()).toBe(0);
  });
  it("booking days never include Saturday", () => {
    expect(meetDays(thu).some((d) => d.getDay() === 6)).toBe(false);
    expect(meetDays(thu)).toHaveLength(6);
  });
  it("Friday offers morning hours only, and warns after 13:00", () => {
    const fri = new Date(2026, 10, 6);
    expect(slotsFor(fri, thu)).toEqual(["09:00", "10:00", "11:00", "12:00"]);
    expect(timeWarning(fri, "15:30")).toContain("שבת");
    expect(timeWarning(fri, "10:00")).toBe("");
  });
  it("today only offers hours at least 30 minutes ahead", () => {
    const late = new Date(2026, 10, 5, 16, 45);
    expect(slotsFor(new Date(2026, 10, 5), late)[0]).toBe("18:00");
  });
  it("call back tomorrow morning means the next working day at 10:00", () => {
    const d = laterDate("tm", thu);
    expect(d.getDay()).toBe(0);
    expect(fT(d)).toBe("10:00");
  });
  it("times are shown in Israel time", () => {
    const utcNoon = new Date(Date.UTC(2026, 10, 5, 12, 0));
    expect(fT(utcNoon)).toBe("14:00");
    expect(wall(utcNoon).getHours()).toBe(14);
  });
});

describe("phone numbers", () => {
  it("accepts the ways people type Israeli numbers", () => {
    for (const v of ["050-1234567", "0501234567", "050 123 4567", "+972501234567", "972-50-1234567"]) expect(normalizePhone(v)).toBe("+972501234567");
  });
  it("rejects what is not a phone number", () => {
    expect(normalizePhone("123")).toBeNull();
    expect(normalizePhone("")).toBeNull();
  });
  it("shows Israeli numbers the local way", () => {
    expect(formatPhone("+972501234567")).toBe("050-123-4567");
  });
});
