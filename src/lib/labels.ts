/** Dutch labels and fixed option lists for everything the UI shows. */
import type {
  Difficulty,
  ExamKind,
  PlanStyle,
  SessionKind,
  StudyMethod,
  SubjectColor,
} from '../types';

// Chosen for a white background: each colour stays clearly visible as a dot or thin bar.
export const SUBJECT_COLORS: Record<SubjectColor, { label: string; hex: string }> = {
  green: { label: 'Groen', hex: '#1F9D55' },
  teal: { label: 'Turquoise', hex: '#0E9488' },
  blue: { label: 'Blauw', hex: '#2F6FEB' },
  indigo: { label: 'Indigo', hex: '#5856D6' },
  purple: { label: 'Paars', hex: '#9B51E0' },
  pink: { label: 'Roze', hex: '#E0458B' },
  red: { label: 'Rood', hex: '#E5484D' },
  orange: { label: 'Oranje', hex: '#E8760C' },
  yellow: { label: 'Geel', hex: '#B88A00' },
  gray: { label: 'Grijs', hex: '#6E7781' },
};

export const SUBJECT_COLOR_ORDER: SubjectColor[] = [
  'green',
  'teal',
  'blue',
  'indigo',
  'purple',
  'pink',
  'red',
  'orange',
  'yellow',
  'gray',
];

export const EXAM_KINDS: Record<ExamKind, { label: string; short: string }> = {
  toets: { label: 'Toets', short: 'Toets' },
  so: { label: 'Schriftelijke overhoring', short: 'SO' },
  tentamen: { label: 'Tentamen', short: 'Tentamen' },
  mondeling: { label: 'Mondeling', short: 'Mondeling' },
  presentatie: { label: 'Presentatie', short: 'Presentatie' },
  deadline: { label: 'Inleveropdracht', short: 'Inleveren' },
};

export const EXAM_KIND_ORDER: ExamKind[] = [
  'toets',
  'so',
  'tentamen',
  'mondeling',
  'presentatie',
  'deadline',
];

export const STUDY_METHODS: Record<StudyMethod, { label: string; description: string }> = {
  lezen: { label: 'Lezen', description: 'De stof rustig doorlezen en markeren' },
  samenvatten: { label: 'Samenvatten', description: 'In je eigen woorden opschrijven' },
  flashcards: { label: 'Flashcards', description: 'Begrippen en vragen op kaartjes' },
  oefenen: { label: 'Oefenopgaven', description: 'Opdrachten en oude toetsen maken' },
  uitleggen: { label: 'Uitleggen', description: 'De stof hardop aan iemand uitleggen' },
  mindmap: { label: 'Mindmap', description: 'Verbanden tekenen in een schema' },
  overhoren: { label: 'Overhoren', description: 'Jezelf testen of laten overhoren' },
};

export const STUDY_METHOD_ORDER: StudyMethod[] = [
  'samenvatten',
  'flashcards',
  'oefenen',
  'lezen',
  'overhoren',
  'uitleggen',
  'mindmap',
];

export const SESSION_KINDS: Record<SessionKind, { label: string }> = {
  leren: { label: 'Leren' },
  herhalen: { label: 'Herhalen' },
  eindherhaling: { label: 'Eindherhaling' },
};

export const PLAN_STYLES: Record<PlanStyle, { label: string; description: string }> = {
  gespreid: { label: 'Gelijkmatig', description: 'Elke dag een beetje, netjes verdeeld' },
  vroeg: { label: 'Ruim op tijd', description: 'Vroeg beginnen en ruim van tevoren klaar' },
  laat: { label: 'Kort van tevoren', description: 'Zo dicht mogelijk op de toets' },
};

export const PLAN_STYLE_ORDER: PlanStyle[] = ['gespreid', 'vroeg', 'laat'];

export const DIFFICULTIES: Record<Difficulty, { label: string }> = {
  1: { label: 'Makkelijk' },
  2: { label: 'Gemiddeld' },
  3: { label: 'Moeilijk' },
};

/** Index 0 = Monday, matching `weekdayIndex` and `Preferences.minutesPerWeekday`. */
export const WEEKDAYS_LONG = [
  'maandag',
  'dinsdag',
  'woensdag',
  'donderdag',
  'vrijdag',
  'zaterdag',
  'zondag',
] as const;

export const WEEKDAYS_SHORT = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'] as const;

/** Block lengths offered in the preferences. */
export const SESSION_LENGTH_OPTIONS = [20, 25, 30, 45, 60] as const;
export const BREAK_LENGTH_OPTIONS = [5, 10, 15] as const;
