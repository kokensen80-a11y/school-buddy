/**
 * Reads exam details (date, time, subject, location, kind, title) out of the text that
 * OCR found on a photo: a toetsrooster, a Magister or SOMtoday screenshot, a note.
 * Pure and deterministic, so it can be tested without OCR.
 */
import { isValidISODate } from './date';
import type { ExamKind, ID, ISODate, Subject, TimeOfDay } from '../types';

export interface ScanResult {
  date?: ISODate;
  time?: TimeOfDay;
  endTime?: TimeOfDay;
  location?: string;
  /** An existing subject of the account that matched. */
  subjectId?: ID;
  /** The subject name that was read, when no existing subject matched. */
  subjectName?: string;
  kind?: ExamKind;
  title?: string;
  /** The lines this result came from, to show when there are several. */
  context: string;
}

export interface ScanOptions {
  today: ISODate;
  subjects: Pick<Subject, 'id' | 'name'>[];
}

// ───────────────────────── helpers ─────────────────────────

function fold(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function editDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}

/** Does `word` (already folded) appear in `text` (folded), allowing small OCR typos? */
function containsWord(text: string, word: string): boolean {
  if (!word) return false;
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (new RegExp(`(^|[^\\p{L}])${escaped}($|[^\\p{L}])`, 'u').test(text)) return true;
  if (word.length < 6 || word.includes(' ')) return false;
  const max = word.length >= 9 ? 2 : 1;
  return (text.match(/\p{L}+/gu) ?? []).some(
    (w) => w.length >= word.length - max && editDistance(w, word) <= max,
  );
}

// ───────────────────────── dates ─────────────────────────

const MONTHS: [RegExp, number][] = [
  [/^jan(uari|uary)?$/, 1],
  [/^feb(ruari|ruary)?$/, 2],
  [/^(maart|mrt|maa|mar|march)$/, 3],
  [/^apr(il)?$/, 4],
  [/^(mei|may)$/, 5],
  [/^(juni|jun|june)$/, 6],
  [/^(juli|jul|july)$/, 7],
  [/^aug(ustus|ust)?$/, 8],
  [/^sep(t|tember)?$/, 9],
  [/^(okt|oktober|oct|october)$/, 10],
  [/^nov(ember)?$/, 11],
  [/^dec(ember)?$/, 12],
];

const MONTH_WORD =
  'januari|january|jan|februari|february|feb|maart|march|mrt|maa|mar|april|apr|mei|may|juni|june|jun|juli|july|jul|augustus|august|aug|september|sept|sep|oktober|october|okt|oct|november|nov|december|dec';

const WEEKDAY_BEFORE =
  /(maandag|dinsdag|woensdag|donderdag|vrijdag|zaterdag|zondag|\bma|\bdi|\bwo|\bdo|\bvr|\bza|\bzo)\.?,?\s*$/;

function monthOf(word: string): number | undefined {
  return MONTHS.find(([re]) => re.test(word))?.[1];
}

interface DateHit {
  date: ISODate;
  score: number;
  start: number;
  end: number;
}

function buildDate(day: number, month: number, year: number | undefined, today: ISODate): ISODate | undefined {
  const thisYear = Number(today.slice(0, 4));
  let y = year === undefined ? thisYear : year < 100 ? 2000 + year : year;
  let iso = `${y}-${pad(month)}-${pad(day)}`;
  if (!isValidISODate(iso)) return undefined;
  if (year === undefined) {
    // No year: the next time this date comes around, with two weeks of slack for recent ones.
    const cutoff = new Date(`${today}T00:00:00`);
    cutoff.setDate(cutoff.getDate() - 14);
    if (new Date(`${iso}T00:00:00`) < cutoff) {
      y += 1;
      iso = `${y}-${pad(month)}-${pad(day)}`;
      if (!isValidISODate(iso)) return undefined;
    }
  }
  return iso;
}

function findDates(line: string, today: ISODate): DateHit[] {
  const lower = fold(line);
  const hits: DateHit[] = [];
  const bonus = (start: number) => {
    const before = lower.slice(0, start);
    let s = 0;
    if (WEEKDAY_BEFORE.test(before)) s += 2;
    if (/datum/.test(lower)) s += 2;
    if (/(hoofdstuk|hst|paragraaf|§|blz|pagina|opgave)/.test(before.slice(-14))) s -= 4;
    return s;
  };

  for (const m of lower.matchAll(/(?<![\d])(20\d{2})-(\d{1,2})-(\d{1,2})(?!\d)/g)) {
    const date = buildDate(Number(m[3]), Number(m[2]), Number(m[1]), today);
    if (date) hits.push({ date, score: 4 + bonus(m.index), start: m.index, end: m.index + m[0].length });
  }

  const textual = new RegExp(`(?<![\\p{L}\\d])(\\d{1,2})(?:e|ste|de)?\\s*(${MONTH_WORD})\\.?(?![\\p{L}])(?:\\s+'?(\\d{4}|\\d{2})(?!\\d))?`, 'gu');
  for (const m of lower.matchAll(textual)) {
    const month = monthOf(m[2]);
    if (!month) continue;
    const date = buildDate(Number(m[1]), month, m[3] ? Number(m[3]) : undefined, today);
    if (date) hits.push({ date, score: 3 + (m[3] ? 1 : 0) + bonus(m.index), start: m.index, end: m.index + m[0].length });
  }

  for (const m of lower.matchAll(/(?<![\p{L}\d§.,:\-/])(\d{1,2})([-/.])(\d{1,2})(?:\2(\d{4}|\d{2}))?(?![\d.,:\-/]*\d)/gu)) {
    if (hits.some((h) => m.index < h.end && m.index + m[0].length > h.start)) continue;
    const hasYear = m[4] !== undefined;
    // "9.30" and "4.1" are times and paragraph numbers, not dates.
    if (m[2] === '.' && !hasYear) continue;
    const date = buildDate(Number(m[1]), Number(m[3]), hasYear ? Number(m[4]) : undefined, today);
    if (date) hits.push({ date, score: (hasYear ? 3 : 0) + bonus(m.index), start: m.index, end: m.index + m[0].length });
  }
  return hits.filter((h) => h.score >= 0);
}

// ───────────────────────── times ─────────────────────────

interface TimeHit {
  time: TimeOfDay;
  end?: TimeOfDay;
  score: number;
}

function findTimes(line: string, dateSpans: { start: number; end: number }[]): TimeHit[] {
  let lower = fold(line);
  for (const s of dateSpans) lower = lower.slice(0, s.start) + ' '.repeat(s.end - s.start) + lower.slice(s.end);
  const found: { t: TimeOfDay; index: number; end: number }[] = [];
  for (const m of lower.matchAll(/(?<![\p{L}\d.,:§])([01]?\d|2[0-3])[:.hu]([0-5]\d)(?![\d.,:]?\d)/gu)) {
    found.push({ t: `${pad(Number(m[1]))}:${m[2]}`, index: m.index, end: m.index + m[0].length });
  }
  for (const m of lower.matchAll(/(?:om|vanaf|aanvang|start|begin)\s+([01]?\d|2[0-3])\s*uur/g)) {
    found.push({ t: `${pad(Number(m[1]))}:00`, index: m.index, end: m.index + m[0].length });
  }
  found.sort((a, b) => a.index - b.index);
  const labelled = /(tijd|aanvang|start|begin|uur|van)/.test(lower);
  const hits: TimeHit[] = [];
  for (let i = 0; i < found.length; i++) {
    const cur = found[i];
    const next = found[i + 1];
    const isRange = next && /^\s*(-|–|—|tot|t\/m|to)\s*$/.test(lower.slice(cur.end, next.index));
    hits.push({
      time: cur.t,
      end: isRange ? next.t : undefined,
      score: (isRange ? 2 : 0) + (labelled ? 2 : 0) + (dateSpans.length > 0 ? 2 : 0),
    });
    if (isRange) i++;
  }
  return hits;
}

// ───────────────────────── location ─────────────────────────

const PLACE_WORDS = ['aula', 'gymzaal', 'sporthal', 'mediatheek', 'kantine', 'bibliotheek', 'theater', 'studiezaal'];

function findLocation(lines: string[]): string | undefined {
  for (const line of lines) {
    const m = line.match(/\b(lokaal|lok\.|ruimte|zaal|locatie|plaats|waar)\s*[:.]?\s*([^\n,;|]+)/i);
    if (m) {
      const value = m[2]
        .replace(/\s{2,}.*$/, '')
        .replace(/\b([01]?\d|2[0-3])[:.]([0-5]\d)\b.*$/, '')
        .replace(/[\s:.\-–]+$/, '')
        .trim()
        .slice(0, 40);
      if (value) return value;
    }
  }
  for (const line of lines) {
    const lower = fold(line);
    const place = PLACE_WORDS.find((p) => new RegExp(`\\b${p}\\b`).test(lower));
    if (place) return place[0].toUpperCase() + place.slice(1);
  }
  for (const line of lines) {
    const m = line.match(/(?<![\p{L}\d])([A-Z]{1,2}\s?\d\.?\d{2})(?![\p{L}\d])/u);
    if (m) return m[1].replace(/\s/, '');
  }
  return undefined;
}

// ───────────────────────── subjects ─────────────────────────

interface KnownSubject {
  name: string;
  words: string[];
  /** Codes only matched in capitals, because many are also short Dutch words. */
  codes: string[];
}

const KNOWN_SUBJECTS: KnownSubject[] = [
  { name: 'Bedrijfseconomie', words: ['bedrijfseconomie'], codes: ['BECO'] },
  { name: 'Maatschappijwetenschappen', words: ['maatschappijwetenschappen'], codes: ['MAW'] },
  { name: 'Maatschappijleer', words: ['maatschappijleer'], codes: ['MAAT'] },
  { name: 'Lichamelijke opvoeding', words: ['lichamelijke opvoeding', 'gym'], codes: ['LO'] },
  { name: 'Wiskunde', words: ['wiskunde', 'wisk'], codes: ['WI', 'WIS', 'WISA', 'WISB', 'WISC', 'WISD'] },
  { name: 'Nederlands', words: ['nederlands'], codes: ['NE', 'NED', 'NL'] },
  { name: 'Engels', words: ['engels', 'english'], codes: ['ENG'] },
  { name: 'Duits', words: ['duits'], codes: ['DU', 'DUI'] },
  { name: 'Frans', words: ['frans'], codes: ['FA', 'FR', 'FRA'] },
  { name: 'Spaans', words: ['spaans'], codes: ['SP', 'SPA'] },
  { name: 'Latijn', words: ['latijn'], codes: ['LA', 'LAT'] },
  { name: 'Grieks', words: ['grieks'], codes: ['GR', 'GRT'] },
  { name: 'Biologie', words: ['biologie', 'bio'], codes: ['BI', 'BIO'] },
  { name: 'Scheikunde', words: ['scheikunde'], codes: ['SK', 'SCH'] },
  { name: 'Natuurkunde', words: ['natuurkunde'], codes: ['NA', 'NAT'] },
  { name: 'Nask', words: ['nask'], codes: ['NASK'] },
  { name: 'Geschiedenis', words: ['geschiedenis'], codes: ['GS', 'GES'] },
  { name: 'Aardrijkskunde', words: ['aardrijkskunde'], codes: ['AK'] },
  { name: 'Economie', words: ['economie'], codes: ['EC', 'ECO'] },
  { name: 'Filosofie', words: ['filosofie'], codes: ['FI', 'FIL'] },
  { name: 'Informatica', words: ['informatica'], codes: ['INF'] },
  { name: 'CKV', words: ['ckv'], codes: ['CKV'] },
  { name: 'NLT', words: ['nlt'], codes: ['NLT'] },
  { name: 'Muziek', words: ['muziek'], codes: ['MU', 'MUZ'] },
  { name: 'Tekenen', words: ['tekenen', 'beeldende vorming'], codes: ['BV'] },
  { name: 'Levensbeschouwing', words: ['levensbeschouwing', 'godsdienst'], codes: ['LV', 'LEV'] },
  { name: 'Techniek', words: ['techniek'], codes: [] },
];

function findSubject(text: string, subjects: ScanOptions['subjects']): Pick<ScanResult, 'subjectId' | 'subjectName'> {
  const lower = fold(text);
  // The account's own subjects first, longest name first so "Wiskunde B" wins over "Wiskunde".
  const own = [...subjects].sort((a, b) => b.name.length - a.name.length);
  for (const s of own) {
    if (containsWord(lower, fold(s.name.trim()))) return { subjectId: s.id };
  }
  for (const known of KNOWN_SUBJECTS) {
    const byWord = known.words.some((w) => containsWord(lower, w));
    const byCode = known.codes.some((c) => new RegExp(`(?<![\\p{L}])${c}(?![\\p{L}])`, 'u').test(text));
    if (!byWord && !byCode) continue;
    let name = known.name;
    if (name === 'Wiskunde') {
      const variant = lower.match(/wiskunde\s+([abcd])(?![\p{L}])/u)?.[1] ?? text.match(/\bWIS([ABCD])\b/)?.[1];
      if (variant) name = `Wiskunde ${variant.toUpperCase()}`;
    }
    // Map onto an own subject with a related name ("Bio", "Wiskunde A"...).
    const folded = fold(name);
    const match = own.find((s) => {
      const n = fold(s.name.trim());
      return n === folded || folded.startsWith(n) || n.startsWith(folded) || known.words.includes(n) || known.codes.includes(s.name.trim().toUpperCase());
    });
    return match ? { subjectId: match.id } : { subjectName: name };
  }
  return {};
}

// ───────────────────────── kind and title ─────────────────────────

function findKind(text: string): ExamKind | undefined {
  const lower = fold(text);
  if (/schriftelijke overhoring|(?<![\p{L}])so(?![\p{L}])/u.test(lower)) return 'so';
  if (/mondeling/.test(lower)) return 'mondeling';
  if (/presentatie/.test(lower)) return 'presentatie';
  if (/tentamen/.test(lower)) return 'tentamen';
  if (/inlever|deadline|werkstuk|verslag/.test(lower)) return 'deadline';
  if (/toets|proefwerk|schoolexamen|examen|(?<![\p{L}])(pw|se)(?![\p{L}])/u.test(lower)) return 'toets';
  return undefined;
}

function findTitle(text: string): string | undefined {
  const range = '(\\d{1,2}(?:\\s*(?:-|–|t\\/m|tm|tot en met|en|&|,)\\s*\\d{1,2})*)';
  const m =
    text.match(new RegExp(`\\b(?:hoofdstuk(?:ken)?|hst\\.?|hfst\\.?|chapter)\\s*${range}`, 'i')) ??
    text.match(new RegExp(`\\bH\\s?${range}(?![\\d.])`));
  if (!m) return undefined;
  const nums = m[1]
    .replace(/\s*(?:-|–|tm|tot en met)\s*/g, ' t/m ')
    .replace(/\s*&\s*/g, ' en ')
    .replace(/\s*,\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .trim();
  return `Hoofdstuk ${nums}`;
}

// ───────────────────────── main ─────────────────────────

function scanBlock(lines: string[], options: ScanOptions): ScanResult {
  const text = lines.join('\n');
  let best: DateHit | undefined;
  let bestTime: TimeHit | undefined;
  lines.forEach((line, index) => {
    const dates = findDates(line, options.today);
    for (const d of dates) if (!best || d.score > best.score) best = d;
    for (const t of findTimes(line, dates)) {
      // A lone time on the first line is usually the clock of a screenshot.
      const lone = index === 0 && fold(line).replace(/[^\p{L}\d]/gu, '').length <= 5;
      const score = t.score - (lone ? 3 : 0);
      if (!bestTime || score > bestTime.score) bestTime = { ...t, score };
    }
  });
  const result: ScanResult = {
    context: lines.join(' ').replace(/\s+/g, ' ').trim().slice(0, 120),
    ...findSubject(text, options.subjects),
  };
  const date = best as DateHit | undefined;
  const time = bestTime as TimeHit | undefined;
  if (date) result.date = date.date;
  if (time && time.score >= 0) {
    result.time = time.time;
    if (time.end) result.endTime = time.end;
  }
  const location = findLocation(lines);
  if (location) result.location = location;
  const kind = findKind(text);
  if (kind) result.kind = kind;
  const title = findTitle(text);
  if (title) result.title = title;
  return result;
}

function hasContent(r: ScanResult): boolean {
  return Boolean(r.date || r.time || r.location || r.subjectId || r.subjectName);
}

/**
 * All exams found in `text`, best first. Usually one; a photo of a whole toetsrooster
 * gives one result per date. Empty when nothing useful was found.
 */
export function scanExamText(text: string, options: ScanOptions): ScanResult[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return [];

  const dateLines = lines
    .map((line, index) => ({ index, dates: findDates(line, options.today) }))
    .filter((l) => l.dates.length > 0);
  const distinct = new Set(dateLines.flatMap((l) => l.dates.map((d) => d.date)));

  if (distinct.size <= 1) {
    const one = scanBlock(lines, options);
    return hasContent(one) ? [one] : [];
  }

  const results: ScanResult[] = [];
  dateLines.forEach((l, i) => {
    const end = dateLines[i + 1]?.index ?? lines.length;
    const block = lines.slice(l.index, end);
    const r = scanBlock(block, options);
    // A block without its own subject may have it on the line just above the date.
    if (!r.subjectId && !r.subjectName && l.index > 0) {
      Object.assign(r, findSubject(lines[l.index - 1], options.subjects));
    }
    results.push(r);
  });
  return results.filter(hasContent).slice(0, 20);
}
