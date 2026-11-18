/**
 * Editors for the study preferences, shared by the onboarding and the profile.
 * All controlled ({ value, onChange }); nothing is saved here.
 */
import { Check } from 'lucide-react';
import {
  Card,
  ChoiceChip,
  Field,
  ListRow,
  SegmentedControl,
  Stack,
  Stepper,
  Switch,
  Text,
  TimeInput,
} from '../ui';
import { formatDuration, formatTime, isValidTime, parseTime } from '../../lib/date';
import {
  BREAK_LENGTH_OPTIONS,
  PLAN_STYLES,
  PLAN_STYLE_ORDER,
  SESSION_LENGTH_OPTIONS,
  STUDY_METHODS,
  STUDY_METHOD_ORDER,
  WEEKDAYS_LONG,
} from '../../lib/labels';
import type { NotificationPrefs, PlanStyle, Preferences, StudyMethod } from '../../types';
import './prefs.css';

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export const weekTotal = (minutes: Preferences['minutesPerWeekday']) => minutes.reduce((a, b) => a + b, 0);

export function WeekdayMinutesEditor({
  value,
  onChange,
}: {
  value: Preferences['minutesPerWeekday'];
  onChange: (v: Preferences['minutesPerWeekday']) => void;
}) {
  return (
    <Stack gap={3}>
      <Card padding="none" className="sb-prefs-compact">
        {WEEKDAYS_LONG.map((day, i) => (
          <ListRow
            key={day}
            title={capitalize(day)}
            trailing={
              <Stepper
                value={value[i]}
                min={0}
                max={360}
                step={15}
                format={(v) => (v === 0 ? 'Rust' : formatDuration(v).replace(' min', ''))}
                aria-label={`Leertijd op ${day}`}
                onChange={(v) => {
                  const next = [...value] as Preferences['minutesPerWeekday'];
                  next[i] = v;
                  onChange(next);
                }}
              />
            }
          />
        ))}
      </Card>
      <Text tone="secondary" aria-live="polite">
        Samen {formatDuration(weekTotal(value))} per week.
      </Text>
    </Stack>
  );
}

type Times = Pick<Preferences, 'weekdayStart' | 'weekendStart' | 'sessionMinutes' | 'breakMinutes'>;

export function exampleDay(p: Times): string {
  const start = parseTime(p.weekdayStart);
  const firstEnd = start + p.sessionMinutes;
  const second = firstEnd + p.breakMinutes;
  return `${p.weekdayStart} tot ${formatTime(firstEnd)}, pauze, ${formatTime(second)} tot ${formatTime(second + p.sessionMinutes)}.`;
}

export function StudyTimesEditor({ value, onChange }: { value: Times; onChange: (v: Times) => void }) {
  const set = (p: Partial<Times>) => onChange({ ...value, ...p });
  return (
    <Stack gap={5}>
      <div className="sb-prefs-two">
        <Field label="Doordeweeks vanaf">
          <TimeInput value={value.weekdayStart} onChange={(v) => isValidTime(v) && set({ weekdayStart: v })} />
        </Field>
        <Field label="Weekend vanaf">
          <TimeInput value={value.weekendStart} onChange={(v) => isValidTime(v) && set({ weekendStart: v })} />
        </Field>
      </div>
      <Field label="Lengte van een blok" group>
        <Stack direction="row" gap={2} wrap>
          {SESSION_LENGTH_OPTIONS.map((m) => (
            <ChoiceChip key={m} selected={value.sessionMinutes === m} onChange={() => set({ sessionMinutes: m })}>
              {m} min
            </ChoiceChip>
          ))}
        </Stack>
      </Field>
      <Field label="Pauze tussen blokken" group>
        <SegmentedControl
          aria-label="Pauze tussen blokken"
          options={BREAK_LENGTH_OPTIONS.map((m) => ({ value: m, label: `${m} min` }))}
          value={value.breakMinutes}
          onChange={(v) => set({ breakMinutes: v })}
        />
      </Field>
      <Text tone="secondary">Bijvoorbeeld: {exampleDay(value)}</Text>
    </Stack>
  );
}

export function MethodPicker({ value, onChange }: { value: StudyMethod[]; onChange: (v: StudyMethod[]) => void }) {
  const toggle = (m: StudyMethod) => {
    if (!value.includes(m)) onChange([...value, m]);
    else if (value.length > 1) onChange(value.filter((x) => x !== m));
  };
  return (
    <Stack gap={2}>
      {STUDY_METHOD_ORDER.map((method) => {
        const position = value.indexOf(method);
        const selected = position >= 0;
        return (
          <OptionButton
            key={method}
            selected={selected}
            mark={selected ? position + 1 : ''}
            label={STUDY_METHODS[method].label}
            description={STUDY_METHODS[method].description}
            onClick={() => toggle(method)}
          />
        );
      })}
    </Stack>
  );
}

export function PlanStylePicker({
  value,
  leadDays,
  onChange,
  onLeadDays,
}: {
  value: PlanStyle;
  leadDays: number;
  onChange: (v: PlanStyle) => void;
  onLeadDays: (v: number) => void;
}) {
  return (
    <Stack gap={4}>
      <Stack gap={2}>
        {PLAN_STYLE_ORDER.map((style) => (
          <OptionButton
            key={style}
            selected={value === style}
            mark={value === style ? <Check size={16} strokeWidth={3} /> : ''}
            label={PLAN_STYLES[style].label}
            description={PLAN_STYLES[style].description}
            onClick={() => onChange(style)}
          />
        ))}
      </Stack>
      <Card padding="none" className="sb-prefs-compact">
        <ListRow
          title="Begin met leren"
          subtitle="Zoveel dagen voor een toets"
          trailing={
            <Stepper
              value={leadDays}
              min={2}
              max={30}
              format={(v) => `${v} dagen`}
              aria-label="Aantal dagen voor een toets beginnen"
              onChange={onLeadDays}
            />
          }
        />
      </Card>
    </Stack>
  );
}

function OptionButton({
  selected,
  mark,
  label,
  description,
  onClick,
}: {
  selected: boolean;
  mark: React.ReactNode;
  label: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className={`sb-option${selected ? ' is-selected' : ''}`} aria-pressed={selected} onClick={onClick}>
      <span className="sb-option__mark" aria-hidden>
        {mark}
      </span>
      <span className="sb-option__text">
        <span className="sb-option__label">{label}</span>
        <span className="sb-option__desc">{description}</span>
      </span>
    </button>
  );
}

const EXAM_DAY_OPTIONS = [7, 3, 2, 1];

/** When reminders arrive. Each kind can be switched off. */
export function NotificationPrefsEditor({
  value,
  onChange,
  disabled = false,
}: {
  value: NotificationPrefs;
  onChange: (v: NotificationPrefs) => void;
  disabled?: boolean;
}) {
  const set = (p: Partial<NotificationPrefs>) => onChange({ ...value, ...p });
  return (
    <div className={`sb-prefs-notify${disabled ? ' is-disabled' : ''}`} inert={disabled}>
      <Card padding="none" className="sb-prefs-compact">
        <ListRow
          title="Voor een leerblok"
          subtitle={value.sessionLeadMinutes === null ? 'Uit' : value.sessionLeadMinutes === 0 ? 'Bij de start' : `${value.sessionLeadMinutes} minuten vooraf`}
          trailing={
            <Switch
              checked={value.sessionLeadMinutes !== null}
              aria-label="Herinnering voor een leerblok"
              onChange={(on) => set({ sessionLeadMinutes: on ? 10 : null })}
            />
          }
        />
        {value.sessionLeadMinutes !== null && (
          <ListRow
            title="Hoeveel minuten vooraf"
            trailing={
              <Stepper
                value={value.sessionLeadMinutes}
                min={0}
                max={60}
                step={5}
                format={(v) => `${v} min`}
                aria-label="Minuten voor een leerblok"
                onChange={(v) => set({ sessionLeadMinutes: v })}
              />
            }
          />
        )}
        <ListRow
          title="Dagoverzicht"
          subtitle={value.dailyDigestTime ? `Elke ochtend om ${value.dailyDigestTime}` : 'Uit'}
          trailing={
            <Switch
              checked={value.dailyDigestTime !== null}
              aria-label="Dagoverzicht"
              onChange={(on) => set({ dailyDigestTime: on ? '07:30' : null })}
            />
          }
        />
        {value.dailyDigestTime !== null && (
          <ListRow
            title="Tijd van het overzicht"
            trailing={
              <TimeInput
                aria-label="Tijd van het dagoverzicht"
                value={value.dailyDigestTime}
                onChange={(v) => isValidTime(v) && set({ dailyDigestTime: v })}
              />
            }
          />
        )}
        <ListRow
          title="Avondcheck"
          subtitle={value.eveningCheckTime ? `Om ${value.eveningCheckTime} als er nog blokken open staan` : 'Uit'}
          trailing={
            <Switch
              checked={value.eveningCheckTime !== null}
              aria-label="Avondcheck"
              onChange={(on) => set({ eveningCheckTime: on ? '20:30' : null })}
            />
          }
        />
      </Card>
      <Field label="Seintje voor een toets" hint="Zoveel dagen van tevoren." group>
        <Stack direction="row" gap={2} wrap>
          {EXAM_DAY_OPTIONS.map((n) => {
            const on = value.examDaysBefore.includes(n);
            return (
              <ChoiceChip
                key={n}
                selected={on}
                onChange={() =>
                  set({
                    examDaysBefore: on
                      ? value.examDaysBefore.filter((x) => x !== n)
                      : [...value.examDaysBefore, n].sort((a, b) => b - a),
                  })
                }
              >
                {n === 1 ? '1 dag' : `${n} dagen`}
              </ChoiceChip>
            );
          })}
        </Stack>
      </Field>
    </div>
  );
}
