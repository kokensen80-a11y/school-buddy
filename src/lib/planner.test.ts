// @vitest-environment node
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { generatePlan, LATEST_END_MINUTES } from './planner';
import { DEFAULT_PREFS } from './defaults';
import { parseTime } from './date';
import type { Exam, PlanInput, StudySession, Topic } from '../types';

const topic = (id: string, est = 60, difficulty: 1 | 2 | 3 = 2, mastered = false): Topic => ({
  id,
  title: `Onderdeel ${id}`,
  estMinutes: est,
  difficulty,
  mastered,
});

const exam = (id: string, date: string, topics: Topic[]): Exam => ({
  id,
  subjectId: 's1',
  title: `Toets ${id}`,
  kind: 'toets',
  date,
  topics,
  attachments: [],
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
});

const base = (exams: Exam[], over: Partial<PlanInput> = {}): PlanInput => ({
  today: '2026-11-16',
  nowMinutes: 9 * 60,
  exams,
  prefs: structuredClone(DEFAULT_PREFS),
  previous: [],
  blockedDates: [],
  ...over,
});

function minutesFor(sessions: StudySession[], examId: string, topicId: string, kind: string) {
  return sessions
    .filter((s) => s.examId === examId && s.kind === kind && s.status !== 'overgeslagen')
    .flatMap((s) => s.parts)
    .filter((p) => p.topicId === topicId)
    .reduce((sum, p) => sum + p.minutes, 0);
}

describe('generatePlan', () => {
  it('plans all learning and a final review before the exam', () => {
    const e = exam('e1', '2026-11-26', [topic('a'), topic('b', 90, 3), topic('c', 30, 1)]);
    const { sessions, warnings } = generatePlan(base([e]));
    expect(warnings).toEqual([]);
    expect(sessions.every((s) => s.date >= '2026-11-16' && s.date < '2026-11-26')).toBe(true);
    expect(minutesFor(sessions, 'e1', 'a', 'leren')).toBe(60);
    expect(minutesFor(sessions, 'e1', 'b', 'leren')).toBe(90);
    for (const t of ['a', 'b', 'c']) expect(minutesFor(sessions, 'e1', t, 'eindherhaling')).toBeGreaterThan(0);
    const lastLearn = sessions.filter((s) => s.kind === 'leren').map((s) => s.date).sort().at(-1)!;
    const firstFinal = sessions.filter((s) => s.kind === 'eindherhaling').map((s) => s.date).sort()[0];
    expect(firstFinal >= lastLearn).toBe(true);
  });

  it('skips learning for mastered topics but still reviews them', () => {
    const e = exam('e1', '2026-11-26', [topic('a', 60, 2, true)]);
    const { sessions } = generatePlan(base([e]));
    expect(minutesFor(sessions, 'e1', 'a', 'leren')).toBe(0);
    expect(minutesFor(sessions, 'e1', 'a', 'eindherhaling')).toBeGreaterThan(0);
  });

  it('warns when there is too little time', () => {
    const e = exam('e1', '2026-11-17', [topic('a', 600), topic('b', 600)]);
    const { warnings } = generatePlan(base([e]));
    expect(warnings).toEqual([expect.objectContaining({ type: 'te-weinig-tijd', examId: 'e1' })]);
  });

  it('warns and plans generic blocks for an exam without material', () => {
    const { sessions, warnings } = generatePlan(base([exam('e1', '2026-11-24', [])]));
    expect(warnings).toEqual([{ type: 'geen-leerstof', examId: 'e1' }]);
    expect(sessions.length).toBeGreaterThan(0);
    expect(sessions.every((s) => s.parts.length === 0)).toBe(true);
  });

  it('respects blocked days, rest days and "now"', () => {
    const prefs = structuredClone(DEFAULT_PREFS);
    prefs.minutesPerWeekday = [90, 90, 0, 90, 90, 90, 90];
    const { sessions } = generatePlan(
      base([exam('e1', '2026-11-25', [topic('a', 240)])], {
        prefs,
        blockedDates: ['2026-11-19'],
        nowMinutes: 17 * 60 + 2,
      }),
    );
    expect(sessions.some((s) => s.date === '2026-11-18' || s.date === '2026-11-19')).toBe(false);
    for (const s of sessions.filter((s) => s.date === '2026-11-16')) expect(parseTime(s.start)).toBeGreaterThanOrEqual(17 * 60 + 5);
  });

  it('keeps done blocks and marks missed blocks, and does not plan done work again', () => {
    const e = exam('e1', '2026-11-26', [topic('a', 60)]);
    const first = generatePlan(base([e], { today: '2026-11-14' })).sessions;
    const done = first.map((s, i) => (i === 0 ? { ...s, status: 'gedaan' as const } : s));
    const { sessions } = generatePlan(base([e], { previous: done }));
    expect(sessions.find((s) => s.id === done[0].id)?.status).toBe('gedaan');
    const missed = sessions.filter((s) => s.date < '2026-11-16' && s.id !== done[0].id);
    expect(missed.every((s) => s.status === 'overgeslagen')).toBe(true);
    expect(minutesFor(sessions, 'e1', 'a', 'leren')).toBe(60);
  });

  it('keeps pinned and today\'s blocks in place', () => {
    const e = exam('e1', '2026-11-26', [topic('a', 120)]);
    const first = generatePlan(base([e])).sessions;
    const moved = first.map((s, i) => (i === 1 ? { ...s, date: '2026-11-20', start: '19:00', pinned: true } : s));
    const { sessions } = generatePlan(base([e], { previous: moved }));
    const pinned = sessions.find((s) => s.id === moved[1].id)!;
    expect([pinned.date, pinned.start]).toEqual(['2026-11-20', '19:00']);
  });

  it('keeps today stable on a re-plan and respects capacity, overlap and the 22:30 limit', () => {
    const arb = fc.record({
      exams: fc.array(
        fc.record({
          offset: fc.integer({ min: -3, max: 30 }),
          topics: fc.array(fc.record({ est: fc.integer({ min: 0, max: 300 }), d: fc.constantFrom(1, 2, 3), m: fc.boolean() }), { maxLength: 6 }),
        }),
        { maxLength: 5 },
      ),
      now: fc.integer({ min: 0, max: 1439 }),
      style: fc.constantFrom('gespreid', 'vroeg', 'laat'),
      session: fc.constantFrom(20, 25, 30, 45, 60),
      minutes: fc.array(fc.constantFrom(0, 30, 60, 90, 180), { minLength: 7, maxLength: 7 }),
    });
    fc.assert(
      fc.property(arb, (a) => {
        const prefs = structuredClone(DEFAULT_PREFS);
        prefs.planStyle = a.style as typeof prefs.planStyle;
        prefs.sessionMinutes = a.session;
        prefs.minutesPerWeekday = a.minutes as typeof prefs.minutesPerWeekday;
        const exams = a.exams.map((x, i) => {
          const d = new Date(Date.UTC(2026, 10, 16 + x.offset));
          const date = d.toISOString().slice(0, 10);
          return exam(`e${i}`, date, x.topics.map((t, j) => topic(`t${j}`, t.est, t.d as 1 | 2 | 3, t.m)));
        });
        const input = base(exams, { prefs, nowMinutes: a.now });
        const one = generatePlan(input);
        const two = generatePlan({ ...input, previous: one.sessions });
        // Re-planning never moves today's blocks. (Later days may shift a little when several
        // exams compete for the same days; that is accepted.)
        const todayOf = (r: typeof one) => r.sessions.filter((x) => x.date === '2026-11-16');
        expect(todayOf(two)).toEqual(todayOf(one));
        if (exams.length <= 1) expect(two).toEqual(one);
        const byDate = new Map<string, StudySession[]>();
        for (const s of one.sessions) byDate.set(s.date, [...(byDate.get(s.date) ?? []), s]);
        for (const [date, list] of byDate) {
          const cap = prefs.minutesPerWeekday[(new Date(date + 'T00:00:00Z').getUTCDay() + 6) % 7];
          expect(list.reduce((sum, s) => sum + s.minutes, 0)).toBeLessThanOrEqual(cap);
          const sorted = [...list].sort((x, y) => x.start.localeCompare(y.start));
          for (let i = 0; i < sorted.length; i++) {
            const s = sorted[i];
            expect(parseTime(s.start) + s.minutes).toBeLessThanOrEqual(LATEST_END_MINUTES);
            expect(s.parts.reduce((sum, p) => sum + p.minutes, 0)).toBe(s.parts.length ? s.minutes : 0);
            if (i > 0) expect(parseTime(s.start)).toBeGreaterThanOrEqual(parseTime(sorted[i - 1].start) + sorted[i - 1].minutes);
          }
          if (date === '2026-11-16') for (const s of list) expect(parseTime(s.start)).toBeGreaterThanOrEqual(a.now);
        }
        for (const s of one.sessions) expect(s.date < exams.find((e) => e.id === s.examId)!.date).toBe(true);
      }),
      { numRuns: 300, seed: 42 },
    );
  });
});
