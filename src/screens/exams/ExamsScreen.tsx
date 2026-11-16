import { useState } from 'react';
import { GraduationCap, Plus } from 'lucide-react';
import {
  Button,
  Card,
  EmptyState,
  IconButton,
  LargeHeader,
  ListRow,
  Screen,
  Section,
  SubjectDot,
} from '../../components/ui';
import { useExams, useSubjects } from '../../lib/store';
import { useToday } from '../../lib/clock';
import { addDays, formatRelative } from '../../lib/date';
import { navigate } from '../../lib/router';
import type { Exam, Subject } from '../../types';
import { examKindLabel, examWhen, pastExams, plural, subjectOf, upcomingExams } from './examHelpers';

/** Tab root: all exams, grouped by when they are. */
export default function ExamsScreen() {
  const exams = useExams();
  const subjects = useSubjects();
  const today = useToday();
  const [showAllPast, setShowAllPast] = useState(false);

  const upcoming = upcomingExams(exams, today);
  const weekEnd = addDays(today, 7);
  const thisWeek = upcoming.filter((e) => e.date < weekEnd);
  const later = upcoming.filter((e) => e.date >= weekEnd);
  const past = pastExams(exams, today);
  const visiblePast = showAllPast ? past : past.slice(0, 3);

  const addButton = (
    <IconButton aria-label="Toets toevoegen" onClick={() => navigate({ name: 'toets-nieuw' })}>
      <Plus />
    </IconButton>
  );

  return (
    <Screen withTabBar>
      <LargeHeader
        title="Toetsen"
        subtitle={upcoming.length > 0 ? plural(upcoming.length, 'toets gepland', 'toetsen gepland') : undefined}
        trailing={addButton}
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
          {thisWeek.length > 0 && (
            <Section label="Komende 7 dagen">
              <ExamList exams={thisWeek} subjects={subjects} today={today} />
            </Section>
          )}
          {later.length > 0 && (
            <Section label="Later">
              <ExamList exams={later} subjects={subjects} today={today} />
            </Section>
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
