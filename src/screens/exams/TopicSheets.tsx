import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Trash } from 'lucide-react';
import {
  Button,
  Field,
  SegmentedControl,
  Sheet,
  Stack,
  Stepper,
  Switch,
  Text,
  TextArea,
  TextInput,
  useConfirm,
  useToast,
} from '../../components/ui';
import { actions } from '../../lib/store';
import { formatDuration } from '../../lib/date';
import { DIFFICULTIES } from '../../lib/labels';
import type { Difficulty, Exam, Topic } from '../../types';
import { parseTopicLines, toTopicDrafts } from './parseTopics';
import { plural } from './examHelpers';

export const DIFFICULTY_OPTIONS = ([1, 2, 3] as Difficulty[]).map((d) => ({
  value: d,
  label: DIFFICULTIES[d].label,
}));

/** 5 minute steps up to 15 minutes, then 15 minute steps. */
export function stepMinutes(current: number, next: number): number {
  const up = next > current;
  if (up) return current < 15 ? current + 5 : current + 15;
  return current <= 15 ? Math.max(5, current - 5) : current - 15;
}

/** Time and difficulty used for every line of a pasted list. */
export function ListDefaults({
  minutes,
  difficulty,
  onMinutes,
  onDifficulty,
}: {
  minutes: number;
  difficulty: Difficulty;
  onMinutes: (v: number) => void;
  onDifficulty: (v: Difficulty) => void;
}) {
  return (
    <>
      <Field label="Leertijd per onderdeel" hint="Staat er een tijd achter een regel, dan gebruiken we die.">
        <Stepper
          value={minutes}
          min={5}
          max={600}
          step={1}
          format={formatDuration}
          onChange={(v) => onMinutes(stepMinutes(minutes, v))}
        />
      </Field>
      <Field label="Hoe moeilijk vind je dit?" group>
        <SegmentedControl
          aria-label="Moeilijkheid"
          options={DIFFICULTY_OPTIONS}
          value={difficulty}
          onChange={onDifficulty}
        />
      </Field>
    </>
  );
}

/** Add one or more topics to an exam, typed or pasted as a list. */
export function AddTopicsSheet({ exam, open, onClose }: { exam: Exam; open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [minutes, setMinutes] = useState(45);
  const [difficulty, setDifficulty] = useState<Difficulty>(2);
  const [busy, setBusy] = useState(false);
  const parsed = parseTopicLines(text);

  useEffect(() => {
    if (open) setText('');
  }, [open]);

  const save = async () => {
    if (parsed.length === 0) return;
    setBusy(true);
    const result = await actions.addTopics(exam.id, toTopicDrafts(parsed, { minutes, difficulty }));
    setBusy(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(`${plural(parsed.length, 'onderdeel', 'onderdelen')} toegevoegd`);
    onClose();
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Leerstof toevoegen"
      showClose
      footer={
        <Button block size="lg" loading={busy} disabled={parsed.length === 0} onClick={() => void save()}>
          {parsed.length > 1 ? `${parsed.length} onderdelen toevoegen` : 'Toevoegen'}
        </Button>
      }
    >
      <Stack gap={5}>
        <Field
          label="Onderdelen"
          hint="Eén onderdeel per regel. Je kunt ook een lijst uit je studiehandleiding plakken."
        >
          <TextArea
            value={text}
            onChange={setText}
            minRows={4}
            placeholder={'Hoofdstuk 3 en 4\nCollegeslides week 1 t/m 4 (60 min)\nBegrippenlijst'}
          />
        </Field>
        {parsed.length > 0 && (
          <Text size="sm" tone="secondary" aria-live="polite">
            {plural(parsed.length, 'onderdeel', 'onderdelen')}: {parsed.map((p) => p.title).join(', ')}
          </Text>
        )}
        <ListDefaults
          minutes={minutes}
          difficulty={difficulty}
          onMinutes={setMinutes}
          onDifficulty={setDifficulty}
        />
      </Stack>
    </Sheet>
  );
}

/** Edit, reorder or delete one topic. */
export function TopicSheet({
  exam,
  topic,
  onClose,
}: {
  exam: Exam;
  topic: Topic | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const [draft, setDraft] = useState<Topic | null>(topic);
  const [busy, setBusy] = useState(false);

  useEffect(() => setDraft(topic), [topic]);

  if (!draft) return <Sheet open={false} onClose={onClose} aria-label="Onderdeel">{null}</Sheet>;

  const index = exam.topics.findIndex((t) => t.id === draft.id);
  const patch = (p: Partial<Topic>) => setDraft({ ...draft, ...p });

  const save = async () => {
    if (!draft.title.trim()) {
      toast.error('Geef het onderdeel een naam.');
      return;
    }
    setBusy(true);
    const result = await actions.updateTopic(exam.id, draft.id, {
      title: draft.title.trim(),
      estMinutes: draft.estMinutes,
      difficulty: draft.difficulty,
      mastered: draft.mastered,
      notes: draft.notes?.trim() || undefined,
    });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success('Opgeslagen. Je planning is bijgewerkt.');
    onClose();
  };

  const move = async (to: number) => {
    const result = await actions.moveTopic(exam.id, draft.id, to);
    if (!result.ok) toast.error(result.error);
  };

  const remove = async () => {
    const ok = await confirm({
      title: 'Onderdeel verwijderen?',
      message: `"${draft.title}" verdwijnt uit deze toets en uit je planning.`,
      confirmLabel: 'Verwijderen',
      destructive: true,
    });
    if (!ok) return;
    const result = await actions.deleteTopic(exam.id, draft.id);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success('Onderdeel verwijderd');
    onClose();
  };

  return (
    <Sheet
      open={topic !== null}
      onClose={onClose}
      title="Onderdeel"
      showClose
      footer={
        <Button block size="lg" loading={busy} onClick={() => void save()}>
          Opslaan
        </Button>
      }
    >
      <Stack gap={5}>
        <Field label="Naam">
          <TextInput value={draft.title} onChange={(title) => patch({ title })} />
        </Field>
        <Field label="Geschatte leertijd" hint="Hoe lang heb je nodig om dit voor het eerst te leren?">
          <Stepper
            value={draft.estMinutes}
            min={5}
            max={600}
            step={1}
            format={formatDuration}
            onChange={(v) => patch({ estMinutes: stepMinutes(draft.estMinutes, v) })}
          />
        </Field>
        <Field label="Hoe moeilijk vind je dit?" group>
          <SegmentedControl
            aria-label="Moeilijkheid"
            options={DIFFICULTY_OPTIONS}
            value={draft.difficulty}
            onChange={(difficulty) => patch({ difficulty })}
          />
        </Field>
        <Field label="Ken ik al" hint="Dan plant School Buddy alleen nog herhaling." group>
          <Switch
            checked={draft.mastered}
            aria-label="Ken ik al"
            onChange={(mastered) => patch({ mastered })}
          />
        </Field>
        <Field label="Notities" optional>
          <TextArea value={draft.notes ?? ''} onChange={(notes) => patch({ notes })} minRows={2} />
        </Field>
        <Stack direction="row" gap={2} wrap>
          <Button
            variant="secondary"
            size="sm"
            icon={<ArrowUp size={16} />}
            disabled={index <= 0}
            onClick={() => void move(index - 1)}
          >
            Omhoog
          </Button>
          <Button
            variant="secondary"
            size="sm"
            icon={<ArrowDown size={16} />}
            disabled={index < 0 || index >= exam.topics.length - 1}
            onClick={() => void move(index + 1)}
          >
            Omlaag
          </Button>
          <Button variant="ghost" size="sm" icon={<Trash size={16} />} onClick={() => void remove()}>
            Verwijderen
          </Button>
        </Stack>
      </Stack>
    </Sheet>
  );
}
