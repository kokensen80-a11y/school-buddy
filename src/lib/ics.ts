/**
 * Calendar export (iCalendar, RFC 5545).
 *
 * The exported file holds every upcoming study block and exam with alarms, so the calendar
 * app of the phone reminds the student even when School Buddy is closed. All times are
 * "floating" local times (no time zone): 16:00 means 16:00 on the clock of the device.
 */
import type { Exam, ISODate, StudySession, UserData } from '../types';
import {
  addDays,
  formatDateLong,
  formatDuration,
  isValidISODate,
  isValidTime,
  minutesOfDay,
  parseTime,
  toISODate,
} from './date';
import { EXAM_KINDS, SESSION_KINDS, STUDY_METHODS } from './labels';

const CRLF = '\r\n';
const MAX_LINE_OCTETS = 75;
const MINUTES_PER_DAY = 24 * 60;

/** Alarm before a study block when the student has switched block reminders off in the app. */
const DEFAULT_SESSION_ALARM_MINUTES = 10;
/** Assumed length of an exam with a start time. */
const EXAM_DURATION_MINUTES = 60;
const EXAM_ALARM_MINUTES = 60;
/** The evening-before alarm goes off at 19:00: this long before midnight of the exam day. */
const EVENING_BEFORE_MINUTES = 5 * 60;
/** How long the download link stays valid; Safari reads the file after the click has returned. */
const DOWNLOAD_LINK_LIFETIME_MS = 60_000;

interface CalendarEvent {
  /** The DTSTART value; events are sorted on it. */
  start: string;
  lines: string[];
}

// ───────────────────────── Formatting ─────────────────────────

const pad = (n: number) => String(n).padStart(2, '0');
const compact = (date: ISODate) => date.replaceAll('-', '');

/** A date-time has no room for parts of a minute: the length of a block in whole minutes, at least one. */
const wholeMinutes = (session: StudySession) => Math.max(1, Math.round(session.minutes));

/** Floating local date-time 'YYYYMMDDTHHMMSS'; `minutes` (whole) may run past midnight. */
function localStamp(date: ISODate, minutes: number): string {
  const day = addDays(date, Math.floor(minutes / MINUTES_PER_DAY));
  const rest = ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return `${compact(day)}T${pad(Math.floor(rest / 60))}${pad(rest % 60)}00`;
}

/** UTC date-time 'YYYYMMDDTHHMMSSZ'. */
function utcStamp(moment: Date): string {
  return moment.toISOString().replace(/[-:]|\.\d{3}/g, '');
}

/** Escapes a TEXT value: backslash, semicolon, comma and line breaks. Other control characters become spaces. */
function escapeText(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

const text = (name: string, value: string) => `${name}:${escapeText(value)}`;

function utf8Length(codePoint: number): number {
  if (codePoint < 0x80) return 1;
  if (codePoint < 0x800) return 2;
  return codePoint < 0x10000 ? 3 : 4;
}

/**
 * Folds a content line so no physical line is longer than 75 octets of UTF-8. Continuation
 * lines start with a space (which counts). A character is never split over two lines.
 */
function fold(line: string): string {
  const pieces: string[] = [];
  let piece = '';
  let octets = 0;
  for (const character of line) {
    const size = utf8Length(character.codePointAt(0) ?? 0);
    if (octets + size > MAX_LINE_OCTETS) {
      pieces.push(piece);
      piece = ' ';
      octets = 1;
    }
    piece += character;
    octets += size;
  }
  pieces.push(piece);
  return pieces.join(CRLF);
}

/** An alarm `minutesBefore` the start of the event it is placed in. */
function alarm(minutesBefore: number, description: string): string[] {
  const hours = Math.floor(minutesBefore / 60);
  const minutes = minutesBefore % 60;
  const trigger =
    minutesBefore <= 0 ? 'PT0M' : `-PT${hours ? `${hours}H` : ''}${minutes ? `${minutes}M` : ''}`;
  return [
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    text('DESCRIPTION', description),
    `TRIGGER:${trigger}`,
    'END:VALARM',
  ];
}

// ───────────────────────── Events ─────────────────────────

function sessionEvent(
  session: StudySession,
  exam: Exam,
  subject: string | undefined,
  alarmMinutes: number,
  stamp: string,
  today: ISODate,
): CalendarEvent {
  const topics = session.parts.flatMap((part) => {
    const topic = exam.topics.find((t) => t.id === part.topicId);
    return topic ? [{ title: topic.title, minutes: part.minutes }] : [];
  });
  const titles = topics.slice(0, 2).map((topic) => topic.title);
  if (topics.length > 2) titles.push(`+${topics.length - 2}`);

  const what = titles.join(', ') || (subject ? exam.title : '');
  const summary =
    `${SESSION_KINDS[session.kind].label}: ${subject ?? exam.title}` + (what ? ` — ${what}` : '');
  const description = [
    topics.length > 0
      ? `Onderwerpen: ${topics.map((t) => `${t.title} (${formatDuration(t.minutes)})`).join(', ')}`
      : '',
    `Manier: ${STUDY_METHODS[session.method].label}`,
    `Voor: ${EXAM_KINDS[exam.kind].label} "${exam.title}" op ${formatDateLong(exam.date, today)}`,
  ]
    .filter(Boolean)
    .join('\n');

  const startMinutes = parseTime(session.start);
  const start = localStamp(session.date, startMinutes);
  return {
    start,
    lines: [
      'BEGIN:VEVENT',
      text('UID', `sessie-${session.id}@schoolbuddy`),
      `DTSTAMP:${stamp}`,
      `DTSTART:${start}`,
      `DTEND:${localStamp(session.date, startMinutes + wholeMinutes(session))}`,
      text('SUMMARY', summary),
      text('DESCRIPTION', description),
      ...alarm(alarmMinutes, summary),
      'END:VEVENT',
    ],
  };
}

function examEvent(exam: Exam, subject: string | undefined, stamp: string): CalendarEvent {
  const kind = EXAM_KINDS[exam.kind].short;
  const summary = `${subject ? `${kind} ${subject}` : kind}: ${exam.title}`;
  const description = [
    exam.topics.length > 0 ? `Leerstof: ${exam.topics.map((t) => t.title).join(', ')}` : '',
    exam.weight ? `Telt ${exam.weight}x mee` : '',
    exam.notes?.trim() ?? '',
  ]
    .filter(Boolean)
    .join('\n');

  const startMinutes = exam.time ? parseTime(exam.time) : 0;
  const when = exam.time
    ? [
        `DTSTART:${localStamp(exam.date, startMinutes)}`,
        `DTEND:${localStamp(exam.date, exam.endTime ? parseTime(exam.endTime) : startMinutes + EXAM_DURATION_MINUTES)}`,
      ]
    : [
        `DTSTART;VALUE=DATE:${compact(exam.date)}`,
        `DTEND;VALUE=DATE:${compact(addDays(exam.date, 1))}`,
      ];

  return {
    start: exam.time ? localStamp(exam.date, startMinutes) : compact(exam.date),
    lines: [
      'BEGIN:VEVENT',
      text('UID', `toets-${exam.id}@schoolbuddy`),
      `DTSTAMP:${stamp}`,
      ...when,
      text('SUMMARY', summary),
      ...(description ? [text('DESCRIPTION', description)] : []),
      ...(exam.location?.trim() ? [text('LOCATION', exam.location.trim())] : []),
      // Triggers count back from the start, which is midnight for an all-day event.
      ...alarm(startMinutes + EVENING_BEFORE_MINUTES, `Morgen: ${summary}`),
      ...(exam.time ? alarm(EXAM_ALARM_MINUTES, `Over een uur: ${summary}`) : []),
      'END:VEVENT',
    ],
  };
}

// ───────────────────────── Public API ─────────────────────────

/**
 * The plan as an iCalendar file: one event per planned study block that has not ended yet
 * and one per exam that still lies ahead. Past events are left out.
 */
export function buildICS({ data, now }: { data: UserData; now: Date }): string {
  const stamp = utcStamp(now);
  const today = toISODate(now);
  const nowLocal = localStamp(today, minutesOfDay(now));
  const sessionAlarm = Math.max(
    0,
    Math.round(data.prefs.notifications.sessionLeadMinutes ?? DEFAULT_SESSION_ALARM_MINUTES),
  );

  const subjects = new Map(data.subjects.map((subject) => [subject.id, subject.name.trim()]));
  const subjectOf = (exam: Exam) => subjects.get(exam.subjectId) || undefined;
  const exams = data.exams.filter(
    (exam) => isValidISODate(exam.date) && (!exam.time || isValidTime(exam.time)),
  );
  const examById = new Map(exams.map((exam) => [exam.id, exam]));

  const events: CalendarEvent[] = [];
  for (const session of data.sessions) {
    const exam = examById.get(session.examId);
    if (!exam || session.status !== 'gepland' || session.minutes <= 0) continue;
    if (!isValidISODate(session.date) || !isValidTime(session.start)) continue;
    const end = localStamp(session.date, parseTime(session.start) + wholeMinutes(session));
    if (end > nowLocal) {
      events.push(sessionEvent(session, exam, subjectOf(exam), sessionAlarm, stamp, today));
    }
  }
  for (const exam of exams) {
    const upcoming = exam.time
      ? localStamp(exam.date, parseTime(exam.time) + EXAM_DURATION_MINUTES) > nowLocal
      : exam.date >= today;
    if (upcoming) events.push(examEvent(exam, subjectOf(exam), stamp));
  }
  events.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//School Buddy//Studieplanner//NL',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:School Buddy',
    ...events.flatMap((event) => event.lines),
    'END:VCALENDAR',
  ];
  return lines.map(fold).join(CRLF) + CRLF;
}

/**
 * Hands the calendar file to the browser as a download. On a phone, opening the downloaded
 * file offers to add the events to the calendar. Call from a click or tap.
 */
export function downloadICS(ics: string, filename = 'school-buddy.ics'): void {
  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  link.style.display = 'none';
  // iOS Safari only follows a link that is part of the document.
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), DOWNLOAD_LINK_LIFETIME_MS);
}
