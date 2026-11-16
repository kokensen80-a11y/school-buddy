import fc from 'fast-check';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Exam, StudySession, UserData } from '../types';
import { addDays, formatTime, toDateTime } from './date';
import { createEmptyUserData } from './defaults';
import { buildICS, downloadICS } from './ics';

// Monday 16 November 2026, 15:00 local time.
const NOW = toDateTime('2026-11-16', '15:00');

function makeExam(overrides: Partial<Exam> = {}): Exam {
  return {
    id: 'ex-bio',
    subjectId: 'bio',
    title: 'Hoofdstuk 3 en 4',
    kind: 'toets',
    date: '2026-11-19',
    topics: [
      { id: 't1', title: 'Celdeling', estMinutes: 60, difficulty: 2, mastered: false },
      { id: 't2', title: 'Mitose', estMinutes: 30, difficulty: 2, mastered: false },
      { id: 't3', title: 'Meiose', estMinutes: 30, difficulty: 3, mastered: false },
    ],
    attachments: [],
    createdAt: '2026-11-01T10:00:00.000Z',
    updatedAt: '2026-11-01T10:00:00.000Z',
    ...overrides,
  };
}

function makeSession(overrides: Partial<StudySession> = {}): StudySession {
  return {
    id: 's1',
    examId: 'ex-bio',
    parts: [
      { topicId: 't1', minutes: 20 },
      { topicId: 't2', minutes: 10 },
    ],
    date: '2026-11-16',
    start: '16:00',
    minutes: 30,
    kind: 'leren',
    method: 'samenvatten',
    status: 'gepland',
    pinned: false,
    ...overrides,
  };
}

function makeData(exams: Exam[] = [makeExam()], sessions: StudySession[] = []): UserData {
  const data = createEmptyUserData();
  data.subjects = [{ id: 'bio', name: 'Biologie', color: 'green' }];
  data.exams = exams;
  data.sessions = sessions;
  return data;
}

/** Undoes line folding: the logical content lines of the file. */
function unfold(ics: string): string[] {
  return ics.replace(/\r\n /g, '').split('\r\n').filter(Boolean);
}

/** The content lines of every VEVENT, in file order. */
function eventsOf(ics: string): string[][] {
  const events: string[][] = [];
  let current: string[] | null = null;
  for (const line of unfold(ics)) {
    if (line === 'BEGIN:VEVENT') current = [];
    else if (line === 'END:VEVENT' && current) {
      events.push(current);
      current = null;
    } else current?.push(line);
  }
  return events;
}

const valueOf = (lines: string[], name: string) =>
  lines.find((line) => line.startsWith(`${name}:`) || line.startsWith(`${name};`))?.replace(/^[^:]*:/, '');

const triggersOf = (lines: string[]) =>
  lines.filter((line) => line.startsWith('TRIGGER:')).map((line) => line.slice('TRIGGER:'.length));

function unescapeText(value: string): string {
  return value.replace(/\\(.)/g, (_, character: string) => (character === 'n' ? '\n' : character));
}

const octets = (line: string) => new TextEncoder().encode(line).length;

describe('buildICS', () => {
  it('produces a calendar with the required header and CRLF line endings', () => {
    const ics = buildICS({ data: makeData([makeExam()], [makeSession()]), now: NOW });
    const lines = unfold(ics);

    expect(lines.slice(0, 6)).toEqual([
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//School Buddy//Studieplanner//NL',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-CALNAME:School Buddy',
    ]);
    expect(lines[lines.length - 1]).toBe('END:VCALENDAR');
    expect(ics.endsWith('\r\n')).toBe(true);
    // No line break other than CRLF anywhere.
    expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    expect(lines.filter((line) => line === 'BEGIN:VEVENT')).toHaveLength(2);
    expect(lines.filter((line) => line === 'END:VEVENT')).toHaveLength(2);
  });

  it('is a valid, empty calendar when nothing lies ahead', () => {
    const ics = buildICS({ data: makeData([], []), now: NOW });
    expect(eventsOf(ics)).toEqual([]);
    expect(unfold(ics)[0]).toBe('BEGIN:VCALENDAR');
    expect(unfold(ics).at(-1)).toBe('END:VCALENDAR');
  });

  it('writes a study block as a floating local event with an alarm', () => {
    const [event] = eventsOf(buildICS({ data: makeData([makeExam({ date: '2026-12-01' })], [makeSession()]), now: NOW }));

    expect(event).toEqual([
      'UID:sessie-s1@schoolbuddy',
      `DTSTAMP:${NOW.toISOString().replace(/[-:]|\.\d{3}/g, '')}`,
      'DTSTART:20261116T160000',
      'DTEND:20261116T163000',
      'SUMMARY:Leren: Biologie — Celdeling\\, Mitose',
      'DESCRIPTION:Onderwerpen: Celdeling (20 min)\\, Mitose (10 min)\\nManier: Samenvatten\\nVoor: Toets "Hoofdstuk 3 en 4" op dinsdag 1 december',
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      'DESCRIPTION:Leren: Biologie — Celdeling\\, Mitose',
      'TRIGGER:-PT10M',
      'END:VALARM',
    ]);
  });

  it('stamps events with the given moment in UTC', () => {
    const now = new Date(Date.UTC(2026, 10, 16, 9, 5, 7));
    const [event] = eventsOf(buildICS({ data: makeData(), now }));
    expect(valueOf(event, 'DTSTAMP')).toBe('20261116T090507Z');
  });

  it('shortens the summary for many topics and falls back to the exam title without any', () => {
    const many = makeSession({
      id: 'many',
      parts: [
        { topicId: 't1', minutes: 10 },
        { topicId: 't2', minutes: 10 },
        { topicId: 't3', minutes: 10 },
      ],
      kind: 'herhalen',
    });
    const generic = makeSession({ id: 'generic', start: '17:00', parts: [], kind: 'eindherhaling' });
    const events = eventsOf(buildICS({ data: makeData([makeExam({ date: '2026-12-01' })], [many, generic]), now: NOW }));

    expect(valueOf(events[0], 'SUMMARY')).toBe('Herhalen: Biologie — Celdeling\\, Mitose\\, +1');
    expect(valueOf(events[1], 'SUMMARY')).toBe('Eindherhaling: Biologie — Hoofdstuk 3 en 4');
    expect(valueOf(events[1], 'DESCRIPTION')).not.toContain('Onderwerpen');
  });

  it('uses the lead time from the preferences for the alarm, or 10 minutes when that is off', () => {
    const trigger = (lead: number | null) => {
      const data = makeData([makeExam({ date: '2026-12-01' })], [makeSession()]);
      data.prefs.notifications.sessionLeadMinutes = lead;
      return triggersOf(eventsOf(buildICS({ data, now: NOW }))[0]);
    };

    expect(trigger(30)).toEqual(['-PT30M']);
    expect(trigger(90)).toEqual(['-PT1H30M']);
    expect(trigger(60)).toEqual(['-PT1H']);
    expect(trigger(0)).toEqual(['PT0M']);
    expect(trigger(null)).toEqual(['-PT10M']);
  });

  it('adds the alarm even when notifications in the app are switched off', () => {
    const data = makeData([makeExam({ date: '2026-12-01' })], [makeSession()]);
    data.prefs.notifications.enabled = false;
    expect(triggersOf(eventsOf(buildICS({ data, now: NOW }))[0])).toEqual(['-PT10M']);
  });

  it('lets a block that runs past midnight end on the next day', () => {
    const late = makeSession({ start: '23:45', minutes: 30 });
    const [event] = eventsOf(buildICS({ data: makeData([makeExam({ date: '2026-12-01' })], [late]), now: NOW }));

    expect(valueOf(event, 'DTSTART')).toBe('20261116T234500');
    expect(valueOf(event, 'DTEND')).toBe('20261117T001500');
  });

  it('writes an exam with a start time as a one-hour event with two alarms', () => {
    const exam = makeExam({ time: '10:30', location: 'Lokaal 2.14', weight: 2, notes: 'Rekenmachine mee' });
    const [event] = eventsOf(buildICS({ data: makeData([exam]), now: NOW }));

    expect(event).toEqual([
      'UID:toets-ex-bio@schoolbuddy',
      `DTSTAMP:${NOW.toISOString().replace(/[-:]|\.\d{3}/g, '')}`,
      'DTSTART:20261119T103000',
      'DTEND:20261119T113000',
      'SUMMARY:Toets Biologie: Hoofdstuk 3 en 4',
      'DESCRIPTION:Leerstof: Celdeling\\, Mitose\\, Meiose\\nTelt 2x mee\\nRekenmachine mee',
      'LOCATION:Lokaal 2.14',
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      'DESCRIPTION:Morgen: Toets Biologie: Hoofdstuk 3 en 4',
      // 19:00 the evening before a 10:30 exam is 15,5 hours earlier.
      'TRIGGER:-PT15H30M',
      'END:VALARM',
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      'DESCRIPTION:Over een uur: Toets Biologie: Hoofdstuk 3 en 4',
      'TRIGGER:-PT1H',
      'END:VALARM',
    ]);
  });

  it('writes an exam without a start time as an all-day event with an alarm the evening before', () => {
    const exam = makeExam({ kind: 'so', topics: [], date: '2026-11-30' });
    const [event] = eventsOf(buildICS({ data: makeData([exam]), now: NOW }));

    expect(event).toEqual([
      'UID:toets-ex-bio@schoolbuddy',
      `DTSTAMP:${NOW.toISOString().replace(/[-:]|\.\d{3}/g, '')}`,
      'DTSTART;VALUE=DATE:20261130',
      // The end of an all-day event is exclusive: the next day, here in the next month.
      'DTEND;VALUE=DATE:20261201',
      'SUMMARY:SO Biologie: Hoofdstuk 3 en 4',
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      'DESCRIPTION:Morgen: SO Biologie: Hoofdstuk 3 en 4',
      'TRIGGER:-PT5H',
      'END:VALARM',
    ]);
  });

  it('leaves the subject out of the summary when it no longer exists', () => {
    const data = makeData([makeExam({ subjectId: 'weg', date: '2026-12-01' })], [makeSession({ parts: [] })]);
    const events = eventsOf(buildICS({ data, now: NOW }));

    expect(valueOf(events[0], 'SUMMARY')).toBe('Leren: Hoofdstuk 3 en 4');
    expect(valueOf(events[1], 'SUMMARY')).toBe('Toets: Hoofdstuk 3 en 4');
  });

  it('leaves out everything that is over, done or damaged', () => {
    const exams = [
      makeExam({ id: 'gisteren', date: '2026-11-15' }),
      makeExam({ id: 'vanochtend', date: '2026-11-16', time: '09:00' }),
      makeExam({ id: 'bezig', date: '2026-11-16', time: '14:30' }),
      makeExam({ id: 'vandaag', date: '2026-11-16' }),
      makeExam({ id: 'kapot', date: 'ooit' }),
      makeExam({ id: 'later', date: '2026-11-20' }),
    ];
    const sessions = [
      makeSession({ id: 'voorbij', examId: 'later', start: '14:00' }),
      makeSession({ id: 'net-klaar', examId: 'later', start: '14:30' }),
      makeSession({ id: 'bezig', examId: 'later', start: '14:45' }),
      makeSession({ id: 'gedaan', examId: 'later', start: '17:00', status: 'gedaan' }),
      makeSession({ id: 'overgeslagen', examId: 'later', start: '18:00', status: 'overgeslagen' }),
      makeSession({ id: 'gisteren', examId: 'later', date: '2026-11-15', start: '20:00' }),
      makeSession({ id: 'zonder-toets', examId: 'verwijderd', start: '19:00' }),
      makeSession({ id: 'kapot', examId: 'later', start: 'straks' }),
      makeSession({ id: 'straks', examId: 'later', start: '19:30' }),
    ];
    const uids = eventsOf(buildICS({ data: makeData(exams, sessions), now: NOW })).map((event) => valueOf(event, 'UID'));

    expect(uids).toEqual([
      'toets-vandaag@schoolbuddy',
      'toets-bezig@schoolbuddy',
      'sessie-bezig@schoolbuddy',
      'sessie-straks@schoolbuddy',
      'toets-later@schoolbuddy',
    ]);
  });

  it('sorts events by start and gives each a unique, stable UID', () => {
    const exams = [makeExam({ id: 'b', date: '2026-11-25', time: '09:00' }), makeExam({ id: 'a', date: '2026-11-18' })];
    const sessions = [
      makeSession({ id: 'late', examId: 'a', date: '2026-11-17', start: '18:00' }),
      makeSession({ id: 'early', examId: 'a', date: '2026-11-17', start: '16:00' }),
      makeSession({ id: 'first', examId: 'b', date: '2026-11-16', start: '20:00' }),
    ];
    const data = makeData(exams, sessions);
    const uids = (now: Date) => eventsOf(buildICS({ data, now })).map((event) => valueOf(event, 'UID'));

    expect(uids(NOW)).toEqual([
      'sessie-first@schoolbuddy',
      'sessie-early@schoolbuddy',
      'sessie-late@schoolbuddy',
      'toets-a@schoolbuddy',
      'toets-b@schoolbuddy',
    ]);
    expect(new Set(uids(NOW)).size).toBe(5);
    expect(uids(new Date(NOW.getTime() + 60_000))).toEqual(uids(NOW));
  });

  it('escapes backslash, comma, semicolon and line breaks', () => {
    const exam = makeExam({
      title: 'H3; §2,1 \\ extra',
      notes: 'Regel 1\r\nRegel 2\rRegel 3\nTab\there',
      location: 'Gebouw A, lokaal 3; boven',
      topics: [],
    });
    const [event] = eventsOf(buildICS({ data: makeData([exam]), now: NOW }));

    expect(valueOf(event, 'SUMMARY')).toBe('Toets Biologie: H3\\; §2\\,1 \\\\ extra');
    expect(valueOf(event, 'DESCRIPTION')).toBe('Regel 1\\nRegel 2\\nRegel 3\\nTab here');
    expect(valueOf(event, 'LOCATION')).toBe('Gebouw A\\, lokaal 3\\; boven');
  });

  it('folds long lines at 75 octets without splitting a multi-byte character', () => {
    const title = 'Één héél lange titel met trema’s, 漢字, emoji 🎓📚🧬 en nog veel meer tekst om over de grens te komen — écht waar 🙂';
    const ics = buildICS({ data: makeData([makeExam({ title, notes: title.repeat(3) })]), now: NOW });
    const physical = ics.split('\r\n');

    expect(physical.some((line) => line.startsWith(' '))).toBe(true);
    for (const line of physical) {
      expect(octets(line)).toBeLessThanOrEqual(75);
      // Throws on half of a surrogate pair.
      expect(() => encodeURIComponent(line)).not.toThrow();
    }
    const [event] = eventsOf(ics);
    expect(unescapeText(valueOf(event, 'SUMMARY') ?? '')).toBe(`Toets Biologie: ${title}`);
    expect(unescapeText(valueOf(event, 'DESCRIPTION') ?? '')).toContain(title.repeat(3));
  });

  it('fills a line up to exactly 75 octets before folding', () => {
    // 'SUMMARY:Toets Biologie: ' is 24 octets, so 51 more fit on the first line.
    const ics = buildICS({ data: makeData([makeExam({ title: 'x'.repeat(52), topics: [] })]), now: NOW });
    const physical = ics.split('\r\n');
    const index = physical.findIndex((line) => line.startsWith('SUMMARY:'));

    expect(physical[index]).toBe(`SUMMARY:Toets Biologie: ${'x'.repeat(51)}`);
    expect(octets(physical[index])).toBe(75);
    expect(physical[index + 1]).toBe(' x');
  });

  it('keeps any text intact through escaping and folding', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 300 }), (title) => {
        const ics = buildICS({ data: makeData([makeExam({ title, topics: [] })]), now: NOW });
        for (const line of ics.split('\r\n')) expect(octets(line)).toBeLessThanOrEqual(75);

        const [event] = eventsOf(ics);
        const expected = title.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, ' ');
        expect(unescapeText(valueOf(event, 'SUMMARY') ?? '')).toBe(`Toets Biologie: ${expected}`);
      }),
    );
  });
});

// ───────────────────────── RFC 5545, line by line ─────────────────────────

const TEXT_PROPERTIES = new Set(['UID', 'SUMMARY', 'DESCRIPTION', 'LOCATION', 'X-WR-CALNAME']);
const ALLOWED: Record<string, Set<string>> = {
  VCALENDAR: new Set(['VERSION', 'PRODID', 'CALSCALE', 'METHOD', 'X-WR-CALNAME']),
  VEVENT: new Set(['UID', 'DTSTAMP', 'DTSTART', 'DTEND', 'SUMMARY', 'DESCRIPTION', 'LOCATION']),
  VALARM: new Set(['ACTION', 'DESCRIPTION', 'TRIGGER']),
};
const NESTING: Record<string, string | undefined> = { VCALENDAR: undefined, VEVENT: 'VCALENDAR', VALARM: 'VEVENT' };

/** Milliseconds of a 'YYYYMMDD' or 'YYYYMMDDTHHMMSS' value read as UTC; fails on an impossible date or time. */
function stampToMs(value: string): number {
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2}))?$/.exec(value);
  if (!match) throw new Error(`not a date or date-time: ${value}`);
  const [year, month, day, hour = 0, minute = 0, second = 0] = match.slice(1).map((part) => Number(part ?? 0));
  const ms = Date.UTC(year, month - 1, day, hour, minute, second);
  const back = new Date(ms).toISOString().replace(/[-:]|\.\d{3}Z/g, '');
  if (back !== (value.includes('T') ? value : `${value}T000000`)) throw new Error(`impossible date or time: ${value}`);
  return ms;
}

interface ParsedEvent {
  uid: string;
  allDay: boolean;
  start: string;
  end: string;
  triggers: string[];
}

/**
 * Reads a calendar the way a strict importer would and throws on anything RFC 5545 does not
 * allow in the subset this app writes. Returns the events it found.
 */
function parseStrictly(ics: string): ParsedEvent[] {
  // 3.1: lines end in CRLF, are at most 75 octets long, and a continuation starts with one space.
  expect(ics.endsWith('\r\n')).toBe(true);
  expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
  const physical = ics.slice(0, -2).split('\r\n');
  expect(physical[0].startsWith(' ')).toBe(false);
  for (const line of physical) {
    expect(line).not.toBe('');
    expect(octets(line)).toBeLessThanOrEqual(75);
    expect(line).not.toMatch(/[\u0000-\u001F\u007F]/);
    expect(() => encodeURIComponent(line)).not.toThrow();
  }

  const stack: string[] = [];
  const seen: Map<string, number>[] = [];
  const events: ParsedEvent[] = [];
  let event: Partial<ParsedEvent> & { triggers: string[] } = { triggers: [] };
  let closed = false;

  const count = (name: string) => seen[seen.length - 1].get(name) ?? 0;
  const exactlyOne = (...names: string[]) => {
    for (const name of names) expect([name, count(name)]).toEqual([name, 1]);
  };

  for (const line of unfold(ics)) {
    expect(closed).toBe(false);
    const match = /^([A-Z][A-Z0-9-]*)((?:;[A-Z][A-Z0-9-]*=[^;:,"]+)*):(.*)$/.exec(line);
    if (!match) throw new Error(`not a content line: ${line}`);
    const [, name, parameters, value] = match;

    if (name === 'BEGIN') {
      expect(NESTING[value]).toBe(stack[stack.length - 1]);
      stack.push(value);
      seen.push(new Map());
      if (value === 'VEVENT') event = { triggers: [] };
      continue;
    }
    if (name === 'END') {
      const component = stack.pop();
      expect(value).toBe(component);
      if (component === 'VCALENDAR') {
        exactlyOne('VERSION', 'PRODID');
        closed = true;
      } else if (component === 'VEVENT') {
        exactlyOne('UID', 'DTSTAMP', 'DTSTART', 'DTEND', 'SUMMARY');
        expect(count('DESCRIPTION')).toBeLessThanOrEqual(1);
        expect(count('LOCATION')).toBeLessThanOrEqual(1);
        events.push(event as ParsedEvent);
      } else {
        exactlyOne('ACTION', 'DESCRIPTION', 'TRIGGER');
      }
      seen.pop();
      continue;
    }

    const component = stack[stack.length - 1];
    expect([component, name, ALLOWED[component]?.has(name)]).toEqual([component, name, true]);
    seen[seen.length - 1].set(name, count(name) + 1);

    if (TEXT_PROPERTIES.has(name)) {
      // 3.3.11: a backslash only escapes \ ; , or n, and a bare ; or , is not allowed in a single text.
      expect(value.replace(/\\[\;,nN]/g, '')).not.toMatch(/[\;,]/);
      expect(value).not.toBe('');
    }
    if (name === 'VERSION') expect(value).toBe('2.0');
    if (name === 'ACTION') expect(value).toBe('DISPLAY');
    if (name === 'DTSTAMP') {
      expect(value).toMatch(/^\d{8}T\d{6}Z$/);
      stampToMs(value.slice(0, -1));
    }
    if (name === 'DTSTART' || name === 'DTEND') {
      const allDay = parameters === ';VALUE=DATE';
      expect(['', ';VALUE=DATE']).toContain(parameters);
      expect(value).toMatch(allDay ? /^\d{8}$/ : /^\d{8}T\d{6}$/);
      stampToMs(value);
      if (name === 'DTSTART') Object.assign(event, { allDay, start: value });
      else {
        // 3.6.1: both of the same type, the end after the start; an all-day end is exclusive.
        expect(allDay).toBe(event.allDay);
        expect(stampToMs(value)).toBeGreaterThan(stampToMs(event.start ?? ''));
        if (allDay) expect(stampToMs(value) - stampToMs(event.start ?? '')).toBe(86_400_000);
        event.end = value;
      }
    } else {
      expect(parameters).toBe('');
    }
    if (name === 'UID') event.uid = value;
    if (name === 'TRIGGER') {
      // 3.3.6: a duration needs at least one part after the T.
      expect(value).toMatch(/^-?PT(?=\d)(\d+H)?(\d+M)?$/);
      event.triggers.push(value);
    }
  }
  expect(closed).toBe(true);
  expect(stack).toEqual([]);
  expect(new Set(events.map((e) => e.uid)).size).toBe(events.length);
  return events;
}

describe('buildICS: RFC 5545 conformance', () => {
  it('writes a file that a strict reader accepts', () => {
    const exams = [
      makeExam({ id: 'a', time: '10:30', location: 'Lokaal 2.14; boven', notes: 'Let op:\nrekenmachine, geodriehoek' }),
      makeExam({ id: 'b', date: '2026-12-31', title: 'Eindtoets — "alles"' }),
      makeExam({ id: 'c', date: '2026-11-30', time: '23:30', kind: 'deadline' }),
    ];
    const sessions = [
      makeSession({ id: 's1', examId: 'a' }),
      makeSession({ id: 's2', examId: 'b', date: '2026-12-31', start: '23:45', minutes: 45, parts: [] }),
    ];
    const events = parseStrictly(buildICS({ data: makeData(exams, sessions), now: NOW }));

    expect(events).toEqual([
      { uid: 'sessie-s1@schoolbuddy', allDay: false, start: '20261116T160000', end: '20261116T163000', triggers: ['-PT10M'] },
      { uid: 'toets-a@schoolbuddy', allDay: false, start: '20261119T103000', end: '20261119T113000', triggers: ['-PT15H30M', '-PT1H'] },
      { uid: 'toets-c@schoolbuddy', allDay: false, start: '20261130T233000', end: '20261201T003000', triggers: ['-PT28H30M', '-PT1H'] },
      // New Year's Eve: the all-day end and a block that runs past midnight both land in 2027.
      { uid: 'toets-b@schoolbuddy', allDay: true, start: '20261231', end: '20270101', triggers: ['-PT5H'] },
      { uid: 'sessie-s2@schoolbuddy', allDay: false, start: '20261231T234500', end: '20270101T003000', triggers: ['-PT10M'] },
    ]);
  });

  it('stays valid for blocks with a broken number of minutes', () => {
    const sessions = [
      makeSession({ id: 'half', minutes: 22.5, parts: [{ topicId: 't1', minutes: 22.5 }] }),
      makeSession({ id: 'kort', start: '17:00', minutes: 0.2, parts: [] }),
    ];
    const ics = buildICS({ data: makeData([makeExam()], sessions), now: NOW });
    const events = parseStrictly(ics);

    expect(events.slice(0, 2)).toEqual([
      { uid: 'sessie-half@schoolbuddy', allDay: false, start: '20261116T160000', end: '20261116T162300', triggers: ['-PT10M'] },
      { uid: 'sessie-kort@schoolbuddy', allDay: false, start: '20261116T170000', end: '20261116T170100', triggers: ['-PT10M'] },
    ]);
    expect(ics).toContain('Celdeling (23 min)');
  });

  it('accepts whatever plan and preferences it is given', () => {
    const text = fc.oneof(fc.string({ maxLength: 40 }), fc.string({ unit: 'binary', maxLength: 120 }), fc.constantFrom('a;b,c\\d', 'x\\ny', '\\', ' ', '日本語 🎓'));
    const examArb = fc.record({
      dayOffset: fc.integer({ min: -3, max: 400 }),
      time: fc.option(fc.integer({ min: 0, max: 1439 }).map(formatTime), { nil: undefined }),
      title: text,
      location: fc.option(text, { nil: undefined }),
      notes: fc.option(text, { nil: undefined }),
      weight: fc.option(fc.double({ min: 0.5, max: 100, noNaN: true }), { nil: undefined }),
      kind: fc.constantFrom<Exam['kind']>('toets', 'so', 'tentamen', 'mondeling', 'presentatie', 'deadline'),
      topicTitle: text,
      hasSubject: fc.boolean(),
    });
    const sessionArb = fc.record({
      exam: fc.nat(3),
      dayOffset: fc.integer({ min: -3, max: 400 }),
      start: fc.integer({ min: 0, max: 1439 }).map(formatTime),
      minutes: fc.oneof(fc.constantFrom(20, 25, 30, 45, 60), fc.double({ min: 0.01, max: 3000, noNaN: true })),
      status: fc.constantFrom<StudySession['status']>('gepland', 'gedaan', 'overgeslagen'),
      kind: fc.constantFrom<StudySession['kind']>('leren', 'herhalen', 'eindherhaling'),
      parts: fc.integer({ min: 0, max: 4 }),
    });

    fc.assert(
      fc.property(
        fc.array(examArb, { minLength: 1, maxLength: 4 }),
        fc.array(sessionArb, { maxLength: 12 }),
        fc.integer({ min: 0, max: 1439 }),
        fc.option(fc.oneof(fc.integer({ min: 0, max: 1440 }), fc.double({ min: 0, max: 1440, noNaN: true })), { nil: null }),
        text,
        (examSpecs, sessionSpecs, nowMinutes, lead, subjectName) => {
          const today = '2026-11-16';
          const exams = examSpecs.map((spec, index) =>
            makeExam({
              id: `e${index}`,
              subjectId: spec.hasSubject ? 'bio' : 'weg',
              date: addDays(today, spec.dayOffset),
              time: spec.time,
              title: spec.title,
              location: spec.location,
              notes: spec.notes,
              weight: spec.weight,
              kind: spec.kind,
              topics: [0, 1, 2, 3].map((n) => ({ id: `t${n}`, title: `${spec.topicTitle}${n}`, estMinutes: 30, difficulty: 2, mastered: false })),
            }),
          );
          const sessions = sessionSpecs.map((spec, index) =>
            makeSession({
              id: `s${index}`,
              examId: `e${spec.exam % exams.length}`,
              date: addDays(today, spec.dayOffset),
              start: spec.start,
              minutes: spec.minutes,
              status: spec.status,
              kind: spec.kind,
              parts: Array.from({ length: spec.parts }, (_, n) => ({ topicId: `t${n}`, minutes: spec.minutes / spec.parts })),
            }),
          );
          const data = makeData(exams, sessions);
          data.subjects = [{ id: 'bio', name: subjectName, color: 'green' }];
          data.prefs.notifications.sessionLeadMinutes = lead;
          const now = toDateTime(today, formatTime(nowMinutes));

          const events = parseStrictly(buildICS({ data, now }));

          // Nothing that is over: every event ends after "now" on the clock of the device.
          const nowStamp = `${today.replaceAll('-', '')}T${formatTime(nowMinutes).replace(':', '')}00`;
          for (const event of events) {
            if (event.allDay) expect(event.start >= nowStamp.slice(0, 8)).toBe(true);
            else expect(event.end > nowStamp).toBe(true);
          }
          const planned = sessions.filter((s) => s.status === 'gepland').length;
          expect(events.length).toBeLessThanOrEqual(planned + exams.length);
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe('downloadICS', () => {
  // jsdom has no object URLs; the fakes are put on URL per test and taken off again.
  const original = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    URL.createObjectURL = original.create;
    URL.revokeObjectURL = original.revoke;
  });

  it('offers the file through a temporary link and releases it afterwards', async () => {
    vi.useFakeTimers();
    const blobs: Blob[] = [];
    const createObjectURL = vi.fn((blob: Blob) => {
      blobs.push(blob);
      return 'blob:school-buddy';
    });
    const revokeObjectURL = vi.fn();
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;

    const clicked: { href: string; download: string; inDocument: boolean }[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push({ href: this.href, download: this.download, inDocument: document.body.contains(this) });
    });

    downloadICS('BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n', 'mijn-planning.ics');

    expect(clicked).toEqual([{ href: 'blob:school-buddy', download: 'mijn-planning.ics', inDocument: true }]);
    expect(blobs[0].type).toBe('text/calendar;charset=utf-8');
    expect(blobs[0].size).toBe(32);
    expect(document.querySelector('a')).toBeNull();

    // The link has to outlive the click: Safari reads the file afterwards.
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60_000);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:school-buddy');
  });

  it('uses a default file name', () => {
    URL.createObjectURL = () => 'blob:x';
    URL.revokeObjectURL = () => undefined;
    let download = '';
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      download = this.download;
    });

    downloadICS('BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n');
    expect(download).toBe('school-buddy.ics');
  });
});
