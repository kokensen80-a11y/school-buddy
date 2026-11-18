import { useState } from 'react';
import { GraduationCap } from 'lucide-react';
import {
  Button,
  Card,
  EmptyState,
  LargeHeader,
  ListRow,
  Screen,
  Section,
  SubjectDot,
} from '../../components/ui';
import { useExams, useSessions, useSubjects, useWarnings } from '../../lib/store';
import { useToday } from '../../lib/clock';
import { formatDateLong, formatRelative } from '../../lib/date';
import { navigate } from '../../lib/router';
import type { Exam, ISODate, Subject } from '../../types';
import { ExamCard } from './ExamCard';
import { examKindLabel, examWhen, pastExams, plural, subjectOf, upcomingExams } from './examHelpers';

/** Tab root: all exams, grouped by when they are. */
export default function ExamsScreen() {
  const exams = useExams();
  const subjects = useSubjects();
  const today = useToday();
  const sessions = useSessions();
  const warnings = useWarnings();
  const [showAllPast, setShowAllPast] = useState(false);

  const upcoming = upcomingExams(exams, today);
  const days: { date: ISODate; exams: Exam[] }[] = [];
  for (const exam of upcoming) {
    const last = days[days.length - 1];
    if (last && last.date === exam.date) last.exams.push(exam);
    else days.push({ date: exam.date, exams: [exam] });
  }
  const past = pastExams(exams, today);
  const visiblePast = showAllPast ? past : past.slice(0, 3);


  return (
    <Screen withTabBar>
      <LargeHeader
        title="Toetsen"
        subtitle={upcoming.length > 0 ? plural(upcoming.length, 'toets gepland', 'toetsen gepland') : undefined}
      />
      {exams.length === 0 ? (
        <EmptyState
          icon={<GraduationCap />}
          title="Nog geen toetsen"
          text="Zet je eerste toets erin met de leerstof. Dan maakt School Buddy je planning."
          action={<Button onClick={() => navigate({ name: 'toets-nieuw' })}>Toets toevoegen</Button>}
        />
      ) : (
        <>
          {days.map((day) => (
            <section key={day.date} className="sb-xday" aria-labelledby={`dag-${day.date}`}>
              <h2 id={`dag-${day.date}`} className="sb-xday__title">
                {formatDateLong(day.date, today)}
              </h2>
              <div className="sb-xday__cards">
                {day.exams.map((exam) => (
                  <ExamCard
                    key={exam.id}
                    exam={exam}
                    subject={subjectOf(subjects, exam)}
                    sessions={sessions}
                    warnings={warnings}
                    today={today}
                  />
                ))}
              </div>
            </section>
          ))}
          {upcoming.length === 0 && (
            <EmptyState
              icon={<GraduationCap />}
              title="Geen toetsen gepland"
              text="Er staat niets meer op de planning. Voeg je volgende toets toe."
              action={<Button onClick={() => navigate({ name: 'toets-nieuw' })}>Toets toevoegen</Button>}
            />
          )}
          {past.length > 0 && (
            <Section
              label="Geweest"
              trailing={
                past.length > 3 ? (
                  <Button variant="ghost" size="sm" onClick={() => setShowAllPast((v) => !v)}>
                    {showAllPast ? 'Minder' : 'Toon alles'}
                  </Button>
                ) : undefined
              }
            >
              <ExamList exams={visiblePast} subjects={subjects} today={today} past />
            </Section>
          )}
        </>
      )}
    </Screen>
  );
}

function ExamList({
  exams,
  subjects,
  today,
  past = false,
}: {
  exams: Exam[];
  subjects: Subject[];
  today: string;
  past?: boolean;
}) {
  return (
    <Card padding="none">
      {exams.map((exam) => {
        const subject = subjectOf(subjects, exam);
        return (
          <ListRow
            key={exam.id}
            leading={subject ? <SubjectDot color={subject.color} size={12} /> : undefined}
            title={exam.title}
            subtitle={[subject?.name, examKindLabel(exam), examWhen(exam)].filter(Boolean).join(' · ')}
            trailing={
              past
                ? exam.grade !== undefined
                  ? exam.grade.toLocaleString('nl-NL')
                  : undefined
                : formatRelative(exam.date, today)
            }
            chevron
            onClick={() => navigate({ name: 'toets', id: exam.id })}
          />
        );
      })}
    </Card>
  );
}
