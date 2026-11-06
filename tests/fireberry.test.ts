import { describe, expect, it } from "vitest";
import { fireberryKind, guessMeetingProject, legacyMeetingKey, mapMeetingStatus, mapStatus, meetingKey, parseCsv, parseFbDate, readFireberry, readFireberryMeetings } from "@/lib/fireberry";

// made-up rows in the shape of Fireberry's exports
const MEETINGS = '﻿תאריך התחלה,נושא,משויך ל,סטטוס,שם נציג,מקור הגעה (משויך ל:לקוח)\r\n' + '06/11/2026 11:00,"מטרו פ""ת",ישראל ישראלי,-,נציגה א,טאבולה\r\n' + "02/11/2026 10:30,זום אתונה,-,בוטלה,נציג ב,-\r\n" + "לא תאריך,לימסול,דנה,התקימה,נציג ב,\r\n";
const LEADS = "שם לקוח,טלפון,סטטוס,מקור הגעה\n" + "ישראל ישראלי,050-1234567,חדש,פייסבוק - אתונה\n";
const projects = ["אתונה", "לימסול", "מטרופארק", "מטרו רעננה", "נופי הירקון", "בן יהודה צפון"].map((name) => ({ id: "p-" + name, name }));

describe("reading Fireberry exports", () => {
  it("tells a meetings export from a leads export by its columns", () => {
    expect(fireberryKind(parseCsv(MEETINGS)[0])).toBe("meetings");
    expect(fireberryKind(parseCsv(LEADS)[0])).toBe("leads");
    expect(fireberryKind(["עמודה", "אחרת"])).toBe(null);
  });

  it("reads meetings with their date, client, subject and rep; a dash means empty", () => {
    const rows = readFireberryMeetings(MEETINGS);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ subject: 'מטרו פ"ת', client: "ישראל ישראלי", status: "", rep: "נציגה א", source: "טאבולה", updated: null });
    expect(rows[0].start?.getHours()).toBe(11);
    expect(rows[0].start?.getDate()).toBe(6);
    expect(rows[1]).toMatchObject({ client: "", source: "", status: "בוטלה" });
    expect(rows[2].start).toBe(null);
  });

  it("still reads leads exports as before", () => {
    const r = readFireberry(LEADS);
    expect(r.missing).toEqual([]);
    expect(r.rows[0]).toMatchObject({ name: "ישראל ישראלי", phone: "+972501234567", source: "פייסבוק - אתונה" });
  });

  it("translates meeting statuses; unknown ones stay ״נקבעה״", () => {
    expect(mapMeetingStatus("התקימה")).toBe("held");
    expect(mapMeetingStatus("התקיימה")).toBe("held");
    expect(mapMeetingStatus("המשך טיפול לאחר פגישה")).toBe("held");
    expect(mapMeetingStatus("נקבעה פגישה שנייה")).toBe("held");
    expect(mapMeetingStatus("בוטלה")).toBe("cancel");
    expect(mapMeetingStatus("תואמה")).toBe("set");
    expect(mapMeetingStatus("")).toBe("set");
  });

  it("gives the same meeting the same key in two files", () => {
    const start = new Date(2026, 10, 6, 10, 0);
    expect(meetingKey({ client: "ישראל ישראלי", start })).toBe(meetingKey({ client: "ישראל ישראלי", start: new Date(start) }));
    expect(meetingKey({ client: "ישראל ישראלי", start })).not.toBe(meetingKey({ client: "ישראל ישראלי", start: new Date(2026, 10, 6, 11, 0) }));
  });

  it("guesses a project only when the subject is clear", () => {
    expect(guessMeetingProject("פגישה אתונה", projects)).toBe("p-אתונה");
    expect(guessMeetingProject("דפני", projects)).toBe("p-אתונה");
    expect(guessMeetingProject('מטרו פ"ת', projects)).toBe("p-מטרופארק");
    expect(guessMeetingProject("מטרו פתח תקוה", projects)).toBe("p-מטרופארק");
    expect(guessMeetingProject('מטרו פ"ת ורעננה', projects)).toBe("");
    expect(guessMeetingProject("פתח תקווה", projects)).toBe("");
    expect(guessMeetingProject("לרנקה", projects)).toBe("");
    expect(guessMeetingProject("לימסול", projects)).toBe("p-לימסול");
  });
});

describe("Fireberry dates and keys", () => {
  it("reads day-first dates and refuses impossible or unknown ones", () => {
    expect(parseFbDate("05/11/2026 14:30")?.getMonth()).toBe(10);
    expect(parseFbDate("05-11-2026")?.getDate()).toBe(5);
    expect(parseFbDate("05-11-2026")?.getMonth()).toBe(10);
    expect(parseFbDate("2026-11-05")?.getDate()).toBe(5);
    expect(parseFbDate("31/02/2026")).toBe(null);
    expect(parseFbDate("Nov 5 2026")).toBe(null);
    expect(parseFbDate("-")).toBe(null);
  });

  it("a dash in a leads export means empty", () => {
    const r = readFireberry("שם לקוח,טלפון,סטטוס,אימייל\nישראל ישראלי,050-1234567,-,-\n");
    expect(r.rows[0].status).toBe("");
    expect(r.rows[0].email).toBe("");
    expect(mapStatus(r.rows[0].status).status).toBe("new");
  });

  it("lost reasons from Fireberry come in neutral wording", () => {
    expect(mapStatus("מכחיש פנייה")).toEqual({ status: "lost", reason: "הכחשת פנייה" });
    expect(mapStatus("לא מעוניין")).toEqual({ status: "lost", reason: "אין עניין" });
  });

  it("two meetings with no client at the same time are told apart by the rep", () => {
    const start = new Date(2026, 10, 6, 10, 0);
    expect(meetingKey({ client: "", start, rep: "א", subject: "" })).not.toBe(meetingKey({ client: "", start, rep: "ב", subject: "" }));
    // meetings with a client keep the key the first import gave them
    expect(meetingKey({ client: "ישראל ישראלי", start, rep: "א" })).toBe(legacyMeetingKey({ client: "ישראל ישראלי", start }));
  });
});
