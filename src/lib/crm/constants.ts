export const ST = {
  new: { l: "חדש", c: "s-new" },
  process: { l: "בתהליך", c: "s-work" },
  noans: { l: "אין מענה", c: "s-noans" },
  meet: { l: "נקבעה פגישה", c: "s-meet" },
  resched: { l: "לתאם מחדש", c: "s-resched" },
  held: { l: "התקיימה פגישה", c: "s-held" },
  follow: { l: "המשך טיפול", c: "s-nego" },
  won: { l: "נחתמה עסקה", c: "s-won" },
  lost: { l: "לא רלוונטי", c: "s-lost" },
} as const;

export type LeadStatus = keyof typeof ST;
export const ST_ORDER: LeadStatus[] = ["new", "process", "noans", "meet", "resched", "held", "follow", "won", "lost"];
/** The main line shown on the lead card. */
export const MAIN: LeadStatus[] = ["new", "process", "meet", "held", "follow", "won"];
export const OPEN_STATUSES: LeadStatus[] = ["new", "process", "noans", "meet", "resched", "held", "follow"];
export const isLeadStatus = (s: string): s is LeadStatus => Object.prototype.hasOwnProperty.call(ST, s);

export const MS = {
  set: { l: "תואמה", c: "m-set", icon: "cal" },
  cancel: { l: "בוטלה", c: "m-cancel", icon: "x" },
  held: { l: "התקיימה", c: "m-held", icon: "check" },
} as const;
export type MeetingStatus = keyof typeof MS;
export const isMeetingStatus = (s: string): s is MeetingStatus => s === "set" || s === "cancel" || s === "held";

/** Who a meeting is with: its lead, or the name kept on the meeting itself (imported history, or a lead that was deleted). */
export function meetingClient(m: { lead?: { name: string } | null; clientName?: string | null }): string {
  return m.lead?.name ?? m.clientName ?? "ללא שם";
}

export const REASONS = ["מכחיש פנייה", "לא מעוניין", "אין תקציב", "מספר לא תקין", "רכש במקום אחר", "אחר"];

export const PLACES = [
  { value: "משרד, פתח תקווה", label: "במשרד" },
  { value: "זום", label: "בזום" },
  { value: "טלפון", label: "בטלפון" },
];

/** Sources people can choose when adding a lead by hand. Leads from forms and campaigns bring their own. */
export const MANUAL_SOURCES = ["שיחה נכנסת", "הגיע למשרד", "הפניה", "פייסבוק", "דף נחיתה", "גוגל", "וואטסאפ", "אתר החברה", "ספק לידים", "אחר"];

export const OFFICE_ADDRESS = "המשרד שלנו נמצא בדרך רבין 1, פתח תקווה, מגדל גלובל טאוור, קומה 4.";
