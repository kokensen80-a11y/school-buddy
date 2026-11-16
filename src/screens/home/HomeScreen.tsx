import { Bell, GraduationCap } from 'lucide-react';
import {
  Button,
  Card,
  EmptyState,
  IconButton,
  LargeHeader,
  ListRow,
  ProgressRing,
  Screen,
  Section,
  Stack,
  SubjectDot,
  Text,
} from '../../components/ui';
import { SessionList } from '../../components/domain/Sessions';
import { PlanWarnings } from '../../components/domain/PlanWarnings';
import { WeekLoad } from '../../components/domain/WeekLoad';
import { useAccount, useExams, useInbox, useSessions, useSubjects } from '../../lib/store';
import { useNowMinutes, useToday } from '../../lib/clock';
import { formatDateLong, formatDuration, formatRelative } from '../../lib/date';
import { navigate } from '../../lib/router';
import {
  dayLoad,
  examMap,
  examRatio,
  nextSession,
  plural,
  sessionTitle,
  sessionsOn,
  studyStreak,
  subjectMap,
  unreadCount,
  weekLoad,
} from '../../lib/selectors';
import { upcomingExams } from '../exams/examHelpers';
import './home.css';

/** "What do I have to do today?" at a glance. */
export default function HomeScreen() {
  const account = useAccount();
  const exams = useExams();
  const subjects = subjectMap(useSubjects());
  const sessions = useSessions();
  const inbox = useInbox();
  const today = useToday();
  const now = useNowMinutes();
  const firstName = account?.name.trim().split(/\s+/)[0] ?? '';

  const todays = sessionsOn(sessions, today).filter((s) => s.status !== 'overgeslagen');
  const load = dayLoad(sessions, today);
  const total = load.plannedMinutes + load.doneMinutes;
  const next = nextSession(sessions, today, now);
  const exById = examMap(exams);
  const upcoming = upcomingExams(exams, today);
  const examsToday = upcoming.filter((e) => e.date === today);
  const week = weekLoad(sessions, today);
  const weekPlanned = week.reduce((sum, d) => sum + d.plannedMinutes + d.doneMinutes, 0);
  const weekDone = week.reduce((sum, d) => sum + d.doneMinutes, 0);
  const streak = studyStreak(sessions, today);
  const unread = unreadCount(inbox);

  const bell = (
    <IconButton aria-label={unread ? `Meldingen, ${unread} nieuw` : 'Meldingen'} badge={unread} onClick={() => navigate({ name: 'meldingen' })}>
      <Bell />
    </IconButton>
  );

  if (exams.length === 0) {
    return (
      <Screen withTabBar>
        <LargeHeader title={`Hoi ${firstName}`} subtitle={formatDateLong(today, today)} trailing={bell} />
        <EmptyState
          icon={<GraduationCap />}
          title="Zet je eerste toets erin"
          text="Vertel welke toets eraan komt en wat je moet leren. School Buddy maakt dan je planning."
          action={<Button onClick={() => navigate({ name: 'toets-nieuw' })}>Toets toevoegen</Button>}
        />
      </Screen>
    );
  }

  const nextDay = todays.length === 0 ? sessions.find((s) => s.status === 'gepland' && s.date > today) : undefined;

  return (
    <Screen withTabBar>
      <LargeHeader title={`Hoi ${firstName}`} subtitle={formatDateLong(today, today)} trailing={bell} />
      <Stack gap={6}>
        {examsToday.map((exam) => (
          <Card key={exam.id} onClick={() => navigate({ name: 'toets', id: exam.id })}>
            <Text weight="semibold">
              Vandaag {exam.title}
              {exam.time ? ` om ${exam.time}` : ''}. Succes!
            </Text>
          </Card>
        ))}

        <PlanWarnings />

        <Section label="Vandaag">
          <Stack gap={3}>
            {todays.length > 0 ? (
              <>
                <div className="sb-home-summary">
                  <ProgressRing value={total ? load.doneMinutes / total : 0} size={56} thickness={6} aria-label="Voortgang vandaag">
                    <span className="sb-home-summary__pct">{total ? Math.round((load.doneMinutes / total) * 100) : 0}%</span>
                  </ProgressRing>
                  <Stack gap={1}>
                    <Text weight="semibold">
                      {load.doneCount} van {plural(load.count, 'blok', 'blokken')}
                      {load.plannedMinutes > 0 ? ` · nog ${formatDuration(load.plannedMinutes)}` : ''}
                    </Text>
                    <Text size="md" tone="secondary">
                      {load.plannedMinutes === 0
                        ? 'Klaar voor vandaag. Lekker bezig!'
                        : next && next.date === today
                          ? `Volgende: ${next.start} ${sessionTitle(next, exById.get(next.examId))}`
                          : 'Nog niet alles afgevinkt.'}
                    </Text>
                  </Stack>
                </div>
                <SessionList sessions={todays} />
              </>
            ) : (
              <Text tone="secondary">
                Vandaag niets gepland.
                {nextDay ? ` Het volgende blok is ${formatRelative(nextDay.date, today)} om ${nextDay.start}.` : ''}
              </Text>
            )}
          </Stack>
        </Section>

        {upcoming.length > 0 && (
          <Section
            label="Komende toetsen"
            trailing={
              upcoming.length > 3 ? (
                <Button variant="ghost" size="sm" onClick={() => navigate({ name: 'toetsen' })}>
                  Alle toetsen
                </Button>
              ) : undefined
            }
          >
            <Card padding="none">
              {upcoming.slice(0, 3).map((exam) => {
                const subject = subjects.get(exam.subjectId);
                const ratio = examRatio(exam, sessions);
                return (
                  <ListRow
                    key={exam.id}
                    leading={subject ? <SubjectDot color={subject.color} size={12} /> : undefined}
                    title={exam.title}
                    subtitle={`${subject?.name ?? ''} · ${formatRelative(exam.date, today)} · ${Math.round(ratio * 100)}% gedaan`}
                    chevron
                    onClick={() => navigate({ name: 'toets', id: exam.id })}
                  />
                );
              })}
            </Card>
          </Section>
        )}

        <Section label="Deze week">
          <Stack gap={3}>
            <WeekLoad anchor={today} onSelect={(date) => navigate({ name: 'agenda', date })} />
            <Text size="md" tone="secondary">
              {weekPlanned > 0
                ? `Deze week ${formatDuration(weekPlanned)} gepland, ${formatDuration(weekDone)} gedaan.`
                : 'Deze week staat er nog niets gepland.'}
              {streak >= 2 ? ` ${streak} dagen op rij geleerd.` : ''}
            </Text>
          </Stack>
        </Section>
      </Stack>
    </Screen>
  );
}

