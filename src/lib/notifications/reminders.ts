/**
 * Derives the reminders for the coming days from the user's data.
 *
 * Pure: no clock, no storage, no browser APIs. The result is recomputed on every state
 * change; the engine (engine.ts) decides when a reminder is actually shown and makes sure
 * each id fires only once.
 *
 * Reminder ids are built from what the reminder is about (exam, date, start time), never
 * from the moment it fires or from its text. Changing the lead time or finishing one block
 * of a run therefore never makes an already delivered reminder fire again, while a block
 * that moves to another slot gets a new id.
 */
import type {
  Exam,
  ISODate,
  Reminder,
  ReminderKind,
  StudySession,
  TimeOfDay,
  UserData,
} from '../../types';
import {
  addDays,
  dateRange,
  formatDateLong,
  formatDuration,
  formatRelative,
  formatTime,
  isValidISODate,
  isValidTime,
  parseTime,
  toDateTime,
  toISODate,
} from '../date';
import { EXAM_KINDS, STUDY_METHODS } from '../labels';
import { toHash } from '../router';

export const DEFAULT_HORIZON_DAYS = 14;
export const DEFAULT_GRACE_MINUTES = 90;

/** Two blocks belong to the same study run when the pause between them is at most the break plus this. */
const RUN_SLACK_MINUTES = 5;
/** Time of the exam countdown reminders when the daily overview is switched off. */
const EXAM_COUNTDOWN_FALLBACK_TIME: TimeOfDay = '16:00';
/** Time of the good-luck message for an exam without a start time. */
const EXAM_DAY_TIME: TimeOfDay = '07:30';
/** The good-luck message goes out this long before an exam that has a start time. */
const EXAM_DAY_LEAD_MINUTES = 60;

/** Longer texts are cut off: a notification shows a few lines at most. */
const MAX_TITLE_LENGTH = 80;
const MAX_BODY_LENGTH = 240;

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
const MINUTES_PER_DAY = 24 * 60;

export interface BuildRemindersInput {
  data: UserData;
  now: Date;
  /** How far ahead reminders are generated. */
  horizonDays?: number;
  /** How far back reminders are still returned, so a reminder that was just missed can be delivered. */
  graceMinutes?: number;
}

/** A reminder whose moment is still a Date, so it can be filtered and sorted cheaply. */
interface Draft {
  id: string;
  at: Date;
  kind: ReminderKind;
  title: string;
  body: string;
  link: string;
}

/** A study block together with the exam and subject it belongs to. */
interface Block {
  session: StudySession;
  exam: Exam;
  subject: string;
}

interface Context {
  prefs: UserData['prefs'];
  /** Exams with a usable date (and time, when they have one). */
  exams: Exam[];
  /** All blocks with a usable date and start whose exam still exists, sorted by date and start. */
  blocks: Block[];
  subjectOf: (exam: Exam) => string;
  /** Every calendar day that overlaps the reminder window. */
  days: ISODate[];
}

// ───────────────────────── Small helpers ─────────────────────────

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const unique = <T>(items: T[]): T[] => [...new Set(items)];
const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const countBlocks = (n: number) => (n === 1 ? '1 blok' : `${n} blokken`);
const totalMinutes = (blocks: Block[]) => blocks.reduce((sum, b) => sum + b.session.minutes, 0);
const isPlanned = (block: Block) => block.session.status === 'gepland';
const startOf = (session: StudySession) => parseTime(session.start);
const endOf = (session: StudySession) => startOf(session) + session.minutes;
/** The moment the last of these blocks ends, in minutes since midnight of their day. */
const endOfAll = (blocks: Block[]) => Math.max(...blocks.map((block) => endOf(block.session)));

/** Cuts a text off after `max` characters (never in the middle of one) and marks the cut with "…". */
function clip(text: string, max: number): string {
  const characters = [...text];
  return characters.length > max ? `${characters.slice(0, max - 1).join('').trimEnd()}…` : text;
}

function moment(date: ISODate, time: TimeOfDay, minutesEarlier = 0): Date {
  return new Date(toDateTime(date, time).getTime() - minutesEarlier * MINUTE_MS);
}

/** "A", "A en B", "A, B en C"; a longer list ends in "en nog 2". */
function listNl(items: string[], max = 3): string {
  const shown =
    items.length > max ? [...items.slice(0, max - 1), `nog ${items.length - max + 1}`] : items;
  if (shown.length <= 1) return shown.join('');
  return `${shown.slice(0, -1).join(', ')} en ${shown[shown.length - 1]}`;
}

/** "toets Biologie", "SO Engels", "inleveropdracht Nederlands". */
function examName(exam: Exam, subject: string): string {
  const noun = exam.kind === 'so' ? EXAM_KINDS.so.short : EXAM_KINDS[exam.kind].label.toLowerCase();
  return `${noun} ${subject}`;
}

const agendaLink = (date: ISODate) => toHash({ name: 'agenda', date });
const examLink = (exam: Exam) => toHash({ name: 'toets', id: exam.id });

/** Damaged records (a hand-edited backup, say) are left out instead of breaking every reminder. */
function createContext(data: UserData, from: number, until: number): Context {
  const exams = data.exams.filter(
    (exam) => isValidISODate(exam.date) && (!exam.time || isValidTime(exam.time)),
  );
  const examById = new Map(exams.map((exam) => [exam.id, exam]));
  const subjects = new Map(data.subjects.map((subject) => [subject.id, subject.name.trim()]));
  const subjectOf = (exam: Exam) => subjects.get(exam.subjectId) || exam.title;

  const blocks: Block[] = [];
  for (const session of data.sessions) {
    const exam = examById.get(session.examId);
    if (exam && isValidISODate(session.date) && isValidTime(session.start)) {
      blocks.push({ session, exam, subject: subjectOf(exam) });
    }
  }
  blocks.sort(
    (a, b) =>
      compare(a.session.date, b.session.date) || compare(a.session.start, b.session.start),
  );

  const days = dateRange(toISODate(new Date(from)), toISODate(new Date(until)));
  return { prefs: data.prefs, exams, blocks, subjectOf, days };
}

// ───────────────────────── 'sessie': time to study ─────────────────────────

/**
 * Splits the blocks into study runs: blocks of one exam on one day that follow each other
 * with at most a break in between. Blocks of every status take part, so a run keeps its
 * identity (its first block) while the student works through it.
 */
function studyRuns(blocks: Block[], maxGapMinutes: number): Block[][] {
  const perExamAndDay = [...blocks].sort(
    (a, b) =>
      compare(a.exam.id, b.exam.id) ||
      compare(a.session.date, b.session.date) ||
      compare(a.session.start, b.session.start),
  );
  const runs: Block[][] = [];
  for (const block of perExamAndDay) {
    const run = runs[runs.length - 1];
    const previous = run?.[run.length - 1];
    // Measured from the end of the whole run: a block may lie inside a longer one.
    const continues =
      previous !== undefined &&
      previous.exam.id === block.exam.id &&
      previous.session.date === block.session.date &&
      startOf(block.session) - endOfAll(run) <= maxGapMinutes;
    if (run && continues) run.push(block);
    else runs.push([block]);
  }
  return runs;
}

const SESSION_TITLES: Record<StudySession['kind'], string> = {
  leren: 'Tijd om te leren',
  herhalen: 'Tijd om te herhalen',
  eindherhaling: 'Tijd voor je eindherhaling',
};

function topicTitles(blocks: Block[]): string[] {
  return unique(
    blocks.flatMap(({ session, exam }) =>
      session.parts.flatMap((part) => {
        const topic = exam.topics.find((t) => t.id === part.topicId);
        return topic ? [topic.title] : [];
      }),
    ),
  );
}

function sessionReminders({ prefs, blocks }: Context): Draft[] {
  const lead = prefs.notifications.sessionLeadMinutes;
  if (lead === null) return [];

  const drafts: Draft[] = [];
  for (const run of studyRuns(blocks, prefs.breakMinutes + RUN_SLACK_MINUTES)) {
    const open = run.filter(isPlanned);
    if (open.length === 0) continue;

    const first = open[0];
    const { exam, subject } = first;
    // A run that goes on past midnight ends at a time on the next day.
    const end = formatTime(endOfAll(open) % MINUTES_PER_DAY);
    const when =
      open.length === 1
        ? `${first.session.start} · ${formatDuration(first.session.minutes)}`
        : `${first.session.start} · ${countBlocks(open.length)}, tot ${end}`;
    const methods = unique(open.map((block) => STUDY_METHODS[block.session.method].label));

    drafts.push({
      // The run's first block, whatever its status: one reminder per run, ever.
      id: `sessie:${exam.id}:${run[0].session.date}T${run[0].session.start}`,
      at: moment(first.session.date, first.session.start, lead),
      kind: 'sessie',
      title: `${SESSION_TITLES[first.session.kind]}: ${subject}`,
      body: [when, listNl(methods), listNl(topicTitles(open)) || exam.title].join(' · '),
      link: agendaLink(first.session.date),
    });
  }
  return drafts;
}

// ───────────────────────── 'dagoverzicht': what today looks like ─────────────────────────

function dailyDigests({ prefs, exams, blocks, subjectOf, days }: Context): Draft[] {
  const time = prefs.notifications.dailyDigestTime;
  if (time === null) return [];

  const examsOn = (date: ISODate) =>
    exams
      .filter((exam) => exam.date === date)
      .map((exam) => examName(exam, subjectOf(exam)) + (exam.time ? ` (${exam.time})` : ''));

  const drafts: Draft[] = [];
  for (const date of days) {
    const planned = blocks.filter((block) => block.session.date === date && isPlanned(block));
    const today = examsOn(date);
    if (planned.length === 0 && today.length === 0) continue;

    const tomorrow = examsOn(addDays(date, 1));
    const lines =
      planned.length > 0
        ? [
            `${listNl(unique(planned.map((block) => block.subject)))}.`,
            today.length > 0 ? `Vandaag ook: ${listNl(today)}.` : '',
          ]
        : ['Geen blokken gepland.'];
    if (tomorrow.length > 0) lines.push(`Morgen: ${listNl(tomorrow)}.`);

    drafts.push({
      id: `dagoverzicht:${date}`,
      at: moment(date, time),
      kind: 'dagoverzicht',
      title:
        planned.length > 0
          ? `Vandaag: ${countBlocks(planned.length)} (${formatDuration(totalMinutes(planned))})`
          : `Vandaag: ${listNl(today)}`,
      body: lines.filter(Boolean).join(' '),
      link: agendaLink(date),
    });
  }
  return drafts;
}

// ───────────────────────── 'toets': countdown and good luck ─────────────────────────

function examReminders({ prefs, exams, blocks, subjectOf }: Context): Draft[] {
  const { examDaysBefore, dailyDigestTime } = prefs.notifications;
  const countdownTime = dailyDigestTime ?? EXAM_COUNTDOWN_FALLBACK_TIME;
  const daysBefore = unique(examDaysBefore.filter((n) => Number.isInteger(n) && n > 0));

  const drafts: Draft[] = [];
  for (const exam of exams) {
    const subject = subjectOf(exam);
    const name = examName(exam, subject);
    const ownBlocks = blocks.filter((block) => block.exam.id === exam.id);
    const planned = ownBlocks.filter(isPlanned);
    const allDone =
      planned.length === 0 && ownBlocks.some((block) => block.session.status === 'gedaan');

    for (const n of daysBefore) {
      const day = addDays(exam.date, -n);
      const open = planned.filter((block) => block.session.date >= day).length;
      const progress =
        open > 0
          ? ` Nog ${countBlocks(open)} te gaan.`
          : allDone
            ? ' Al je blokken zijn af. Goed bezig!'
            : '';
      const when = formatDateLong(exam.date, day) + (exam.time ? ` om ${exam.time}` : '');
      drafts.push({
        id: `toets:${exam.id}:${exam.date}:${n}`,
        at: moment(day, countdownTime),
        kind: 'toets',
        title: `${capitalize(formatRelative(exam.date, day))}: ${name}`,
        body: `${exam.title} · ${when}.${progress}`,
        link: examLink(exam),
      });
    }

    const isDeadline = exam.kind === 'deadline';
    const details =
      exam.title + (exam.time ? ` om ${exam.time}` : '') + (exam.location ? ` (${exam.location})` : '');
    drafts.push({
      id: `toets:${exam.id}:${exam.date}:succes`,
      // Never before midnight: the message says "vandaag".
      at: exam.time
        ? moment(exam.date, exam.time, Math.min(EXAM_DAY_LEAD_MINUTES, parseTime(exam.time)))
        : moment(exam.date, EXAM_DAY_TIME),
      kind: 'toets',
      title: isDeadline ? `Vandaag inleveren: ${subject}` : `Succes vandaag met ${subject}!`,
      body: `${details}. ${isDeadline ? 'Succes met de laatste loodjes!' : 'Je kunt het!'}`,
      link: examLink(exam),
    });
  }
  return drafts;
}

// ───────────────────────── 'avondcheck': blocks still open tonight ─────────────────────────

function eveningChecks({ prefs, blocks, days }: Context): Draft[] {
  const time = prefs.notifications.eveningCheckTime;
  if (time === null) return [];
  const checkMinutes = parseTime(time);

  const drafts: Draft[] = [];
  for (const date of days) {
    // A block that only starts after the check is not "still open": it gets its own reminder.
    const open = blocks.filter(
      (block) =>
        block.session.date === date && isPlanned(block) && startOf(block.session) < checkMinutes,
    );
    if (open.length === 0) continue;

    const subjects = listNl(unique(open.map((block) => block.subject)));
    drafts.push({
      id: `avondcheck:${date}`,
      at: moment(date, time),
      kind: 'avondcheck',
      title: `Je hebt vandaag nog ${countBlocks(open.length)} open staan`,
      body: `${subjects} (${formatDuration(totalMinutes(open))}). Nog even doen of liever verplaatsen? Allebei prima.`,
      link: agendaLink(date),
    });
  }
  return drafts;
}

// ───────────────────────── Public API ─────────────────────────

/**
 * All reminders with a moment between `now - graceMinutes` and `now + horizonDays`
 * (both inclusive), sorted by time. Empty when notifications are switched off.
 */
export function buildReminders({
  data,
  now,
  horizonDays = DEFAULT_HORIZON_DAYS,
  graceMinutes = DEFAULT_GRACE_MINUTES,
}: BuildRemindersInput): Reminder[] {
  if (!data.prefs.notifications.enabled) return [];

  const from = now.getTime() - graceMinutes * MINUTE_MS;
  const until = now.getTime() + horizonDays * DAY_MS;
  const context = createContext(data, from, until);

  return [
    ...sessionReminders(context),
    ...dailyDigests(context),
    ...examReminders(context),
    ...eveningChecks(context),
  ]
    .filter(({ at }) => at.getTime() >= from && at.getTime() <= until)
    .sort((a, b) => a.at.getTime() - b.at.getTime() || compare(a.id, b.id))
    .map((draft) => ({
      ...draft,
      at: draft.at.toISOString(),
      title: clip(draft.title, MAX_TITLE_LENGTH),
      body: clip(draft.body, MAX_BODY_LENGTH),
    }));
}
