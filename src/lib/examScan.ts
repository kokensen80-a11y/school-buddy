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
  /** The word for the kind as it is on the photo: "Kennistoets", "Hertentamen". */
  kindWord?: string;
  title?: string;
  /** "Weging 2", "telt 3x". */
  weight?: number;
  /** What to learn, one item per entry ("Hoofdstuk 4", "Begrippenlijst"). */
  topics?: string[];
  /** Useful remarks such as "Rekenmachine meenemen". */
  notes?: string[];
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

const ROOM = /^[\p{L}]{0,6}\s?[\p{L}]{0,3}\s?[A-Z]?\d{1,2}[.,]?\d{0,3}[a-z]?$/u;

/** "DMH A3.26" and "DMH A3.34" → "DMH A3.26 en A3.34". */
function joinRooms(rooms: string[]): string {
  const first = rooms[0].split(' ');
  const prefix = first.length > 1 && rooms.every((r) => r.startsWith(`${first[0]} `)) ? first[0] : '';
  const parts = rooms.map((r, i) => (prefix && i > 0 ? r.slice(prefix.length + 1) : r));
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} en ${parts[parts.length - 1]}`;
}

function findLocation(lines: string[]): string | undefined {
  // A label on its own line ("Locatie(s)") with one room per line under it.
  for (let i = 0; i < lines.length; i++) {
    if (!/^(?:lokaal|lokalen|locatie|locaties|locatie\(s\)|lokaal\(en\)|ruimte|ruimtes|zaal|zalen|plaats)\s*:?$/i.test(lines[i])) continue;
    const rooms: string[] = [];
    for (const next of lines.slice(i + 1, i + 7)) {
      const room = next.replace(/\s+/g, ' ').trim();
      if (room.length <= 24 && /\d/.test(room) && ROOM.test(room)) rooms.push(room);
      else if (/^online|^digitaal|^thuis/i.test(room)) rooms.push(capitalize(room));
      else break;
    }
    if (rooms.length > 0) return joinRooms(rooms);
  }
  for (const line of lines) {
    const m = line.match(/\b(lokaal|lok\.|ruimte|zaal|locatie|plaats|waar)(?!\s*\()\s*[:.]?\s*([^\n,;|]+)/i);
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
  /** School system codes (Magister, SOMtoday), matched in any case at the start of a line. */
  short?: string[];
}

const KNOWN_SUBJECTS: KnownSubject[] = [
  { name: 'Bedrijfseconomie', words: ['bedrijfseconomie'], codes: ['BECO'], short: ['beco', 'm&o'] },
  { name: 'Maatschappijwetenschappen', words: ['maatschappijwetenschappen'], codes: ['MAW'] },
  { name: 'Maatschappijleer', words: ['maatschappijleer'], codes: ['MAAT'], short: ['maat', 'ml'] },
  { name: 'Lichamelijke opvoeding', words: ['lichamelijke opvoeding', 'gym'], codes: ['LO'], short: ['lo'] },
  { name: 'Wiskunde', words: ['wiskunde', 'wisk'], codes: ['WI', 'WIS', 'WISA', 'WISB', 'WISC', 'WISD'], short: ['wis', 'wisa', 'wisb', 'wisc', 'wisd', 'wi', 'wa', 'wb'] },
  { name: 'Nederlands', words: ['nederlands'], codes: ['NE', 'NED', 'NL'], short: ['netl', 'ned', 'ne', 'nl'] },
  { name: 'Engels', words: ['engels', 'english'], codes: ['ENG'], short: ['entl', 'eng'] },
  { name: 'Duits', words: ['duits'], codes: ['DU', 'DUI'], short: ['dutl', 'du'] },
  { name: 'Frans', words: ['frans'], codes: ['FA', 'FR', 'FRA'], short: ['fatl', 'fa', 'fr'] },
  { name: 'Spaans', words: ['spaans'], codes: ['SP', 'SPA'], short: ['sptl', 'sp'] },
  { name: 'Latijn', words: ['latijn'], codes: ['LA', 'LAT'], short: ['ltc', 'lat'] },
  { name: 'Grieks', words: ['grieks'], codes: ['GR', 'GRT'], short: ['grc', 'gtc'] },
  { name: 'Biologie', words: ['biologie', 'bio'], codes: ['BI', 'BIO'], short: ['biol', 'bio', 'bi'] },
  { name: 'Scheikunde', words: ['scheikunde'], codes: ['SK', 'SCH'], short: ['schk', 'sk'] },
  { name: 'Natuurkunde', words: ['natuurkunde'], codes: ['NA', 'NAT'], short: ['nat', 'nask1'] },
  { name: 'Nask', words: ['nask'], codes: ['NASK'], short: ['nask', 'nask2'] },
  { name: 'Geschiedenis', words: ['geschiedenis'], codes: ['GS', 'GES'], short: ['ges', 'gesch', 'gs'] },
  { name: 'Aardrijkskunde', words: ['aardrijkskunde'], codes: ['AK'], short: ['ak', 'aard'] },
  { name: 'Economie', words: ['economie'], codes: ['EC', 'ECO'], short: ['econ', 'eco', 'ec'] },
  { name: 'Filosofie', words: ['filosofie'], codes: ['FI', 'FIL'], short: ['fi', 'fil'] },
  { name: 'Informatica', words: ['informatica'], codes: ['INF'], short: ['inf'] },
  { name: 'CKV', words: ['ckv'], codes: ['CKV'] },
  { name: 'NLT', words: ['nlt'], codes: ['NLT'] },
  { name: 'Muziek', words: ['muziek'], codes: ['MU', 'MUZ'] },
  { name: 'Tekenen', words: ['tekenen', 'beeldende vorming'], codes: ['BV'] },
  { name: 'Levensbeschouwing', words: ['levensbeschouwing', 'godsdienst'], codes: ['LV', 'LEV'], short: ['lv', 'lev', 'gd'] },
  { name: 'Techniek', words: ['techniek'], codes: [] },
];

/** Courses of hbo business and sport programmes, checked before the school subjects. */
const HBO_SUBJECTS: KnownSubject[] = [
  { name: 'Sportmarketing', words: ['sportmarketing'], codes: [] },
  { name: 'Sportmanagement', words: ['sportmanagement'], codes: [] },
  { name: 'Sportbeleid', words: ['sportbeleid'], codes: [] },
  { name: 'Sportsociologie', words: ['sportsociologie'], codes: [] },
  { name: 'Sportpsychologie', words: ['sportpsychologie'], codes: [] },
  { name: 'Sportrecht', words: ['sportrecht'], codes: [] },
  { name: 'Eventmanagement', words: ['eventmanagement', 'evenementenmanagement'], codes: [] },
  { name: 'Sponsoring', words: ['sponsoring'], codes: [] },
  { name: 'Ondernemingsplan', words: ['ondernemingsplan', 'businessplan', 'business plan'], codes: [] },
  { name: 'Ondernemerschap', words: ['ondernemerschap', 'entrepreneurship'], codes: [] },
  { name: 'Financieel management', words: ['financieel management', 'financial management', 'financiering'], codes: [] },
  { name: 'Strategisch management', words: ['strategisch management'], codes: [] },
  { name: 'Projectmanagement', words: ['projectmanagement'], codes: [] },
  { name: 'HRM', words: ['human resource management', 'personeelsmanagement'], codes: ['HRM'] },
  { name: 'Accounting', words: ['accounting', 'boekhouden', 'financiele administratie'], codes: [] },
  { name: 'Bedrijfsrecht', words: ['bedrijfsrecht', 'ondernemingsrecht'], codes: [] },
  { name: 'Organisatiekunde', words: ['organisatiekunde'], codes: [] },
  { name: 'Marketing', words: ['marketing', 'marketingcommunicatie'], codes: [] },
  { name: 'Communicatie', words: ['communicatie'], codes: [] },
  { name: 'Sales', words: ['sales', 'verkoopkunde'], codes: [] },
  { name: 'Statistiek', words: ['statistiek'], codes: [] },
  { name: 'Onderzoeksvaardigheden', words: ['onderzoeksvaardigheden', 'praktijkgericht onderzoek'], codes: [] },
  { name: 'Business English', words: ['business english'], codes: [] },
  { name: 'Leiderschap', words: ['leiderschap'], codes: [] },
  { name: 'Innovatie', words: ['innovatie'], codes: [] },
  { name: 'Studieloopbaanbegeleiding', words: ['studieloopbaanbegeleiding', 'studieloopbaan'], codes: ['SLB'] },
  { name: 'Management', words: ['management'], codes: [] },
];

const NAME_WORD = "(?:[\\p{L}&'’]+|\\d{1,2}[a-z]?|[IVX]{1,3})";
const NAME_STOP =
  /^(op|om|in|van|voor|met|datum|tijd|lokaal|zaal|locatie|week|periode|blok|kwartiel|semester|tentamen|toets|hertentamen|herkansing|gelegenheid|kans|online|digitaal|schriftelijk|aanvang|start|duur|uur|vanaf|tot|door|bij|deel|en|of)$/i;

/** A course name from free text: up to five words, cut at dates, times and words like "op". */
function courseName(raw: string): string | undefined {
  const words: string[] = [];
  for (const w of raw.trim().split(/\s+/)) {
    if (!new RegExp(`^${NAME_WORD}$`, 'u').test(w)) break;
    if (words.length > 0 && NAME_STOP.test(w) && !/^(en|&)$/i.test(w)) break;
    words.push(w);
    if (words.length === 5) break;
  }
  while (words.length > 0 && /^(en|of|&|van|voor|de|het|een)$/i.test(words[words.length - 1])) words.pop();
  const name = words.join(' ').replace(/[.,:;]+$/, '');
  if (name.length < 3 || !/\p{L}{3}/u.test(name) || NOT_A_SUBJECT.test(fold(name))) return undefined;
  return capitalize(name);
}

function findSubject(text: string, subjects: ScanOptions['subjects']): Pick<ScanResult, 'subjectId' | 'subjectName'> {
  const lower = fold(text);
  // The account's own subjects first, longest name first so "Marketing 2" wins over "Marketing".
  const own = [...subjects].sort((a, b) => b.name.length - a.name.length);
  for (const s of own) {
    if (containsWord(lower, fold(s.name.trim()))) return { subjectId: s.id };
  }
  const byName = (name: string): Pick<ScanResult, 'subjectId' | 'subjectName'> => {
    const f = fold(name);
    const match = own.find((s) => {
      const n = fold(s.name.trim());
      return n === f || (n.length >= 4 && f.startsWith(`${n} `));
    });
    return match ? { subjectId: match.id } : { subjectName: name };
  };

  // 1. A label: "Vak: ...", "Cursus: ...", "Module: ...", "Onderwijseenheid: ...".
  const label = text.match(
    /(?:^|\n)\s*(?:vak|vaknaam|cursus|cursusnaam|module|onderwijseenheid|course|leereenheid)\s*[:\-–]\s*(?:[A-Z]{2,6}\d?[-.]?[A-Z0-9]{1,6}\s+)?([^\n|·•]+)/iu,
  );
  const fromLabel = label && courseName(label[1]);
  if (fromLabel) return byName(fromLabel);

  // 2. A course code with its name, as in Osiris and timetables: "SMO1-MAR Marketing 1".
  for (const m of text.matchAll(/(?<![\p{L}\d])[A-Z]{2,6}\d?[-.][A-Z0-9]{2,6}(?:[-.][A-Z0-9]{1,4})?\s+([A-Z][^\n|·•]*)/gu)) {
    const name = courseName(m[1]);
    if (name) return byName(name);
  }

  // 3. The words right after the kind: "Tentamen Financieel management 1", "Toets Biologie".
  const after = text.match(
    /(?<![\p{L}])(?:[Hh]ertentamen|[Tt]entamen|TENTAMEN|[Tt]oets|TOETS|[Kk]ennistoets|[Pp]roefwerk|SO|[Mm]ondeling|[Pp]resentatie|[Aa]ssessment|[Hh]erkansing)[ \t]*[:\-–]?[ \t]+([A-Z][^\n|·•]*)/u,
  );
  const fromKind = after && courseName(after[1]);

  // 4. Known course and subject names; a longer name after the kind wins ("Marketing 2").
  for (const known of [...HBO_SUBJECTS, ...KNOWN_SUBJECTS]) {
    const byWord = known.words.some((w) => containsWord(lower, w));
    const byCode = known.codes.some((c) => new RegExp(`(?<![\\p{L}])${c}(?![\\p{L}])`, 'u').test(text));
    const byShort = (known.short ?? []).some((c) =>
      new RegExp(`(?:^|\\n|[|•·])\\s*${escapeRe(c)}(?=\\s*[:|·–-]|\\s+[\\p{L}\\d])`, 'iu').test(text),
    );
    if (!byWord && !byCode && !byShort) continue;
    let name = known.name;
    if (name === 'Wiskunde') {
      const variant = lower.match(/wiskunde\s+([abcd])(?![\p{L}])/u)?.[1] ?? text.match(/\bWIS([ABCD])\b/)?.[1];
      if (variant) name = `Wiskunde ${variant.toUpperCase()}`;
    }
    if (fromKind && fold(fromKind).includes(fold(name)) && fromKind.length > name.length) return byName(fromKind);
    // Map onto an own subject with a related name ("Bio", "Wiskunde A"...).
    const folded = fold(name);
    const match = own.find((s) => {
      const n = fold(s.name.trim());
      return n === folded || folded.startsWith(n) || n.startsWith(folded) || known.words.includes(n) || known.codes.includes(s.name.trim().toUpperCase());
    });
    return match ? { subjectId: match.id } : { subjectName: name };
  }

  if (fromKind) return byName(fromKind);

  // 5. The heading, as in timetable and Brightspace popups:
  //    "[BYOD] Strategie Overheid - tweede gelegenheid (3VYZ-h)" → "Strategie Overheid".
  const looksLikeExam =
    new RegExp(`(?<![\\p{L}])${KIND_WORDS}(?![\\p{L}])`, 'iu').test(text) ||
    new RegExp(`(?<![\\p{L}])(${MONTH_WORD})(?![\\p{L}])`, 'u').test(lower) ||
    /\d{1,2}[-/]\d{1,2}/.test(text);
  for (const line of looksLikeExam ? text.split('\n').slice(0, 4) : []) {
    if (!/\p{L}{3}/u.test(line) || /\d{1,2}[:.]\d{2}/.test(line)) continue;
    const head = line
      // Icons before a "[BYOD]" tag or the title come out as stray letters ("O", "©").
      .replace(/^.*?\[[^\]]*\]/, ' ')
      .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
      .replace(/^\s*(?:[^\s\d]\s+)+/u, '')
      .split(/\s[-–—|:]\s|:\s/)[0]
      .replace(new RegExp(`^\\s*${KIND_WORDS}\\s*`, 'iu'), '');
    const name = courseName(head);
    if (name && !new RegExp(`^${KIND_WORDS}$`, 'iu').test(name)) return byName(name);
  }
  return {};
}

const KIND_WORDS =
  '(?:hertentamen|tentamen|kennistoets|toets|proefwerk|so|mondeling|presentatie|assessment|herkansing|deeltoets|eindtoets|opdracht)';

const NOT_A_SUBJECT =
  /^(hoofdstuk|datum|week|periode|toetsweek|tentamenweek|leerstof|literatuur|over|voor|van|op|in|om|klas|morgen|vandaag|maandag|dinsdag|woensdag|donderdag|vrijdag|zaterdag|zondag|januari|februari|maart|april|mei|juni|juli|augustus|september|oktober|november|december|paragraaf|thema|unit|module|les|deel|blok|kwartiel|semester|nummer|cijfer|resultaat|herkansing|inhalen|aanmelden|inschrijven|uitslag|rooster|overzicht|agenda|info|informatie|online|digitaal|schriftelijk|magister|somtoday|brightspace|osiris|canvas|teams|outlook|mytimetable|xedule|zermelo|itslearning|vakcode|docent|klas|groep|opmerking|sluiten|locatie)/;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ───────────────────────── kind and title ─────────────────────────

function findKind(text: string): ExamKind | undefined {
  const lower = fold(text);
  if (/assessment|mondeling|criteriumgericht interview|(?<![\p{L}])cgi(?![\p{L}])/u.test(lower)) return 'mondeling';
  if (/presentatie|pitch/.test(lower)) return 'presentatie';
  if (/tentamen|kennistoets|herkansing/.test(lower)) return 'tentamen';
  if (/inlever|deadline|werkstuk|verslag|portfolio|beroepsproduct|adviesrapport|rapport|paper|essay|opdracht/.test(lower)) return 'deadline';
  if (/schriftelijke overhoring/.test(lower) || /(?<![\p{L}])SO(?![\p{L}])/u.test(text)) return 'so';
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

// ───────────────────────── weight, material, notes ─────────────────────────

function findWeight(text: string): number | undefined {
  const lower = fold(text);
  const m =
    lower.match(/weging\s*[:=]?\s*(\d{1,2})(?![\d.,]*\s*%)/) ??
    lower.match(/telt\s*(\d{1,2})\s*(?:x|keer|maal)/) ??
    lower.match(/(\d{1,2})\s*x\s*(?:meetellen|tellen|weging)/);
  if (!m) return undefined;
  const n = Number(m[1]);
  return n >= 1 && n <= 10 ? n : undefined;
}

const MATERIAL_LABEL =
  /^(?:leerstof|lesstof|stof|te leren|leren|inhoud|onderwerpen?|kennen|toetsstof|tentamenstof|literatuur|wat moet je kennen)\s*[:\-–]\s*(.*)$/i;
const FIELD_LABEL =
  /^(?:datum|tijd|lokaal|locatie|plaats|weging|vak|soort|opmerkingen?|let op|hulpmiddelen|meenemen|nb|n\.b\.|toets|duur)\b/i;
const MATERIAL_HINT =
  /(hoofdstuk|hst\.?|hfst|(?<![\p{L}])h\s?\d|§|paragraaf|par\.|blz|bladzijde|pagina|(?<![\p{L}])p\.?\s?\d|begrippen|woordjes|woordenlijst|grammatica|werkwoorden|unit|thema|module|lesbrief|opgaven|samenvatting|aantekeningen|leesboek|formules|theorie|reader|dictaat|sheets|slides|college|artikel|casus|literatuur|chapter|lesson|(?<![\p{L}])(?:les|week)\s?\d)/iu;
const CHAPTERS =
  /(?:hoofdstuk(?:ken)?|hst\.?|hfst\.?|chapter|(?<![\p{L}])h)\s*(\d{1,2}(?:\s*(?:-|–|t\/m|tm|tot en met|en|&|,)\s*\d{1,2})*)(?![\d.])/iu;
const NOTE_LINE =
  /(hulpmiddel|meenemen|mee nemen|neem .* mee|toegestaan|rekenmachine|woordenboek|binas|grafische|laptop|legitimatie|collegekaart)/i;

/** "4 t/m 6" → [4, 5, 6]; "4 en 5" → [4, 5]. Undefined for silly ranges. */
function chapterNumbers(spec: string): number[] | undefined {
  const parts = spec
    .replace(/\s*(?:-|–|t\/m|tm|tot en met)\s*/g, '..')
    .split(/\s*(?:,|en|&)\s*/);
  const out: number[] = [];
  for (const part of parts) {
    const [a, b] = part.split('..').map((x) => Number(x.trim()));
    if (!Number.isFinite(a)) return undefined;
    if (b === undefined || !Number.isFinite(b)) out.push(a);
    else {
      if (b < a || b - a > 12) return undefined;
      for (let n = a; n <= b; n++) out.push(n);
    }
  }
  return out.length > 0 && out.length <= 15 ? out : undefined;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** One material line or piece into topics; chapter references become one topic per chapter. */
function toTopics(piece: string): string[] {
  const clean = piece.replace(/^[\s\-–•*·>]+/, '').replace(/[\s.;:]+$/, '').trim();
  if (clean.length < 2) return [];
  const m = clean.match(CHAPTERS);
  if (m && m.index !== undefined) {
    const rest = (clean.slice(0, m.index) + clean.slice(m.index + m[0].length)).replace(/[^\p{L}\d§]/gu, '');
    const nums = chapterNumbers(m[1]);
    // Only the chapter reference (perhaps with a subject or "toets" around it): split it up.
    if (nums && !MATERIAL_HINT.test(rest)) return nums.map((n) => `Hoofdstuk ${n}`);
  }
  return [capitalize(clean.slice(0, 80))];
}

function findTopics(lines: string[], subjectWords: string[], today: ISODate): string[] {
  const out: string[] = [];
  const push = (items: string[]) => {
    for (const t of items) if (!out.some((o) => o.toLowerCase() === t.toLowerCase())) out.push(t);
  };
  const labelled = lines.findIndex((l) => MATERIAL_LABEL.test(l));
  if (labelled >= 0) {
    const first = lines[labelled].match(MATERIAL_LABEL)![1];
    const block = [first];
    for (const l of lines.slice(labelled + 1, labelled + 16)) {
      if (FIELD_LABEL.test(l) || NOTE_LINE.test(l) || findDates(l, today).length > 0) break;
      block.push(l);
    }
    for (const line of block) for (const piece of line.split(/[;,•]/)) push(toTopics(piece));
    return out.slice(0, 30);
  }
  for (const line of lines) {
    if (!MATERIAL_HINT.test(line) || NOTE_LINE.test(line)) continue;
    if (/^(?:datum|tijd|lokaal|locatie|weging)\b/i.test(line)) continue;
    // Leave out the subject and kind words around a heading like "Toets Biologie H4 en 5".
    let rest = line;
    for (const w of [...subjectWords, 'toets', 'proefwerk', 'so', 'schriftelijke overhoring', 'mondeling', 'tentamen']) {
      rest = rest.replace(new RegExp(`(?<![\\p{L}])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}])`, 'giu'), ' ');
    }
    for (const d of findDates(rest, today)) rest = rest.slice(0, d.start) + rest.slice(d.end);
    for (const piece of rest.split(/[;•]/)) push(toTopics(piece.replace(/\s+/g, ' ')));
  }
  return out.slice(0, 30);
}

function findNotes(lines: string[]): string[] {
  const text = lines.join('\n');
  const notes: string[] = [];
  if (/(?<![\p{L}])BYOD(?![\p{L}])/u.test(text)) notes.push('Laptop meenemen (BYOD)');
  if (/tweede gelegenheid|herkansing|hertentamen/i.test(text)) notes.push('Herkansing');
  for (const l of lines) {
    if (!NOTE_LINE.test(l)) continue;
    const note = capitalize(l.replace(/^(?:opmerkingen?|let op|nb|n\.b\.)\s*[:!]?\s*/i, '').trim());
    if (note.length > 2) notes.push(note);
  }
  return notes.slice(0, 4);
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
  const kindWord = text.match(new RegExp(`(?<![\\p{L}])${KIND_WORDS}(?![\\p{L}])`, 'iu'))?.[0];
  if (kindWord && kindWord.length > 3) result.kindWord = capitalize(kindWord.toLowerCase());
  const weight = findWeight(text);
  if (weight) result.weight = weight;
  const subjectWords = [
    ...options.subjects.filter((s) => s.id === result.subjectId).map((s) => s.name),
    ...(result.subjectName ? [result.subjectName] : []),
  ];
  const topics = findTopics(lines, subjectWords, options.today);
  if (topics.length > 0) result.topics = topics;
  const notes = findNotes(lines);
  if (notes.length > 0) result.notes = notes;
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
