import { useExams, useSessions, useSubjects } from '../../lib/store';
import { useToday } from '../../lib/clock';
import { dayOfMonth, formatDateLong, formatDuration } from '../../lib/date';
import { WEEKDAYS_SHORT } from '../../lib/labels';
import { subjectMap, weekLoad } from '../../lib/selectors';
import type { ISODate } from '../../types';
import './domain.css';

/** Seven bars for the week of `anchor`: done (black) on top of planned (grey). */
export function WeekLoad({ anchor, onSelect }: { anchor: ISODate; onSelect?: (date: ISODate) => void }) {
  const sessions = useSessions();
  const exams = useExams();
  const subjects = subjectMap(useSubjects());
  const today = useToday();
  const week = weekLoad(sessions, anchor);
  const max = Math.max(60, ...week.map((d) => d.plannedMinutes + d.doneMinutes));

  return (
    <div className="sb-week">
      {week.map((d, i) => {
        const total = d.plannedMinutes + d.doneMinutes;
        const exam = exams.find((e) => e.date === d.date);
        const color = exam ? subjects.get(exam.subjectId)?.color : undefined;
        return (
          <button
            key={d.date}
            type="button"
            className={`sb-week__day${d.date === today ? ' is-today' : ''}`}
            aria-label={`${formatDateLong(d.date, today)}: ${total > 0 ? formatDuration(total) : 'niets gepland'}${exam ? `, toets ${exam.title}` : ''}`}
            onClick={() => onSelect?.(d.date)}
          >
            <span>{WEEKDAYS_SHORT[i]}</span>
            <span className="sb-week__bar" aria-hidden>
              <span className="sb-week__fill" style={{ height: `${(total / max) * 100}%` }} />
              <span className="sb-week__done" style={{ height: `${(d.doneMinutes / max) * 100}%` }} />
            </span>
            <span aria-hidden>{dayOfMonth(d.date)}</span>
            <span
              className="sb-week__exam"
              aria-hidden
              style={{ background: color ? `var(--subject-${color})` : 'transparent' }}
            />
          </button>
        );
      })}
    </div>
  );
}
