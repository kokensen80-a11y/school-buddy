import { Bell, GraduationCap } from 'lucide-react';
import {
  Button,
  Card,
  EmptyState,
  IconButton,
  LargeHeader,
  ListRow,
  Screen,
  SubjectDot,
  Text,
} from '../../components/ui';
import { SessionList } from '../../components/domain/Sessions';
import { PlanWarnings } from '../../components/domain/PlanWarnings';
import { useExams, useInbox, useSessions, useSubjects } from '../../lib/store';
import { useNowMinutes, useToday } from '../../lib/clock';
import { formatDateLong, formatDuration, formatRelative } from '../../lib/date';
import { navigate } from '../../lib/router';
import {
  dayLoad,
  examRatio,
  nextSession,
  plural,
  sessionsOn,
  studyStreak,
  subjectMap,
  unreadCount,
} from '../../lib/selectors';
import { upcomingExams } from '../exams/examHelpers';
import { greeting } from './HomeHeader';
import { NextExamCard, StatCard, TimeTiles, TodayDots, WeekChart, WeekTicks } from './HomeBento';
import './home.css';

/** "What do I have to do today?" at a glance. */
export default function HomeScreen() {
  const exams = useExams();
  const subjects = subjectMap(useSubjects());
  const sessions = useSessions();
  const inbox = useInbox();
  const today = useToday();
  const now = useNowMinutes();

  const todays = sessionsOn(sessions, today).filter((s) => s.status !== 'overgeslagen');
  const load = dayLoad(sessions, today);
  const next = nextSession(sessions, today, now);
  const upcoming = upcomingExams(exams, today);
  const examsToday = upcoming.filter((e) => e.date === today);
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
        <LargeHeader title={greeting(now)} subtitle={formatDateLong(today, today)} trailing={bell} className="sb-home-header" />
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
  const doneAll = sessions.filter((s) => s.status === 'gedaan');
  const doneMinutes = doneAll.reduce((sum, s) => sum + s.minutes, 0);

  return (
    <Screen withTabBar>
      <LargeHeader
        title={greeting(now)}
        subtitle={formatDateLong(today, today)}
        trailing={bell}
        className="sb-home-header"
      />
      <div className="sb-bento">
        {examsToday.map((exam) => (
          <Card key={exam.id} className="sb-bento__span" onClick={() => navigate({ name: 'toets', id: exam.id })}>
            <Text weight="semibold">
              Vandaag {exam.title}
              {exam.time ? ` om ${exam.time}` : ''}. Succes!
            </Text>
          </Card>
        ))}

        <div className="sb-bento__span">
          <PlanWarnings dismissible />
        </div>

        <WeekTicks today={today} />

        <section className="sb-bento__card sb-bento__span" aria-labelledby="bento-today">
          <h2 id="bento-today" className="sb-bento__title">
            Vandaag
          </h2>
          <p className="sb-bento__sub">
            {todays.length === 0
              ? `Niets gepland.${nextDay ? ` Volgende blok ${formatRelative(nextDay.date, today)} om ${nextDay.start}.` : ''}`
              : load.plannedMinutes === 0
                ? 'Alles gedaan. Lekker bezig!'
                : next && next.date === today
                  ? `${load.doneCount} van ${plural(load.count, 'blok', 'blokken')}, volgende om ${next.start}`
                  : `${load.doneCount} van ${plural(load.count, 'blok', 'blokken')} gedaan`}
          </p>
          <TodayDots sessions={todays} />
          {todays.length > 0 && (
            <div className="sb-bento__list">
              <SessionList sessions={todays} />
            </div>
          )}
        </section>

        <NextExamCard today={today} />

        <TimeTiles today={today} />

        <StatCard tall value={doneMinutes > 0 ? formatDuration(doneMinutes) : '0 min'} label="leertijd in totaal" emoji="📚" />
        <div className="sb-bento__stack">
          <StatCard value={doneAll.length} label={doneAll.length === 1 ? 'blok gedaan' : 'blokken gedaan'} emoji="✅" />
          <StatCard value={`${streak} ${streak === 1 ? 'dag' : 'dagen'}`} label="op rij" emoji="🔥" />
        </div>

        <WeekChart today={today} />

        {upcoming.length > 1 && (
          <section className="sb-bento__card sb-bento__span" aria-labelledby="bento-exams">
            <h2 id="bento-exams" className="sb-bento__title">
              Komende toetsen
            </h2>
            <div className="sb-bento__list">
              {upcoming.slice(0, 4).map((exam) => {
                const subject = subjects.get(exam.subjectId);
                return (
                  <ListRow
                    key={exam.id}
                    leading={subject ? <SubjectDot color={subject.color} size={12} /> : undefined}
                    title={subject?.name ?? exam.title}
                    subtitle={`${formatRelative(exam.date, today)} · ${Math.round(examRatio(exam, sessions) * 100)}% gedaan`}
                    chevron
                    onClick={() => navigate({ name: 'toets', id: exam.id })}
                  />
                );
              })}
            </div>
          </section>
        )}
      </div>
    </Screen>
  );
}
