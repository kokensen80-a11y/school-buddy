/**
 * Turns whatever was found in storage (or in an imported backup) into valid UserData.
 * It never throws: missing or malformed fields get their default, records that cannot
 * be repaired are dropped. This is also where older data versions would be migrated;
 * so far there is only version 1.
 *
 * The value helpers are shared with the actions, so that data written by the store
 * always passes through here unchanged.
 */
import type {
  AttachmentMeta,
  Exam,
  ID,
  InboxItem,
  ISODate,
  ISODateTime,
  NotificationPrefs,
  PlanWarning,
  Preferences,
  ReminderKind,
  SessionKind,
  SessionPart,
  SessionStatus,
  StudyMethod,
  StudySession,
  Subject,
  TimeOfDay,
  Topic,
  UserData,
} from '../../types';
import { isValidISODate, isValidTime } from '../date';
import { DEFAULT_PREFS, createEmptyUserData } from '../defaults';
import {
  EXAM_KIND_ORDER,
  PLAN_STYLE_ORDER,
  SESSION_KINDS,
  STUDY_METHOD_ORDER,
  SUBJECT_COLOR_ORDER,
} from '../labels';
import { MAX_EXAM_WEIGHT, MAX_INBOX_ITEMS, MAX_TOPIC_MINUTES } from './limits';

const DEFAULT_TOPIC_MINUTES = 30;
const MINUTES_PER_DAY = 1440;
const SESSION_KIND_ORDER = Object.keys(SESSION_KINDS) as SessionKind[];
const SESSION_STATUSES: readonly SessionStatus[] = ['gepland', 'gedaan', 'overgeslagen'];
const REMINDER_KINDS: readonly ReminderKind[] = [
  'sessie',
  'toets',
  'dagoverzicht',
  'avondcheck',
  'systeem',
];

type Raw = Record<string, unknown>;

// ───────────────────────── Value helpers ─────────────────────────

export const isRecord = (value: unknown): value is Raw =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const idOf = (value: unknown): ID | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined;

/** Trimmed text, or undefined when nothing is left. */
export function cleanText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

/** A whole number within [min, max] (rounded first), or undefined. */
export function wholeNumber(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  // Adding 0 turns the -0 that rounding can produce into a plain 0, which is what JSON stores.
  const rounded = Math.round(value) + 0;
  return rounded >= min && rounded <= max ? rounded : undefined;
}

const positiveNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;

export function oneOf<T extends string>(options: readonly T[], value: unknown): T | undefined {
  return options.find((option) => option === value);
}

/** A grade from 1 to 10, rounded to one decimal, or undefined. */
export function cleanGrade(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1 || value > 10) {
    return undefined;
  }
  return Math.round(value * 10) / 10;
}

/** A weight above 0 and at most MAX_EXAM_WEIGHT, or undefined. */
export function cleanWeight(value: unknown): number | undefined {
  const weight = positiveNumber(value);
  return weight !== undefined && weight <= MAX_EXAM_WEIGHT ? weight : undefined;
}

export function cleanTopicMinutes(value: unknown): number | undefined {
  return wholeNumber(value, 1, MAX_TOPIC_MINUTES);
}

/** The length of a study block or of one part of it: more than nothing, at most a whole day. */
function blockMinutes(value: unknown): number | undefined {
  const minutes = positiveNumber(value);
  return minutes !== undefined && minutes <= MINUTES_PER_DAY ? minutes : undefined;
}

/** A parseable timestamp in the canonical Date.toISOString() form, or undefined. */
function isoDateTime(value: unknown): ISODateTime | undefined {
  if (typeof value !== 'string') return undefined;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? undefined : new Date(ms).toISOString();
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function uniqueById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

/** Sanitises every entry of a stored list and drops the ones that cannot be repaired. */
function keepValid<T>(value: unknown, sanitizeOne: (raw: unknown) => T | undefined): T[] {
  return list(value).flatMap((raw) => {
    const item = sanitizeOne(raw);
    return item === undefined ? [] : [item];
  });
}

// ───────────────────────── Preferences ─────────────────────────

function timeOrNull(value: unknown, fallback: TimeOfDay | null): TimeOfDay | null {
  if (value === null) return null;
  return isValidTime(value) ? value : fallback;
}

function sanitizeNotificationPrefs(raw: unknown, fallback: NotificationPrefs): NotificationPrefs {
  const source = isRecord(raw) ? raw : {};
  const examDaysBefore = Array.isArray(source.examDaysBefore)
    ? unique(keepValid(source.examDaysBefore, (days) => wholeNumber(days, 0, 365))).sort(
        (a, b) => b - a,
      )
    : [...fallback.examDaysBefore];
  return {
    enabled: typeof source.enabled === 'boolean' ? source.enabled : fallback.enabled,
    sessionLeadMinutes:
      source.sessionLeadMinutes === null
        ? null
        : (wholeNumber(source.sessionLeadMinutes, 0, MINUTES_PER_DAY) ??
          fallback.sessionLeadMinutes),
    dailyDigestTime: timeOrNull(source.dailyDigestTime, fallback.dailyDigestTime),
    examDaysBefore,
    eveningCheckTime: timeOrNull(source.eveningCheckTime, fallback.eveningCheckTime),
  };
}

/** Valid preferences; every field that is missing or invalid in `raw` is taken from `fallback`. */
export function sanitizePrefs(raw: unknown, fallback: Preferences = DEFAULT_PREFS): Preferences {
  const source = isRecord(raw) ? raw : {};
  const rawMinutes = list(source.minutesPerWeekday);
  const methods = unique(
    keepValid(source.methods, (method) => oneOf(STUDY_METHOD_ORDER, method)),
  );
  return {
    minutesPerWeekday: fallback.minutesPerWeekday.map(
      (minutes, day) => wholeNumber(rawMinutes[day], 0, MINUTES_PER_DAY) ?? minutes,
    ) as Preferences['minutesPerWeekday'],
    sessionMinutes: wholeNumber(source.sessionMinutes, 5, 240) ?? fallback.sessionMinutes,
    breakMinutes: wholeNumber(source.breakMinutes, 0, 120) ?? fallback.breakMinutes,
    weekdayStart: isValidTime(source.weekdayStart) ? source.weekdayStart : fallback.weekdayStart,
    weekendStart: isValidTime(source.weekendStart) ? source.weekendStart : fallback.weekendStart,
    methods: methods.length > 0 ? methods : [...fallback.methods],
    planStyle: oneOf(PLAN_STYLE_ORDER, source.planStyle) ?? fallback.planStyle,
    leadDays: wholeNumber(source.leadDays, 1, 365) ?? fallback.leadDays,
    notifications: sanitizeNotificationPrefs(source.notifications, fallback.notifications),
  };
}

// ───────────────────────── Subjects, exams, topics ─────────────────────────

/** Subject names are unique without regard to case; two names with the same key are the same name. */
export const subjectNameKey = (name: string): string => name.toLowerCase();

function sanitizeSubject(raw: unknown): Subject | undefined {
  if (!isRecord(raw)) return undefined;
  const id = idOf(raw.id);
  const name = cleanText(raw.name);
  if (!id || !name) return undefined;
  return { id, name, color: oneOf(SUBJECT_COLOR_ORDER, raw.color) ?? 'gray' };
}

/**
 * The valid subjects, each name once: of two subjects with the same name the first
 * stays. `keptIds` maps the id of every valid stored subject to the id of the one
 * that stays, so the exams of a dropped double move to its namesake.
 */
function sanitizeSubjects(raw: unknown): { subjects: Subject[]; keptIds: Map<ID, ID> } {
  const byName = new Map<string, Subject>();
  const keptIds = new Map<ID, ID>();
  for (const subject of uniqueById(keepValid(raw, sanitizeSubject))) {
    const key = subjectNameKey(subject.name);
    const kept = byName.get(key) ?? subject;
    byName.set(key, kept);
    keptIds.set(subject.id, kept.id);
  }
  return { subjects: [...byName.values()], keptIds };
}

function sanitizeTopic(raw: unknown): Topic | undefined {
  if (!isRecord(raw)) return undefined;
  const id = idOf(raw.id);
  const title = cleanText(raw.title);
  if (!id || !title) return undefined;
  const topic: Topic = {
    id,
    title,
    estMinutes: cleanTopicMinutes(raw.estMinutes) ?? DEFAULT_TOPIC_MINUTES,
    difficulty: raw.difficulty === 1 || raw.difficulty === 3 ? raw.difficulty : 2,
    mastered: raw.mastered === true,
  };
  const notes = cleanText(raw.notes);
  if (notes) topic.notes = notes;
  return topic;
}

function sanitizeAttachment(raw: unknown, fallbackNow: ISODateTime): AttachmentMeta | undefined {
  if (!isRecord(raw)) return undefined;
  const id = idOf(raw.id);
  if (!id) return undefined;
  return {
    id,
    name: cleanText(raw.name) ?? 'Bijlage',
    mime: cleanText(raw.mime) ?? 'application/octet-stream',
    size: positiveNumber(raw.size) ?? 0,
    addedAt: isoDateTime(raw.addedAt) ?? fallbackNow,
  };
}

/** The optional exam fields; whatever is empty or invalid is left out. */
export function optionalExamFields(
  source: Raw,
): Pick<Exam, 'time' | 'location' | 'weight' | 'notes' | 'grade'> {
  const fields: Pick<Exam, 'time' | 'location' | 'weight' | 'notes' | 'grade'> = {};
  if (isValidTime(source.time)) fields.time = source.time;
  const location = cleanText(source.location);
  if (location) fields.location = location;
  const weight = cleanWeight(source.weight);
  if (weight !== undefined) fields.weight = weight;
  const notes = cleanText(source.notes);
  if (notes) fields.notes = notes;
  const grade = cleanGrade(source.grade);
  if (grade !== undefined) fields.grade = grade;
  return fields;
}

function sanitizeExam(
  raw: unknown,
  subjectIds: Map<ID, ID>,
  fallbackNow: ISODateTime,
): Exam | undefined {
  if (!isRecord(raw)) return undefined;
  const id = idOf(raw.id);
  const title = cleanText(raw.title);
  const subjectId = subjectIds.get(idOf(raw.subjectId) ?? '');
  if (!id || !title || !subjectId || !isValidISODate(raw.date)) return undefined;
  const createdAt = isoDateTime(raw.createdAt) ?? fallbackNow;
  return {
    id,
    subjectId,
    title,
    kind: oneOf(EXAM_KIND_ORDER, raw.kind) ?? 'toets',
    date: raw.date,
    ...optionalExamFields(raw),
    topics: uniqueById(keepValid(raw.topics, sanitizeTopic)),
    attachments: uniqueById(
      keepValid(raw.attachments, (attachment) => sanitizeAttachment(attachment, fallbackNow)),
    ),
    createdAt,
    updatedAt: isoDateTime(raw.updatedAt) ?? createdAt,
  };
}

/**
 * A file belongs to one exam: of two exams that name the same attachment the first
 * keeps it. Otherwise deleting one of them would take away the file of the other.
 */
function withUniqueAttachments(exams: Exam[]): Exam[] {
  const seen = new Set<ID>();
  return exams.map((exam) => ({
    ...exam,
    attachments: exam.attachments.filter((attachment) => {
      if (seen.has(attachment.id)) return false;
      seen.add(attachment.id);
      return true;
    }),
  }));
}

// ───────────────────────── Sessions and warnings ─────────────────────────

function sanitizePart(raw: unknown): SessionPart | undefined {
  if (!isRecord(raw)) return undefined;
  const topicId = idOf(raw.topicId);
  const minutes = blockMinutes(raw.minutes);
  return topicId && minutes ? { topicId, minutes } : undefined;
}

function sanitizeSession(
  raw: unknown,
  examIds: Set<ID>,
  defaultMethod: StudyMethod,
): StudySession | undefined {
  if (!isRecord(raw)) return undefined;
  const id = idOf(raw.id);
  const examId = idOf(raw.examId);
  const minutes = blockMinutes(raw.minutes);
  if (!id || !examId || !examIds.has(examId) || !minutes) return undefined;
  if (!isValidISODate(raw.date) || !isValidTime(raw.start)) return undefined;
  const session: StudySession = {
    id,
    examId,
    parts: keepValid(raw.parts, sanitizePart),
    date: raw.date,
    start: raw.start,
    minutes,
    kind: oneOf(SESSION_KIND_ORDER, raw.kind) ?? 'leren',
    method: oneOf(STUDY_METHOD_ORDER, raw.method) ?? defaultMethod,
    status: oneOf(SESSION_STATUSES, raw.status) ?? 'gepland',
    pinned: raw.pinned === true,
  };
  const completedAt = isoDateTime(raw.completedAt);
  if (completedAt) session.completedAt = completedAt;
  return session;
}

function sanitizeWarning(raw: unknown, examIds: Set<ID>): PlanWarning | undefined {
  if (!isRecord(raw)) return undefined;
  const examId = idOf(raw.examId);
  if (!examId || !examIds.has(examId)) return undefined;
  if (raw.type === 'geen-leerstof') return { type: 'geen-leerstof', examId };
  const missingMinutes = positiveNumber(raw.missingMinutes);
  return raw.type === 'te-weinig-tijd' && missingMinutes
    ? { type: 'te-weinig-tijd', examId, missingMinutes }
    : undefined;
}

// ───────────────────────── Inbox ─────────────────────────

export function sanitizeInboxItem(raw: unknown): InboxItem | undefined {
  if (!isRecord(raw)) return undefined;
  const id = idOf(raw.id);
  const at = isoDateTime(raw.at);
  const title = cleanText(raw.title);
  if (!id || !at || !title) return undefined;
  const item: InboxItem = {
    id,
    at,
    kind: oneOf(REMINDER_KINDS, raw.kind) ?? 'systeem',
    title,
    body: typeof raw.body === 'string' ? raw.body : '',
    read: raw.read === true,
  };
  // A link only ever leads to a screen of the app (a hash such as '#/toetsen/abc'),
  // never to a script or another site that an imported file may try to slip in.
  const link = cleanText(raw.link);
  if (link?.startsWith('#')) item.link = link;
  return item;
}

/** Newest first, at most MAX_INBOX_ITEMS. Of two items with the same id the first one wins. */
export function normalizeInbox(items: InboxItem[]): InboxItem[] {
  return uniqueById(items)
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .slice(0, MAX_INBOX_ITEMS);
}

// ───────────────────────── Everything ─────────────────────────

function sanitizeBlockedDates(raw: unknown): ISODate[] {
  return unique(list(raw).filter(isValidISODate)).sort();
}

/**
 * Valid UserData for anything that was stored. `fallbackNow` replaces timestamps
 * that are missing or unreadable.
 */
export function sanitizeUserData(
  raw: unknown,
  fallbackNow: ISODateTime = new Date().toISOString(),
): UserData {
  if (!isRecord(raw)) return createEmptyUserData();

  const prefs = sanitizePrefs(raw.prefs);
  const { subjects, keptIds } = sanitizeSubjects(raw.subjects);
  const exams = withUniqueAttachments(
    uniqueById(keepValid(raw.exams, (exam) => sanitizeExam(exam, keptIds, fallbackNow))),
  );
  const examIds = new Set(exams.map((exam) => exam.id));

  return {
    version: 1,
    onboarded: raw.onboarded === true,
    subjects,
    exams,
    sessions: uniqueById(
      keepValid(raw.sessions, (session) => sanitizeSession(session, examIds, prefs.methods[0])),
    ),
    warnings: keepValid(raw.warnings, (warning) => sanitizeWarning(warning, examIds)),
    prefs,
    blockedDates: sanitizeBlockedDates(raw.blockedDates),
    inbox: normalizeInbox(keepValid(raw.inbox, sanitizeInboxItem)),
  };
}
