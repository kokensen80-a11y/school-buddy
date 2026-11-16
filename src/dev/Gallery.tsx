/**
 * Component gallery: every part of the UI kit in a realistic School Buddy setting.
 * The four tabs are four sample screens; "Toetsen" (the start tab) mirrors the
 * reference screens: floating top bar, exam header, action tiles, sections, tab bar.
 */
import { useState } from 'react';
import {
  Bell,
  BookOpen,
  CalendarDays,
  CalendarPlus,
  Clock,
  Ellipsis,
  GraduationCap,
  Hash,
  House,
  LogOut,
  Pencil,
  Plus,
  RefreshCw,
  Sparkles,
  Trash,
  UserRound,
} from 'lucide-react';
import {
  ActionTile,
  ActionTileRow,
  Avatar,
  Badge,
  Button,
  Callout,
  Card,
  CheckCircle,
  Chip,
  ChoiceChip,
  ConfirmProvider,
  DateInput,
  Divider,
  EmptyState,
  Field,
  GlassPill,
  Heading,
  IconButton,
  LargeHeader,
  ListRow,
  ProgressBar,
  ProgressRing,
  Screen,
  Section,
  SegmentedControl,
  Select,
  Sheet,
  Skeleton,
  Slider,
  Spinner,
  Stack,
  Stepper,
  SubjectDot,
  SubjectTag,
  Switch,
  TabBar,
  Text,
  TextArea,
  TextInput,
  TimeInput,
  ToastProvider,
  TopBar,
  useConfirm,
  useToast,
  type TabBarItem,
} from '../components/ui';
import {
  addDays,
  dayOfMonth,
  formatDateLong,
  formatDateShort,
  formatDuration,
  formatRelative,
  todayISO,
  weekDates,
  weekNumber,
} from '../lib/date';
import {
  DIFFICULTIES,
  EXAM_KIND_ORDER,
  EXAM_KINDS,
  PLAN_STYLE_ORDER,
  PLAN_STYLES,
  SESSION_LENGTH_OPTIONS,
  STUDY_METHOD_ORDER,
  STUDY_METHODS,
  SUBJECT_COLOR_ORDER,
  SUBJECT_COLORS,
  WEEKDAYS_SHORT,
} from '../lib/labels';
import type { Difficulty, ExamKind, ISODate, PlanStyle, StudyMethod, SubjectColor } from '../types';
import './Gallery.css';

type GalleryTab = 'home' | 'agenda' | 'toetsen' | 'profiel';

const TABS: TabBarItem<GalleryTab>[] = [
  { key: 'home', label: 'Home', icon: <House /> },
  { key: 'agenda', label: 'Agenda', icon: <CalendarDays />, badge: 3 },
  { key: 'toetsen', label: 'Toetsen', icon: <GraduationCap /> },
  { key: 'profiel', label: 'Profiel', icon: <UserRound /> },
];

interface SampleBlock {
  id: string;
  title: string;
  subject: string;
  color: SubjectColor;
  method: StudyMethod;
  minutes: number;
  start: string;
}

const BLOCKS: SampleBlock[] = [
  {
    id: 'b1',
    title: '§3.1 Mitose samenvatten',
    subject: 'Biologie',
    color: 'green',
    method: 'samenvatten',
    minutes: 30,
    start: '16:00',
  },
  {
    id: 'b2',
    title: 'Begrippen celdeling',
    subject: 'Biologie',
    color: 'green',
    method: 'flashcards',
    minutes: 25,
    start: '16:40',
  },
  {
    id: 'b3',
    title: 'Hoofdstuk 5: breuken',
    subject: 'Wiskunde',
    color: 'blue',
    method: 'oefenen',
    minutes: 30,
    start: '17:15',
  },
];

interface SampleTopic {
  id: string;
  title: string;
  difficulty: Difficulty;
  minutes: number;
  progress: number;
}

const TOPICS: SampleTopic[] = [
  { id: 't1', title: '§3.1 Mitose', difficulty: 2, minutes: 60, progress: 1 },
  { id: 't2', title: '§3.2 Meiose', difficulty: 3, minutes: 90, progress: 0.5 },
  { id: 't3', title: '§3.3 Celcyclus en DNA', difficulty: 1, minutes: 45, progress: 0 },
];

interface SampleExam {
  subject: string;
  color: SubjectColor;
  title: string;
  inDays: number;
  progress: number;
}

const EXAMS: SampleExam[] = [
  { subject: 'Biologie', color: 'green', title: 'Hoofdstuk 3: Celdeling', inDays: 10, progress: 0.5 },
  { subject: 'Wiskunde', color: 'blue', title: 'Hoofdstuk 5: Breuken', inDays: 3, progress: 0.8 },
  { subject: 'Geschiedenis', color: 'orange', title: 'De Gouden Eeuw', inDays: 16, progress: 0.1 },
];

const blockMeta = (block: SampleBlock) =>
  `${STUDY_METHODS[block.method].label} · ${formatDuration(block.minutes)}`;

interface TodayState {
  /** Ids of the study blocks that are ticked off. */
  done: ReadonlySet<string>;
  onToggle: (id: string, checked: boolean) => void;
}

/** Today's study blocks with their tick-off circles; shared by two tabs. */
function TodayList({ done, onToggle, showSubject = false }: TodayState & { showSubject?: boolean }) {
  const toast = useToast();
  return (
    <>
      {BLOCKS.map((block) => {
        const isDone = done.has(block.id);
        return (
          <ListRow
            key={block.id}
            leading={
              <CheckCircle
                checked={isDone}
                color={block.color}
                aria-label={`${block.title} afvinken`}
                onChange={(checked) => onToggle(block.id, checked)}
              />
            }
            title={<span className={isDone ? 'sb-gallery-done' : undefined}>{block.title}</span>}
            subtitle={showSubject ? `${block.subject} · ${blockMeta(block)}` : blockMeta(block)}
            trailing={block.start}
            onClick={() => toast.info(`${block.title} begint om ${block.start}.`)}
          />
        );
      })}
    </>
  );
}

/** Seven day cells, Monday to Sunday: a sample of what the agenda can build with the tokens. */
function WeekStrip({ selected, onSelect }: { selected: ISODate; onSelect: (date: ISODate) => void }) {
  const today = todayISO();
  return (
    <div className="sb-gallery-week" role="group" aria-label={`Week ${weekNumber(today)}`}>
      {weekDates(today).map((date, index) => {
        const classes = ['sb-gallery-week__day'];
        if (date === selected) classes.push('sb-gallery-week__day--selected');
        if (date === today) classes.push('sb-gallery-week__day--today');
        return (
          <button
            key={date}
            type="button"
            className={classes.join(' ')}
            aria-pressed={date === selected}
            aria-label={formatDateLong(date)}
            onClick={() => onSelect(date)}
          >
            <span className="sb-gallery-week__weekday">{WEEKDAYS_SHORT[index]}</span>
            <span className="sb-gallery-week__number">{dayOfMonth(date)}</span>
            <span className="sb-gallery-week__dots">
              {index % 3 !== 2 && <SubjectDot color="green" size={5} />}
              {index % 2 === 0 && <SubjectDot color="blue" size={5} />}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ───────────────────────── Toetsen: exam detail ─────────────────────────

function ExamScreen({ done, onToggle }: TodayState) {
  const toast = useToast();
  const confirm = useConfirm();
  const today = todayISO();
  const examDate = addDays(today, 10);

  const [color, setColor] = useState<SubjectColor>('green');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [topicTitle, setTopicTitle] = useState('§3.2 Meiose');
  const [topicNotes, setTopicNotes] = useState('Let op het verschil tussen meiose I en II.');
  const [difficulty, setDifficulty] = useState<Difficulty>(3);
  const [minutes, setMinutes] = useState(90);
  const [kind, setKind] = useState<ExamKind | ''>('toets');
  const [date, setDate] = useState<ISODate>(examDate);
  const [time, setTime] = useState('10:15');

  const doneCount = BLOCKS.filter((block) => done.has(block.id)).length;
  const titleError = topicTitle.trim() === '' ? 'Geef het onderdeel een naam.' : undefined;
  const openSheet = () => setSheetOpen(true);
  const replan = () => toast.success('Je planning is bijgewerkt.');

  const askDelete = async () => {
    const confirmed = await confirm({
      title: 'Toets verwijderen?',
      message: 'Je planning voor deze toets verdwijnt ook. Dit kun je niet terugdraaien.',
      confirmLabel: 'Verwijderen',
      destructive: true,
    });
    if (confirmed) toast.error('De toets is verwijderd.');
  };

  const saveTopic = () => {
    if (titleError) return;
    setSaving(true);
    window.setTimeout(() => {
      setSaving(false);
      setSheetOpen(false);
      toast.success('Je leerstof is opgeslagen.');
    }, 700);
  };

  return (
    <Screen
      tint={color}
      withTabBar
      topBar={
        <TopBar
          title="Biologie — Hoofdstuk 3: Celdeling en mitose"
          onBack={() => toast.info('Terug naar je toetsen.')}
          actions={[
            { icon: <Pencil />, label: 'Bewerken', onClick: openSheet },
            { icon: <Ellipsis />, label: 'Meer', onClick: askDelete },
          ]}
        />
      }
    >
      <Stack direction="row" gap={2} wrap>
        <SubjectTag color={color}>Biologie</SubjectTag>
        <Chip>{EXAM_KINDS.toets.label} · telt 2x</Chip>
      </Stack>
      <Heading level={2} size="title" className="sb-gallery-title">
        Celdeling en mitose
      </Heading>
      <Text tone="secondary">{formatDateShort(examDate)}, 10:15 · lokaal B204</Text>

      <ActionTileRow className="sb-gallery-tiles">
        <ActionTile variant="primary" icon={<CalendarPlus />} label="Inplannen" onClick={replan} />
        <ActionTile icon={<Pencil />} label="Bewerken" onClick={openSheet} />
        <ActionTile icon={<Ellipsis />} label="Meer" onClick={askDelete} />
      </ActionTileRow>

      <Section label="Vandaag leren" trailing={`${doneCount} van ${BLOCKS.length}`}>
        <TodayList done={done} onToggle={onToggle} />
      </Section>

      <div className="sb-gallery-notes">
        <Heading level={2}>Zo pak je deze toets aan</Heading>
        <Text>
          Je leert het meest als je de stof in kleine stukken verdeelt en elke dag even herhaalt.
        </Text>
        <ul>
          <li>Begin met de paragraaf die je het moeilijkst vindt</li>
          <li>Maak flashcards van alle begrippen uit hoofdstuk 3</li>
          <li>Oefen de avond ervoor met een oude toets</li>
        </ul>
        <Stack direction="row" gap={2} wrap>
          <Chip icon={<Hash />}>Hoofdstuk 3</Chip>
          <Chip icon={<Clock />}>{formatDuration(195)}</Chip>
          <Chip color="orange">Moeilijk</Chip>
        </Stack>
      </div>

      <Section label="Voortgang">
        <Card>
          <Stack direction="row" gap={4}>
            <ProgressRing
              value={0.5}
              color={color}
              size={64}
              thickness={6}
              aria-label="Voortgang Biologie"
            >
              50%
            </ProgressRing>
            <div className="sb-gallery-grow">
              <Heading level={3} size="subheading">
                Je ligt op schema
              </Heading>
              <Text size="md" tone="secondary">
                Nog {formatDuration(105)} verdeeld over 6 blokken.
              </Text>
            </div>
          </Stack>
          <Divider />
          <Stack gap={3}>
            {TOPICS.map((topic) => (
              <div key={topic.id}>
                <Stack direction="row" justify="between" gap={2} className="sb-gallery-bar-label">
                  <Text as="span" size="md" id={`gallery-${topic.id}`}>
                    {topic.title}
                  </Text>
                  <Text as="span" size="sm" tone="secondary">
                    {Math.round(topic.progress * 100)}%
                  </Text>
                </Stack>
                <ProgressBar
                  value={topic.progress}
                  color={color}
                  aria-labelledby={`gallery-${topic.id}`}
                />
              </div>
            ))}
          </Stack>
        </Card>
      </Section>

      <Section
        label="Leerstof"
        trailing={
          <Button variant="ghost" size="sm" icon={<Plus />} onClick={openSheet}>
            Toevoegen
          </Button>
        }
      >
        <Card padding="none">
          {TOPICS.map((topic) => (
            <ListRow
              key={topic.id}
              leading={<BookOpen />}
              title={topic.title}
              subtitle={`${DIFFICULTIES[topic.difficulty].label} · ${formatDuration(topic.minutes)}`}
              trailing={topic.progress === 1 ? <Chip>Ken ik al</Chip> : undefined}
              chevron
              onClick={openSheet}
            />
          ))}
        </Card>
      </Section>

      <Section label="Let op">
        <Stack gap={3}>
          <Callout
            tone="warning"
            title="Te weinig tijd voor deze toets"
            action={
              <Button variant="secondary" size="sm" icon={<RefreshCw />} onClick={replan}>
                Opnieuw plannen
              </Button>
            }
          >
            Er past nog {formatDuration(45)} niet in je planning. Begin eerder of plan een extra dag.
          </Callout>
          <Callout tone="success" title="Goed bezig!">
            Je hebt deze week al je blokken afgevinkt.
          </Callout>
          <Callout tone="info">Tip: herhaal de moeilijkste paragraaf de avond voor de toets.</Callout>
          <Callout tone="danger" title="Opslaan is niet gelukt">
            Controleer of je nog genoeg opslagruimte hebt.
          </Callout>
        </Stack>
      </Section>

      <Section label="Kleur van het vak">
        <Stack direction="row" gap={2} wrap>
          {SUBJECT_COLOR_ORDER.map((option) => (
            <ChoiceChip
              key={option}
              selected={option === color}
              icon={<SubjectDot color={option} />}
              onChange={() => setColor(option)}
            >
              {SUBJECT_COLORS[option].label}
            </ChoiceChip>
          ))}
        </Stack>
      </Section>

      <Section label="Knoppen">
        <Stack gap={3}>
          <Button size="lg" block icon={<Sparkles />} onClick={replan}>
            Maak mijn planning
          </Button>
          <Stack direction="row" gap={2} wrap>
            <Button>Opslaan</Button>
            <Button variant="secondary">Later</Button>
            <Button variant="ghost">Overslaan</Button>
            <Button variant="danger" icon={<Trash />} onClick={askDelete}>
              Verwijderen
            </Button>
          </Stack>
          <Stack direction="row" gap={2} wrap>
            <Button loading>Opslaan</Button>
            <Button variant="secondary" loading>
              Later
            </Button>
            <Button disabled>Niet beschikbaar</Button>
            <Button variant="secondary" size="sm">
              Klein
            </Button>
          </Stack>
          <Stack direction="row" gap={3} wrap>
            <IconButton aria-label="Meldingen" badge={2}>
              <Bell />
            </IconButton>
            <IconButton aria-label="Toets toevoegen" size="sm">
              <Plus />
            </IconButton>
            <GlassPill className="sb-gallery-pill">
              <IconButton variant="plain" aria-label="Bewerken" onClick={openSheet}>
                <Pencil />
              </IconButton>
              <IconButton variant="plain" aria-label="Verwijderen" onClick={askDelete}>
                <Trash />
              </IconButton>
            </GlassPill>
            <Badge count={4} />
            <Badge count={12} tone="neutral" />
            <Badge count={120} tone="danger" />
          </Stack>
        </Stack>
      </Section>

      <Section label="Meldingen bovenin">
        <Stack direction="row" gap={2} wrap>
          <Button variant="secondary" onClick={() => toast.success('Je hebt je blok afgevinkt.')}>
            Gelukt
          </Button>
          <Button
            variant="secondary"
            onClick={() => toast.error('Dat ging niet goed. Probeer het opnieuw.')}
          >
            Fout
          </Button>
          <Button variant="secondary" onClick={() => toast.info('Morgen heb je een vrije dag.')}>
            Info
          </Button>
        </Stack>
      </Section>

      <Sheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title="Leerstof bewerken"
        footer={
          <Button size="lg" block loading={saving} onClick={saveTopic}>
            Opslaan
          </Button>
        }
      >
        <Field label="Onderdeel" error={titleError}>
          <TextInput
            value={topicTitle}
            onChange={setTopicTitle}
            placeholder="Bijvoorbeeld §3.2 Meiose"
          />
        </Field>
        <Field label="Soort" hint="Bepaalt hoe School Buddy je herinnert.">
          <Select<ExamKind>
            value={kind}
            onChange={setKind}
            placeholder="Kies een soort"
            options={EXAM_KIND_ORDER.map((value) => ({ value, label: EXAM_KINDS[value].label }))}
          />
        </Field>
        <Field label="Datum en tijd" group>
          <Stack direction="row" gap={2}>
            <DateInput value={date} onChange={setDate} min={today} aria-label="Datum" />
            <TimeInput
              value={time}
              onChange={setTime}
              aria-label="Tijd"
              className="sb-gallery-time"
            />
          </Stack>
        </Field>
        <Field label="Hoe moeilijk vind je dit?" group>
          <SegmentedControl<Difficulty>
            value={difficulty}
            onChange={setDifficulty}
            options={([1, 2, 3] as const).map((value) => ({
              value,
              label: DIFFICULTIES[value].label,
            }))}
          />
        </Field>
        <Field
          label="Geschatte leertijd"
          hint="Hoe lang heb je nodig om dit voor het eerst te leren?"
        >
          <Stepper
            value={minutes}
            onChange={setMinutes}
            min={15}
            max={240}
            step={15}
            format={formatDuration}
          />
        </Field>
        <Field label="Notities" optional>
          <TextArea
            value={topicNotes}
            onChange={setTopicNotes}
            placeholder="Waar moet je op letten?"
          />
        </Field>
      </Sheet>
    </Screen>
  );
}

// ───────────────────────── Home: tab root with large title ─────────────────────────

function HomeScreen({ done, onToggle }: TodayState) {
  const toast = useToast();
  const today = todayISO();
  const [selected, setSelected] = useState<ISODate>(today);
  const doneCount = BLOCKS.filter((block) => done.has(block.id)).length;

  return (
    <Screen withTabBar>
      <LargeHeader
        title="Vandaag"
        subtitle={formatDateLong(today)}
        trailing={
          <>
            <IconButton
              aria-label="Meldingen"
              badge={2}
              onClick={() => toast.info('Je hebt 2 nieuwe meldingen.')}
            >
              <Bell />
            </IconButton>
            <Avatar name="Sanne de Vries" size={44} />
          </>
        }
      />

      <WeekStrip selected={selected} onSelect={setSelected} />

      <Section label="Vandaag leren" trailing={`${doneCount} van ${BLOCKS.length}`}>
        <Card padding="none">
          <TodayList done={done} onToggle={onToggle} showSubject />
        </Card>
      </Section>

      <Section label="Komende toetsen">
        <Stack gap={3}>
          {EXAMS.map((exam) => (
            <Card key={exam.subject} onClick={() => toast.info(`${exam.subject}: ${exam.title}`)}>
              <Stack direction="row" justify="between" gap={2}>
                <SubjectTag color={exam.color}>{exam.subject}</SubjectTag>
                <Text as="span" size="sm" tone="secondary">
                  {formatRelative(addDays(today, exam.inDays), today)}
                </Text>
              </Stack>
              <Heading level={3} size="subheading" className="sb-gallery-card-title">
                {exam.title}
              </Heading>
              <ProgressBar
                value={exam.progress}
                color={exam.color}
                aria-label={`Voortgang ${exam.subject}`}
              />
            </Card>
          ))}
        </Stack>
      </Section>
    </Screen>
  );
}

// ───────────────────────── Agenda: empty and loading states ─────────────────────────

function AgendaScreen() {
  const toast = useToast();
  const today = todayISO();
  const [selected, setSelected] = useState<ISODate>(today);
  const [view, setView] = useState<'week' | 'maand'>('week');

  return (
    <Screen withTabBar>
      <LargeHeader title="Agenda" subtitle={`Week ${weekNumber(today)}`} />
      <SegmentedControl
        aria-label="Weergave"
        className="sb-gallery-view-switch"
        value={view}
        onChange={setView}
        options={[
          { value: 'week', label: 'Week' },
          { value: 'maand', label: 'Maand' },
        ]}
      />
      <WeekStrip selected={selected} onSelect={setSelected} />

      <Section label={formatDateLong(selected)}>
        <EmptyState
          icon={<Sparkles />}
          title="Vrije dag"
          text="Er staat niets gepland. Geniet ervan, of plan alvast een extra blok."
          action={
            <Button
              variant="secondary"
              icon={<Plus />}
              onClick={() => toast.success('Er is een blok toegevoegd.')}
            >
              Blok toevoegen
            </Button>
          }
        />
      </Section>

      <Section label="Bezig met laden" trailing={<Spinner size={16} />}>
        <Stack gap={3}>
          <Stack direction="row" gap={3}>
            <Skeleton shape="circle" width={40} height={40} />
            <Stack gap={2} className="sb-gallery-grow">
              <Skeleton width="70%" />
              <Skeleton width="45%" height={12} />
            </Stack>
          </Stack>
          <Skeleton shape="card" height={96} />
        </Stack>
      </Section>
    </Screen>
  );
}

// ───────────────────────── Profiel: settings and form controls ─────────────────────────

function ProfileScreen() {
  const toast = useToast();
  const confirm = useConfirm();
  const [name, setName] = useState('Sanne de Vries');
  const [methods, setMethods] = useState<StudyMethod[]>(['samenvatten', 'flashcards', 'oefenen']);
  const [planStyle, setPlanStyle] = useState<PlanStyle>('gespreid');
  const [sessionMinutes, setSessionMinutes] = useState('30');
  const [minutesPerDay, setMinutesPerDay] = useState(90);
  const [leadDays, setLeadDays] = useState(10);
  const [start, setStart] = useState('16:00');
  const [reminders, setReminders] = useState(true);
  const [digest, setDigest] = useState(false);

  const toggleMethod = (method: StudyMethod, selected: boolean) =>
    setMethods((current) =>
      selected ? [...current, method] : current.filter((item) => item !== method),
    );

  const logOut = async () => {
    const confirmed = await confirm({
      title: 'Uitloggen?',
      message: 'Je gegevens blijven op dit apparaat staan.',
      confirmLabel: 'Uitloggen',
    });
    if (confirmed) toast.info('Je bent uitgelogd.');
  };

  return (
    <Screen
      withTabBar
      bottomBar={
        <Button size="lg" block onClick={() => toast.success('Je voorkeuren zijn opgeslagen.')}>
          Voorkeuren opslaan
        </Button>
      }
    >
      <LargeHeader title="Profiel" />
      <Card>
        <Stack direction="row" gap={3}>
          <Avatar name={name} size={56} />
          <div className="sb-gallery-grow">
            <Heading level={2} size="subheading">
              {name.trim() || 'Naamloos'}
            </Heading>
            <Text size="md" tone="secondary" truncate>
              sanne@voorbeeld.nl
            </Text>
          </div>
        </Stack>
      </Card>

      <Section label="Zo leer ik">
        <Field label="Naam">
          <TextInput value={name} onChange={setName} autoComplete="name" />
        </Field>
        <Field label="Mijn leermethodes" group>
          <Stack direction="row" gap={2} wrap>
            {STUDY_METHOD_ORDER.map((method) => (
              <ChoiceChip
                key={method}
                selected={methods.includes(method)}
                onChange={(selected) => toggleMethod(method, selected)}
              >
                {STUDY_METHODS[method].label}
              </ChoiceChip>
            ))}
          </Stack>
        </Field>
        <Field label="Hoe plan je het liefst?" hint={PLAN_STYLES[planStyle].description} group>
          <SegmentedControl<PlanStyle>
            value={planStyle}
            onChange={setPlanStyle}
            options={PLAN_STYLE_ORDER.map((value) => ({ value, label: PLAN_STYLES[value].label }))}
          />
        </Field>
        <Field label="Lengte van een blok">
          <Select
            value={sessionMinutes}
            onChange={setSessionMinutes}
            options={SESSION_LENGTH_OPTIONS.map((value) => ({
              value: String(value),
              label: formatDuration(value),
            }))}
          />
        </Field>
        <Field label="Leertijd op een schooldag">
          <Slider
            value={minutesPerDay}
            onChange={setMinutesPerDay}
            max={240}
            step={15}
            format={formatDuration}
          />
        </Field>
        <Field label="Begin met leren" hint="Zoveel dagen voor een toets start je planning.">
          <Stepper
            value={leadDays}
            onChange={setLeadDays}
            min={1}
            max={30}
            format={(days) => (days === 1 ? '1 dag' : `${days} dagen`)}
          />
        </Field>
        <Field label="Starttijd door de week">
          <TimeInput value={start} onChange={setStart} />
        </Field>
      </Section>

      <Section label="Meldingen">
        <Card padding="none">
          <ListRow
            asLabel
            title="Herinneringen"
            subtitle="10 minuten voor elk blok"
            trailing={<Switch checked={reminders} onChange={setReminders} />}
          />
          <ListRow
            asLabel
            title="Dagoverzicht"
            subtitle="Elke ochtend om 07:30"
            trailing={<Switch checked={digest} onChange={setDigest} />}
          />
          <ListRow
            asLabel
            title="Avondcheck"
            subtitle="Zet eerst herinneringen aan"
            trailing={<Switch checked={false} onChange={() => undefined} disabled />}
          />
        </Card>
      </Section>

      <Section label="Account">
        <Card padding="none">
          <ListRow
            leading={<GraduationCap />}
            title="Mijn vakken"
            trailing="6"
            chevron
            onClick={() => toast.info('Je hebt 6 vakken.')}
          />
          <ListRow leading={<LogOut />} title="Uitloggen" destructive onClick={logOut} />
        </Card>
      </Section>
    </Screen>
  );
}

function GalleryShell() {
  const [tab, setTab] = useState<GalleryTab>('toetsen');
  const [done, setDone] = useState<ReadonlySet<string>>(() => new Set(['b1']));

  const toggle = (id: string, checked: boolean) =>
    setDone((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });

  return (
    <>
      {tab === 'home' && <HomeScreen done={done} onToggle={toggle} />}
      {tab === 'agenda' && <AgendaScreen />}
      {tab === 'toetsen' && <ExamScreen done={done} onToggle={toggle} />}
      {tab === 'profiel' && <ProfileScreen />}
      <TabBar items={TABS} value={tab} onChange={setTab} />
    </>
  );
}

export default function Gallery() {
  return (
    <ToastProvider>
      <ConfirmProvider>
        <GalleryShell />
      </ConfirmProvider>
    </ToastProvider>
  );
}
