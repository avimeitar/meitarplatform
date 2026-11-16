export const ST = {
  new: { l: "חדש", c: "s-new" },
  process: { l: "בתהליך", c: "s-work" },
  noans: { l: "אין מענה", c: "s-noans" },
  meet: { l: "נקבעה פגישה", c: "s-meet" },
  resched: { l: "לתאם מחדש", c: "s-resched" },
  held: { l: "התקיימה פגישה", c: "s-held" },
  follow: { l: "המשך טיפול לאחר פגישה", c: "s-nego" },
  won: { l: "נחתמה עסקה", c: "s-won" },
  lost: { l: "לא רלוונטי", c: "s-lost" },
} as const;

export type LeadStatus = keyof typeof ST;
export const ST_ORDER: LeadStatus[] = ["new", "process", "noans", "meet", "resched", "held", "follow", "won", "lost"];
/** The main line shown on the lead card. */
export const MAIN: LeadStatus[] = ["new", "process", "meet", "held", "follow", "won"];
export const OPEN_STATUSES: LeadStatus[] = ["new", "process", "noans", "meet", "resched", "held", "follow"];
export const isLeadStatus = (s: string): s is LeadStatus => Object.prototype.hasOwnProperty.call(ST, s);

/** A meeting's status as stored. "set" with the arrival confirmed shows as "אושרה הגעה" (see MEETING_STATES). */
export const MS = {
  set: { l: "נקבעה", c: "m-set", icon: "cal" },
  held: { l: "התקיימה", c: "m-held", icon: "check" },
  noshow: { l: "אי-הגעה", c: "m-noshow", icon: "phone-x" },
  cancel: { l: "בוטלה", c: "m-cancel", icon: "x" },
  resched: { l: "לתאם מחדש", c: "m-resched", icon: "repeat" },
} as const;
export type MeetingStatus = keyof typeof MS;
export const isMeetingStatus = (s: string): s is MeetingStatus => Object.prototype.hasOwnProperty.call(MS, s);
/** Statuses of a meeting that did not take place. */
export const NOT_HELD: MeetingStatus[] = ["noshow", "cancel", "resched"];

/** What people pick and see: the stored statuses, with "נקבעה" split by whether the arrival was confirmed. */
export const MEETING_STATES = {
  set: { l: "נקבעה", c: "m-set", icon: "cal" },
  confirmed: { l: "אושרה הגעה", c: "m-ok", icon: "cc" },
  held: { l: "התקיימה", c: "m-held", icon: "check" },
  noshow: { l: "אי-הגעה", c: "m-noshow", icon: "phone-x" },
  cancel: { l: "בוטלה", c: "m-cancel", icon: "x" },
  resched: { l: "לתאם מחדש", c: "m-resched", icon: "repeat" },
} as const;
export type MeetingState = keyof typeof MEETING_STATES;
export const MEETING_STATE_ORDER: MeetingState[] = ["set", "confirmed", "held", "noshow", "cancel", "resched"];
export const isMeetingState = (s: string): s is MeetingState => Object.prototype.hasOwnProperty.call(MEETING_STATES, s);
export function meetingState(m: { status: string; confirmed: boolean }): MeetingState {
  if (m.status === "set") return m.confirmed ? "confirmed" : "set";
  return isMeetingState(m.status) ? m.status : "set";
}

/** Who a meeting is with: its lead, or the name kept on the meeting itself (imported history, or a lead that was deleted). */
export function meetingClient(m: { lead?: { name: string } | null; clientName?: string | null }): string {
  return m.lead?.name ?? m.clientName ?? "ללא שם";
}

/** A task's status as people see it. Done and cancelled are kept as done/voided, so every list that counts open tasks stays right. */
export const TASK_STATES = {
  open: { l: "פתוחה", c: "ts-open" },
  progress: { l: "בטיפול", c: "ts-progress" },
  done: { l: "הושלמה", c: "ts-done" },
  cancel: { l: "בוטלה", c: "ts-cancel" },
} as const;
export type TaskState = keyof typeof TASK_STATES;
export const TASK_STATE_ORDER: TaskState[] = ["open", "progress", "done", "cancel"];
export const isTaskState = (s: string): s is TaskState => Object.prototype.hasOwnProperty.call(TASK_STATES, s);
export function taskState(t: { done: boolean; voided: boolean; status: string }): TaskState {
  if (t.done) return t.voided ? "cancel" : "done";
  return t.status === "progress" ? "progress" : "open";
}

export const REASONS = ["הכחשת פנייה", "אין עניין", "אין תקציב", "מספר לא תקין", "רכישה במקום אחר", "אחר"];

export const PLACES = [
  { value: "משרד, פתח תקווה", label: "במשרד" },
  { value: "זום", label: "בזום" },
  { value: "טלפון", label: "בטלפון" },
];

/** Sources people can choose when adding a lead by hand. Leads from forms and campaigns bring their own. */
export const MANUAL_SOURCES = ["שיחה נכנסת", "הגעה למשרד", "הפניה", "פייסבוק", "דף נחיתה", "גוגל", "וואטסאפ", "אתר החברה", "ספק לידים", "אחר"];

/** Every meeting is at the office. */
export const OFFICE = {
  place: "משרד, פתח תקווה",
  address: "דרך רבין 1, פתח תקווה, מגדל גלובל טאוור, קומה 4",
  waze: "https://waze.com/ul?q=" + encodeURIComponent("דרך רבין 1, פתח תקווה") + "&navigate=yes",
};
export const OFFICE_ADDRESS = `המשרד שלנו נמצא ב${OFFICE.address}.`;
