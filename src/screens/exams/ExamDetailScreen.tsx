import { useState } from 'react';
import { BookOpen, Check, Pencil, Plus, Trash } from 'lucide-react';
import {
  ActionTile,
  ActionTileRow,
  Button,
  Card,
  Chip,
  EmptyState,
  Heading,
  ListRow,
  Screen,
  Section,
  Stack,
  SubjectTag,
  Text,
  TopBar,
  useConfirm,
  useToast,
} from '../../components/ui';
import { actions, useExams, useSessions, useSubjects } from '../../lib/store';
import { SessionList } from '../../components/domain/Sessions';
import { PlanWarnings } from '../../components/domain/PlanWarnings';
import { examRatio } from '../../lib/selectors';
import { ProgressBar } from '../../components/ui';
import { useToday } from '../../lib/clock';
import { formatDuration, formatRelative } from '../../lib/date';
import { DIFFICULTIES } from '../../lib/labels';
import { goBack, navigate } from '../../lib/router';
import type { ID, Topic } from '../../types';
import { examKindLabel, examWhen, plural, subjectOf } from './examHelpers';
import { AddTopicsSheet, TopicSheet } from './TopicSheets';
import './exams.css';

/** One exam: when it is, and the material to learn for it. */
export default function ExamDetailScreen({ examId }: { examId: ID }) {
  const exams = useExams();
  const sessions = useSessions();
  const subjects = useSubjects();
  const today = useToday();
  const toast = useToast();
  const confirm = useConfirm();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Topic | null>(null);

  const exam = exams.find((e) => e.id === examId);
  const back = () => goBack({ name: 'toetsen' });

  if (!exam) {
    return (
      <Screen topBar={<TopBar onBack={back} />}>
        <EmptyState
          icon={<BookOpen />}
          title="Deze toets bestaat niet meer"
          text="Misschien is hij verwijderd."
          action={<Button onClick={() => navigate({ name: 'toetsen' }, { replace: true })}>Naar je toetsen</Button>}
        />
      </Screen>
    );
  }

  const subject = subjectOf(subjects, exam);
  const totalMinutes = exam.topics.reduce((sum, t) => sum + (t.mastered ? 0 : t.estMinutes), 0);
  const isPast = exam.date < today;
  const examSessions = sessions.filter((x) => x.examId === exam.id && x.status !== 'overgeslagen');
  const doneMinutes = examSessions.filter((x) => x.status === 'gedaan').reduce((sum, x) => sum + x.minutes, 0);
  const plannedTotal = examSessions.reduce((sum, x) => sum + x.minutes, 0);

  const remove = async () => {
    const ok = await confirm({
      title: 'Toets verwijderen?',
      message: 'De toets, de leerstof en de leerblokken in je planning worden verwijderd.',
      confirmLabel: 'Verwijderen',
      destructive: true,
    });
    if (!ok) return;
    const result = await actions.deleteExam(exam.id);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success('Toets verwijderd');
    navigate({ name: 'toetsen' }, { replace: true });
  };

  return (
    <Screen
      tint={subject?.color}
      topBar={
        <TopBar
          title={exam.title}
          onBack={back}
          actions={[
            {
              key: 'edit',
              icon: <Pencil />,
              label: 'Toets bewerken',
              onClick: () => navigate({ name: 'toets-bewerken', id: exam.id }),
            },
          ]}
        />
      }
    >
      <Stack gap={6}>
        <Stack gap={3}>
          <Stack direction="row" gap={2} wrap>
            {subject && <SubjectTag color={subject.color}>{subject.name}</SubjectTag>}
            <Chip>{examKindLabel(exam)}</Chip>
          </Stack>
          <Heading level={1} size="title" className="sb-exam-title">
            {exam.title}
          </Heading>
          <Text tone="secondary">
            {examWhen(exam)} · {formatRelative(exam.date, today)}
          </Text>
        </Stack>

        <ActionTileRow>
          <ActionTile variant="primary" icon={<Plus />} label="Leerstof" onClick={() => setAdding(true)} />
          <ActionTile
            icon={<Pencil />}
            label="Bewerken"
            onClick={() => navigate({ name: 'toets-bewerken', id: exam.id })}
          />
          <ActionTile icon={<Trash />} label="Verwijderen" onClick={() => void remove()} />
        </ActionTileRow>

        <PlanWarnings examId={exam.id} />

        <Section
          label="Leerstof"
          trailing={
            exam.topics.length > 0 ? (
              <Text size="sm" tone="secondary">
                {plural(exam.topics.length, 'onderdeel', 'onderdelen')} · {formatDuration(totalMinutes)}
              </Text>
            ) : undefined
          }
        >
          {exam.topics.length === 0 ? (
            <Card>
              <Stack gap={3}>
                <Text tone="secondary">
                  {isPast
                    ? 'Deze toets is geweest.'
                    : 'Voeg toe wat je moet leren. Daarmee maakt School Buddy je planning.'}
                </Text>
                {!isPast && (
                  <Button icon={<Plus size={18} />} onClick={() => setAdding(true)}>
                    Leerstof toevoegen
                  </Button>
                )}
              </Stack>
            </Card>
          ) : (
            <Card padding="none">
              {exam.topics.map((topic) => (
                <ListRow
                  key={topic.id}
                  title={topic.title}
                  subtitle={`${DIFFICULTIES[topic.difficulty].label} · ${formatDuration(topic.estMinutes)}`}
                  trailing={topic.mastered ? <Chip icon={<Check size={14} />}>Ken ik al</Chip> : undefined}
                  chevron
                  onClick={() => setEditing(topic)}
                />
              ))}
            </Card>
          )}
        </Section>

        {!isPast && (
          <Section
            label="Planning"
            trailing={
              <Button variant="ghost" size="sm" onClick={() => navigate({ name: 'agenda' })}>
                Agenda
              </Button>
            }
          >
            <Stack gap={3}>
              {examSessions.length > 0 && (
                <Stack gap={2}>
                  <ProgressBar value={examRatio(exam, sessions)} aria-label="Voortgang" />
                  <Text size="md" tone="secondary">
                    {formatDuration(doneMinutes)} van {formatDuration(plannedTotal)} gedaan
                  </Text>
                </Stack>
              )}
              <SessionList
                sessions={examSessions.filter((s) => s.status === 'gepland' && s.date >= today)}
                showDate
                emptyText={
                  exam.topics.length === 0
                    ? 'Voeg leerstof toe, dan plant School Buddy je leerblokken.'
                    : exam.date === today
                      ? 'De toets is vandaag. Succes!'
                      : 'Er zijn geen leerblokken meer gepland.'
                }
              />
            </Stack>
          </Section>
        )}

        {exam.notes && (
          <Section label="Notities">
            <Text className="sb-exam-notes">{exam.notes}</Text>
          </Section>
        )}
      </Stack>

      <AddTopicsSheet exam={exam} open={adding} onClose={() => setAdding(false)} />
      <TopicSheet exam={exam} topic={editing} onClose={() => setEditing(null)} />
    </Screen>
  );
}
