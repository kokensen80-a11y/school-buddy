import type { CSSProperties } from 'react';
import {
  ArrowRight,
  FileCheck,
  GraduationCap,
  Info,
  MapPin,
  MessageCircle,
  PencilLine,
  Presentation,
  type LucideIcon,
} from 'lucide-react';
import { ProgressRing } from '../../components/ui';
import { EXAM_KINDS } from '../../lib/labels';
import { diffDays, formatDuration } from '../../lib/date';
import { navigate } from '../../lib/router';
import type { Exam, ExamKind, ISODate, PlanWarning, StudySession, Subject } from '../../types';
import { plural } from './examHelpers';

const KIND_ICON: Record<ExamKind, LucideIcon> = {
  tentamen: GraduationCap,
  toets: PencilLine,
  so: PencilLine,
  mondeling: MessageCircle,
  presentatie: Presentation,
  deadline: FileCheck,
};

type Tone = 'good' | 'warn' | 'bad';

interface Status {
  tone: Tone;
  label: string;
  detail: string;
}

/** How the preparation for an exam is going, in one coloured line. */
export function examStatus(
  exam: Exam,
  sessions: StudySession[],
  warnings: PlanWarning[],
  today: ISODate,
): Status {
  const mine = sessions.filter((s) => s.examId === exam.id && s.status !== 'overgeslagen');
  const done = mine.filter((s) => s.status === 'gedaan');
  const missed = mine.filter((s) => s.status === 'gepland' && s.date < today);
  const ahead = mine.filter((s) => s.status === 'gepland' && s.date >= today);
  const short = warnings.find((w) => w.examId === exam.id && w.type === 'te-weinig-tijd');

  if (exam.topics.length === 0) {
    return { tone: 'bad', label: 'Geen leerstof', detail: 'Voeg je leerstof toe' };
  }
  if (short && short.type === 'te-weinig-tijd') {
    return { tone: 'bad', label: 'Te weinig tijd', detail: `${formatDuration(short.missingMinutes)} past niet` };
  }
  if (mine.length > 0 && ahead.length === 0 && missed.length === 0 && done.length > 0) {
    return { tone: 'good', label: 'Klaar voor de toets', detail: 'Alles is gedaan' };
  }
  if (missed.length > 0) {
    return { tone: 'warn', label: 'Achter op schema', detail: plural(missed.length, 'leerblok gemist', 'leerblokken gemist') };
  }
  const minutes = ahead.reduce((sum, s) => sum + s.minutes, 0);
  return {
    tone: 'good',
    label: 'Op schema',
    detail: ahead.length > 0 ? `${plural(ahead.length, 'blok', 'blokken')}, ${formatDuration(minutes)}` : 'Nog niets gepland',
  };
}

function countdown(date: ISODate, today: ISODate): string {
  const d = diffDays(today, date);
  if (d === 0) return 'Vandaag';
  if (d === 1) return 'Morgen';
  return `Over ${d} dagen`;
}

/** A big dark card for an upcoming exam; the whole card opens the exam. */
export function ExamCard({
  exam,
  subject,
  sessions,
  warnings,
  today,
}: {
  exam: Exam;
  subject: Subject | undefined;
  sessions: StudySession[];
  warnings: PlanWarning[];
  today: ISODate;
}) {
  const Icon = KIND_ICON[exam.kind];
  const kind = EXAM_KINDS[exam.kind].label;
  const status = examStatus(exam, sessions, warnings, today);
  const mine = sessions.filter((s) => s.examId === exam.id && s.status !== 'overgeslagen');
  const doneCount = mine.filter((s) => s.status === 'gedaan').length;
  const ratio = mine.length === 0 ? 0 : doneCount / mine.length;
  const name = subject?.name ?? exam.title;
  // The title only adds something when it is more than "<soort> <vak>".
  const generic = new RegExp(`^(\\w+\\s+)?${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
  const subtitle = subject && !generic.test(exam.title.trim()) ? exam.title : undefined;
  const style = { '--xcard-color': `var(--subject-${subject?.color ?? 'gray'})` } as CSSProperties;

  return (
    <button
      type="button"
      className="sb-xcard"
      style={style}
      onClick={() => navigate({ name: 'toets', id: exam.id })}
      aria-label={`${name}, ${kind}, ${countdown(exam.date, today).toLowerCase()}. ${status.label}. Bekijk de toets.`}
    >
      <span className="sb-xcard__art" aria-hidden>
        <Icon strokeWidth={1.25} />
      </span>

      <span className="sb-xcard__badges" aria-hidden>
        <span className="sb-xcard__badge sb-xcard__badge--glass">
          <Info size={15} />
          {exam.weight && exam.weight > 1 ? `${kind} · telt ${exam.weight}x` : kind}
        </span>
        <span className="sb-xcard__badge sb-xcard__badge--solid">{countdown(exam.date, today)}</span>
      </span>

      <span className="sb-xcard__main" aria-hidden>
        <span className="sb-xcard__title">{name}</span>
        {subtitle && <span className="sb-xcard__subtitle">{subtitle}</span>}
        <span className="sb-xcard__row">
          <span className="sb-xcard__when">
            {exam.time ? (
              <span className="sb-xcard__time">
                {exam.time}
                {exam.endTime && (
                  <>
                    <ArrowRight size={18} strokeWidth={2.75} />
                    {exam.endTime}
                  </>
                )}
              </span>
            ) : (
              <span className="sb-xcard__time sb-xcard__time--none">Tijd onbekend</span>
            )}
            {exam.location && (
              <span className="sb-xcard__place">
                <MapPin size={14} />
                {exam.location}
              </span>
            )}
          </span>
          <span className="sb-xcard__progress">
            <ProgressRing value={ratio} size={52} thickness={4} color="#ffffff">
              <span className="sb-xcard__pct">{Math.round(ratio * 100)}%</span>
            </ProgressRing>
            <span className="sb-xcard__progress-text">
              Voorbereid
              <strong>
                {doneCount} van {mine.length}
              </strong>
            </span>
          </span>
        </span>
      </span>

      <span className="sb-xcard__bar" aria-hidden>
        <span className={`sb-xcard__dot sb-xcard__dot--${status.tone}`} />
        <span className="sb-xcard__status">
          <strong className={`sb-xcard__status-label sb-xcard__status-label--${status.tone}`}>{status.label}</strong>
          <span className="sb-xcard__status-detail">{status.detail}</span>
        </span>
        <span className="sb-xcard__cta">Bekijk</span>
      </span>
    </button>
  );
}
