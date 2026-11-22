// What the archive screens share with the browser: the kinds of records, the counts, and the words that confirm a move.

export type ArchiveKind = "lead" | "meeting" | "task" | "project";
export const ARCHIVE_KINDS: { key: ArchiveKind; label: string }[] = [
  { key: "lead", label: "לקוחות" },
  { key: "meeting", label: "פגישות" },
  { key: "task", label: "משימות" },
  { key: "project", label: "פרויקטים" },
];
export const isArchiveKind = (k: string | undefined): k is ArchiveKind => ARCHIVE_KINDS.some((x) => x.key === k);

export type ArchiveCounts = { leads: number; meetings: number; tasks: number; projects: number };

/** The words that confirm a move to the archive. */
export const CONFIRM_WORDS = "להעביר לארכיון";

/** Projects that are likely to stay, by name: Petah Tikva and Hadera. Only a suggestion: the person ticks what stays. */
export const likelyKept = (name: string) => /חדרה|פתח[\s-]*תקו|פ[״"']ת/.test(name);
