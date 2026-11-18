import { useEffect, useState, type FormEvent } from 'react';
import { BookOpen, Plus } from 'lucide-react';
import {
  Button,
  Callout,
  ChoiceChip,
  EmptyState,
  Field,
  Heading,
  Screen,
  Section,
  Select,
  Stack,
  Stepper,
  SubjectDot,
  Text,
  TextArea,
  TextInput,
  DateInput,
  TimeInput,
  TopBar,
  useConfirm,
  useToast,
} from '../../components/ui';
import { actions, useExams, useSubjects } from '../../lib/store';
import { useToday } from '../../lib/clock';
import { formatDayMonth, isValidISODate } from '../../lib/date';
import { EXAM_KINDS, EXAM_KIND_ORDER, SUBJECT_COLORS, SUBJECT_COLOR_ORDER } from '../../lib/labels';
import { goBack, navigate } from '../../lib/router';
import type { Difficulty, Exam, ExamKind, ID, SubjectColor } from '../../types';
import { parseTopicLines, toTopicDrafts } from './parseTopics';
import { ListDefaults } from './TopicSheets';
import { plural } from './examHelpers';
import { PhotoScan, foundSummary } from './PhotoScan';
import { PendingFiles } from './MaterialFiles';
import type { ScanResult } from '../../lib/examScan';
import './exams.css';

interface FormState {
  subjectId: ID;
  title: string;
  kind: ExamKind;
  date: string;
  time: string;
  endTime: string;
  location: string;
  weight: number;
  notes: string;
}

type Errors = Partial<Record<'subject' | 'title' | 'date', string>>;

const KIND_OPTIONS = EXAM_KIND_ORDER.map((k) => ({ value: k, label: EXAM_KINDS[k].label }));

function fromExam(exam: Exam | undefined, presetDate: string): FormState {
  return {
    subjectId: exam?.subjectId ?? '',
    title: exam?.title ?? '',
    kind: exam?.kind ?? 'tentamen',
    date: exam?.date ?? presetDate,
    time: exam?.time ?? '',
    endTime: exam?.endTime ?? '',
    location: exam?.location ?? '',
    weight: exam?.weight ?? 1,
    notes: exam?.notes ?? '',
  };
}

/** Reads (once) the date the agenda handed over for a new exam. */
function takePresetDate(): string {
  try {
    const value = sessionStorage.getItem('sb.newExamDate') ?? '';
    sessionStorage.removeItem('sb.newExamDate');
    return isValidISODate(value) ? value : '';
  } catch {
    return '';
  }
}

/** Add a new exam (no examId) or edit an existing one. */
export default function ExamEditScreen({ examId }: { examId?: ID }) {
  const exams = useExams();
  const subjects = useSubjects();
  const today = useToday();
  const toast = useToast();
  const confirm = useConfirm();
  const exam = examId ? exams.find((e) => e.id === examId) : undefined;
  const isNew = !examId;

  const [initial] = useState(() => fromExam(exam, isNew ? takePresetDate() : ''));
  const [form, setForm] = useState<FormState>(() => ({
    ...initial,
    subjectId: initial.subjectId || (subjects.length === 1 ? subjects[0].id : ''),
  }));
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [topicsText, setTopicsText] = useState('');
  const [minutes, setMinutes] = useState(45);
  const [difficulty, setDifficulty] = useState<Difficulty>(2);
  const [photo, setPhoto] = useState<File | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [scanned, setScanned] = useState<string | null>(null);
  const [subjectSuggestion, setSubjectSuggestion] = useState<{ name: string; n: number } | null>(null);

  /** The form as it was before the first scan, so a second photo starts clean. */
  const [preScan, setPreScan] = useState<{ form: FormState; topics: string } | null>(null);

  const applyScan = async (r: ScanResult, file: File) => {
    // A subject that is not in the account yet is added right away, so the form is complete.
    let subjectId = r.subjectId;
    if (!subjectId && r.subjectName) {
      const name = r.subjectName;
      subjectId = subjects.find((s) => s.name.trim().toLowerCase() === name.toLowerCase())?.id;
      if (!subjectId) {
        const used = new Set(subjects.map((s) => s.color));
        const color = SUBJECT_COLOR_ORDER.find((c) => !used.has(c)) ?? SUBJECT_COLOR_ORDER[subjects.length % SUBJECT_COLOR_ORDER.length];
        const created = await actions.addSubject({ name, color });
        if (created.ok) subjectId = created.subject.id;
      }
    }
    const subjectName = subjects.find((s) => s.id === subjectId)?.name ?? r.subjectName;
    const base = preScan ?? { form, topics: topicsText };
    if (!preScan) setPreScan(base);
    setTopicsText(base.topics.trim() ? base.topics : (r.topics ?? []).join('\n'));
    setForm(() => {
      const f = base.form;
      const kind = r.kind ?? f.kind;
      return {
        ...f,
        subjectId: subjectId ?? (r.subjectName ? '' : f.subjectId),
        date: r.date ?? f.date,
        time: r.time ?? f.time,
        endTime: r.endTime ?? (r.time ? '' : f.endTime),
        location: r.location ?? f.location,
        kind,
        // "Kennistoets Strategie Overheid"; without a subject the chapters or the date.
        title:
          f.title ||
          (subjectName
            ? `${r.kindWord ?? EXAM_KINDS[kind].label} ${subjectName}`
            : r.title || [r.kindWord ?? EXAM_KINDS[kind].label, r.date ? formatDayMonth(r.date) : ''].filter(Boolean).join(' ')),
        weight: r.weight ?? f.weight,
        notes:
          f.notes ||
          (r.notes ?? []).join('\n'),
      };
    });
    if (!subjectId && r.subjectName) setSubjectSuggestion((s) => ({ name: r.subjectName!, n: (s?.n ?? 0) + 1 }));
    setErrors({});
    setPhoto(file);
    setScanned(foundSummary(r));
  };

  const parsed = parseTopicLines(topicsText);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial) || topicsText.trim() !== '';
  const fallback = examId ? ({ name: 'toets', id: examId } as const) : ({ name: 'toetsen' } as const);
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const back = async () => {
    if (dirty) {
      const ok = await confirm({
        title: 'Wijzigingen weggooien?',
        message: 'Wat je hebt ingevuld wordt niet bewaard.',
        confirmLabel: 'Weggooien',
        cancelLabel: 'Verder invullen',
        destructive: true,
      });
      if (!ok) return;
    }
    goBack(fallback);
  };

  if (examId && !exam) {
    return (
      <Screen topBar={<TopBar onBack={() => goBack({ name: 'toetsen' })} />}>
        <EmptyState
          icon={<BookOpen />}
          title="Deze toets bestaat niet meer"
          action={<Button onClick={() => navigate({ name: 'toetsen' }, { replace: true })}>Naar je toetsen</Button>}
        />
      </Screen>
    );
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const next: Errors = {};
    if (!form.subjectId) next.subject = 'Kies een vak.';
    if (!form.title.trim()) next.title = 'Geef de toets een titel.';
    if (!isValidISODate(form.date)) next.date = 'Kies een datum.';
    setErrors(next);
    if (Object.keys(next).length > 0) {
      document.querySelector<HTMLElement>('[aria-invalid="true"], .sb-exam-subjects button')?.focus();
      return;
    }
    const fields = {
      subjectId: form.subjectId,
      title: form.title.trim(),
      kind: form.kind,
      date: form.date,
      time: form.time || undefined,
      endTime: (form.time && form.endTime > form.time && form.endTime) || undefined,
      location: form.location.trim() || undefined,
      weight: form.weight,
      notes: form.notes.trim() || undefined,
    };
    setBusy(true);
    if (isNew) {
      const result = await actions.addExam({
        ...fields,
        topics: toTopicDrafts(parsed, { minutes, difficulty }),
      });
      setBusy(false);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const toStore = photo ? [photo, ...files] : files;
      let failed = 0;
      for (const file of toStore) {
        const stored = await actions.addAttachment(result.exam.id, file, file.name || 'Foto van de toets');
        if (!stored.ok) failed++;
      }
      if (failed > 0) toast.error(failed === 1 ? 'Eén bestand kon niet bewaard worden.' : `${failed} bestanden konden niet bewaard worden.`);
      toast.success('Toets toegevoegd. Je planning is gemaakt.');
      navigate({ name: 'toets', id: result.exam.id }, { replace: true });
    } else {
      const result = await actions.updateExam(examId, fields);
      setBusy(false);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success('Opgeslagen. Je planning is bijgewerkt.');
      goBack(fallback);
    }
  };

  return (
    <Screen topBar={<TopBar title={isNew ? 'Nieuwe toets' : 'Toets bewerken'} onBack={() => void back()} />}>
      <form className="sb-exam-form" onSubmit={submit} noValidate>
        <Heading level={1} size="title">
          {isNew ? 'Nieuwe toets' : 'Toets bewerken'}
        </Heading>

        {isNew &&
          (scanned ? (
            <Callout
              tone="success"
              title={`Gevonden: ${scanned}`}
              action={
                <Button size="sm" variant="ghost" onClick={() => setScanned(null)}>
                  Andere foto
                </Button>
              }
            >
              Controleer even of alles klopt. De foto wordt bij de toets bewaard.
            </Callout>
          ) : (
            <PhotoScan onResult={(r, file) => void applyScan(r, file)} />
          ))}

        <SubjectPicker
          value={form.subjectId}
          onChange={(id) => set('subjectId', id)}
          error={errors.subject}
          suggestion={subjectSuggestion}
        />

        <Field label="Titel" error={errors.title}>
          <TextInput
            value={form.title}
            onChange={(v) => set('title', v)}
            placeholder="Bijvoorbeeld Tentamen Marketing 1"
            aria-invalid={errors.title ? true : undefined}
          />
        </Field>

        <Field label="Soort">
          <Select
            value={form.kind}
            options={
              KIND_OPTIONS.some((o) => o.value === form.kind)
                ? KIND_OPTIONS
                : [...KIND_OPTIONS, { value: form.kind, label: EXAM_KINDS[form.kind].label }]
            } onChange={(v) => set('kind', v)} />
        </Field>

        <Field
          label="Datum"
          error={errors.date}
          hint={form.date && form.date < today ? 'Deze datum is al geweest.' : undefined}
        >
          <DateInput
            value={form.date}
            onChange={(v) => set('date', v)}
            aria-invalid={errors.date ? true : undefined}
          />
        </Field>

        <div className="sb-exam-form__row">
          <Field label="Begint" optional>
            <TimeInput value={form.time} onChange={(v) => set('time', v)} />
          </Field>
          <Field
            label="Eindigt"
            optional
            hint={form.endTime && form.time && form.endTime <= form.time ? 'Moet na de begintijd zijn.' : undefined}
          >
            <TimeInput value={form.endTime} onChange={(v) => set('endTime', v)} />
          </Field>
        </div>

        <Field label="Lokaal of plek" optional>
          <TextInput value={form.location} onChange={(v) => set('location', v)} placeholder="Bijvoorbeeld DMH A3.26" />
        </Field>

        <Field label="Weging" hint="Hoe vaak telt dit cijfer mee?">
          <Stepper
            value={form.weight}
            min={1}
            max={10}
            format={(v) => `${v}x`}
            onChange={(v) => set('weight', v)}
          />
        </Field>

        <Field label="Notities" optional>
          <TextArea value={form.notes} onChange={(v) => set('notes', v)} minRows={2} />
        </Field>

        {isNew && (
          <Section label="Leerstof">
            <Stack gap={4}>
              <Text tone="secondary" size="md">
                Typ of plak wat je moet leren, één onderdeel per regel. Je kunt dit ook later toevoegen.
              </Text>
              <TextArea
                aria-label="Leerstof, één onderdeel per regel"
                value={topicsText}
                onChange={setTopicsText}
                minRows={4}
                placeholder={'Hoofdstuk 3 en 4\nCollegeslides week 1 t/m 4 (60 min)\nBegrippenlijst'}
              />
              {parsed.length > 0 && (
                <>
                  <Text size="sm" tone="secondary" aria-live="polite">
                    {plural(parsed.length, 'onderdeel', 'onderdelen')}: {parsed.map((p) => p.title).join(', ')}
                  </Text>
                  <ListDefaults
                    minutes={minutes}
                    difficulty={difficulty}
                    onMinutes={setMinutes}
                    onDifficulty={setDifficulty}
                  />
                </>
              )}
            </Stack>
          </Section>
        )}

        {isNew && <PendingFiles files={files} onChange={setFiles} />}

        <Button type="submit" size="lg" block loading={busy}>
          {isNew ? 'Toets toevoegen' : 'Opslaan'}
        </Button>
      </form>
    </Screen>
  );
}

/** The account's subjects as chips, plus creating a new one inline. */
function SubjectPicker({
  value,
  onChange,
  error,
  suggestion,
}: {
  value: ID;
  onChange: (id: ID) => void;
  error?: string;
  /** A subject name read from a photo that is not one of the account's subjects yet. */
  suggestion?: { name: string; n: number } | null;
}) {
  const subjects = useSubjects();
  const toast = useToast();
  const used = new Set(subjects.map((s) => s.color));
  const [creating, setCreating] = useState(subjects.length === 0);
  const [name, setName] = useState('');
  const [color, setColor] = useState<SubjectColor>(
    () => SUBJECT_COLOR_ORDER.find((c) => !used.has(c)) ?? 'green',
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!suggestion) return;
    setName(suggestion.name);
    setCreating(true);
  }, [suggestion]);

  const create = async () => {
    if (!name.trim()) {
      toast.error('Geef het vak een naam.');
      return;
    }
    setBusy(true);
    const result = await actions.addSubject({ name: name.trim(), color });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    onChange(result.subject.id);
    setName('');
    setCreating(false);
  };

  return (
    <Field label="Vak" error={error} group>
      <Stack gap={3}>
        {subjects.length > 0 && (
          <Stack direction="row" gap={2} wrap className="sb-exam-subjects">
            {subjects.map((s) => (
              <ChoiceChip
                key={s.id}
                selected={value === s.id}
                icon={<SubjectDot color={s.color} size={10} />}
                onChange={() => onChange(s.id)}
              >
                {s.name}
              </ChoiceChip>
            ))}
            {!creating && (
              <ChoiceChip selected={false} icon={<Plus size={14} />} onChange={() => setCreating(true)}>
                Nieuw vak
              </ChoiceChip>
            )}
          </Stack>
        )}
        {creating && (
          <Stack gap={3}>
            <TextInput
              value={name}
              onChange={setName}
              placeholder="Naam van het vak, bijvoorbeeld Marketing"
              aria-label="Naam van het nieuwe vak"
              autoCapitalize="words"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void create();
                }
              }}
            />
            <div className="sb-exam-form__colors" role="group" aria-label="Kleur van het vak">
              {SUBJECT_COLOR_ORDER.map((c) => (
                <button
                  key={c}
                  type="button"
                  className="sb-exam-color"
                  style={{ backgroundColor: `var(--subject-${c})` }}
                  aria-label={SUBJECT_COLORS[c].label}
                  aria-pressed={color === c}
                  onClick={() => setColor(c)}
                />
              ))}
            </div>
            <Stack direction="row" gap={2}>
              <Button size="sm" loading={busy} onClick={() => void create()}>
                Vak toevoegen
              </Button>
              {subjects.length > 0 && (
                <Button size="sm" variant="ghost" onClick={() => setCreating(false)}>
                  Annuleren
                </Button>
              )}
            </Stack>
          </Stack>
        )}
      </Stack>
    </Field>
  );
}
