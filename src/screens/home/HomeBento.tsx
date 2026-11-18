import type { CSSProperties, ReactNode } from 'react';
import { Check } from 'lucide-react';
import { useExams, useSessions, useSubjects } from '../../lib/store';
import { formatDateLong, formatDateShort, formatDuration, formatRelative } from '../../lib/date';
import { examRatio, subjectMap, weekLoad } from '../../lib/selectors';
import { navigate } from '../../lib/router';
import type { ISODate, StudySession } from '../../types';

const DAY_LETTERS = ['M', 'D', 'W', 'D', 'V', 'Z', 'Z'];

/** Minutes as a big number and a small unit: 45 → ["45", "min"], 160 → ["2,7", "uur"]. */
function bigTime(minutes: number): [string, string] {
  if (minutes < 100) return [String(minutes), 'min'];
  return [(minutes / 60).toFixed(1).replace('.', ',').replace(',0', ''), 'uur'];
}

/** Seven rounded squares; done days are filled with a tick, today has a ring. */
export function WeekTicks({ today }: { today: ISODate }) {
  const week = weekLoad(useSessions(), today);
  return (
    <div className="sb-bento__card sb-bento__span sb-ticks">
      {week.map((d, i) => {
        const done = d.count > 0 && d.doneCount === d.count;
        return (
          <button
            key={d.date}
            type="button"
            className={`sb-ticks__day${done ? ' is-done' : ''}${d.date === today ? ' is-today' : ''}`}
            aria-label={`${formatDateLong(d.date, today)}: ${d.count === 0 ? 'niets gepland' : done ? 'alles gedaan' : `${d.doneCount} van ${d.count} blokken gedaan`}`}
            onClick={() => navigate({ name: 'agenda', date: d.date })}
          >
            {done ? <Check size={18} strokeWidth={3} aria-hidden /> : <span aria-hidden>{DAY_LETTERS[i]}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** Three coloured tiles: today, this week, done this week. */
export function TimeTiles({ today }: { today: ISODate }) {
  const week = weekLoad(useSessions(), today);
  const day = week.find((d) => d.date === today);
  const tiles: { color: string; minutes: number; label: string }[] = [
    { color: 'var(--tile-green)', minutes: day ? day.plannedMinutes + day.doneMinutes : 0, label: 'vandaag' },
    { color: 'var(--tile-purple)', minutes: week.reduce((s, d) => s + d.plannedMinutes + d.doneMinutes, 0), label: 'deze week' },
    { color: 'var(--tile-yellow)', minutes: week.reduce((s, d) => s + d.doneMinutes, 0), label: 'gedaan' },
  ];
  return (
    <section className="sb-bento__card sb-bento__span" aria-labelledby="bento-time">
      <h2 id="bento-time" className="sb-bento__title">
        Leertijd
      </h2>
      <p className="sb-bento__sub">Wat er deze week op je planning staat</p>
      <div className="sb-tiles">
        {tiles.map((t) => {
          const [num, unit] = bigTime(t.minutes);
          return (
            <div key={t.label} className="sb-tile" style={{ '--tile-color': t.color } as CSSProperties}>
              <span className="sb-tile__num">
                {num} <small>{unit}</small>
              </span>
              <span className="sb-tile__label">{t.label}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** Today's blocks as circles: a filled one per finished block, a dashed numbered one per open block. */
export function TodayDots({ sessions }: { sessions: StudySession[] }) {
  if (sessions.length === 0) return null;
  const shown = sessions.slice(0, 8);
  return (
    <div className="sb-dots" aria-label={`${sessions.filter((s) => s.status === 'gedaan').length} van ${sessions.length} blokken gedaan`}>
      {shown.map((s, i) => (
        <span key={s.id} className={`sb-dots__dot${s.status === 'gedaan' ? ' is-done' : ''}`} aria-hidden>
          {s.status === 'gedaan' ? <Check size={18} strokeWidth={3} /> : i + 1}
        </span>
      ))}
    </div>
  );
}

/** A white card with a big number, a grey label and a large emoji as illustration. */
export function StatCard({
  value,
  label,
  emoji,
  tall = false,
}: {
  value: ReactNode;
  label: string;
  emoji: string;
  tall?: boolean;
}) {
  return (
    <div className={`sb-bento__card sb-stat${tall ? ' sb-stat--tall' : ''}`}>
      {!tall && (
        <span className="sb-stat__emoji" aria-hidden>
          {emoji}
        </span>
      )}
      <span className="sb-stat__value">{value}</span>
      <span className="sb-stat__label">{label}</span>
      {tall && (
        <span className="sb-stat__emoji sb-stat__emoji--big" aria-hidden>
          {emoji}
        </span>
      )}
    </div>
  );
}

/** Bars per day: light blue for planned time, blue for the part that is done. */
export function WeekChart({ today }: { today: ISODate }) {
  const week = weekLoad(useSessions(), today);
  const max = Math.max(60, ...week.map((d) => d.plannedMinutes + d.doneMinutes));
  const top = Math.ceil(max / 60) * 60;
  return (
    <section className="sb-bento__card sb-bento__span" aria-labelledby="bento-chart">
      <h2 id="bento-chart" className="sb-bento__title sb-bento__title--center">
        Leertijd per dag
      </h2>
      <div className="sb-chart">
        <div className="sb-chart__axis" aria-hidden>
          <span>{top / 60} u</span>
          <span>{top / 120} u</span>
          <span>0</span>
        </div>
        <div className="sb-chart__bars">
          {week.map((d, i) => {
            const total = d.plannedMinutes + d.doneMinutes;
            return (
              <div key={d.date} className={`sb-chart__col${d.date === today ? ' is-today' : ''}`}>
                <div
                  className="sb-chart__bar"
                  role="img"
                  aria-label={`${formatDateLong(d.date, today)}: ${total ? `${formatDuration(total)} gepland, ${formatDuration(d.doneMinutes)} gedaan` : 'niets gepland'}`}
                >
                  <span className="sb-chart__planned" style={{ height: `${(total / top) * 100}%` }} />
                  <span className="sb-chart__done" style={{ height: `${(d.doneMinutes / top) * 100}%` }} />
                </div>
                <span className="sb-chart__day" aria-hidden>
                  {['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'][i]}
                </span>
              </div>
            );
          })}
        </div>
      </div>
      <div className="sb-chart__legend" aria-hidden>
        <span><i className="is-planned" /> gepland</span>
        <span><i className="is-done" /> gedaan</span>
      </div>
    </section>
  );
}

/** The next exam as a coloured card, like an event banner. */
export function NextExamCard({ today }: { today: ISODate }) {
  const exams = useExams();
  const sessions = useSessions();
  const subjects = subjectMap(useSubjects());
  const next = exams.filter((e) => e.date >= today).sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? '').localeCompare(b.time ?? ''))[0];
  if (!next) return null;
  const subject = subjects.get(next.subjectId);
  const pct = Math.round(examRatio(next, sessions) * 100);
  const style = { '--banner-color': `var(--subject-${subject?.color ?? 'indigo'})` } as CSSProperties;
  return (
    <button type="button" className="sb-banner sb-bento__span" style={style} onClick={() => navigate({ name: 'toets', id: next.id })}>
      <span className="sb-banner__text">
        <span className="sb-banner__kicker">Volgende toets</span>
        <span className="sb-banner__title">{subject?.name ?? next.title}</span>
        <span className="sb-banner__body">
          {formatRelative(next.date, today)}, {formatDateShort(next.date)}
          {next.time ? ` om ${next.time}` : ''}. {pct}% voorbereid.
        </span>
      </span>
      <span className="sb-banner__emoji" aria-hidden>
        🎓
      </span>
    </button>
  );
}
