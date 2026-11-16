/**
 * School Buddy — domain model.
 *
 * This file is the shared contract between the planner, the store, the
 * notification engine and the screens. Change it deliberately.
 */

/** Local calendar date, 'YYYY-MM-DD'. Never a UTC timestamp. Sorts lexicographically. */
export type ISODate = string;
/** Local wall-clock time, 'HH:mm' (24h). */
export type TimeOfDay = string;
/** Full timestamp as produced by Date.toISOString(). */
export type ISODateTime = string;
export type ID = string;

// ───────────────────────── Subjects (vakken) ─────────────────────────

export type SubjectColor =
  | 'green'
  | 'teal'
  | 'blue'
  | 'indigo'
  | 'purple'
  | 'pink'
  | 'red'
  | 'orange'
  | 'yellow'
  | 'gray';

export interface Subject {
  id: ID;
  name: string;
  color: SubjectColor;
}

// ───────────────────────── Exams (toetsen) & material (leerstof) ─────────────────────────

/** 1 = makkelijk, 2 = gemiddeld, 3 = moeilijk */
export type Difficulty = 1 | 2 | 3;

/** One piece of study material for an exam, e.g. "Hoofdstuk 3 – Celdeling" or "§2.1 t/m §2.4". */
export interface Topic {
  id: ID;
  title: string;
  notes?: string;
  /** Estimated minutes needed to learn this topic the first time. */
  estMinutes: number;
  difficulty: Difficulty;
  /** "Ken ik al": the planner skips first-pass learning and only schedules review. */
  mastered: boolean;
}

export type ExamKind = 'toets' | 'so' | 'tentamen' | 'mondeling' | 'presentatie' | 'deadline';

/** Metadata of an uploaded file (photo of the studiewijzer, PDF…). The blob itself lives in IndexedDB. */
export interface AttachmentMeta {
  id: ID;
  name: string;
  mime: string;
  size: number;
  addedAt: ISODateTime;
}

export interface Exam {
  id: ID;
  subjectId: ID;
  title: string;
  kind: ExamKind;
  date: ISODate;
  /** Start time of the exam, if known. */
  time?: TimeOfDay;
  location?: string;
  /** Weging, e.g. 2 for "telt 2x". */
  weight?: number;
  notes?: string;
  topics: Topic[];
  attachments: AttachmentMeta[];
  /** Cijfer, filled in afterwards (1–10). */
  grade?: number;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

// ───────────────────────── Preferences (voorkeuren) ─────────────────────────

export type StudyMethod =
  | 'lezen'
  | 'samenvatten'
  | 'flashcards'
  | 'oefenen'
  | 'uitleggen'
  | 'mindmap'
  | 'overhoren';

/**
 * How work is spread over the days before an exam.
 * - gespreid: evenly over the available days
 * - vroeg:    front-loaded, done well ahead of time
 * - laat:     close to the exam
 */
export type PlanStyle = 'gespreid' | 'vroeg' | 'laat';

export interface NotificationPrefs {
  /** Master switch (the browser permission is tracked separately). */
  enabled: boolean;
  /** Remind this many minutes before each study block (0 = at start). null = off. */
  sessionLeadMinutes: number | null;
  /** Daily overview ("Vandaag: 3 blokken…") at this time. null = off. */
  dailyDigestTime: TimeOfDay | null;
  /** Remind N days before each exam, e.g. [7, 3, 1]. Empty = off. */
  examDaysBefore: number[];
  /** Evening check-in when planned blocks are still open. null = off. */
  eveningCheckTime: TimeOfDay | null;
}

export interface Preferences {
  /** Max study minutes per weekday; index 0 = Monday … 6 = Sunday. 0 = rest day. */
  minutesPerWeekday: [number, number, number, number, number, number, number];
  /** Length of one study block in minutes (e.g. 25, 30, 45, 60). */
  sessionMinutes: number;
  /** Break between two blocks in minutes. */
  breakMinutes: number;
  /** When studying starts on Monday–Friday. */
  weekdayStart: TimeOfDay;
  /** When studying starts on Saturday and Sunday. */
  weekendStart: TimeOfDay;
  /** Preferred study methods, most preferred first. Never empty. */
  methods: StudyMethod[];
  planStyle: PlanStyle;
  /** Start preparing at most this many days before an exam. */
  leadDays: number;
  notifications: NotificationPrefs;
}

// ───────────────────────── Study plan (planning) ─────────────────────────

/**
 * - leren:         first pass through new material
 * - herhalen:      spaced repetition of material learned earlier
 * - eindherhaling: final review shortly before the exam
 */
export type SessionKind = 'leren' | 'herhalen' | 'eindherhaling';
export type SessionStatus = 'gepland' | 'gedaan' | 'overgeslagen';

/** Which topic a session works on, and for how long. */
export interface SessionPart {
  topicId: ID;
  minutes: number;
}

/** One study block in the agenda. */
export interface StudySession {
  id: ID;
  examId: ID;
  /**
   * What is studied in this block. The minutes add up to `minutes`.
   * Empty only for a generic block of an exam that has no topics yet.
   */
  parts: SessionPart[];
  date: ISODate;
  start: TimeOfDay;
  minutes: number;
  kind: SessionKind;
  method: StudyMethod;
  status: SessionStatus;
  /** True when the user moved this block by hand; the planner then keeps its date and start. */
  pinned: boolean;
  completedAt?: ISODateTime;
}

export type PlanWarning =
  /** Not all work for this exam fits before its date with the current preferences. */
  | { type: 'te-weinig-tijd'; examId: ID; missingMinutes: number }
  /** The exam has no topics; only generic blocks could be planned. */
  | { type: 'geen-leerstof'; examId: ID };

export interface PlanInput {
  /** The current local date. */
  today: ISODate;
  /** Minutes since local midnight; new blocks today never start before this. */
  nowMinutes: number;
  exams: Exam[];
  prefs: Preferences;
  /** The current sessions (history + previous plan). */
  previous: StudySession[];
  /** Days on which the user cannot study at all. */
  blockedDates: ISODate[];
}

export interface PlanResult {
  /** The complete new session list (history included), sorted by date, then start. */
  sessions: StudySession[];
  warnings: PlanWarning[];
}

/** Progress of one topic, derived from the sessions. */
export interface TopicProgress {
  topicId: ID;
  /** Total minutes of work the planner wants for this topic (learning + all reviews). */
  requiredMinutes: number;
  doneMinutes: number;
  plannedMinutes: number;
}

// ───────────────────────── Notifications (meldingen) ─────────────────────────

export type ReminderKind = 'sessie' | 'toets' | 'dagoverzicht' | 'avondcheck' | 'systeem';

/** A reminder that should fire at a moment in the future. Derived from the plan; never stored. */
export interface Reminder {
  /** Stable id: the same reminder keeps the same id across re-plans, so it never fires twice. */
  id: string;
  at: ISODateTime;
  kind: ReminderKind;
  title: string;
  body: string;
  /** In-app deep link, a hash such as '#/toetsen/abc'. */
  link?: string;
}

/** A message in the in-app notification centre. */
export interface InboxItem {
  id: string;
  at: ISODateTime;
  kind: ReminderKind;
  title: string;
  body: string;
  link?: string;
  read: boolean;
}

// ───────────────────────── Accounts & persistence ─────────────────────────

export interface Account {
  id: ID;
  name: string;
  email: string;
  createdAt: ISODateTime;
}

/** Everything that belongs to one account. Stored per account, exported as backup. */
export interface UserData {
  version: 1;
  /** False until the preferences wizard is finished. */
  onboarded: boolean;
  subjects: Subject[];
  exams: Exam[];
  sessions: StudySession[];
  /** Warnings from the most recent planning run. */
  warnings: PlanWarning[];
  prefs: Preferences;
  blockedDates: ISODate[];
  inbox: InboxItem[];
}
