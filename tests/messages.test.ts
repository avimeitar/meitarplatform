// The WhatsApp messages a manager words in רשימות והגדרות: fields fill in, and what is missing reads well.
import { describe, expect, it } from "vitest";
import { cleanTemplates, DEFAULT_TEMPLATES, fillTemplate, MEETING_TEMPLATE, needsMeeting, unknownFields } from "@/lib/crm/messages";

const full = { לקוח: "נועה", נציג: "אורנה", פרויקט: "מטרופארק", יום: "שלישי 18.11", שעה: "10:30", "נפגשים עם": "דרור", כתובת: "דרך רבין 1, פתח תקווה", ווייז: "https://crm.example/waze" };
const meeting = DEFAULT_TEMPLATES.find((t) => t.id === MEETING_TEMPLATE)!.text;

describe("filling a message", () => {
  it("signs with the sender's name and fills the meeting", () => {
    const text = fillTemplate(meeting, full);
    expect(text.startsWith("היי נועה, כאן אורנה מקבוצת מיתר")).toBe(true);
    expect(text).toContain("מתי: יום שלישי 18.11 בשעה 10:30");
    expect(text).toContain("בנושא: מטרופארק");
    expect(text).toContain("נפגשים עם: דרור");
    expect(text).toContain("ניווט בווייז: https://crm.example/waze");
    expect(text).not.toMatch(/[{}]/);
  });

  it("leaves out a line whose detail is missing, and keeps the rest of the layout", () => {
    const text = fillTemplate(meeting, { ...full, פרויקט: "", "נפגשים עם": null });
    expect(text).not.toContain("בנושא");
    expect(text).not.toContain("נפגשים עם");
    expect(text).toContain("איפה: דרך רבין 1, פתח תקווה");
    expect(text).not.toMatch(/\n{3}/);
  });

  it("a missing project inside a sentence still reads well", () => {
    expect(fillTemplate("ניסיתי להשיג אותך בקשר ל{פרויקט}.", { פרויקט: "" })).toBe("ניסיתי להשיג אותך בקשר לפרויקט.");
    expect(fillTemplate("כל הפרטים על {פרויקט}", { פרויקט: "" })).toBe("כל הפרטים על הפרויקט");
    expect(fillTemplate("בקשר ל{פרויקט}", { פרויקט: "אתונה" })).toBe("בקשר לאתונה");
  });

  it("a field it doesn't know stays as typed, and is pointed out", () => {
    expect(fillTemplate("היי {שם}", full)).toBe("היי {שם}");
    expect(unknownFields("היי {לקוח}, {שם} ו{שם}")).toEqual(["שם"]);
  });
});

describe("which messages are offered", () => {
  it("one with the day or time of a meeting needs a meeting", () => {
    expect(needsMeeting({ text: meeting })).toBe(true);
    expect(needsMeeting({ text: "היי {לקוח}" })).toBe(false);
    expect(DEFAULT_TEMPLATES.filter((t) => !needsMeeting(t)).map((t) => t.id)).toEqual(["project", "missed", "office"]);
  });

  it("saved messages are cleaned, and the meeting message is always there", () => {
    const saved = cleanTemplates([
      { id: "a", title: "  שלום  ", text: "היי {לקוח}\r\n" },
      { id: "a", title: "כפול", text: "x" },
      { id: "b", title: "", text: "בלי שם" },
    ]);
    expect(saved.map((t) => t.id)).toEqual([MEETING_TEMPLATE, "a"]);
    expect(saved[1]).toEqual({ id: "a", title: "שלום", text: "היי {לקוח}" });
    expect(cleanTemplates("junk")).toBe(DEFAULT_TEMPLATES);
  });
});
