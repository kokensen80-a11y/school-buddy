import { IDBObjectStore } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Exam, InboxItem, PlanResult, StudySession, UserData } from '../../types';
import { DEFAULT_PREFS } from '../defaults';
import { MESSAGES } from './messages';
import {
  NOW,
  NOW_MINUTES,
  TODAY,
  addSampleExam,
  disposeHarnesses,
  examDraft,
  fakePlan,
  fillStorage,
  resetBrowserStorage,
  signedInHarness,
  storedAttachmentIds,
  type Harness,
} from './testSupport';
import type { Result } from './types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const NOW_ISO = NOW.toISOString();
const LATER = new Date(2026, 10, 17, 9, 0);
const LATER_ISO = LATER.toISOString();

const dataOf = ({ store }: Harness): UserData => {
  const { data } = store.getState();
  if (!data) throw new Error('Expected a signed-in store.');
  return data;
};

const inboxItem = (id: string, at: string, overrides: Partial<InboxItem> = {}): InboxItem => ({
  id,
  at,
  kind: 'sessie',
  title: `Melding ${id}`,
  body: 'Tijd om te leren',
  read: false,
  ...overrides,
});

beforeEach(resetBrowserStorage);
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  disposeHarnesses();
});

describe('preferences', () => {
  it('merges a patch into the preferences, notifications field by field', async () => {
    const harness = await signedInHarness();

    const result = await harness.actions.updatePrefs({
      sessionMinutes: 45,
      minutesPerWeekday: [0, 60, 60, 60, 60, 0, 0],
      notifications: { enabled: true, dailyDigestTime: null },
    });

    expect(result).toStrictEqual({ ok: true });
    expect(dataOf(harness).prefs).toStrictEqual({
      ...DEFAULT_PREFS,
      sessionMinutes: 45,
      minutesPerWeekday: [0, 60, 60, 60, 60, 0, 0],
      notifications: { ...DEFAULT_PREFS.notifications, enabled: true, dailyDigestTime: null },
    });
  });

  it('keeps the current value where the patch is invalid', async () => {
    const harness = await signedInHarness();
    await harness.actions.updatePrefs({ methods: ['lezen'], leadDays: 21 });

    await harness.actions.updatePrefs({
      methods: [],
      leadDays: 0,
      weekdayStart: 'vroeg',
      planStyle: 'laat',
    });

    expect(dataOf(harness).prefs).toMatchObject({
      methods: ['lezen'],
      leadDays: 21,
      weekdayStart: DEFAULT_PREFS.weekdayStart,
      planStyle: 'laat',
    });
  });

  it('keeps the identity of everything a patch does not touch', async () => {
    const harness = await signedInHarness();
    const before = dataOf(harness);
    await harness.actions.updatePrefs({ breakMinutes: 5 });
    const after = dataOf(harness);
    expect(after.prefs).not.toBe(before.prefs);
    expect(after.prefs.notifications).toBe(before.prefs.notifications);
    expect(after.prefs.methods).toBe(before.prefs.methods);
    expect(after.subjects).toBe(before.subjects);
    expect(after.exams).toBe(before.exams);
  });

  it('marks the onboarding as finished, once', async () => {
    const harness = await signedInHarness();
    expect(dataOf(harness).onboarded).toBe(false);
    await expect(harness.actions.completeOnboarding()).resolves.toStrictEqual({ ok: true });
    expect(dataOf(harness).onboarded).toBe(true);

    const before = harness.notifications();
    await harness.actions.completeOnboarding();
    expect(harness.notifications()).toBe(before);
  });
});

describe('subjects', () => {
  it('adds a subject', async () => {
    const harness = await signedInHarness();
    const result = await harness.actions.addSubject({ name: '  Biologie ', color: 'green' });
    const subject = { id: expect.stringMatching(UUID), name: 'Biologie', color: 'green' };
    expect(result).toStrictEqual({ ok: true, subject });
    expect(dataOf(harness).subjects).toStrictEqual([subject]);
  });

  it('returns the existing subject instead of adding a duplicate name', async () => {
    const harness = await signedInHarness();
    const first = await harness.actions.addSubject({ name: 'Biologie', color: 'green' });
    const before = harness.notifications();

    const second = await harness.actions.addSubject({ name: ' BIOLOGIE ', color: 'red' });

    expect(second).toStrictEqual(first);
    expect(dataOf(harness).subjects).toHaveLength(1);
    expect(harness.notifications()).toBe(before);
  });

  it('refuses a subject without a name', async () => {
    const harness = await signedInHarness();
    await expect(harness.actions.addSubject({ name: '  ', color: 'green' })).resolves.toStrictEqual(
      { ok: false, error: MESSAGES.subjectNameRequired },
    );
    expect(dataOf(harness).subjects).toStrictEqual([]);
  });

  it('renames and recolours a subject, but not to the name of another one', async () => {
    const harness = await signedInHarness();
    const bio = await harness.actions.addSubject({ name: 'Biologie', color: 'green' });
    const math = await harness.actions.addSubject({ name: 'Wiskunde', color: 'blue' });
    if (!bio.ok || !math.ok) throw new Error('setup failed');

    await expect(
      harness.actions.updateSubject(bio.subject.id, { name: 'Bio', color: 'teal' }),
    ).resolves.toStrictEqual({
      ok: true,
      subject: { id: bio.subject.id, name: 'Bio', color: 'teal' },
    });
    await expect(
      harness.actions.updateSubject(bio.subject.id, { color: 'pink' }),
    ).resolves.toMatchObject({ subject: { name: 'Bio', color: 'pink' } });
    await expect(
      harness.actions.updateSubject(bio.subject.id, { name: 'BIO' }),
    ).resolves.toMatchObject({ ok: true, subject: { name: 'BIO' } });

    await expect(
      harness.actions.updateSubject(bio.subject.id, { name: 'wiskunde' }),
    ).resolves.toStrictEqual({ ok: false, error: MESSAGES.subjectNameTaken });
    await expect(harness.actions.updateSubject(bio.subject.id, { name: ' ' })).resolves.toStrictEqual(
      { ok: false, error: MESSAGES.subjectNameRequired },
    );
    await expect(harness.actions.updateSubject('weg', { name: 'X' })).resolves.toStrictEqual({
      ok: false,
      error: MESSAGES.subjectNotFound,
    });
    expect(dataOf(harness).subjects).toStrictEqual([
      { id: bio.subject.id, name: 'BIO', color: 'pink' },
      math.subject,
    ]);
  });

  it('refuses to delete a subject while an exam uses it', async () => {
    const harness = await signedInHarness();
    const exam = await addSampleExam(harness);

    await expect(harness.actions.deleteSubject(exam.subjectId)).resolves.toStrictEqual({
      ok: false,
      error: MESSAGES.subjectInUse,
    });
    expect(dataOf(harness).subjects).toHaveLength(1);

    await harness.actions.deleteExam(exam.id);
    await expect(harness.actions.deleteSubject(exam.subjectId)).resolves.toStrictEqual({
      ok: true,
    });
    expect(dataOf(harness).subjects).toStrictEqual([]);
    await expect(harness.actions.deleteSubject(exam.subjectId)).resolves.toStrictEqual({
      ok: true,
    });
  });
});

describe('exams', () => {
  it('adds an exam with ids and timestamps of its own', async () => {
    const harness = await signedInHarness();
    const subject = await harness.actions.addSubject({ name: 'Biologie', color: 'green' });
    if (!subject.ok) throw new Error(subject.error);

    const result = await harness.actions.addExam({
      subjectId: subject.subject.id,
      title: '  Celdeling ',
      kind: 'so',
      date: '2026-11-27',
      time: '09:15',
      location: '  Lokaal 12 ',
      weight: 2,
      notes: '',
      topics: [
        { title: ' Mitose ', notes: ' blz. 40 ', estMinutes: 44.6, difficulty: 3, mastered: false },
        { title: 'Meiose', estMinutes: 30, difficulty: 1, mastered: true },
      ],
    });

    if (!result.ok) throw new Error(result.error);
    expect(result.exam).toStrictEqual({
      id: expect.stringMatching(UUID),
      subjectId: subject.subject.id,
      title: 'Celdeling',
      kind: 'so',
      date: '2026-11-27',
      time: '09:15',
      location: 'Lokaal 12',
      weight: 2,
      topics: [
        {
          id: expect.stringMatching(UUID),
          title: 'Mitose',
          notes: 'blz. 40',
          estMinutes: 45,
          difficulty: 3,
          mastered: false,
        },
        { id: expect.stringMatching(UUID), title: 'Meiose', estMinutes: 30, difficulty: 1, mastered: true },
      ],
      attachments: [],
      createdAt: NOW_ISO,
      updatedAt: NOW_ISO,
    });
    const ids = [result.exam.id, ...result.exam.topics.map((topic) => topic.id)];
    expect(new Set(ids).size).toBe(3);
    expect(dataOf(harness).exams).toStrictEqual([result.exam]);
  });

  it.each([
    ['no title', { title: '   ' }, MESSAGES.examTitleRequired],
    ['an unknown subject', { subjectId: 'bestaat-niet' }, MESSAGES.examSubjectRequired],
    ['an impossible date', { date: '2026-02-30' }, MESSAGES.dateInvalid],
    ['a date in another format', { date: '27-11-2026' }, MESSAGES.dateInvalid],
    ['an impossible time', { time: '24:00' }, MESSAGES.timeInvalid],
    ['a weight of 0', { weight: 0 }, MESSAGES.weightInvalid],
    ['a weight that is not a number', { weight: Number.NaN }, MESSAGES.weightInvalid],
    ['a grade above 10', { grade: 10.5 }, MESSAGES.gradeInvalid],
    [
      'a topic without a title',
      { topics: [{ title: ' ', estMinutes: 30, difficulty: 2 as const, mastered: false }] },
      MESSAGES.topicTitleRequired,
    ],
    [
      'a topic without time',
      { topics: [{ title: 'H1', estMinutes: 0, difficulty: 2 as const, mastered: false }] },
      MESSAGES.topicMinutesInvalid,
    ],
    [
      'a topic with an absurd amount of time',
      { topics: [{ title: 'H1', estMinutes: 6001, difficulty: 2 as const, mastered: false }] },
      MESSAGES.topicMinutesInvalid,
    ],
  ])('refuses an exam with %s', async (_case, overrides, error) => {
    const harness = await signedInHarness();
    const subject = await harness.actions.addSubject({ name: 'Biologie', color: 'green' });
    if (!subject.ok) throw new Error(subject.error);
    const before = harness.notifications();

    const result = await harness.actions.addExam(examDraft(subject.subject.id, overrides));

    expect(result).toStrictEqual({ ok: false, error });
    expect(dataOf(harness).exams).toStrictEqual([]);
    expect(harness.notifications()).toBe(before);
    expect(harness.plannerCalls).toHaveLength(0);
  });

  it('updates the given fields only and stamps the change', async () => {
    const harness = await signedInHarness();
    const exam = await addSampleExam(harness, { time: '09:15', location: 'Lokaal 12', weight: 2 });
    const topicsBefore = dataOf(harness).exams[0].topics;
    harness.setNow(LATER);

    const result = await harness.actions.updateExam(exam.id, {
      title: 'Hoofdstuk 3 t/m 5',
      date: '2026-12-01',
      kind: 'tentamen',
    });

    const updated: Exam = {
      ...exam,
      title: 'Hoofdstuk 3 t/m 5',
      date: '2026-12-01',
      kind: 'tentamen',
      updatedAt: LATER_ISO,
    };
    expect(result).toStrictEqual({ ok: true, exam: updated });
    expect(dataOf(harness).exams).toStrictEqual([updated]);
    expect(updated.createdAt).toBe(NOW_ISO);
    expect(dataOf(harness).exams[0].topics).toBe(topicsBefore);
  });

  it('clears an optional field that is patched to undefined or an empty string', async () => {
    const harness = await signedInHarness();
    const exam = await addSampleExam(harness, {
      time: '09:15',
      location: 'Lokaal 12',
      weight: 2,
      notes: 'Let op',
    });

    const result = await harness.actions.updateExam(exam.id, {
      time: undefined,
      location: '',
      weight: undefined,
    });

    if (!result.ok) throw new Error(result.error);
    expect(Object.keys(result.exam)).not.toContain('time');
    expect(Object.keys(result.exam)).not.toContain('location');
    expect(Object.keys(result.exam)).not.toContain('weight');
    expect(result.exam.notes).toBe('Let op');
  });

  it('replaces the topic list, keeping the ids of the topics that stay', async () => {
    const harness = await signedInHarness();
    const exam = await addSampleExam(harness);
    const [first, second] = exam.topics;

    const result = await harness.actions.updateExam(exam.id, {
      topics: [
        { ...second, title: 'Hoofdstuk 4 (nieuw)' },
        { title: 'Hoofdstuk 5', estMinutes: 20, difficulty: 1, mastered: false },
        { ...second, title: 'Kopie met hetzelfde id' },
        { id: 'zelf-verzonnen', title: 'Vreemd id', estMinutes: 10, difficulty: 2, mastered: false },
      ],
    });

    if (!result.ok) throw new Error(result.error);
    const topics = result.exam.topics;
    expect(topics.map((topic) => topic.title)).toStrictEqual([
      'Hoofdstuk 4 (nieuw)',
      'Hoofdstuk 5',
      'Kopie met hetzelfde id',
      'Vreemd id',
    ]);
    expect(topics[0].id).toBe(second.id);
    expect(new Set(topics.map((topic) => topic.id)).size).toBe(4);
    expect(topics.map((topic) => topic.id)).not.toContain(first.id);
    expect(topics.map((topic) => topic.id)).not.toContain('zelf-verzonnen');
  });

  it('refuses an invalid update and an update of an exam that is gone', async () => {
    const harness = await signedInHarness();
    const exam = await addSampleExam(harness);
    const before = harness.store.getState();

    await expect(harness.actions.updateExam(exam.id, { title: '' })).resolves.toStrictEqual({
      ok: false,
      error: MESSAGES.examTitleRequired,
    });
    await expect(harness.actions.updateExam(exam.id, { subjectId: 'weg' })).resolves.toStrictEqual({
      ok: false,
      error: MESSAGES.examSubjectRequired,
    });
    await expect(
      harness.actions.updateExam(exam.id, {
        topics: [{ title: '', estMinutes: 10, difficulty: 2, mastered: false }],
      }),
    ).resolves.toStrictEqual({ ok: false, error: MESSAGES.topicTitleRequired });
    await expect(harness.actions.updateExam('weg', { title: 'X' })).resolves.toStrictEqual({
      ok: false,
      error: MESSAGES.examNotFound,
    });
    expect(harness.store.getState()).toBe(before);
  });

  it('deletes an exam together with its blocks, warnings and files', async () => {
    const harness = await signedInHarness();
    const keep = await addSampleExam(harness, { title: 'Blijft' });
    const gone = await addSampleExam(harness, { title: 'Weg', topics: [] });
    await harness.actions.addAttachment(keep.id, new File(['a'], 'blijft.txt'));
    const file = await harness.actions.addAttachment(gone.id, new File(['b'], 'weg.txt'));
    if (!file.ok) throw new Error(file.error);
    expect(dataOf(harness).sessions.map((session) => session.examId)).toStrictEqual([
      keep.id,
      gone.id,
    ]);
    expect(dataOf(harness).warnings).toStrictEqual([{ type: 'geen-leerstof', examId: gone.id }]);

    await expect(harness.actions.deleteExam(gone.id)).resolves.toStrictEqual({ ok: true });

    const data = dataOf(harness);
    expect(data.exams.map((exam) => exam.id)).toStrictEqual([keep.id]);
    expect(data.sessions.map((session) => session.examId)).toStrictEqual([keep.id]);
    expect(data.warnings).toStrictEqual([]);
    expect(harness.plannerCalls.at(-1)?.previous.map((session) => session.examId)).toStrictEqual([
      keep.id,
    ]);
    await expect(harness.actions.getAttachmentBlob(file.attachment.id)).resolves.toBeUndefined();
    await expect(storedAttachmentIds()).resolves.toHaveLength(1);

    const before = harness.notifications();
    await expect(harness.actions.deleteExam(gone.id)).resolves.toStrictEqual({ ok: true });
    expect(harness.notifications()).toBe(before);
  });

  it('sets, rounds and clears a grade', async () => {
    const harness = await signedInHarness();
    const exam = await addSampleExam(harness);
    harness.setNow(LATER);

    const graded = await harness.actions.setGrade(exam.id, 7.46);
    expect(graded).toStrictEqual({ ok: true, exam: { ...exam, grade: 7.5, updatedAt: LATER_ISO } });
    expect(dataOf(harness).exams[0].grade).toBe(7.5);

    const cleared = await harness.actions.setGrade(exam.id, undefined);
    if (!cleared.ok) throw new Error(cleared.error);
    expect(Object.keys(cleared.exam)).not.toContain('grade');
    expect(Object.keys(dataOf(harness).exams[0])).not.toContain('grade');
  });

  it.each([0.9, 10.1, Number.NaN, Number.POSITIVE_INFINITY])('refuses the grade %s', async (grade) => {
    const harness = await signedInHarness();
    const exam = await addSampleExam(harness);
    await expect(harness.actions.setGrade(exam.id, grade)).resolves.toStrictEqual({
      ok: false,
      error: MESSAGES.gradeInvalid,
    });
    await expect(harness.actions.setGrade('weg', 7)).resolves.toStrictEqual({
      ok: false,
      error: MESSAGES.examNotFound,
    });
    expect(dataOf(harness).exams[0]).toStrictEqual(exam);
  });
});

describe('topics', () => {
  it('adds topics at the end and returns them', async () => {
    const harness = await signedInHarness();
    const exam = await addSampleExam(harness);
    harness.setNow(LATER);

    const result = await harness.actions.addTopics(exam.id, [
      { title: ' Hoofdstuk 5 ', estMinutes: 20, difficulty: 1, mastered: false },
      { title: 'Hoofdstuk 6', notes: 'alleen §6.1', estMinutes: 40, difficulty: 3, mastered: true },
    ]);

    if (!result.ok) throw new Error(result.error);
    expect(result.topics).toStrictEqual([
      { id: expect.stringMatching(UUID), title: 'Hoofdstuk 5', estMinutes: 20, difficulty: 1, mastered: false },
      {
        id: expect.stringMatching(UUID),
        title: 'Hoofdstuk 6',
        notes: 'alleen §6.1',
        estMinutes: 40,
        difficulty: 3,
        mastered: true,
      },
    ]);
    const stored = dataOf(harness).exams[0];
    expect(stored.topics).toStrictEqual([...exam.topics, ...result.topics]);
    expect(stored.updatedAt).toBe(LATER_ISO);
    expect(new Set(stored.topics.map((topic) => topic.id)).size).toBe(4);
  });

  it('adds nothing when one of the drafts is invalid', async () => {
    const harness = await signedInHarness();
    const exam = await addSampleExam(harness);

    await expect(
      harness.actions.addTopics(exam.id, [
        { title: 'Goed', estMinutes: 20, difficulty: 1, mastered: false },
        { title: '', estMinutes: 20, difficulty: 1, mastered: false },
      ]),
    ).resolves.toStrictEqual({ ok: false, error: MESSAGES.topicTitleRequired });
    await expect(
      harness.actions.addTopics('weg', [{ title: 'X', estMinutes: 20, difficulty: 1, mastered: false }]),
    ).resolves.toStrictEqual({ ok: false, error: MESSAGES.examNotFound });
    await expect(harness.actions.addTopics(exam.id, [])).resolves.toStrictEqual({
      ok: true,
      topics: [],
    });
    expect(dataOf(harness).exams[0]).toStrictEqual(exam);
  });

  it('updates one topic', async () => {
    const harness = await signedInHarness();
    const exam = await addSampleExam(harness);
    const [first, second] = exam.topics;

    const result = await harness.actions.updateTopic(exam.id, first.id, {
      mastered: true,
      notes: 'Ken ik al',
      estMinutes: 15,
    });

    const updated = { ...first, mastered: true, notes: 'Ken ik al', estMinutes: 15 };
    expect(result).toStrictEqual({ ok: true, topic: updated });
    expect(dataOf(harness).exams[0].topics).toStrictEqual([updated, second]);
    expect(dataOf(harness).exams[0].topics[1]).toBe(second);

    const cleared = await harness.actions.updateTopic(exam.id, first.id, { notes: '' });
    if (!cleared.ok) throw new Error(cleared.error);
    expect(Object.keys(cleared.topic)).not.toContain('notes');
  });

  it('refuses an invalid topic update and unknown ids', async () => {
    const harness = await signedInHarness();
    const exam = await addSampleExam(harness);
    const topicId = exam.topics[0].id;

    await expect(harness.actions.updateTopic(exam.id, topicId, { title: ' ' })).resolves.toStrictEqual(
      { ok: false, error: MESSAGES.topicTitleRequired },
    );
    await expect(
      harness.actions.updateTopic(exam.id, topicId, { estMinutes: -5 }),
    ).resolves.toStrictEqual({ ok: false, error: MESSAGES.topicMinutesInvalid });
    await expect(
      harness.actions.updateTopic(exam.id, 'weg', { mastered: true }),
    ).resolves.toStrictEqual({ ok: false, error: MESSAGES.topicNotFound });
    await expect(
      harness.actions.updateTopic('weg', topicId, { mastered: true }),
    ).resolves.toStrictEqual({ ok: false, error: MESSAGES.examNotFound });
    expect(dataOf(harness).exams[0]).toStrictEqual(exam);
  });

  it('deletes a topic', async () => {
    const harness = await signedInHarness();
    const exam = await addSampleExam(harness);
    const [first, second] = exam.topics;

    await expect(harness.actions.deleteTopic(exam.id, first.id)).resolves.toStrictEqual({
      ok: true,
    });
    expect(dataOf(harness).exams[0].topics).toStrictEqual([second]);

    const before = harness.notifications();
    await expect(harness.actions.deleteTopic(exam.id, first.id)).resolves.toStrictEqual({
      ok: true,
    });
    await expect(harness.actions.deleteTopic('weg', first.id)).resolves.toStrictEqual({ ok: true });
    expect(harness.notifications()).toBe(before);
  });

  it('moves a topic to another position, clamped to the list', async () => {
    const harness = await signedInHarness();
    const exam = await addSampleExam(harness, {
      topics: ['A', 'B', 'C', 'D'].map((title) => ({
        title,
        estMinutes: 30,
        difficulty: 2 as const,
        mastered: false,
      })),
    });
    const [a, b, c, d] = exam.topics;
    const order = () => dataOf(harness).exams[0].topics.map((topic) => topic.title).join('');

    await expect(harness.actions.moveTopic(exam.id, a.id, 2)).resolves.toStrictEqual({ ok: true });
    expect(order()).toBe('BCAD');
    await harness.actions.moveTopic(exam.id, d.id, 0);
    expect(order()).toBe('DBCA');
    await harness.actions.moveTopic(exam.id, b.id, 99);
    expect(order()).toBe('DCAB');
    await harness.actions.moveTopic(exam.id, b.id, -3);
    expect(order()).toBe('BDCA');

    const before = harness.notifications();
    await harness.actions.moveTopic(exam.id, c.id, 2);
    await harness.actions.moveTopic(exam.id, c.id, Number.NaN);
    expect(order()).toBe('BDCA');
    expect(harness.notifications()).toBe(before);

    await expect(harness.actions.moveTopic(exam.id, 'weg', 0)).resolves.toStrictEqual({
      ok: false,
      error: MESSAGES.topicNotFound,
    });
    await expect(harness.actions.moveTopic('weg', a.id, 0)).resolves.toStrictEqual({
      ok: false,
      error: MESSAGES.examNotFound,
    });
  });
});

describe('attachments', () => {
  it('stores a file and gives it back unchanged', async () => {
    const harness = await signedInHarness();
    const exam = await addSampleExam(harness);
    harness.setNow(LATER);
    const file = new File(['%PDF studiewijzer'], 'studiewijzer.pdf', { type: 'application/pdf' });

    const result = await harness.actions.addAttachment(exam.id, file);

    if (!result.ok) throw new Error(result.error);
    expect(result.attachment).toStrictEqual({
      id: expect.stringMatching(UUID),
      name: 'studiewijzer.pdf',
      mime: 'application/pdf',
      size: file.size,
      addedAt: LATER_ISO,
    });
    expect(dataOf(harness).exams[0].attachments).toStrictEqual([result.attachment]);
    expect(dataOf(harness).exams[0].updatedAt).toBe(LATER_ISO);

    const blob = await harness.actions.getAttachmentBlob(result.attachment.id);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob?.type).toBe('application/pdf');
    await expect(blob?.text()).resolves.toBe('%PDF studiewijzer');
  });

  it('names a plain Blob after the given name, or calls it "Bijlage"', async () => {
    const harness = await signedInHarness();
    const exam = await addSampleExam(harness);

    const named = await harness.actions.addAttachment(exam.id, new Blob(['x']), ' foto.jpg ');
    const withOwnName = await harness.actions.addAttachment(
      exam.id,
      Object.assign(new Blob(['y'], { type: 'image/png' }), { name: 'scan.png' }),
    );
    const anonymous = await harness.actions.addAttachment(exam.id, new Blob(['z']));
    const renamed = await harness.actions.addAttachment(exam.id, new File(['q'], 'a.txt'), 'b.txt');

    expect(named).toMatchObject({ attachment: { name: 'foto.jpg', mime: 'application/octet-stream' } });
    expect(withOwnName).toMatchObject({ attachment: { name: 'scan.png', mime: 'image/png' } });
    expect(anonymous).toMatchObject({ attachment: { name: 'Bijlage' } });
    expect(renamed).toMatchObject({ attachment: { name: 'b.txt' } });
    expect(dataOf(harness).exams[0].attachments).toHaveLength(4);
  });

  it('refuses a file above 15 MB and stores nothing', async () => {
    const harness = await signedInHarness();
    const exam = await addSampleExam(harness);
    const limit = 15 * 1024 * 1024;
    const before = harness.notifications();

    const tooLarge = await harness.actions.addAttachment(
      exam.id,
      new File([new Uint8Array(limit + 1)], 'film.mp4'),
    );

    expect(tooLarge).toStrictEqual({
      ok: false,
      error: 'Dit bestand is te groot. Een bijlage mag maximaal 15 MB zijn.',
    });
    expect(dataOf(harness).exams[0].attachments).toStrictEqual([]);
    expect(harness.notifications()).toBe(before);
    await expect(storedAttachmentIds()).resolves.toStrictEqual([]);
  });

  it('accepts a file of exactly 15 MB', async () => {
    const harness = await signedInHarness();
    const exam = await addSampleExam(harness);
    const limit = 15 * 1024 * 1024;

    const result = await harness.actions.addAttachment(
      exam.id,
      new File([new Uint8Array(limit)], 'groot.bin'),
    );

    if (!result.ok) throw new Error(result.error);
    const blob = await harness.actions.getAttachmentBlob(result.attachment.id);
    expect(blob?.size).toBe(limit);
  });

  it('refuses a file for an exam that does not exist', async () => {
    const harness = await signedInHarness();
    await expect(harness.actions.addAttachment('weg', new File(['x'], 'x.txt'))).resolves.toStrictEqual(
      { ok: false, error: MESSAGES.examNotFound },
    );
    await expect(storedAttachmentIds()).resolves.toStrictEqual([]);
  });

  it('removes an attachment and its file', async () => {
    const harness = await signedInHarness();
    const exam = await addSampleExam(harness);
    const first = await harness.actions.addAttachment(exam.id, new File(['1'], 'een.txt'));
    const second = await harness.actions.addAttachment(exam.id, new File(['2'], 'twee.txt'));
    if (!first.ok || !second.ok) throw new Error('setup failed');

    await expect(
      harness.actions.removeAttachment(exam.id, first.attachment.id),
    ).resolves.toStrictEqual({ ok: true });

    expect(dataOf(harness).exams[0].attachments).toStrictEqual([second.attachment]);
    await expect(harness.actions.getAttachmentBlob(first.attachment.id)).resolves.toBeUndefined();
    await expect(storedAttachmentIds()).resolves.toStrictEqual([second.attachment.id]);

    await expect(
      harness.actions.removeAttachment(exam.id, first.attachment.id),
    ).resolves.toStrictEqual({ ok: true });
    await expect(harness.actions.getAttachmentBlob('bestaat-niet')).resolves.toBeUndefined();
  });

  it('gives a friendly error when the device has no room for the file', async () => {
    const harness = await signedInHarness();
    const exam = await addSampleExam(harness);
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });

    const result = await harness.actions.addAttachment(exam.id, new File(['x'], 'x.txt'));

    expect(result).toStrictEqual({
      ok: false,
      error:
        'De opslag van je browser is vol. Verwijder een paar bijlagen of oude toetsen en probeer het opnieuw.',
    });
    expect(dataOf(harness).exams[0].attachments).toStrictEqual([]);
  });

  it('removes the file again when its metadata cannot be saved', async () => {
    const harness = await signedInHarness();
    const exam = await addSampleExam(harness);
    const release = fillStorage();

    const result = await harness.actions.addAttachment(exam.id, new File(['x'], 'x.txt'));
    release();

    expect(result.ok).toBe(false);
    expect(dataOf(harness).exams[0].attachments).toStrictEqual([]);
    await expect(storedAttachmentIds()).resolves.toStrictEqual([]);
  });
});

describe('study blocks', () => {
  const setup = async () => {
    const harness = await signedInHarness();
    const exam = await addSampleExam(harness);
    const [session] = dataOf(harness).sessions;
    return { harness, exam, session };
  };
  const sessionOf = (harness: Harness): StudySession => dataOf(harness).sessions[0];

  it('marks a block as done at the current time', async () => {
    const { harness, session } = await setup();
    harness.setNow(LATER);

    await expect(harness.actions.completeSession(session.id)).resolves.toStrictEqual({ ok: true });

    expect(sessionOf(harness)).toStrictEqual({
      ...session,
      status: 'gedaan',
      completedAt: LATER_ISO,
    });
  });

  it('keeps the original completion time when a done block is completed again', async () => {
    const { harness, session } = await setup();
    await harness.actions.completeSession(session.id);
    harness.setNow(LATER);
    const before = harness.notifications();

    await harness.actions.completeSession(session.id);

    expect(sessionOf(harness).completedAt).toBe(NOW_ISO);
    expect(harness.notifications()).toBe(before);
  });

  it('reopens a done block', async () => {
    const { harness, session } = await setup();
    await harness.actions.completeSession(session.id);

    await expect(harness.actions.reopenSession(session.id)).resolves.toStrictEqual({ ok: true });

    expect(sessionOf(harness)).toStrictEqual(session);
    expect(Object.keys(sessionOf(harness))).not.toContain('completedAt');
  });

  it('skips a block', async () => {
    const { harness, session } = await setup();
    await harness.actions.completeSession(session.id);

    await expect(harness.actions.skipSession(session.id)).resolves.toStrictEqual({ ok: true });

    expect(sessionOf(harness)).toStrictEqual({ ...session, status: 'overgeslagen' });
  });

  it('moves a block and pins it, and unpins it again', async () => {
    const { harness, session } = await setup();

    await expect(
      harness.actions.moveSession(session.id, { date: '2026-11-19', start: '19:30' }),
    ).resolves.toStrictEqual({ ok: true });
    expect(sessionOf(harness)).toStrictEqual({
      ...session,
      date: '2026-11-19',
      start: '19:30',
      pinned: true,
    });

    await expect(harness.actions.unpinSession(session.id)).resolves.toStrictEqual({ ok: true });
    expect(sessionOf(harness)).toStrictEqual({
      ...session,
      date: '2026-11-19',
      start: '19:30',
      pinned: false,
    });
  });

  it('refuses to move a block to an impossible date or time', async () => {
    const { harness, session } = await setup();
    await expect(
      harness.actions.moveSession(session.id, { date: '2026-11-31', start: '19:30' }),
    ).resolves.toStrictEqual({ ok: false, error: MESSAGES.dateInvalid });
    await expect(
      harness.actions.moveSession(session.id, { date: '2026-11-19', start: '7:30' }),
    ).resolves.toStrictEqual({ ok: false, error: MESSAGES.timeInvalid });
    expect(sessionOf(harness)).toBe(session);
  });

  it('answers with a friendly error for a block that is gone', async () => {
    const { harness } = await setup();
    const gone = { ok: false, error: MESSAGES.sessionNotFound };
    const before = harness.plannerCalls.length;

    await expect(harness.actions.completeSession('weg')).resolves.toStrictEqual(gone);
    await expect(harness.actions.reopenSession('weg')).resolves.toStrictEqual(gone);
    await expect(harness.actions.skipSession('weg')).resolves.toStrictEqual(gone);
    await expect(
      harness.actions.moveSession('weg', { date: '2026-11-19', start: '19:30' }),
    ).resolves.toStrictEqual(gone);
    await expect(harness.actions.unpinSession('weg')).resolves.toStrictEqual(gone);
    expect(harness.plannerCalls).toHaveLength(before);
  });
});

describe('blocked dates', () => {
  it('toggles a date and keeps the list sorted', async () => {
    const harness = await signedInHarness();

    await expect(harness.actions.toggleBlockedDate('2026-12-25')).resolves.toStrictEqual({
      ok: true,
      blocked: true,
    });
    await harness.actions.toggleBlockedDate('2026-11-20');
    await harness.actions.toggleBlockedDate('2026-12-05');
    expect(dataOf(harness).blockedDates).toStrictEqual(['2026-11-20', '2026-12-05', '2026-12-25']);

    await expect(harness.actions.toggleBlockedDate('2026-12-05')).resolves.toStrictEqual({
      ok: true,
      blocked: false,
    });
    expect(dataOf(harness).blockedDates).toStrictEqual(['2026-11-20', '2026-12-25']);
  });

  it('refuses something that is not a date', async () => {
    const harness = await signedInHarness();
    await expect(harness.actions.toggleBlockedDate('kerst')).resolves.toStrictEqual({
      ok: false,
      error: MESSAGES.dateInvalid,
    });
    expect(dataOf(harness).blockedDates).toStrictEqual([]);
  });
});

describe('inbox', () => {
  it('adds new items newest first and ignores ids it already has', async () => {
    const harness = await signedInHarness();
    const monday = inboxItem('ma', '2026-11-16T07:30:00.000Z', { link: '#/agenda' });
    const tuesday = inboxItem('di', '2026-11-17T07:30:00.000Z');
    const wednesday = inboxItem('wo', '2026-11-18T07:30:00.000Z');

    await expect(harness.actions.addInboxItems([monday, wednesday])).resolves.toStrictEqual({
      ok: true,
    });
    await harness.actions.markInboxRead('ma');
    const before = harness.notifications();
    await harness.actions.addInboxItems([
      { ...monday, title: 'Nog een keer', read: false },
      tuesday,
      { ...tuesday, title: 'Dubbel in dezelfde lading' },
    ]);

    expect(dataOf(harness).inbox).toStrictEqual([wednesday, tuesday, { ...monday, read: true }]);
    expect(harness.notifications()).toBe(before + 1);

    await harness.actions.addInboxItems([monday, tuesday, wednesday]);
    await harness.actions.addInboxItems([]);
    expect(harness.notifications()).toBe(before + 1);
  });

  it('keeps only the newest 100 items', async () => {
    const harness = await signedInHarness();
    const items = Array.from({ length: 120 }, (_, index) =>
      inboxItem(`item-${index}`, new Date(Date.UTC(2026, 10, 1, 0, index)).toISOString()),
    );

    await harness.actions.addInboxItems(items.slice(0, 80));
    await harness.actions.addInboxItems(items.slice(80));

    const { inbox } = dataOf(harness);
    expect(inbox).toHaveLength(100);
    expect(inbox[0].id).toBe('item-119');
    expect(inbox[99].id).toBe('item-20');
  });

  it('drops items that are not valid inbox items', async () => {
    const harness = await signedInHarness();
    const good = inboxItem('goed', '2026-11-16T07:30:00.000Z');
    await harness.actions.addInboxItems([
      good,
      { ...good, id: 'geen-datum', at: 'straks' },
      { ...good, id: 'geen-titel', title: '  ' },
    ]);
    expect(dataOf(harness).inbox).toStrictEqual([good]);
  });

  it('marks one item or everything as read, and clears the inbox', async () => {
    const harness = await signedInHarness();
    const a = inboxItem('a', '2026-11-16T07:30:00.000Z');
    const b = inboxItem('b', '2026-11-17T07:30:00.000Z');
    const c = inboxItem('c', '2026-11-18T07:30:00.000Z');
    await harness.actions.addInboxItems([a, b, c]);

    await expect(harness.actions.markInboxRead('b')).resolves.toStrictEqual({ ok: true });
    expect(dataOf(harness).inbox.map((item) => item.read)).toStrictEqual([false, true, false]);
    expect(dataOf(harness).inbox[0]).toStrictEqual(c);

    let before = harness.notifications();
    await harness.actions.markInboxRead('b');
    await harness.actions.markInboxRead('bestaat-niet');
    expect(harness.notifications()).toBe(before);

    await harness.actions.markInboxRead('all');
    expect(dataOf(harness).inbox.map((item) => item.read)).toStrictEqual([true, true, true]);

    await expect(harness.actions.clearInbox()).resolves.toStrictEqual({ ok: true });
    expect(dataOf(harness).inbox).toStrictEqual([]);
    before = harness.notifications();
    await harness.actions.clearInbox();
    expect(harness.notifications()).toBe(before);
  });
});

describe('planning', () => {
  interface Context {
    harness: Harness;
    exam: Exam;
    session: StudySession;
  }
  interface Case {
    name: string;
    prepare?: (context: Context) => Promise<unknown>;
    act: (context: Context) => Promise<Result>;
  }

  const newTopic = { title: 'Hoofdstuk 5', estMinutes: 20, difficulty: 1 as const, mastered: false };

  const planChanging: Case[] = [
    { name: 'updatePrefs', act: ({ harness }) => harness.actions.updatePrefs({ leadDays: 14 }) },
    {
      name: 'addExam',
      act: ({ harness, exam }) =>
        harness.actions.addExam(examDraft(exam.subjectId, { title: 'Tweede toets' })),
    },
    {
      name: 'updateExam',
      act: ({ harness, exam }) => harness.actions.updateExam(exam.id, { date: '2026-12-04' }),
    },
    { name: 'deleteExam', act: ({ harness, exam }) => harness.actions.deleteExam(exam.id) },
    { name: 'setGrade', act: ({ harness, exam }) => harness.actions.setGrade(exam.id, 8) },
    { name: 'addTopics', act: ({ harness, exam }) => harness.actions.addTopics(exam.id, [newTopic]) },
    {
      name: 'updateTopic',
      act: ({ harness, exam }) =>
        harness.actions.updateTopic(exam.id, exam.topics[0].id, { mastered: true }),
    },
    {
      name: 'deleteTopic',
      act: ({ harness, exam }) => harness.actions.deleteTopic(exam.id, exam.topics[1].id),
    },
    {
      name: 'moveTopic',
      act: ({ harness, exam }) => harness.actions.moveTopic(exam.id, exam.topics[1].id, 0),
    },
    {
      name: 'completeSession',
      act: ({ harness, session }) => harness.actions.completeSession(session.id),
    },
    {
      name: 'reopenSession',
      prepare: ({ harness, session }) => harness.actions.completeSession(session.id),
      act: ({ harness, session }) => harness.actions.reopenSession(session.id),
    },
    { name: 'skipSession', act: ({ harness, session }) => harness.actions.skipSession(session.id) },
    {
      name: 'moveSession',
      act: ({ harness, session }) =>
        harness.actions.moveSession(session.id, { date: '2026-11-19', start: '19:30' }),
    },
    {
      name: 'unpinSession',
      prepare: ({ harness, session }) =>
        harness.actions.moveSession(session.id, { date: '2026-11-19', start: '19:30' }),
      act: ({ harness, session }) => harness.actions.unpinSession(session.id),
    },
    {
      name: 'toggleBlockedDate',
      act: ({ harness }) => harness.actions.toggleBlockedDate('2026-11-20'),
    },
    {
      name: 'importData',
      prepare: ({ harness }) => harness.actions.updatePrefs({ leadDays: 14 }),
      act: ({ harness }) => {
        const backup = JSON.parse(harness.actions.exportData()) as { data: UserData };
        backup.data.prefs.leadDays = 5;
        return harness.actions.importData(JSON.stringify(backup));
      },
    },
  ];

  it.each(planChanging)(
    '$name runs the planner exactly once, on the changed data, in one state change',
    async ({ prepare, act }) => {
      const harness = await signedInHarness();
      const exam = await addSampleExam(harness);
      const context: Context = { harness, exam, session: dataOf(harness).sessions[0] };
      await prepare?.(context);
      const callsBefore = harness.plannerCalls.length;
      const notificationsBefore = harness.notifications();
      const stateBefore = harness.store.getState();

      const result = await act(context);

      expect(result.ok).toBe(true);
      expect(harness.plannerCalls).toHaveLength(callsBefore + 1);
      expect(harness.notifications()).toBe(notificationsBefore + 1);
      expect(harness.store.getState()).not.toBe(stateBefore);

      const input = harness.plannerCalls[callsBefore];
      const data = dataOf(harness);
      expect(Object.keys(input).sort()).toStrictEqual(
        ['blockedDates', 'exams', 'nowMinutes', 'previous', 'prefs', 'today'].sort(),
      );
      expect(input.today).toBe(TODAY);
      expect(input.nowMinutes).toBe(NOW_MINUTES);
      // The planner saw the data as the action left it…
      expect(input.exams).toStrictEqual(data.exams);
      expect(input.prefs).toStrictEqual(data.prefs);
      expect(input.blockedDates).toStrictEqual(data.blockedDates);
      // …and what it returned is what was stored.
      expect(data.sessions).toStrictEqual(fakePlan(input).sessions);
      expect(data.warnings).toStrictEqual(fakePlan(input).warnings);
    },
  );

  it('gives the planner the blocks as the action changed them', async () => {
    const harness = await signedInHarness();
    await addSampleExam(harness);
    const [session] = dataOf(harness).sessions;

    await harness.actions.completeSession(session.id);
    expect(harness.plannerCalls.at(-1)?.previous).toStrictEqual([
      { ...session, status: 'gedaan', completedAt: NOW_ISO },
    ]);

    await harness.actions.moveSession(session.id, { date: '2026-11-19', start: '19:30' });
    expect(harness.plannerCalls.at(-1)?.previous).toStrictEqual([
      {
        ...session,
        status: 'gedaan',
        completedAt: NOW_ISO,
        date: '2026-11-19',
        start: '19:30',
        pinned: true,
      },
    ]);
  });

  it('uses the date and time of the moment of the action', async () => {
    const harness = await signedInHarness();
    harness.setNow(new Date(2026, 11, 31, 23, 59, 30));
    await harness.actions.replan();
    expect(harness.plannerCalls.at(-1)).toMatchObject({ today: '2026-12-31', nowMinutes: 1439 });

    harness.setNow(new Date(2027, 0, 1, 0, 0, 0));
    await harness.actions.replan();
    expect(harness.plannerCalls.at(-1)).toMatchObject({ today: '2027-01-01', nowMinutes: 0 });
  });

  it('publishes the change and the new plan together, never one without the other', async () => {
    const plan: PlanResult = { sessions: [], warnings: [] };
    const harness = await signedInHarness(undefined, () => plan);
    const subject = await harness.actions.addSubject({ name: 'Biologie', color: 'green' });
    if (!subject.ok) throw new Error(subject.error);
    const seen: UserData[] = [];
    harness.store.subscribe(() => seen.push(dataOf(harness)));

    plan.sessions = [
      {
        id: 'gepland-door-de-planner',
        examId: 'wordt-zo-ingevuld',
        parts: [],
        date: TODAY,
        start: '16:00',
        minutes: 30,
        kind: 'leren',
        method: 'lezen',
        status: 'gepland',
        pinned: false,
      },
    ];
    const added = await harness.actions.addExam(examDraft(subject.subject.id));
    if (!added.ok) throw new Error(added.error);

    expect(seen).toHaveLength(1);
    expect(seen[0].exams).toStrictEqual([added.exam]);
    expect(seen[0].sessions).toStrictEqual(plan.sessions);
  });

  it('replan runs the planner once and changes nothing when the plan is the same', async () => {
    const harness = await signedInHarness();
    await addSampleExam(harness);
    const callsBefore = harness.plannerCalls.length;
    const notificationsBefore = harness.notifications();
    const stateBefore = harness.store.getState();

    await expect(harness.actions.replan()).resolves.toStrictEqual({ ok: true });

    expect(harness.plannerCalls).toHaveLength(callsBefore + 1);
    expect(harness.notifications()).toBe(notificationsBefore);
    expect(harness.store.getState()).toBe(stateBefore);
  });

  it('keeps the identity of the blocks a new plan did not change', async () => {
    const harness = await signedInHarness();
    await addSampleExam(harness, { title: 'Eerste' });
    await addSampleExam(harness, { title: 'Tweede' });
    const before = dataOf(harness);

    await harness.actions.completeSession(before.sessions[1].id);

    const after = dataOf(harness);
    expect(after.sessions).not.toBe(before.sessions);
    expect(after.sessions[0]).toBe(before.sessions[0]);
    expect(after.sessions[1]).not.toBe(before.sessions[1]);
    expect(after.exams).toBe(before.exams);
    expect(after.prefs).toBe(before.prefs);
  });

  const planNeutral: Case[] = [
    { name: 'completeOnboarding', act: ({ harness }) => harness.actions.completeOnboarding() },
    {
      name: 'addSubject',
      act: ({ harness }) => harness.actions.addSubject({ name: 'Frans', color: 'pink' }),
    },
    {
      name: 'updateSubject',
      act: ({ harness, exam }) => harness.actions.updateSubject(exam.subjectId, { color: 'red' }),
    },
    {
      name: 'deleteSubject',
      prepare: ({ harness }) => harness.actions.addSubject({ name: 'Frans', color: 'pink' }),
      act: ({ harness }) =>
        harness.actions.deleteSubject(dataOf(harness).subjects.at(-1)?.id ?? ''),
    },
    {
      name: 'addAttachment',
      act: ({ harness, exam }) => harness.actions.addAttachment(exam.id, new File(['x'], 'x.txt')),
    },
    {
      name: 'removeAttachment',
      prepare: ({ harness, exam }) =>
        harness.actions.addAttachment(exam.id, new File(['x'], 'x.txt')),
      act: ({ harness, exam }) =>
        harness.actions.removeAttachment(exam.id, dataOf(harness).exams[0].attachments[0].id),
    },
    {
      name: 'addInboxItems',
      act: ({ harness }) =>
        harness.actions.addInboxItems([inboxItem('a', '2026-11-16T07:30:00.000Z')]),
    },
    {
      name: 'markInboxRead',
      prepare: ({ harness }) =>
        harness.actions.addInboxItems([inboxItem('a', '2026-11-16T07:30:00.000Z')]),
      act: ({ harness }) => harness.actions.markInboxRead('all'),
    },
    {
      name: 'clearInbox',
      prepare: ({ harness }) =>
        harness.actions.addInboxItems([inboxItem('a', '2026-11-16T07:30:00.000Z')]),
      act: ({ harness }) => harness.actions.clearInbox(),
    },
    { name: 'updateAccount', act: ({ harness }) => harness.actions.updateAccount({ name: 'Sammie' }) },
  ];

  it.each(planNeutral)(
    '$name does not run the planner and is one state change',
    async ({ prepare, act }) => {
      const harness = await signedInHarness();
      const exam = await addSampleExam(harness);
      const context: Context = { harness, exam, session: dataOf(harness).sessions[0] };
      await prepare?.(context);
      const callsBefore = harness.plannerCalls.length;
      const notificationsBefore = harness.notifications();
      const sessionsBefore = dataOf(harness).sessions;

      const result = await act(context);

      expect(result.ok).toBe(true);
      expect(harness.plannerCalls).toHaveLength(callsBefore);
      expect(harness.notifications()).toBe(notificationsBefore + 1);
      expect(dataOf(harness).sessions).toBe(sessionsBefore);
    },
  );

  it('answers with a friendly error and changes nothing when the planner crashes', async () => {
    let broken = false;
    const harness = await signedInHarness(undefined, (input) => {
      if (broken) throw new Error('planner bug');
      return fakePlan(input);
    });
    const exam = await addSampleExam(harness);
    const before = harness.store.getState();
    broken = true;

    await expect(harness.actions.updateExam(exam.id, { title: 'Nieuw' })).resolves.toStrictEqual({
      ok: false,
      error: MESSAGES.unknown,
    });

    expect(harness.store.getState()).toBe(before);
    broken = false;
    await expect(harness.actions.updateExam(exam.id, { title: 'Nieuw' })).resolves.toMatchObject({
      ok: true,
    });
  });
});

describe('a subscriber that throws', () => {
  const failingSubscriber = async () => {
    const harness = await signedInHarness();
    const bug = new Error('subscriber bug');
    let toldAfterwards = 0;
    harness.store.subscribe(() => {
      throw bug;
    });
    harness.store.subscribe(() => {
      toldAfterwards += 1;
    });
    return { harness, bug, toldAfterwards: () => toldAfterwards };
  };

  it('does not break the action or the other subscribers, and its error is reported', async () => {
    const reportError = vi.fn();
    vi.stubGlobal('reportError', reportError);
    const { harness, bug, toldAfterwards } = await failingSubscriber();

    const result = await harness.actions.addSubject({ name: 'Biologie', color: 'green' });

    expect(result.ok).toBe(true);
    expect(dataOf(harness).subjects).toHaveLength(1);
    expect(toldAfterwards()).toBe(1);
    expect(reportError).toHaveBeenCalledExactlyOnceWith(bug);
  });

  it('rethrows the error outside the action where the browser has no reportError', async () => {
    vi.stubGlobal('reportError', undefined);
    const { harness, bug, toldAfterwards } = await failingSubscriber();
    vi.useFakeTimers();

    const result = await harness.actions.addSubject({ name: 'Biologie', color: 'green' });

    expect(result.ok).toBe(true);
    expect(toldAfterwards()).toBe(1);
    expect(() => vi.runAllTimers()).toThrow(bug);
  });
});

describe('actions that are started together', () => {
  it('are applied one after the other, none of them on stale data', async () => {
    const harness = await signedInHarness();
    const { actions } = harness;

    const results = await Promise.all([
      actions.addSubject({ name: 'Biologie', color: 'green' }),
      actions.addSubject({ name: 'Wiskunde', color: 'blue' }),
      actions.addSubject({ name: 'biologie', color: 'red' }),
      actions.toggleBlockedDate('2026-11-20'),
      actions.toggleBlockedDate('2026-11-21'),
      actions.updatePrefs({ sessionMinutes: 45 }),
      actions.updatePrefs({ breakMinutes: 5 }),
      actions.addInboxItems([inboxItem('a', '2026-11-16T07:30:00.000Z')]),
    ]);

    expect(results.every((result) => result.ok)).toBe(true);
    const data = dataOf(harness);
    expect(data.subjects.map((subject) => subject.name)).toStrictEqual(['Biologie', 'Wiskunde']);
    expect(data.blockedDates).toStrictEqual(['2026-11-20', '2026-11-21']);
    expect(data.prefs).toMatchObject({ sessionMinutes: 45, breakMinutes: 5 });
    expect(data.inbox).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem(`sb.data.${harness.store.getState().account?.id}`) ?? '')).toStrictEqual(data);
  });

  it('keeps working after an action failed', async () => {
    const harness = await signedInHarness();
    const [failed, worked] = await Promise.all([
      harness.actions.toggleBlockedDate('geen datum'),
      harness.actions.toggleBlockedDate('2026-11-20'),
    ]);
    expect(failed.ok).toBe(false);
    expect(worked).toStrictEqual({ ok: true, blocked: true });
  });
});
