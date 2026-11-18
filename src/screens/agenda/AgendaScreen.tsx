import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import {
  Button,
  Card,
  GlassPill,
  Heading,
  IconButton,
  LargeHeader,
  ListRow,
  Screen,
  Section,
  Stack,
  SubjectDot,
  Text,
  useConfirm,
  useToast,
} from '../../components/ui';
import { SessionList } from '../../components/domain/Sessions';
import { actions, useData, useSubjects } from '../../lib/store';
import { useToday } from '../../lib/clock';
import {
  addDays,
  addMonths,
  dayOfMonth,
  diffDays,
  formatDateLong,
  formatDuration,
  formatMonthYear,
  formatRelative,
  isSameMonth,
  monthGrid,
  startOfMonth,
} from '../../lib/date';
import { WEEKDAYS_SHORT } from '../../lib/labels';
import { navigate } from '../../lib/router';
import { dayLoad, plural, sessionsByDate, sessionsOn, subjectMap } from '../../lib/selectors';
import type { Exam, ISODate } from '../../types';
import './agenda.css';

/** Month calendar of exams and study blocks, with the selected day's details below. */
export default function AgendaScreen({ date }: { date?: ISODate }) {
  const today = useToday();
  const data = useData();
  const subjects = subjectMap(useSubjects());
  const toast = useToast();
  const confirm = useConfirm();
  const [selected, setSelected] = useState<ISODate>(date ?? today);
  const [month, setMonth] = useState<ISODate>(startOfMonth(date ?? today));

  // Follow the route when it changes from outside (a notification link).
  useEffect(() => {
    if (date) {
      setSelected(date);
      setMonth(startOfMonth(date));
    }
  }, [date]);

  const select = (d: ISODate) => {
    setSelected(d);
    if (!isSameMonth(d, month)) setMonth(startOfMonth(d));
    navigate({ name: 'agenda', date: d }, { replace: true });
  };

  const byDate = useMemo(() => sessionsByDate(data.sessions), [data.sessions]);
  const examsByDate = useMemo(() => {
    const map = new Map<ISODate, Exam[]>();
    for (const e of data.exams) map.set(e.date, [...(map.get(e.date) ?? []), e]);
    return map;
  }, [data.exams]);
  const blocked = new Set(data.blockedDates);

  const daySessions = sessionsOn(data.sessions, selected).filter((s) => s.status !== 'overgeslagen' || s.date < today);
  const dayExams = examsByDate.get(selected) ?? [];
  const load = dayLoad(data.sessions, selected);
  const isBlocked = blocked.has(selected);

  const toggleBlocked = async () => {
    const planned = daySessions.filter((s) => s.status === 'gepland').length;
    if (!isBlocked && planned > 0) {
      const ok = await confirm({
        title: 'Geen tijd op deze dag?',
        message: `${plural(planned, 'blok wordt', 'blokken worden')} opnieuw ingepland op andere dagen.`,
        confirmLabel: 'Ja, geen tijd',
      });
      if (!ok) return;
    }
    const result = await actions.toggleBlockedDate(selected);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(result.blocked ? 'Deze dag is vrij. Je planning is aangepast.' : 'Je kunt deze dag weer leren.');
  };

  const addExamHere = () => {
    try {
      sessionStorage.setItem('sb.newExamDate', selected);
    } catch {
      // Without session storage the editor simply starts without a date.
    }
    navigate({ name: 'toets-nieuw' });
  };

  const nextWeek = Array.from({ length: 7 }, (_, i) => addDays(today, i));

  return (
    <Screen withTabBar>
      <LargeHeader
        title="Agenda"
        subtitle={
          <span key={month} className="sb-swap">
            {formatMonthYear(month)}
          </span>
        }
        trailing={
          <GlassPill>
            <IconButton variant="plain" aria-label="Vorige maand" onClick={() => setMonth(addMonths(month, -1))}>
              <ChevronLeft />
            </IconButton>
            <IconButton variant="plain" aria-label="Volgende maand" onClick={() => setMonth(addMonths(month, 1))}>
              <ChevronRight />
            </IconButton>
          </GlassPill>
        }
      />
      <Stack gap={6}>
        <MonthCalendar
          month={month}
          selected={selected}
          today={today}
          onSelect={select}
          onMonth={setMonth}
          dayInfo={(d) => {
            const list = byDate.get(d) ?? [];
            const active = list.filter((s) => s.status !== 'overgeslagen');
            return {
              exams: (examsByDate.get(d) ?? []).map((e) => subjects.get(e.subjectId)?.color ?? 'gray'),
              blocks: active.length,
              done: active.filter((s) => s.status === 'gedaan').length,
              blocked: blocked.has(d),
            };
          }}
        />
        {selected !== today && (
          <Button variant="secondary" size="sm" className="sb-agenda-today" onClick={() => select(today)}>
            Naar vandaag
          </Button>
        )}

        <Stack gap={4} key={selected} className="sb-agenda-day">
          <Stack gap={1}>
            <Heading level={2} size="heading">
              {formatDateLong(selected, today)}
            </Heading>
            <Text tone="secondary" size="md">
              {[
                Math.abs(diffDays(today, selected)) <= 2 ? formatRelative(selected, today) : '',
                load.count > 0 ? `${plural(load.count, 'blok', 'blokken')} · ${formatDuration(load.plannedMinutes + load.doneMinutes)}` : '',
                isBlocked ? 'geen tijd' : '',
              ]
                .filter(Boolean)
                .join(' · ') || 'Niets gepland'}
            </Text>
          </Stack>

          {dayExams.length > 0 && (
            <Card padding="none">
              {dayExams.map((exam) => {
                const subject = subjects.get(exam.subjectId);
                return (
                  <ListRow
                    key={exam.id}
                    leading={subject ? <SubjectDot color={subject.color} size={12} /> : undefined}
                    title={`Toets: ${exam.title}`}
                    subtitle={[subject?.name, exam.time, exam.location].filter(Boolean).join(' · ')}
                    chevron
                    onClick={() => navigate({ name: 'toets', id: exam.id })}
                  />
                );
              })}
            </Card>
          )}

          <SessionList
            sessions={daySessions}
            emptyText={isBlocked ? 'Op deze dag plant School Buddy niets.' : dayExams.length ? undefined : 'Op deze dag hoef je niets te leren.'}
          />

          <Stack direction="row" gap={2} wrap>
            {selected >= today && (
              <Button variant="secondary" size="sm" onClick={() => void toggleBlocked()}>
                {isBlocked ? 'Toch tijd op deze dag' : 'Geen tijd op deze dag'}
              </Button>
            )}
            <Button variant="ghost" size="sm" icon={<Plus size={16} />} onClick={addExamHere}>
              Toets op deze dag
            </Button>
          </Stack>
        </Stack>

        <Section label="Komende 7 dagen">
          <Card padding="none">
            {nextWeek.map((d) => {
              const l = dayLoad(data.sessions, d);
              const ex = examsByDate.get(d) ?? [];
              return (
                <ListRow
                  key={d}
                  title={formatDateLong(d, today)}
                  subtitle={
                    [ex.length ? ex.map((e) => `Toets ${e.title}`).join(', ') : '', l.count ? `${plural(l.count, 'blok', 'blokken')} · ${formatDuration(l.plannedMinutes + l.doneMinutes)}` : '']
                      .filter(Boolean)
                      .join(' · ') || (blocked.has(d) ? 'Geen tijd' : 'Niets gepland')
                  }
                  chevron
                  onClick={() => select(d)}
                />
              );
            })}
          </Card>
        </Section>
      </Stack>
    </Screen>
  );
}

interface DayInfo {
  exams: string[];
  blocks: number;
  done: number;
  blocked: boolean;
}

function MonthCalendar({
  month,
  selected,
  today,
  onSelect,
  onMonth,
  dayInfo,
}: {
  month: ISODate;
  selected: ISODate;
  today: ISODate;
  onSelect: (d: ISODate) => void;
  onMonth: (m: ISODate) => void;
  dayInfo: (d: ISODate) => DayInfo;
}) {
  const weeks = monthGrid(month);
  const gridRef = useRef<HTMLDivElement>(null);
  // Which way the month changed, so the new month slides in from that side.
  const shownMonth = useRef(month);
  const direction = month > shownMonth.current ? 'next' : month < shownMonth.current ? 'prev' : 'none';
  useEffect(() => {
    shownMonth.current = month;
  }, [month]);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const focusTarget = isSameMonth(selected, month) ? selected : month;

  const onKey = (event: KeyboardEvent, d: ISODate) => {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key];
    if (!step) return;
    event.preventDefault();
    const next = addDays(d, step);
    onSelect(next);
    requestAnimationFrame(() => gridRef.current?.querySelector<HTMLElement>(`[data-date="${next}"]`)?.focus());
  };

  const onPointerDown = (e: PointerEvent) => {
    swipe.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerUp = (e: PointerEvent) => {
    const start = swipe.current;
    swipe.current = null;
    if (!start) return;
    const dx = e.clientX - start.x;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(e.clientY - start.y) * 1.5) {
      onMonth(addMonths(month, dx < 0 ? 1 : -1));
    }
  };

  return (
    <div className="sb-cal" ref={gridRef} onPointerDown={onPointerDown} onPointerUp={onPointerUp}>
      <div className="sb-cal__head" aria-hidden>
        {WEEKDAYS_SHORT.map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      <div role="grid" aria-label={formatMonthYear(month)} key={month} className={`sb-cal__grid sb-cal__grid--${direction}`}>
        {weeks.map((week) => (
          <div role="row" className="sb-cal__row" key={week[0]}>
            {week.map((d) => {
              const info = dayInfo(d);
              const label = [
                formatDateLong(d, today),
                info.exams.length ? plural(info.exams.length, 'toets', 'toetsen') : '',
                info.blocks ? plural(info.blocks, 'blok', 'blokken') : '',
                info.blocked ? 'geen tijd' : '',
              ]
                .filter(Boolean)
                .join(', ');
              return (
                <button
                  key={d}
                  type="button"
                  role="gridcell"
                  data-date={d}
                  tabIndex={d === focusTarget ? 0 : -1}
                  aria-selected={d === selected}
                  aria-label={label}
                  className={[
                    'sb-cal__day',
                    isSameMonth(d, month) ? '' : 'is-outside',
                    d === today ? 'is-today' : '',
                    d === selected ? 'is-selected' : '',
                    info.blocked ? 'is-blocked' : '',
                  ].join(' ')}
                  onClick={() => onSelect(d)}
                  onKeyDown={(e) => onKey(e, d)}
                >
                  <span className="sb-cal__num">{dayOfMonth(d)}</span>
                  <span className="sb-cal__marks" aria-hidden>
                    {info.exams.slice(0, 3).map((c, i) => (
                      <span key={i} className="sb-cal__exam" style={{ background: `var(--subject-${c})` }} />
                    ))}
                    {info.blocks > 0 && (
                      <span
                        className={`sb-cal__blocks${info.done === info.blocks ? ' is-done' : info.done > 0 ? ' is-partial' : ''}`}
                      />
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
