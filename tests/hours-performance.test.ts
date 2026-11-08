// The rules behind work hours and the performance screen that need no database.
import { describe, expect, it } from "vitest";
import { leadFate, median, periodOf, workMinutes } from "@/lib/crm/performance";
import { canEditShift, isMissingExit, monthRange, shiftMinutes, tracksHours } from "@/lib/hours";
import type { CurrentUser } from "@/lib/session";

// Sunday 8.11.2026 at noon (npm test runs in Israel time)
const NOW = new Date(2026, 10, 8, 12, 0);

describe("performance periods", () => {
  it("this month runs from the 1st until now, and is compared with the same days last month", () => {
    const p = periodOf({ p: "month" }, NOW);
    expect(p.cur.start).toEqual(new Date(2026, 10, 1));
    expect(p.cur.end).toEqual(NOW);
    expect(p.prev.start).toEqual(new Date(2026, 9, 1));
    expect(p.prev.end).toEqual(new Date(2026, 9, 8, 12, 0));
    expect(p.title).toBe("1.11–8.11.2026");
    expect(p.bucket).toBe("day");
  });

  it("anything unknown shows this month", () => {
    expect(periodOf({ p: "nonsense" }, NOW).key).toBe("month");
  });

  it("last week is Sunday to Saturday, compared with the week before it", () => {
    const p = periodOf({ p: "lweek" }, NOW);
    expect(p.cur.start).toEqual(new Date(2026, 10, 1));
    expect(p.cur.end).toEqual(new Date(2026, 10, 8));
    expect(p.prev.start).toEqual(new Date(2026, 9, 25));
    expect(p.prev.end).toEqual(new Date(2026, 10, 1));
    expect(p.to).toBe("2026-11-07");
  });

  it("three months are counted by week", () => {
    const p = periodOf({ p: "3m" }, NOW);
    expect(p.cur.start).toEqual(new Date(2026, 8, 1));
    expect(p.prev.start).toEqual(new Date(2026, 5, 1));
    expect(p.bucket).toBe("week");
  });

  it("a custom range is put in order, stops at today, and covers at most a year", () => {
    const p = periodOf({ p: "custom", from: "2026-12-31", to: "2026-10-05" }, NOW);
    expect(p.cur.start).toEqual(new Date(2026, 9, 5));
    expect(p.cur.end).toEqual(NOW);
    expect(p.to).toBe("2026-11-08");
    const long = periodOf({ p: "custom", from: "2020-01-01", to: "2026-11-01" }, NOW);
    expect((long.cur.end.getTime() - long.cur.start.getTime()) / 86_400_000).toBeLessThanOrEqual(367);
    expect(long.bucket).toBe("month");
    // a day that doesn't exist falls back to the start of this month
    expect(periodOf({ p: "custom", from: "2026-02-31", to: "2026-11-03" }, NOW).cur.start).toEqual(new Date(2026, 10, 1));
  });
});

describe("where a lead stands", () => {
  const base = { lostReason: null, touch: null, met: false, talked: false };
  it("tells untreated, unreached, junk and relevant apart", () => {
    expect(leadFate({ ...base, status: "new" })).toBe("untreated");
    expect(leadFate({ ...base, status: "new", touch: NOW })).toBe("unreached");
    // one call without an answer makes a lead "בתהליך", but nobody has talked to it yet
    expect(leadFate({ ...base, status: "process", touch: NOW })).toBe("unreached");
    expect(leadFate({ ...base, status: "process", touch: NOW, talked: true })).toBe("relevant");
    expect(leadFate({ ...base, status: "noans" })).toBe("unreached");
    expect(leadFate({ ...base, status: "noans", met: true })).toBe("relevant");
    expect(leadFate({ ...base, status: "lost", lostReason: "מספר לא תקין" })).toBe("junk");
    expect(leadFate({ ...base, status: "lost", lostReason: "הכחשת פנייה" })).toBe("junk");
    // a real person who dropped out is still a relevant lead
    expect(leadFate({ ...base, status: "lost", lostReason: "אין תקציב" })).toBe("relevant");
    expect(leadFate({ ...base, status: "meet" })).toBe("relevant");
    expect(leadFate({ ...base, status: "won" })).toBe("relevant");
  });
});

describe("response time counts working hours only", () => {
  it("within the same morning", () => {
    expect(workMinutes(new Date(2026, 10, 9, 10, 0), new Date(2026, 10, 9, 10, 15))).toBe(15);
  });
  it("a lead from the night that got a call at 8:10 waited 10 minutes", () => {
    expect(workMinutes(new Date(2026, 10, 9, 23, 0), new Date(2026, 10, 10, 8, 10))).toBe(10);
  });
  it("Thursday evening to Sunday morning skips the weekend", () => {
    expect(new Date(2026, 10, 12).getDay()).toBe(4);
    expect(workMinutes(new Date(2026, 10, 12, 19, 50), new Date(2026, 10, 15, 8, 10))).toBe(20);
  });
  it("the median of the waits", () => {
    expect(median([])).toBeNull();
    expect(median([5, 1, 3])).toBe(3);
    expect(median([1, 2, 4, 10])).toBe(3);
  });
});

describe("work hours rules", () => {
  it("an open shift from an earlier day is missing its exit", () => {
    expect(isMissingExit(new Date(2026, 10, 7, 9, 0), NOW)).toBe(true);
    expect(isMissingExit(new Date(2026, 10, 8, 8, 0), NOW)).toBe(false);
  });

  it("a shift belongs whole to the day it started; an open one counts nothing yet", () => {
    expect(shiftMinutes({ startAt: new Date(2026, 10, 7, 22, 0), endAt: new Date(2026, 10, 8, 2, 30) })).toBe(270);
    expect(shiftMinutes({ startAt: new Date(2026, 10, 8, 9, 0), endAt: null })).toBe(0);
  });

  it("employees fix their own hours up to 7 days back; managers fix anyone else's at any time", () => {
    const agent = { id: "a", permissions: [] } as unknown as CurrentUser;
    const manager = { id: "m", permissions: ["hours.manage"] } as unknown as CurrentUser;
    expect(canEditShift(agent, { userId: "a", startAt: new Date(2026, 10, 1, 9) }, NOW)).toBe(true);
    expect(canEditShift(agent, { userId: "a", startAt: new Date(2026, 9, 31, 9) }, NOW)).toBe(false);
    expect(canEditShift(agent, { userId: "b", startAt: new Date(2026, 10, 8, 9) }, NOW)).toBe(false);
    expect(canEditShift(manager, { userId: "a", startAt: new Date(2026, 8, 1, 9) }, NOW)).toBe(true);
    // a manager's own hours follow the employees' rule
    expect(canEditShift(manager, { userId: "m", startAt: new Date(2026, 9, 31, 9) }, NOW)).toBe(false);
  });

  it("system administrators don't report hours; agents and sales managers do", () => {
    expect(tracksHours({ permissions: ["users.manage", "roles.manage"] } as unknown as CurrentUser)).toBe(false);
    expect(tracksHours({ permissions: ["reports.view", "hours.manage"] } as unknown as CurrentUser)).toBe(true);
    expect(tracksHours({ permissions: [] } as unknown as CurrentUser)).toBe(true);
  });

  it("a month from the address", () => {
    const r = monthRange("2026-02");
    expect(r.start).toEqual(new Date(2026, 1, 1));
    expect(r.end).toEqual(new Date(2026, 2, 1));
    expect(monthRange("junk", NOW).key).toBe("2026-11");
  });
});
