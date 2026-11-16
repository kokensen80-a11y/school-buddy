import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type {
  Exam,
  NotificationPrefs,
  Reminder,
  ReminderKind,
  StudySession,
  UserData,
} from '../../types';
import { addDays, formatTime, toDateTime } from '../date';
import { createEmptyUserData } from '../defaults';
import { buildReminders } from './reminders';

// Monday 16 November 2026; the biology exam is on Thursday the 19th.
const MONDAY = '2026-11-16';
const TUESDAY = '2026-11-17';
const WEDNESDAY = '2026-11-18';
const THURSDAY = '2026-11-19';

const iso = (date: string, time: string) => toDateTime(date, time).toISOString();

function makeExam(overrides: Partial<Exam> = {}): Exam {
  return {
    id: 'ex-bio',
    subjectId: 'bio',
    title: 'Hoofdstuk 3 en 4',
    kind: 'toets',
    date: THURSDAY,
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

let sessionCounter = 0;
function makeSession(overrides: Partial<StudySession> = {}): StudySession {
  sessionCounter += 1;
  return {
    id: `s${sessionCounter}`,
    examId: 'ex-bio',
    parts: [{ topicId: 't1', minutes: 30 }],
    date: MONDAY,
    start: '16:00',
    minutes: 30,
    kind: 'leren',
    method: 'samenvatten',
    status: 'gepland',
    pinned: false,
    ...overrides,
  };
}

interface Fixture {
  exams?: Exam[];
  sessions?: StudySession[];
  notifications?: Partial<NotificationPrefs>;
}

function makeData({ exams = [makeExam()], sessions = [], notifications = {} }: Fixture = {}): UserData {
  const data = createEmptyUserData();
  data.subjects = [
    { id: 'bio', name: 'Biologie', color: 'green' },
    { id: 'wis', name: 'Wiskunde', color: 'blue' },
    { id: 'eng', name: 'Engels', color: 'red' },
  ];
  data.exams = exams;
  data.sessions = sessions;
  data.prefs.notifications = { ...data.prefs.notifications, enabled: true, ...notifications };
  return data;
}

function build(fixture: Fixture, now: Date, options: { horizonDays?: number; graceMinutes?: number } = {}) {
  return buildReminders({ data: makeData(fixture), now, ...options });
}

const ofKind = (reminders: Reminder[], kind: ReminderKind) => reminders.filter((r) => r.kind === kind);

const MONDAY_AFTERNOON = toDateTime(MONDAY, '15:00');
const MONDAY_MORNING = toDateTime(MONDAY, '07:00');

describe('buildReminders', () => {
  it('returns nothing when notifications are switched off', () => {
    const fixture: Fixture = { sessions: [makeSession()], notifications: { enabled: false } };
    expect(build(fixture, MONDAY_AFTERNOON)).toEqual([]);
  });

  it('returns reminders sorted by time with unique ids and valid timestamps', () => {
    const sessions = [
      makeSession({ date: TUESDAY }),
      makeSession(),
      makeSession({ date: WEDNESDAY, start: '19:00' }),
    ];
    const reminders = build({ sessions }, MONDAY_MORNING);
    const times = reminders.map((r) => Date.parse(r.at));

    expect(reminders.length).toBeGreaterThan(5);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(new Set(reminders.map((r) => r.id)).size).toBe(reminders.length);
    for (const reminder of reminders) {
      expect(new Date(reminder.at).toISOString()).toBe(reminder.at);
      expect(reminder.link).toMatch(/^#\/(agenda\/\d{4}-\d{2}-\d{2}|toetsen\/.+)$/);
    }
  });

  it('gives the same result for the same input', () => {
    const fixture: Fixture = { sessions: [makeSession(), makeSession({ date: TUESDAY })] };
    expect(build(fixture, MONDAY_AFTERNOON)).toEqual(build(fixture, MONDAY_AFTERNOON));
  });

  it('ignores blocks without an exam and records with a damaged date or time', () => {
    const fixture: Fixture = {
      exams: [makeExam(), makeExam({ id: 'ex-broken', date: 'binnenkort' })],
      sessions: [
        makeSession({ examId: 'verwijderd' }),
        makeSession({ examId: 'ex-broken' }),
        makeSession({ date: '2026-02-30' }),
        makeSession({ start: 'straks' }),
      ],
    };
    const reminders = build(fixture, MONDAY_MORNING);

    expect(ofKind(reminders, 'sessie')).toEqual([]);
    expect(ofKind(reminders, 'dagoverzicht').map((r) => r.id)).toEqual([`dagoverzicht:${THURSDAY}`]);
    expect(reminders.some((r) => r.id.includes('ex-broken'))).toBe(false);
  });
});

describe('study block reminders', () => {
  it('reminds before a planned block with topics, method, start and duration', () => {
    const session = makeSession({
      parts: [
        { topicId: 't1', minutes: 20 },
        { topicId: 't2', minutes: 10 },
      ],
    });
    const [reminder] = ofKind(build({ sessions: [session] }, MONDAY_AFTERNOON), 'sessie');

    expect(reminder).toEqual({
      id: `sessie:ex-bio:${MONDAY}T16:00`,
      at: iso(MONDAY, '15:50'),
      kind: 'sessie',
      title: 'Tijd om te leren: Biologie',
      body: '16:00 · 30 min · Samenvatten · Celdeling en Mitose',
      link: `#/agenda/${MONDAY}`,
    });
  });

  it('names the kind of block in the title and falls back to the exam title without topics', () => {
    const sessions = [
      makeSession({ kind: 'herhalen', parts: [] }),
      makeSession({ kind: 'eindherhaling', date: TUESDAY, method: 'overhoren' }),
    ];
    const [review, final] = ofKind(build({ sessions }, MONDAY_AFTERNOON), 'sessie');

    expect(review.title).toBe('Tijd om te herhalen: Biologie');
    expect(review.body).toBe('16:00 · 30 min · Samenvatten · Hoofdstuk 3 en 4');
    expect(final.title).toBe('Tijd voor je eindherhaling: Biologie');
    expect(final.body).toContain('Overhoren');
  });

  it('uses the exam title when the subject no longer exists', () => {
    const fixture: Fixture = {
      exams: [makeExam({ subjectId: 'weg' })],
      sessions: [makeSession()],
    };
    const [reminder] = ofKind(build(fixture, MONDAY_AFTERNOON), 'sessie');
    expect(reminder.title).toBe('Tijd om te leren: Hoofdstuk 3 en 4');
  });

  it('fires at the start when the lead time is 0 and not at all when it is off', () => {
    const sessions = [makeSession()];
    const atStart = ofKind(build({ sessions, notifications: { sessionLeadMinutes: 0 } }, MONDAY_AFTERNOON), 'sessie');
    const off = ofKind(build({ sessions, notifications: { sessionLeadMinutes: null } }, MONDAY_AFTERNOON), 'sessie');

    expect(atStart.map((r) => r.at)).toEqual([iso(MONDAY, '16:00')]);
    expect(off).toEqual([]);
  });

  it('skips blocks that are done or skipped', () => {
    const sessions = [
      makeSession({ status: 'gedaan' }),
      makeSession({ date: TUESDAY, status: 'overgeslagen' }),
    ];
    expect(ofKind(build({ sessions }, MONDAY_AFTERNOON), 'sessie')).toEqual([]);
  });

  it('sends one reminder for consecutive blocks of the same exam', () => {
    // 30 minutes of work and 10 minutes of break: 16:00, 16:40 and 17:20.
    const sessions = [
      makeSession({ start: '17:20', parts: [{ topicId: 't3', minutes: 30 }], method: 'flashcards' }),
      makeSession({ start: '16:00', parts: [{ topicId: 't1', minutes: 30 }] }),
      makeSession({ start: '16:40', parts: [{ topicId: 't2', minutes: 30 }] }),
    ];
    const reminders = ofKind(build({ sessions }, MONDAY_AFTERNOON), 'sessie');

    expect(reminders).toHaveLength(1);
    expect(reminders[0].id).toBe(`sessie:ex-bio:${MONDAY}T16:00`);
    expect(reminders[0].at).toBe(iso(MONDAY, '15:50'));
    expect(reminders[0].body).toBe(
      '16:00 · 3 blokken, tot 17:50 · Samenvatten en Flashcards · Celdeling, Mitose en Meiose',
    );
  });

  it('starts a new reminder after a longer pause, for another exam and on another day', () => {
    const maths = makeExam({ id: 'ex-wis', subjectId: 'wis', title: 'Hoofdstuk 7', topics: [] });
    const sessions = [
      makeSession({ start: '16:00' }),
      makeSession({ start: '16:40', examId: 'ex-wis', parts: [] }),
      // 16:30 → 17:20 is 50 minutes: more than a break, so a run of its own.
      makeSession({ start: '17:20' }),
      makeSession({ start: '16:00', date: TUESDAY }),
    ];
    const reminders = ofKind(build({ exams: [makeExam(), maths], sessions }, MONDAY_AFTERNOON), 'sessie');

    expect(reminders.map((r) => r.id)).toEqual([
      `sessie:ex-bio:${MONDAY}T16:00`,
      `sessie:ex-wis:${MONDAY}T16:40`,
      `sessie:ex-bio:${MONDAY}T17:20`,
      `sessie:ex-bio:${TUESDAY}T16:00`,
    ]);
    expect(reminders[1].title).toBe('Tijd om te leren: Wiskunde');
  });

  it('accepts a few minutes of slack on top of the break, but not more', () => {
    const run = (secondStart: string) =>
      ofKind(
        build({ sessions: [makeSession({ start: '16:00' }), makeSession({ start: secondStart })] }, MONDAY_AFTERNOON),
        'sessie',
      );

    expect(run('16:45')).toHaveLength(1); // break of 10 + 5 minutes slack
    expect(run('16:46')).toHaveLength(2);
  });

  it('keeps blocks that overlap in one run and names the real end of the run', () => {
    // A long block with a short one inside it; the third starts 10 minutes after the long one ends.
    const sessions = [
      makeSession({ start: '16:00', minutes: 60 }),
      makeSession({ start: '16:10', minutes: 10 }),
      makeSession({ start: '17:10', minutes: 30 }),
    ];
    const reminders = ofKind(build({ sessions }, MONDAY_AFTERNOON), 'sessie');

    expect(reminders.map((r) => r.id)).toEqual([`sessie:ex-bio:${MONDAY}T16:00`]);
    expect(reminders[0].body).toContain('16:00 · 3 blokken, tot 17:40');
  });

  it('names the right end for a run that goes on past midnight', () => {
    const sessions = [makeSession({ start: '23:00' }), makeSession({ start: '23:40' })];
    const [reminder] = ofKind(build({ sessions }, MONDAY_AFTERNOON), 'sessie');
    expect(reminder.body).toContain('23:00 · 2 blokken, tot 00:10');
  });

  it('keeps the id of a run while the student works through it', () => {
    const first = makeSession({ start: '16:00' });
    const rest = [makeSession({ start: '16:40' }), makeSession({ start: '17:20' })];
    const before = ofKind(build({ sessions: [first, ...rest] }, MONDAY_AFTERNOON), 'sessie');
    const during = ofKind(
      build({ sessions: [{ ...first, status: 'gedaan' }, ...rest] }, MONDAY_AFTERNOON),
      'sessie',
    );
    const after = ofKind(
      build(
        { sessions: [first, ...rest].map((s) => ({ ...s, status: 'gedaan' as const })) },
        MONDAY_AFTERNOON,
      ),
      'sessie',
    );

    expect(during).toHaveLength(1);
    expect(during[0].id).toBe(before[0].id);
    expect(during[0].at).toBe(iso(MONDAY, '16:30'));
    expect(during[0].body).toContain('16:40 · 2 blokken, tot 17:50');
    expect(after).toEqual([]);
  });

  it('keeps the id when only the lead time changes, and changes it when the block moves', () => {
    const session = makeSession();
    const idOf = (fixture: Fixture) => ofKind(build(fixture, MONDAY_AFTERNOON), 'sessie')[0].id;

    const original = idOf({ sessions: [session] });
    expect(idOf({ sessions: [session], notifications: { sessionLeadMinutes: 30 } })).toBe(original);
    expect(idOf({ sessions: [{ ...session, id: 'opnieuw-gepland' }] })).toBe(original);
    expect(idOf({ sessions: [{ ...session, start: '16:30' }] })).not.toBe(original);
    expect(idOf({ sessions: [{ ...session, date: TUESDAY }] })).not.toBe(original);
  });
});

describe('daily overview', () => {
  it('summarises the blocks, subjects and exams of today and tomorrow', () => {
    const english = makeExam({ id: 'ex-eng', subjectId: 'eng', kind: 'so', date: THURSDAY, title: 'Unit 4' });
    const bio = makeExam({ date: WEDNESDAY, time: '10:30' });
    const maths = makeExam({ id: 'ex-wis', subjectId: 'wis', date: '2026-11-27', title: 'Hoofdstuk 7' });
    const sessions = [
      makeSession({ date: WEDNESDAY, start: '16:00', examId: 'ex-eng' }),
      makeSession({ date: WEDNESDAY, start: '16:40', examId: 'ex-wis', minutes: 45 }),
      makeSession({ date: WEDNESDAY, start: '17:35', examId: 'ex-wis', minutes: 15 }),
      makeSession({ date: WEDNESDAY, start: '19:00', examId: 'ex-wis', status: 'gedaan' }),
    ];
    const reminders = build({ exams: [bio, english, maths], sessions }, MONDAY_AFTERNOON);
    const digest = reminders.find((r) => r.id === `dagoverzicht:${WEDNESDAY}`);

    expect(digest).toEqual({
      id: `dagoverzicht:${WEDNESDAY}`,
      at: iso(WEDNESDAY, '07:30'),
      kind: 'dagoverzicht',
      title: 'Vandaag: 3 blokken (1 u 30 min)',
      body: 'Engels en Wiskunde. Vandaag ook: toets Biologie (10:30). Morgen: SO Engels.',
      link: `#/agenda/${WEDNESDAY}`,
    });
  });

  it('uses the singular for one block', () => {
    const [digest] = ofKind(build({ sessions: [makeSession()] }, MONDAY_MORNING), 'dagoverzicht');
    expect(digest.title).toBe('Vandaag: 1 blok (30 min)');
    expect(digest.body).toBe('Biologie.');
  });

  it('is also sent on a day with only an exam', () => {
    const fixture: Fixture = {
      exams: [
        makeExam({ time: '10:30' }),
        makeExam({ id: 'ex-eng', subjectId: 'eng', kind: 'presentatie', date: '2026-11-20' }),
      ],
    };
    const digests = ofKind(build(fixture, MONDAY_AFTERNOON), 'dagoverzicht');

    expect(digests.map((r) => r.id)).toEqual([`dagoverzicht:${THURSDAY}`, 'dagoverzicht:2026-11-20']);
    expect(digests[0].title).toBe('Vandaag: toets Biologie (10:30)');
    expect(digests[0].body).toBe('Geen blokken gepland. Morgen: presentatie Engels.');
    expect(digests[1].title).toBe('Vandaag: presentatie Engels');
    expect(digests[1].body).toBe('Geen blokken gepland.');
  });

  it('skips days without blocks or exams, and is off when no time is set', () => {
    const sessions = [makeSession({ date: TUESDAY })];
    const on = ofKind(build({ sessions }, MONDAY_AFTERNOON), 'dagoverzicht');
    const off = ofKind(build({ sessions, notifications: { dailyDigestTime: null } }, MONDAY_AFTERNOON), 'dagoverzicht');

    expect(on.map((r) => r.id)).toEqual([`dagoverzicht:${TUESDAY}`, `dagoverzicht:${THURSDAY}`]);
    expect(off).toEqual([]);
  });

  it('follows the chosen time', () => {
    const fixture: Fixture = { sessions: [makeSession({ date: TUESDAY })], notifications: { dailyDigestTime: '06:45' } };
    const [digest] = ofKind(build(fixture, MONDAY_AFTERNOON), 'dagoverzicht');
    expect(digest.at).toBe(iso(TUESDAY, '06:45'));
  });
});

describe('exam reminders', () => {
  it('counts down on the chosen days, at the time of the daily overview', () => {
    const sessions = [
      makeSession({ date: MONDAY }),
      makeSession({ date: TUESDAY }),
      makeSession({ date: WEDNESDAY, start: '16:00' }),
      makeSession({ date: WEDNESDAY, start: '16:40' }),
    ];
    const fixture: Fixture = { exams: [makeExam({ time: '10:30' })], sessions };
    const countdown = ofKind(build(fixture, MONDAY_MORNING), 'toets').filter((r) => !r.id.endsWith('succes'));

    // 7 days before is already in the past; 3 and 1 remain.
    expect(countdown).toEqual([
      {
        id: `toets:ex-bio:${THURSDAY}:3`,
        at: iso(MONDAY, '07:30'),
        kind: 'toets',
        title: 'Over 3 dagen: toets Biologie',
        body: 'Hoofdstuk 3 en 4 · donderdag 19 november om 10:30. Nog 4 blokken te gaan.',
        link: '#/toetsen/ex-bio',
      },
      {
        id: `toets:ex-bio:${THURSDAY}:1`,
        at: iso(WEDNESDAY, '07:30'),
        kind: 'toets',
        title: 'Morgen: toets Biologie',
        body: 'Hoofdstuk 3 en 4 · donderdag 19 november om 10:30. Nog 2 blokken te gaan.',
        link: '#/toetsen/ex-bio',
      },
    ]);
  });

  it('counts down at 16:00 when the daily overview is off', () => {
    const fixture: Fixture = { notifications: { dailyDigestTime: null, examDaysBefore: [2] } };
    const [reminder] = ofKind(build(fixture, MONDAY_MORNING), 'toets');

    expect(reminder.at).toBe(iso(TUESDAY, '16:00'));
    expect(reminder.title).toBe('Overmorgen: toets Biologie');
    expect(reminder.body).toBe('Hoofdstuk 3 en 4 · donderdag 19 november.');
  });

  it('says so when every block is done and uses the singular for one open block', () => {
    const body = (sessions: StudySession[]) =>
      ofKind(build({ sessions, notifications: { examDaysBefore: [1] } }, MONDAY_MORNING), 'toets')[0].body;

    expect(body([makeSession({ status: 'gedaan' })])).toBe(
      'Hoofdstuk 3 en 4 · donderdag 19 november. Al je blokken zijn af. Goed bezig!',
    );
    expect(body([makeSession({ date: WEDNESDAY })])).toBe(
      'Hoofdstuk 3 en 4 · donderdag 19 november. Nog 1 blok te gaan.',
    );
    // Open blocks before the reminder day are neither "to go" nor "all done".
    expect(body([makeSession({ date: MONDAY }), makeSession({ date: TUESDAY, status: 'gedaan' })])).toBe(
      'Hoofdstuk 3 en 4 · donderdag 19 november.',
    );
  });

  it('ignores duplicate, zero and negative day counts and is off for an empty list', () => {
    const ids = (examDaysBefore: number[]) =>
      ofKind(build({ notifications: { examDaysBefore } }, MONDAY_MORNING), 'toets').map((r) => r.id);

    expect(ids([1, 1, 0, -2, 1.5])).toEqual([`toets:ex-bio:${THURSDAY}:1`, `toets:ex-bio:${THURSDAY}:succes`]);
    expect(ids([])).toEqual([`toets:ex-bio:${THURSDAY}:succes`]);
  });

  it('wishes good luck an hour before an exam with a start time', () => {
    const fixture: Fixture = { exams: [makeExam({ time: '10:30', location: 'lokaal 12' })] };
    const reminder = build(fixture, MONDAY_AFTERNOON).find((r) => r.id.endsWith('succes'));

    expect(reminder).toEqual({
      id: `toets:ex-bio:${THURSDAY}:succes`,
      at: iso(THURSDAY, '09:30'),
      kind: 'toets',
      title: 'Succes vandaag met Biologie!',
      body: 'Hoofdstuk 3 en 4 om 10:30 (lokaal 12). Je kunt het!',
      link: '#/toetsen/ex-bio',
    });
  });

  it('wishes good luck at 07:30 for an exam without a start time', () => {
    const reminder = build({}, MONDAY_AFTERNOON).find((r) => r.id.endsWith('succes'));

    expect(reminder?.at).toBe(iso(THURSDAY, '07:30'));
    expect(reminder?.body).toBe('Hoofdstuk 3 en 4. Je kunt het!');
  });

  it('never wishes good luck on the day before, however early the exam starts', () => {
    const fixture: Fixture = { exams: [makeExam({ time: '00:30' })] };
    const reminder = build(fixture, toDateTime(WEDNESDAY, '20:00')).find((r) => r.id.endsWith('succes'));

    expect(reminder?.title).toBe('Succes vandaag met Biologie!');
    expect(reminder?.at).toBe(iso(THURSDAY, '00:00'));
  });

  it('words a hand-in deadline differently', () => {
    const fixture: Fixture = { exams: [makeExam({ kind: 'deadline', title: 'Boekverslag', time: '17:00' })] };
    const reminders = ofKind(build(fixture, MONDAY_MORNING), 'toets');

    expect(reminders[0].title).toBe('Over 3 dagen: inleveropdracht Biologie');
    expect(reminders[2].title).toBe('Vandaag inleveren: Biologie');
    expect(reminders[2].body).toBe('Boekverslag om 17:00. Succes met de laatste loodjes!');
  });

  it('gets a new id when the exam moves to another date', () => {
    const idsFor = (date: string) =>
      ofKind(build({ exams: [makeExam({ date })] }, MONDAY_MORNING), 'toets').map((r) => r.id);
    const moved = idsFor('2026-11-20');

    expect(moved).toHaveLength(3);
    expect(moved.filter((id) => idsFor(THURSDAY).includes(id))).toEqual([]);
  });
});

describe('evening check', () => {
  it('mentions the blocks that are still open that day', () => {
    const maths = makeExam({ id: 'ex-wis', subjectId: 'wis', date: '2026-11-27' });
    const sessions = [
      makeSession({ start: '16:00' }),
      makeSession({ start: '16:40', examId: 'ex-wis' }),
      makeSession({ start: '17:20', status: 'gedaan' }),
    ];
    const [check] = ofKind(build({ exams: [makeExam(), maths], sessions }, MONDAY_AFTERNOON), 'avondcheck');

    expect(check).toEqual({
      id: `avondcheck:${MONDAY}`,
      at: iso(MONDAY, '20:30'),
      kind: 'avondcheck',
      title: 'Je hebt vandaag nog 2 blokken open staan',
      body: 'Biologie en Wiskunde (1 uur). Nog even doen of liever verplaatsen? Allebei prima.',
      link: `#/agenda/${MONDAY}`,
    });
  });

  it('uses the singular for one block', () => {
    const [check] = ofKind(build({ sessions: [makeSession()] }, MONDAY_AFTERNOON), 'avondcheck');
    expect(check.title).toBe('Je hebt vandaag nog 1 blok open staan');
  });

  it('stays quiet when everything is done, and for blocks that start after the check', () => {
    const done = [makeSession({ status: 'gedaan' }), makeSession({ start: '16:40', status: 'overgeslagen' })];
    const late = [makeSession({ start: '20:30' }), makeSession({ start: '21:00' })];

    expect(ofKind(build({ sessions: done }, MONDAY_AFTERNOON), 'avondcheck')).toEqual([]);
    expect(ofKind(build({ sessions: late }, MONDAY_AFTERNOON), 'avondcheck')).toEqual([]);
  });

  it('is off when no time is set', () => {
    const fixture: Fixture = { sessions: [makeSession()], notifications: { eveningCheckTime: null } };
    expect(ofKind(build(fixture, MONDAY_AFTERNOON), 'avondcheck')).toEqual([]);
  });
});

describe('length of the texts', () => {
  it('cuts off titles and bodies that would get too long, without splitting a character', () => {
    const long = (word: string) => `${word} 🎓`.repeat(400);
    const exam = makeExam({
      title: long('Hoofdstuk'),
      location: long('Lokaal'),
      time: '10:30',
      topics: [
        { id: 't1', title: long('Celdeling'), estMinutes: 60, difficulty: 2, mastered: false },
        { id: 't2', title: long('Mitose'), estMinutes: 30, difficulty: 2, mastered: false },
      ],
    });
    const data = makeData({ exams: [exam], sessions: [makeSession(), makeSession({ date: WEDNESDAY })] });
    data.subjects = [{ id: 'bio', name: long('Biologie'), color: 'green' }];
    const reminders = buildReminders({ data, now: MONDAY_MORNING });

    expect(new Set(reminders.map((r) => r.kind))).toEqual(new Set(['sessie', 'dagoverzicht', 'toets', 'avondcheck']));
    for (const { title, body } of reminders) {
      expect([...title].length).toBeLessThanOrEqual(80);
      expect([...body].length).toBeLessThanOrEqual(240);
      // Throws on half of a surrogate pair.
      expect(() => encodeURIComponent(title + body)).not.toThrow();
    }
    const [study] = ofKind(reminders, 'sessie');
    expect(study.title.startsWith('Tijd om te leren: Biologie 🎓')).toBe(true);
    expect(study.title.endsWith('…')).toBe(true);
    expect(study.body.startsWith('16:00 · 30 min · Samenvatten · Celdeling 🎓')).toBe(true);
    expect(study.body.endsWith('…')).toBe(true);
  });

  it('leaves texts of a normal length alone', () => {
    const exam = makeExam({ title: 'Hoofdstuk 3 tot en met 7, inclusief de stencils van de docent', time: '10:30' });
    const data = makeData({ exams: [exam], sessions: [makeSession()] });
    data.subjects = [{ id: 'bio', name: 'Maatschappijwetenschappen', color: 'green' }];
    const reminders = buildReminders({ data, now: MONDAY_MORNING });

    expect(reminders.length).toBeGreaterThan(4);
    expect(reminders.some((r) => (r.title + r.body).includes('…'))).toBe(false);
  });
});

describe('time window', () => {
  // One block at 16:00 with a lead of 10 minutes: the reminder is due at 15:50.
  const fixture: Fixture = {
    sessions: [makeSession()],
    notifications: { dailyDigestTime: null, eveningCheckTime: null, examDaysBefore: [] },
  };
  const dueAt = toDateTime(MONDAY, '15:50').getTime();
  const sessionIds = (now: number, options?: { horizonDays?: number; graceMinutes?: number }) =>
    ofKind(build(fixture, new Date(now), options), 'sessie').map((r) => r.id);

  it('keeps a missed reminder for 90 minutes by default', () => {
    expect(sessionIds(dueAt + 90 * 60_000)).toHaveLength(1);
    expect(sessionIds(dueAt + 90 * 60_000 + 1)).toHaveLength(0);
  });

  it('honours a custom grace period', () => {
    expect(sessionIds(dueAt + 1, { graceMinutes: 0 })).toHaveLength(0);
    expect(sessionIds(dueAt, { graceMinutes: 0 })).toHaveLength(1);
    expect(sessionIds(dueAt + 6 * 3_600_000, { graceMinutes: 12 * 60 })).toHaveLength(1);
  });

  it('looks 14 days ahead by default', () => {
    const day = 86_400_000;
    expect(sessionIds(dueAt - 14 * day)).toHaveLength(1);
    expect(sessionIds(dueAt - 14 * day - 1)).toHaveLength(0);
  });

  it('honours a custom horizon', () => {
    const day = 86_400_000;
    expect(sessionIds(dueAt - 2 * day, { horizonDays: 2 })).toHaveLength(1);
    expect(sessionIds(dueAt - 2 * day - 1, { horizonDays: 2 })).toHaveLength(0);
    expect(sessionIds(dueAt - 20 * day, { horizonDays: 30 })).toHaveLength(1);
  });

  it('includes per-day reminders of the first and last day of the window', () => {
    const lastDay = addDays(MONDAY, 14);
    const sessions = [makeSession({ date: MONDAY, start: '06:00' }), makeSession({ date: lastDay, start: '06:00' })];
    const digests = ofKind(build({ exams: [makeExam({ date: '2026-12-20' })], sessions }, toDateTime(MONDAY, '08:00')), 'dagoverzicht');

    expect(digests.map((r) => r.id)).toEqual([`dagoverzicht:${MONDAY}`, `dagoverzicht:${lastDay}`]);
  });
});

describe('properties', () => {
  const sessionArb = fc.record({
    dayOffset: fc.integer({ min: -3, max: 20 }),
    startMinutes: fc.integer({ min: 0, max: 23 * 60 }),
    minutes: fc.constantFrom(20, 25, 30, 45, 60),
    examId: fc.constantFrom('ex-bio', 'ex-wis'),
    status: fc.constantFrom<StudySession['status']>('gepland', 'gedaan', 'overgeslagen'),
  });

  it('always returns unique ids, sorted, inside the window, however the plan looks', () => {
    fc.assert(
      fc.property(fc.array(sessionArb, { maxLength: 40 }), fc.integer({ min: 0, max: 1439 }), (specs, nowMinutes) => {
        const sessions = specs.map((spec) =>
          makeSession({
            examId: spec.examId,
            date: addDays(MONDAY, spec.dayOffset),
            start: formatTime(spec.startMinutes),
            minutes: spec.minutes,
            status: spec.status,
          }),
        );
        const exams = [makeExam(), makeExam({ id: 'ex-wis', subjectId: 'wis', date: '2026-11-24', time: '09:00' })];
        const now = toDateTime(MONDAY, formatTime(nowMinutes));
        const reminders = build({ exams, sessions }, now);
        const times = reminders.map((r) => Date.parse(r.at));

        expect(new Set(reminders.map((r) => r.id)).size).toBe(reminders.length);
        expect(times).toEqual([...times].sort((a, b) => a - b));
        for (const time of times) {
          expect(time).toBeGreaterThanOrEqual(now.getTime() - 90 * 60_000);
          expect(time).toBeLessThanOrEqual(now.getTime() + 14 * 86_400_000);
        }
        // At most one study reminder per planned block.
        const planned = sessions.filter((s) => s.status === 'gepland').length;
        expect(ofKind(reminders, 'sessie').length).toBeLessThanOrEqual(planned);
        expect(buildReminders({ data: makeData({ exams, sessions }), now })).toEqual(reminders);
      }),
    );
  });
});
