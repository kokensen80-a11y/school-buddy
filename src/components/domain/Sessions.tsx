import { useState } from 'react';
import { ArrowRight, CalendarClock, Pin, PinOff, SkipForward, Undo2 } from 'lucide-react';
import {
  Button,
  Card,
  CheckCircle,
  Chip,
  DateInput,
  Field,
  ListRow,
  Sheet,
  Stack,
  SubjectDot,
  Text,
  TimeInput,
  useToast,
} from '../ui';
import { actions, useExams, useSessions, useSubjects } from '../../lib/store';
import { useToday } from '../../lib/clock';
import { addDays, formatDateLong, formatDateShort, formatDuration, isValidISODate, isValidTime } from '../../lib/date';
import { SESSION_KINDS, STUDY_METHODS } from '../../lib/labels';
import { navigate } from '../../lib/router';
import { examMap, sessionTimeRange, sessionTitle, subjectMap } from '../../lib/selectors';
import type { ID, StudySession } from '../../types';
import './domain.css';

/** A card with study blocks; tapping a block opens its details. */
export function SessionList({
  sessions,
  showDate = false,
  emptyText,
}: {
  sessions: StudySession[];
  showDate?: boolean;
  emptyText?: string;
}) {
  const [openId, setOpenId] = useState<ID | null>(null);
  if (sessions.length === 0) {
    return emptyText ? <Text tone="secondary">{emptyText}</Text> : null;
  }
  return (
    <>
      <Card padding="none">
        {sessions.map((s) => (
          <SessionRow key={s.id} session={s} showDate={showDate} onOpen={() => setOpenId(s.id)} />
        ))}
      </Card>
      <SessionSheet sessionId={openId} onClose={() => setOpenId(null)} />
    </>
  );
}

export function SessionRow({
  session,
  showDate = false,
  onOpen,
}: {
  session: StudySession;
  showDate?: boolean;
  onOpen?: () => void;
}) {
  const exams = examMap(useExams());
  const subjects = subjectMap(useSubjects());
  const toast = useToast();
  const exam = exams.get(session.examId);
  const subject = exam ? subjects.get(exam.subjectId) : undefined;
  const done = session.status === 'gedaan';
  const skipped = session.status === 'overgeslagen';

  const toggle = async (checked: boolean) => {
    const result = checked ? await actions.completeSession(session.id) : await actions.reopenSession(session.id);
    if (!result.ok) toast.error(result.error);
  };

  const meta = [
    SESSION_KINDS[session.kind].label,
    STUDY_METHODS[session.method].label,
    formatDuration(session.minutes),
    subject?.name,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <ListRow
      className={`sb-session${done ? ' is-done' : ''}${skipped ? ' is-skipped' : ''}`}
      leading={
        <CheckCircle
          checked={done}
          aria-label={done ? 'Toch niet gedaan' : 'Afvinken'}
          onChange={(c) => void toggle(c)}
        />
      }
      title={
        <span className="sb-session__title">
          {subject && <SubjectDot color={subject.color} size={8} />}
          <span>{sessionTitle(session, exam)}</span>
        </span>
      }
      subtitle={skipped ? `Gemist · ${meta}` : meta}
      trailing={
        <span className="sb-session__time">
          {showDate && <span>{formatDateShort(session.date)}</span>}
          <span>{session.start}</span>
          {session.pinned && <Pin size={12} aria-label="Vastgezet" />}
        </span>
      }
      onClick={onOpen}
    />
  );
}

/** Details and actions of one block: tick off, skip, move or release. */
export function SessionSheet({ sessionId, onClose }: { sessionId: ID | null; onClose: () => void }) {
  const sessions = useSessions();
  const exams = examMap(useExams());
  const subjects = subjectMap(useSubjects());
  const today = useToday();
  const toast = useToast();
  const [moving, setMoving] = useState(false);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');

  const session = sessions.find((s) => s.id === sessionId);
  const exam = session ? exams.get(session.examId) : undefined;
  const subject = exam ? subjects.get(exam.subjectId) : undefined;

  const close = () => {
    setMoving(false);
    onClose();
  };

  const run = async (action: Promise<{ ok: boolean; error?: string }>, message: string) => {
    const result = await action;
    if (!result.ok) {
      toast.error(result.error ?? 'Er ging iets mis.');
      return;
    }
    toast.success(message);
    close();
  };

  if (!session) return <Sheet open={false} onClose={close} aria-label="Leerblok">{null}</Sheet>;

  const lastDay = exam ? addDays(exam.date, -1) : undefined;
  const moveError =
    date && !isValidISODate(date)
      ? 'Kies een datum.'
      : date && date < today
        ? 'Die dag is al geweest.'
        : date && lastDay && date > lastDay
          ? 'Kies een dag voor de toets.'
          : '';

  const startMove = () => {
    setDate(session.date >= today ? session.date : today);
    setTime(session.start);
    setMoving(true);
  };

  return (
    <Sheet open={sessionId !== null} onClose={close} title={sessionTitle(session, exam)} showClose>
      <Stack gap={5}>
        <Stack gap={1}>
          <Text tone="secondary">
            {formatDateLong(session.date, today)} · {sessionTimeRange(session)}
          </Text>
          <Text tone="secondary">
            {SESSION_KINDS[session.kind].label} met {STUDY_METHODS[session.method].label.toLowerCase()}:{' '}
            {STUDY_METHODS[session.method].description.toLowerCase()}.
          </Text>
        </Stack>

        {exam && (
          <Card padding="none">
            <ListRow
              leading={subject ? <SubjectDot color={subject.color} size={12} /> : undefined}
              title={exam.title}
              subtitle={`${subject?.name ?? 'Toets'} · ${formatDateShort(exam.date)}`}
              chevron
              onClick={() => {
                close();
                navigate({ name: 'toets', id: exam.id });
              }}
            />
            {session.parts.map((p) => {
              const topic = exam.topics.find((t) => t.id === p.topicId);
              return topic ? (
                <ListRow key={p.topicId} title={topic.title} trailing={formatDuration(p.minutes)} />
              ) : null;
            })}
          </Card>
        )}

        {moving ? (
          <Stack gap={4}>
            <div className="sb-session-move">
              <Field label="Dag" error={moveError || undefined}>
                <DateInput value={date} min={today} max={lastDay} onChange={setDate} />
              </Field>
              <Field label="Tijd">
                <TimeInput value={time} onChange={setTime} />
              </Field>
            </div>
            <Stack direction="row" gap={2}>
              <Button
                icon={<ArrowRight size={18} />}
                disabled={!date || !isValidTime(time) || Boolean(moveError)}
                onClick={() =>
                  void run(
                    actions.moveSession(session.id, { date, start: time }),
                    `Verplaatst naar ${formatDateShort(date)}, ${time}`,
                  )
                }
              >
                Verplaatsen
              </Button>
              <Button variant="ghost" onClick={() => setMoving(false)}>
                Annuleren
              </Button>
            </Stack>
          </Stack>
        ) : (
          <Stack gap={2}>
            {session.status === 'gedaan' ? (
              <Button variant="secondary" block icon={<Undo2 size={18} />} onClick={() => void run(actions.reopenSession(session.id), 'Weer open gezet')}>
                Toch niet gedaan
              </Button>
            ) : (
              <Button block onClick={() => void run(actions.completeSession(session.id), 'Afgevinkt. Goed bezig!')}>
                Afvinken
              </Button>
            )}
            {session.status === 'gepland' && (
              <>
                <Button variant="secondary" block icon={<CalendarClock size={18} />} onClick={startMove}>
                  Verplaatsen
                </Button>
                <Button
                  variant="ghost"
                  block
                  icon={<SkipForward size={18} />}
                  onClick={() => void run(actions.skipSession(session.id), 'Overgeslagen. Het werk wordt opnieuw ingepland.')}
                >
                  Overslaan
                </Button>
              </>
            )}
            {session.pinned && session.status === 'gepland' && (
              <Button variant="ghost" block icon={<PinOff size={18} />} onClick={() => void run(actions.unpinSession(session.id), 'School Buddy plant dit blok weer zelf')}>
                Losmaken
              </Button>
            )}
            {session.status === 'overgeslagen' && <Chip>Dit blok is gemist of overgeslagen</Chip>}
          </Stack>
        )}
      </Stack>
    </Sheet>
  );
}
