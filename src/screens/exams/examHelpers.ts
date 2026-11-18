import type { Exam, ISODate, Subject } from '../../types';
import { EXAM_KINDS } from '../../lib/labels';
import { formatDateShort } from '../../lib/date';

export function subjectOf(subjects: Subject[], exam: Exam): Subject | undefined {
  return subjects.find((s) => s.id === exam.subjectId);
}

/** Soonest first; same day sorted by time, then title. */
export function sortExams(exams: Exam[]): Exam[] {
  return [...exams].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      (a.time ?? '99:99').localeCompare(b.time ?? '99:99') ||
      a.title.localeCompare(b.title, 'nl'),
  );
}

export function upcomingExams(exams: Exam[], today: ISODate): Exam[] {
  return sortExams(exams.filter((e) => e.date >= today));
}

export function pastExams(exams: Exam[], today: ISODate): Exam[] {
  return sortExams(exams.filter((e) => e.date < today)).reverse();
}

/** "17:20 tot 19:30", or just the start time. */
export function examTimeRange(exam: Exam): string | undefined {
  if (!exam.time) return undefined;
  return exam.endTime ? `${exam.time} tot ${exam.endTime}` : exam.time;
}

/** "ma 16 nov · 10:15 tot 11:05 · B204" */
export function examWhen(exam: Exam): string {
  return [formatDateShort(exam.date), examTimeRange(exam), exam.location].filter(Boolean).join(' · ');
}

/** "Toets · telt 2x" */
export function examKindLabel(exam: Exam): string {
  const kind = EXAM_KINDS[exam.kind].short;
  return exam.weight && exam.weight !== 1 ? `${kind} · telt ${exam.weight}x` : kind;
}

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}
