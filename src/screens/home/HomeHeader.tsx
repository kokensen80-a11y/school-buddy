import { Check, Flame } from 'lucide-react';
import { useExams, useSessions, useSubjects } from '../../lib/store';
import { dayOfMonth, formatDateLong, parseTime } from '../../lib/date';
import { WEEKDAYS_SHORT } from '../../lib/labels';
import { subjectMap, weekLoad } from '../../lib/selectors';
import { navigate } from '../../lib/router';
import type { ISODate } from '../../types';

/** "goedemorgen", "goedemiddag", "goedenavond" or "goedenacht". */
export function greeting(nowMinutes: number): string {
  if (nowMinutes < parseTime('06:00')) return 'goedenacht';
  if (nowMinutes < parseTime('12:00')) return 'goedemorgen';
  if (nowMinutes < parseTime('18:00')) return 'goedemiddag';
  return 'goedenavond';
}

/** Flame with the number of days in a row with a finished block. */
export function StreakBadge({ days }: { days: number }) {
  return (
    <span className="sb-streak" aria-label={`${days} ${days === 1 ? 'dag' : 'dagen'} op rij geleerd`}>
      <Flame size={18} aria-hidden />
      <span aria-hidden>{days}</span>
    </span>
  );
}

/**
 * The week as seven days: a tick on days where every block was done, today in a raised
 * tile, and a coloured dot under days with an exam.
 */
export function WeekChecks({ today }: { today: ISODate }) {
  const sessions = useSessions();
  const exams = useExams();
  const subjects = subjectMap(useSubjects());
  const week = weekLoad(sessions, today);

  return (
    <div className="sb-weekchecks">
      {week.map((d, i) => {
        const done = d.count > 0 && d.doneCount === d.count;
        const exam = exams.find((e) => e.date === d.date);
        const color = exam ? subjects.get(exam.subjectId)?.color : undefined;
        const label = [
          formatDateLong(d.date, today),
          d.count === 0 ? 'niets gepland' : done ? 'alles gedaan' : `${d.doneCount} van ${d.count} blokken gedaan`,
          exam ? `toets ${exam.title}` : '',
        ]
          .filter(Boolean)
          .join(', ');
        return (
          <button
            key={d.date}
            type="button"
            className={`sb-weekchecks__day${d.date === today ? ' is-today' : ''}${done ? ' is-done' : ''}`}
            aria-label={label}
            onClick={() => navigate({ name: 'agenda', date: d.date })}
          >
            <span className="sb-weekchecks__name" aria-hidden>
              {WEEKDAYS_SHORT[i]}
            </span>
            <span className="sb-weekchecks__mark" aria-hidden>
              {done ? <Check size={14} strokeWidth={3} /> : dayOfMonth(d.date)}
            </span>
            <span
              className="sb-weekchecks__exam"
              aria-hidden
              style={{ background: color ? `var(--subject-${color})` : 'transparent' }}
            />
          </button>
        );
      })}
    </div>
  );
}
