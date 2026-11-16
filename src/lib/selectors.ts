/** Small pure helpers the screens share. */
import type { Exam, ID, InboxItem, ISODate, PlanWarning, StudySession, Subject } from '../types';
import { addDays, formatDuration, parseTime, weekDates } from './date';

export function examMap(exams: Exam[]): Map<ID, Exam> {
  return new Map(exams.map((e) => [e.id, e]));
}

export function subjectMap(subjects: Subject[]): Map<ID, Subject> {
  return new Map(subjects.map((s) => [s.id, s]));
}

export function sessionsOn(sessions: StudySession[], date: ISODate): StudySession[] {
  return sessions.filter((s) => s.date === date).sort((a, b) => a.start.localeCompare(b.start));
}

export function sessionsByDate(sessions: StudySession[]): Map<ISODate, StudySession[]> {
  const map = new Map<ISODate, StudySession[]>();
  for (const s of sessions) map.set(s.date, [...(map.get(s.date) ?? []), s]);
  return map;
}

/** What the block is about: its topic titles, or a generic line. */
export function sessionTitle(session: StudySession, exam: Exam | undefined): string {
  if (!exam) return 'Leerblok';
  const titles = session.parts
    .map((p) => exam.topics.find((t) => t.id === p.topicId)?.title)
    .filter((t): t is string => Boolean(t));
  if (titles.length > 0) return titles.join(', ');
  return `${session.kind === 'eindherhaling' ? 'Herhalen' : 'Leren'} voor ${exam.title}`;
}

/** "16:00 tot 16:30" */
export function sessionTimeRange(session: StudySession): string {
  const end = parseTime(session.start) + session.minutes;
  return `${session.start} tot ${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`;
}

export interface DayLoad {
  plannedMinutes: number;
  doneMinutes: number;
  count: number;
  doneCount: number;
}

/** Planned and done work on one day (skipped blocks are left out). */
export function dayLoad(sessions: StudySession[], date: ISODate): DayLoad {
  const load: DayLoad = { plannedMinutes: 0, doneMinutes: 0, count: 0, doneCount: 0 };
  for (const s of sessions) {
    if (s.date !== date || s.status === 'overgeslagen') continue;
    load.count++;
    if (s.status === 'gedaan') {
      load.doneCount++;
      load.doneMinutes += s.minutes;
    } else {
      load.plannedMinutes += s.minutes;
    }
  }
  return load;
}

export function weekLoad(sessions: StudySession[], anyDate: ISODate) {
  return weekDates(anyDate).map((date) => ({ date, ...dayLoad(sessions, date) }));
}

/** First planned block that has not ended yet. */
export function nextSession(sessions: StudySession[], today: ISODate, nowMinutes: number) {
  return sessions
    .filter((s) => s.status === 'gepland' && (s.date > today || (s.date === today && parseTime(s.start) + s.minutes > nowMinutes)))
    .sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start))[0];
}

/** Days in a row, up to today or yesterday, on which at least one block was done. */
export function studyStreak(sessions: StudySession[], today: ISODate): number {
  const doneDays = new Set(sessions.filter((s) => s.status === 'gedaan').map((s) => s.date));
  let day = doneDays.has(today) ? today : addDays(today, -1);
  let streak = 0;
  while (doneDays.has(day)) {
    streak++;
    day = addDays(day, -1);
  }
  return streak;
}

/** Done versus required learning for an exam, 0..1. */
export function examRatio(exam: Exam, sessions: StudySession[]): number {
  let done = 0;
  let total = 0;
  for (const s of sessions) {
    if (s.examId !== exam.id || s.status === 'overgeslagen') continue;
    total += s.minutes;
    if (s.status === 'gedaan') done += s.minutes;
  }
  return total === 0 ? 0 : done / total;
}

export function warningText(warning: PlanWarning, exams: Exam[]): { title: string; body: string } {
  const exam = exams.find((e) => e.id === warning.examId);
  const name = exam ? exam.title : 'een toets';
  if (warning.type === 'geen-leerstof') {
    return {
      title: `Nog geen leerstof bij ${name}`,
      body: 'Voeg toe wat je moet leren, dan kan School Buddy het goed verdelen.',
    };
  }
  return {
    title: `Te weinig tijd voor ${name}`,
    body: `Er past nog ${formatDuration(warning.missingMinutes)} niet in je planning. Maak meer tijd vrij per dag of begin eerder.`,
  };
}

export function unreadCount(inbox: InboxItem[]): number {
  return inbox.filter((i) => !i.read).length;
}

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}
