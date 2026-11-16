import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { UserData } from '../../types';
import { DEFAULT_PREFS, createEmptyUserData } from '../defaults';
import { sanitizePrefs, sanitizeUserData } from './sanitize';

const NOW = '2026-11-16T14:30:00.000Z';

function validData(): UserData {
  return {
    version: 1,
    onboarded: true,
    subjects: [
      { id: 'sub-1', name: 'Biologie', color: 'green' },
      { id: 'sub-2', name: 'Wiskunde', color: 'blue' },
    ],
    exams: [
      {
        id: 'exam-1',
        subjectId: 'sub-1',
        title: 'Celdeling',
        kind: 'so',
        date: '2026-11-27',
        time: '09:15',
        location: 'Lokaal 12',
        weight: 2,
        notes: 'Ook de practicumvragen',
        grade: 7.4,
        topics: [
          { id: 'top-1', title: 'Mitose', estMinutes: 45, difficulty: 3, mastered: false },
          {
            id: 'top-2',
            title: 'Meiose',
            notes: 'Blz. 40-52',
            estMinutes: 30,
            difficulty: 1,
            mastered: true,
          },
        ],
        attachments: [
          {
            id: 'att-1',
            name: 'studiewijzer.pdf',
            mime: 'application/pdf',
            size: 1234,
            addedAt: '2026-11-10T08:00:00.000Z',
          },
        ],
        createdAt: '2026-11-10T08:00:00.000Z',
        updatedAt: '2026-11-12T08:00:00.000Z',
      },
    ],
    sessions: [
      {
        id: 'ses-1',
        examId: 'exam-1',
        parts: [{ topicId: 'top-1', minutes: 30 }],
        date: '2026-11-16',
        start: '16:00',
        minutes: 30,
        kind: 'leren',
        method: 'flashcards',
        status: 'gedaan',
        pinned: true,
        completedAt: '2026-11-16T15:31:00.000Z',
      },
      {
        id: 'ses-2',
        examId: 'exam-1',
        parts: [],
        date: '2026-11-17',
        start: '16:00',
        minutes: 22.5,
        kind: 'eindherhaling',
        method: 'overhoren',
        status: 'gepland',
        pinned: false,
      },
    ],
    warnings: [
      { type: 'te-weinig-tijd', examId: 'exam-1', missingMinutes: 40 },
      { type: 'geen-leerstof', examId: 'exam-1' },
    ],
    prefs: {
      minutesPerWeekday: [60, 0, 60, 0, 60, 120, 0],
      sessionMinutes: 45,
      breakMinutes: 5,
      weekdayStart: '15:30',
      weekendStart: '11:00',
      methods: ['oefenen', 'lezen'],
      planStyle: 'vroeg',
      leadDays: 14,
      notifications: {
        enabled: true,
        sessionLeadMinutes: null,
        dailyDigestTime: null,
        examDaysBefore: [5, 2],
        eveningCheckTime: '21:00',
      },
    },
    blockedDates: ['2026-11-20', '2026-12-25'],
    inbox: [
      {
        id: 'in-2',
        at: '2026-11-16T07:30:00.000Z',
        kind: 'dagoverzicht',
        title: 'Vandaag: 2 blokken',
        body: 'Succes!',
        link: '#/agenda',
        read: false,
      },
      {
        id: 'in-1',
        at: '2026-11-15T19:30:00.000Z',
        kind: 'toets',
        title: 'Nog 12 dagen',
        body: '',
        read: true,
      },
    ],
  };
}

describe('sanitizeUserData', () => {
  it('returns valid data unchanged', () => {
    expect(sanitizeUserData(validData(), NOW)).toStrictEqual(validData());
  });

  it('survives a JSON round trip of valid data unchanged', () => {
    const stored = JSON.parse(JSON.stringify(validData())) as unknown;
    expect(sanitizeUserData(stored, NOW)).toStrictEqual(validData());
  });

  it.each([null, undefined, 'tekst', 42, true, [], [validData()]])(
    'gives empty data for %j',
    (raw) => {
      expect(sanitizeUserData(raw, NOW)).toStrictEqual(createEmptyUserData());
    },
  );

  it('fills everything that is missing with defaults', () => {
    const data = sanitizeUserData({}, NOW);
    expect(data).toStrictEqual(createEmptyUserData());
    expect(data.prefs).not.toBe(DEFAULT_PREFS);
    expect(data.prefs.methods).not.toBe(DEFAULT_PREFS.methods);
    expect(data.prefs.notifications.examDaysBefore).not.toBe(
      DEFAULT_PREFS.notifications.examDaysBefore,
    );
  });

  it('always keeps version 1, whatever was stored', () => {
    expect(sanitizeUserData({ version: 0 }, NOW).version).toBe(1);
    expect(sanitizeUserData({ version: '7' }, NOW).version).toBe(1);
  });

  it('repairs fields of the wrong type', () => {
    const data = sanitizeUserData(
      {
        onboarded: 'ja',
        subjects: 'geen',
        exams: { a: 1 },
        sessions: null,
        warnings: 3,
        prefs: 'x',
        blockedDates: {},
        inbox: false,
      },
      NOW,
    );
    expect(data).toStrictEqual(createEmptyUserData());
  });

  it('drops subjects without id or name and repairs an unknown colour', () => {
    const data = sanitizeUserData(
      {
        subjects: [
          { id: 'a', name: '  Frans  ', color: 'neon' },
          { id: '', name: 'Zonder id' },
          { id: 'b', name: '   ' },
          { id: 'a', name: 'Dubbel id', color: 'red' },
          'kapot',
          null,
        ],
      },
      NOW,
    );
    expect(data.subjects).toStrictEqual([{ id: 'a', name: 'Frans', color: 'gray' }]);
  });

  it('drops exams that cannot be shown and repairs the rest', () => {
    const data = sanitizeUserData(
      {
        subjects: [{ id: 'sub', name: 'Frans', color: 'pink' }],
        exams: [
          { id: 'ok', subjectId: 'sub', title: ' Woordjes ', date: '2026-12-01' },
          { id: 'no-subject', subjectId: 'weg', title: 'X', date: '2026-12-01' },
          { id: 'bad-date', subjectId: 'sub', title: 'X', date: '2026-02-30' },
          { id: 'no-title', subjectId: 'sub', title: '', date: '2026-12-01' },
          { subjectId: 'sub', title: 'Zonder id', date: '2026-12-01' },
          {
            id: 'messy',
            subjectId: 'sub',
            title: 'Rommelig',
            kind: 'quiz',
            date: '2026-12-02',
            time: '25:00',
            location: 7,
            weight: -1,
            notes: '   ',
            grade: 11,
            topics: [
              { id: 't1', title: 'Goed', estMinutes: 20, difficulty: 3, mastered: true },
              { id: 't2', title: 'Half', estMinutes: 'veel', difficulty: 9, mastered: 'ja' },
              { id: 't1', title: 'Dubbel' },
              { title: 'Zonder id' },
              { id: 't3', title: '' },
              42,
            ],
            attachments: [
              { id: 'f1', name: 'foto.jpg', mime: 'image/jpeg', size: 10, addedAt: 'gisteren' },
              { id: 'f2' },
              { name: 'zonder id' },
            ],
            createdAt: 'ooit',
            updatedAt: 12,
          },
        ],
      },
      NOW,
    );

    expect(data.exams.map((exam) => exam.id)).toStrictEqual(['ok', 'messy']);
    expect(data.exams[0]).toStrictEqual({
      id: 'ok',
      subjectId: 'sub',
      title: 'Woordjes',
      kind: 'toets',
      date: '2026-12-01',
      topics: [],
      attachments: [],
      createdAt: NOW,
      updatedAt: NOW,
    });
    expect(data.exams[1]).toStrictEqual({
      id: 'messy',
      subjectId: 'sub',
      title: 'Rommelig',
      kind: 'toets',
      date: '2026-12-02',
      topics: [
        { id: 't1', title: 'Goed', estMinutes: 20, difficulty: 3, mastered: true },
        { id: 't2', title: 'Half', estMinutes: 30, difficulty: 2, mastered: false },
      ],
      attachments: [
        { id: 'f1', name: 'foto.jpg', mime: 'image/jpeg', size: 10, addedAt: NOW },
        { id: 'f2', name: 'Bijlage', mime: 'application/octet-stream', size: 0, addedAt: NOW },
      ],
      createdAt: NOW,
      updatedAt: NOW,
    });
  });

  it('drops sessions and warnings of exams that do not exist, and repairs the rest', () => {
    const data = sanitizeUserData(
      {
        subjects: [{ id: 'sub', name: 'Frans', color: 'pink' }],
        exams: [{ id: 'exam', subjectId: 'sub', title: 'Woordjes', date: '2026-12-01' }],
        prefs: { methods: ['mindmap'] },
        sessions: [
          {
            id: 's1',
            examId: 'exam',
            parts: [{ topicId: 't', minutes: 20 }, { topicId: '', minutes: 5 }, { minutes: 5 }, 3],
            date: '2026-11-20',
            start: '16:00',
            minutes: 20,
            kind: 'stampen',
            method: 'zingen',
            status: 'klaar',
            pinned: 1,
            completedAt: 'nooit',
          },
          { id: 's2', examId: 'weg', date: '2026-11-20', start: '16:00', minutes: 20 },
          { id: 's3', examId: 'exam', date: '20 november', start: '16:00', minutes: 20 },
          { id: 's4', examId: 'exam', date: '2026-11-20', start: '4 uur', minutes: 20 },
          { id: 's5', examId: 'exam', date: '2026-11-20', start: '16:00', minutes: 0 },
          { id: 's1', examId: 'exam', date: '2026-11-21', start: '16:00', minutes: 20 },
        ],
        warnings: [
          { type: 'geen-leerstof', examId: 'exam' },
          { type: 'geen-leerstof', examId: 'weg' },
          { type: 'te-weinig-tijd', examId: 'exam', missingMinutes: 'veel' },
          { type: 'onbekend', examId: 'exam' },
          null,
        ],
      },
      NOW,
    );

    expect(data.sessions).toStrictEqual([
      {
        id: 's1',
        examId: 'exam',
        parts: [{ topicId: 't', minutes: 20 }],
        date: '2026-11-20',
        start: '16:00',
        minutes: 20,
        kind: 'leren',
        method: 'mindmap',
        status: 'gepland',
        pinned: false,
      },
    ]);
    expect(data.warnings).toStrictEqual([{ type: 'geen-leerstof', examId: 'exam' }]);
  });

  it('keeps valid blocked dates once, in order', () => {
    const data = sanitizeUserData(
      { blockedDates: ['2026-12-25', 'kerst', '2026-11-20', '2026-12-25', 5, '2026-13-01'] },
      NOW,
    );
    expect(data.blockedDates).toStrictEqual(['2026-11-20', '2026-12-25']);
  });

  it('keeps the newest 100 valid inbox items, newest first', () => {
    const items = Array.from({ length: 130 }, (_, index) => ({
      id: `item-${index}`,
      at: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
      kind: 'sessie',
      title: `Melding ${index}`,
      body: 'x',
      read: false,
    }));
    const data = sanitizeUserData(
      {
        inbox: [
          ...items,
          { id: 'item-5', at: NOW, kind: 'sessie', title: 'Dubbel id', body: '', read: true },
          { id: 'no-date', at: 'straks', title: 'X' },
          { id: 'no-title', at: NOW },
          { id: 'odd', at: '2027-01-01T10:00:00+01:00', kind: 'reclame', title: 'Ander', body: 7 },
        ],
      },
      NOW,
    );
    expect(data.inbox).toHaveLength(100);
    expect(data.inbox[0]).toStrictEqual({
      id: 'odd',
      at: '2027-01-01T09:00:00.000Z',
      kind: 'systeem',
      title: 'Ander',
      body: '',
      read: false,
    });
    expect(data.inbox[1].id).toBe('item-129');
    expect(data.inbox[99].id).toBe('item-31');
  });

  it('merges subjects with the same name (ignoring case) and moves their exams to the one that stays', () => {
    const exam = (id: string, subjectId: string) => ({
      id,
      subjectId,
      title: `Toets ${id}`,
      date: '2026-12-01',
    });
    const data = sanitizeUserData(
      {
        subjects: [
          { id: 'a', name: 'Biologie', color: 'green' },
          { id: 'b', name: 'Frans', color: 'pink' },
          { id: 'c', name: ' BIOLOGIE ', color: 'red' },
          { id: 'd', name: 'biologie', color: 'blue' },
        ],
        exams: [exam('e1', 'a'), exam('e2', 'c'), exam('e3', 'b'), exam('e4', 'd'), exam('e5', 'x')],
      },
      NOW,
    );

    expect(data.subjects).toStrictEqual([
      { id: 'a', name: 'Biologie', color: 'green' },
      { id: 'b', name: 'Frans', color: 'pink' },
    ]);
    expect(data.exams.map(({ id, subjectId }) => [id, subjectId])).toStrictEqual([
      ['e1', 'a'],
      ['e2', 'a'],
      ['e3', 'b'],
      ['e4', 'a'],
    ]);
  });

  it('lets one attachment belong to one exam only: the first that names it', () => {
    const file = (id: string) => ({ id, name: `${id}.pdf`, mime: 'application/pdf', size: 1, addedAt: NOW });
    const exam = (id: string, attachments: unknown[]) => ({
      id,
      subjectId: 'sub',
      title: `Toets ${id}`,
      date: '2026-12-01',
      attachments,
    });
    const data = sanitizeUserData(
      {
        subjects: [{ id: 'sub', name: 'Frans', color: 'pink' }],
        exams: [
          exam('e1', [file('f1'), file('f2'), file('f1')]),
          exam('e2', [file('f2'), file('f3')]),
          exam('e3', [file('f1'), file('f3')]),
        ],
      },
      NOW,
    );

    expect(data.exams.map((item) => item.attachments.map((attachment) => attachment.id))).toStrictEqual([
      ['f1', 'f2'],
      ['f3'],
      [],
    ]);
  });

  it('drops blocks and parts that last longer than a day', () => {
    const block = (id: string, minutes: unknown, parts: unknown[] = []) => ({
      id,
      examId: 'exam',
      parts,
      date: '2026-11-20',
      start: '16:00',
      minutes,
    });
    const data = sanitizeUserData(
      {
        subjects: [{ id: 'sub', name: 'Frans', color: 'pink' }],
        exams: [{ id: 'exam', subjectId: 'sub', title: 'Woordjes', date: '2026-12-01' }],
        sessions: [
          block('dag', 1440),
          block('te-lang', 1441),
          block('absurd', 1e300),
          block('oneindig', Number.POSITIVE_INFINITY),
          block('delen', 30, [
            { topicId: 't1', minutes: 30 },
            { topicId: 't2', minutes: 1e300 },
          ]),
        ],
      },
      NOW,
    );

    expect(data.sessions.map(({ id, minutes, parts }) => ({ id, minutes, parts }))).toStrictEqual([
      { id: 'dag', minutes: 1440, parts: [] },
      { id: 'delen', minutes: 30, parts: [{ topicId: 't1', minutes: 30 }] },
    ]);
  });

  it('keeps the link of an inbox item only when it is an in-app link', () => {
    const item = (id: string, link: unknown) => ({ id, at: NOW, kind: 'toets', title: id, body: '', link });
    const data = sanitizeUserData(
      {
        inbox: [
          item('a', '#/toetsen/exam-1'),
          item('b', 'javascript:alert(document.cookie)'),
          item('c', 'https://evil.example/#/toetsen'),
          item('d', '//evil.example'),
          item('e', ' #/agenda '),
          item('f', 42),
        ],
      },
      NOW,
    );

    expect(Object.fromEntries(data.inbox.map(({ id, link }) => [id, link]))).toStrictEqual({
      a: '#/toetsen/exam-1',
      b: undefined,
      c: undefined,
      d: undefined,
      e: '#/agenda',
      f: undefined,
    });
  });

  it('is not fooled by "__proto__" keys in stored JSON', () => {
    const raw = JSON.parse(
      '{"__proto__":{"onboarded":true},"subjects":[{"__proto__":{"color":"red"},"id":"s","name":"Frans"}],' +
        '"prefs":{"__proto__":{"sessionMinutes":99},"notifications":{"__proto__":{"enabled":true}}}}',
    ) as unknown;

    const data = sanitizeUserData(raw, NOW);

    expect(data).toStrictEqual({
      ...createEmptyUserData(),
      subjects: [{ id: 's', name: 'Frans', color: 'gray' }],
    });
    expect(Object.getPrototypeOf(data.subjects[0])).toBe(Object.prototype);
    expect(({} as { onboarded?: unknown }).onboarded).toBeUndefined();
  });

  it('never throws and is stable for any JSON value', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (raw) => {
        const once = sanitizeUserData(raw, NOW);
        expect(once.version).toBe(1);
        expect(once.prefs.methods.length).toBeGreaterThan(0);
        expect(sanitizeUserData(JSON.parse(JSON.stringify(once)), NOW)).toStrictEqual(once);
      }),
    );
  });

  it('never throws and is stable for damaged versions of real data', () => {
    const damage = fc.oneof(
      fc.constant(null),
      fc.constant(undefined),
      fc.string(),
      fc.double(),
      fc.boolean(),
      fc.array(fc.jsonValue(), { maxLength: 3 }),
      fc.dictionary(fc.string(), fc.jsonValue(), { maxKeys: 3 }),
    );
    const paths: string[][] = [];
    const collect = (value: unknown, path: string[]) => {
      if (typeof value !== 'object' || value === null) return;
      for (const [key, child] of Object.entries(value)) {
        paths.push([...path, key]);
        collect(child, [...path, key]);
      }
    };
    collect(validData(), []);

    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.constantFrom(...paths), damage), { minLength: 1, maxLength: 6 }),
        (changes) => {
          const raw = validData() as unknown as Record<string, unknown>;
          for (const [path, value] of changes) {
            let target: unknown = raw;
            for (const key of path.slice(0, -1)) {
              target = (target as Record<string, unknown> | null | undefined)?.[key];
            }
            if (typeof target === 'object' && target !== null) {
              (target as Record<string, unknown>)[path[path.length - 1]] = value;
            }
          }
          const once = sanitizeUserData(raw, NOW);
          const examIds = new Set(once.exams.map((exam) => exam.id));
          const subjectIds = new Set(once.subjects.map((subject) => subject.id));
          expect(once.exams.every((exam) => subjectIds.has(exam.subjectId))).toBe(true);
          expect(once.sessions.every((session) => examIds.has(session.examId))).toBe(true);
          expect(once.warnings.every((warning) => examIds.has(warning.examId))).toBe(true);
          expect(once.prefs.minutesPerWeekday).toHaveLength(7);
          expect(sanitizeUserData(JSON.parse(JSON.stringify(once)), NOW)).toStrictEqual(once);
        },
      ),
    );
  });
});

describe('sanitizePrefs', () => {
  it('keeps valid values and takes every invalid one from the fallback', () => {
    const prefs = sanitizePrefs({
      minutesPerWeekday: [30, -5, 'veel', 2000, 45.4],
      sessionMinutes: 0,
      breakMinutes: 15,
      weekdayStart: '7 uur',
      weekendStart: '09:30',
      methods: ['lezen', 'dansen', 'lezen', 'mindmap'],
      planStyle: 'chaotisch',
      leadDays: 0,
      notifications: {
        enabled: 'aan',
        sessionLeadMinutes: -1,
        dailyDigestTime: null,
        examDaysBefore: [1, 7, 7, 'x', -2, 3.2],
        eveningCheckTime: '99:99',
      },
    });
    expect(prefs).toStrictEqual({
      minutesPerWeekday: [30, 90, 90, 90, 45, 120, 90],
      sessionMinutes: DEFAULT_PREFS.sessionMinutes,
      breakMinutes: 15,
      weekdayStart: DEFAULT_PREFS.weekdayStart,
      weekendStart: '09:30',
      methods: ['lezen', 'mindmap'],
      planStyle: DEFAULT_PREFS.planStyle,
      leadDays: DEFAULT_PREFS.leadDays,
      notifications: {
        enabled: false,
        sessionLeadMinutes: DEFAULT_PREFS.notifications.sessionLeadMinutes,
        dailyDigestTime: null,
        examDaysBefore: [7, 3, 1],
        eveningCheckTime: DEFAULT_PREFS.notifications.eveningCheckTime,
      },
    });
  });

  it('stores a rounded-down negative fraction as a plain zero', () => {
    const prefs = sanitizePrefs({
      breakMinutes: -0.2,
      minutesPerWeekday: [-0, -0.4, 0, 0, 0, 0, 0],
      notifications: { sessionLeadMinutes: -0.1, examDaysBefore: [-0.3] },
    });
    expect(Object.is(prefs.breakMinutes, 0)).toBe(true);
    expect(prefs.minutesPerWeekday.every((minutes) => Object.is(minutes, 0))).toBe(true);
    expect(Object.is(prefs.notifications.sessionLeadMinutes, 0)).toBe(true);
    expect(Object.is(prefs.notifications.examDaysBefore[0], 0)).toBe(true);
  });

  it('never leaves the study methods empty and accepts "no reminders"', () => {
    const prefs = sanitizePrefs({
      methods: [],
      notifications: { examDaysBefore: [], sessionLeadMinutes: null, eveningCheckTime: null },
    });
    expect(prefs.methods).toStrictEqual(DEFAULT_PREFS.methods);
    expect(prefs.notifications.examDaysBefore).toStrictEqual([]);
    expect(prefs.notifications.sessionLeadMinutes).toBeNull();
    expect(prefs.notifications.eveningCheckTime).toBeNull();
  });
});
