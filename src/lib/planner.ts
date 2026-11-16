/**
 * The study planner: turns exams, material and preferences into study blocks.
 *
 * How it works (pure and deterministic, so the same input always gives the same plan):
 * 1. History. Done and skipped blocks stay as they are. Planned blocks in the past become
 *    'overgeslagen' (missed). Planned blocks today, and blocks the user moved by hand
 *    (pinned), are kept where they are. Every other planned block is thrown away and
 *    planned again, so the plan always reflects the latest exams and preferences.
 * 2. Work. Per topic there is learning (estMinutes, skipped when mastered), one or two
 *    spaced reviews (about a third of the time, two for difficult topics) and a short
 *    final review (about a fifth). Work already done or kept is subtracted.
 * 3. Days. An exam is prepared from `leadDays` before it up to the day before. When the
 *    must-do work (learning + final review) does not fit, the window grows back to today.
 *    Exams are planned soonest first, so a close exam gets the time it needs first.
 * 4. Placement. Final reviews go on the last study day(s). Learning is spread according to
 *    the plan style (evenly, early or late). Reviews go on a day at least two days after
 *    the topic was learned, when there is room; otherwise they are dropped.
 * 5. Blocks. Each day's work is cut into blocks of at most `sessionMinutes`, placed from
 *    the start time with a break in between, never after 22:30 and never before "now".
 * Whatever must-do work does not fit is reported as a 'te-weinig-tijd' warning.
 */
import type {
  Difficulty,
  Exam,
  ID,
  ISODate,
  PlanInput,
  PlanResult,
  PlanWarning,
  Preferences,
  SessionKind,
  SessionPart,
  StudyMethod,
  StudySession,
  Topic,
  TopicProgress,
} from '../types';
import { addDays, dateRange, formatTime, isWeekend, parseTime, weekdayIndex } from './date';

/** No block ends later than this (minutes since midnight). */
export const LATEST_END_MINUTES = 22 * 60 + 30;
/** Pseudo topic for an exam without material; its blocks get no parts. */
const GENERIC = '__algemeen';
const KIND_ORDER: SessionKind[] = ['leren', 'herhalen', 'eindherhaling'];

const round5 = (n: number) => Math.max(5, Math.round(n / 5) * 5);

// ───────────────────────── Work per topic ─────────────────────────

function safeMinutes(est: number): number {
  return Number.isFinite(est) ? Math.min(600, Math.max(5, est)) : 30;
}

export function learnMinutes(topic: Topic): number {
  return topic.mastered ? 0 : round5(safeMinutes(topic.estMinutes));
}

export function finalReviewMinutes(topic: Topic): number {
  const factor: Record<Difficulty, number> = { 1: 0.15, 2: 0.2, 3: 0.25 };
  return round5(safeMinutes(topic.estMinutes) * (factor[topic.difficulty] ?? 0.2));
}

/** Minutes of each spaced review, and how many reviews the topic gets. */
export function reviewPlan(topic: Topic): { minutes: number; count: number } {
  return {
    minutes: Math.max(10, round5(safeMinutes(topic.estMinutes) * 0.33)),
    count: topic.difficulty === 3 && !topic.mastered ? 2 : 1,
  };
}

function required(topic: Topic, kind: SessionKind): number {
  if (kind === 'leren') return learnMinutes(topic);
  if (kind === 'eindherhaling') return finalReviewMinutes(topic);
  const r = reviewPlan(topic);
  return r.minutes * r.count;
}

function genericTopic(prefs: Preferences): Topic {
  return { id: GENERIC, title: '', estMinutes: prefs.sessionMinutes * 2, difficulty: 2, mastered: false };
}

// ───────────────────────── Preferences ─────────────────────────

function sanitize(prefs: Preferences): Preferences {
  const clamp = (n: number, lo: number, hi: number, fallback: number) =>
    Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : fallback;
  return {
    ...prefs,
    sessionMinutes: round5(clamp(prefs.sessionMinutes, 10, 180, 30)),
    breakMinutes: clamp(prefs.breakMinutes, 0, 60, 10),
    leadDays: clamp(prefs.leadDays, 1, 365, 10),
    methods: prefs.methods.length > 0 ? prefs.methods : ['samenvatten'],
    minutesPerWeekday: prefs.minutesPerWeekday.map((m) => clamp(m, 0, 1440, 0)) as Preferences['minutesPerWeekday'],
  };
}

export function capacityOf(date: ISODate, prefs: Preferences, blocked: ReadonlySet<ISODate>): number {
  return blocked.has(date) ? 0 : prefs.minutesPerWeekday[weekdayIndex(date)];
}

// ───────────────────────── Methods ─────────────────────────

const SUITABLE: Record<SessionKind, StudyMethod[]> = {
  leren: ['samenvatten', 'lezen', 'mindmap', 'uitleggen'],
  herhalen: ['flashcards', 'overhoren', 'oefenen', 'uitleggen'],
  eindherhaling: ['overhoren', 'oefenen', 'flashcards'],
};

function pickMethod(prefs: Preferences, kind: SessionKind, seed: number): StudyMethod {
  const options = prefs.methods.filter((m) => SUITABLE[kind].includes(m));
  return options.length > 0 ? options[seed % options.length] : prefs.methods[0];
}

// ───────────────────────── Day state ─────────────────────────

interface Alloc {
  examId: ID;
  topicId: ID;
  kind: SessionKind;
  minutes: number;
}

interface Day {
  date: ISODate;
  /** Minutes still free for new work. */
  free: number;
  /** Earliest start of the first new block. */
  start: number;
  allocs: Alloc[];
}

function buildDays(input: PlanInput, prefs: Preferences, kept: StudySession[], lastDate: ISODate): Map<ISODate, Day> {
  const blocked = new Set(input.blockedDates);
  const days = new Map<ISODate, Day>();
  const nowStart = Math.ceil(input.nowMinutes / 5) * 5;
  for (const date of dateRange(input.today, lastDate)) {
    const onDay = kept.filter((s) => s.date === date);
    // Today's kept blocks are booked per exam later (see generatePlan), so the day looks
    // the same to every exam as it did when those blocks were first planned.
    const used = date === input.today ? 0 : onDay.reduce((sum, s) => sum + s.minutes, 0);
    let fitStart = parseTime(isWeekend(date) ? prefs.weekendStart : prefs.weekdayStart);
    if (date === input.today) fitStart = Math.max(fitStart, nowStart);
    let start = fitStart;
    for (const s of onDay) {
      if (s.status === 'gepland') start = Math.max(start, parseTime(s.start) + s.minutes + prefs.breakMinutes);
    }
    // What fits before 22:30: whole blocks with breaks, plus a shorter last block.
    const window = LATEST_END_MINUTES - fitStart;
    const S = prefs.sessionMinutes;
    const B = prefs.breakMinutes;
    const full = window <= 0 ? 0 : Math.floor((window + B) / (S + B));
    const rest = window - full * (S + B);
    const fits = Math.max(0, full * S + (rest >= 5 ? Math.floor(rest / 5) * 5 : 0));
    const free = Math.max(0, Math.min(capacityOf(date, prefs, blocked) - used, fits));
    days.set(date, { date, free: Math.floor(free / 5) * 5, start, allocs: [] });
  }
  return days;
}

function allocate(day: Day, examId: ID, topicId: ID, kind: SessionKind, minutes: number): number {
  const take = Math.min(minutes, day.free);
  if (take < 5) return 0;
  const rounded = Math.floor(take / 5) * 5;
  day.free -= rounded;
  const last = day.allocs[day.allocs.length - 1];
  if (last && last.examId === examId && last.topicId === topicId && last.kind === kind) last.minutes += rounded;
  else day.allocs.push({ examId, topicId, kind, minutes: rounded });
  return rounded;
}

// ───────────────────────── Main ─────────────────────────

export function generatePlan(input: PlanInput): PlanResult {
  const prefs = sanitize(input.prefs);
  const { today } = input;
  const examById = new Map(input.exams.map((e) => [e.id, e]));

  // 1. History
  const kept: StudySession[] = [];
  for (const s of input.previous) {
    const exam = examById.get(s.examId);
    if (!exam) continue;
    if (s.status !== 'gepland') {
      kept.push(s);
    } else if (s.date < today) {
      kept.push({ ...s, status: 'overgeslagen', pinned: s.pinned });
    } else if ((s.date === today || s.pinned) && exam.date > s.date) {
      const topicIds = new Set(exam.topics.map((t) => t.id));
      const parts = s.parts.filter((p) => topicIds.has(p.topicId));
      if (s.parts.length > 0 && parts.length === 0) continue;
      const minutes = parts.length > 0 ? parts.reduce((sum, p) => sum + p.minutes, 0) : s.minutes;
      kept.push({ ...s, parts, minutes });
    }
  }

  // Work already covered, per exam + topic + kind (done counts, kept planned counts).
  const covered = new Map<string, number>();
  const key = (examId: ID, topicId: ID, kind: SessionKind) => `${examId}|${topicId}|${kind}`;
  for (const s of kept) {
    if (s.status === 'overgeslagen') continue;
    const parts: SessionPart[] = s.parts.length > 0 ? s.parts : [{ topicId: GENERIC, minutes: s.minutes }];
    for (const p of parts) covered.set(key(s.examId, p.topicId, s.kind), (covered.get(key(s.examId, p.topicId, s.kind)) ?? 0) + p.minutes);
  }
  const remaining = (examId: ID, topic: Topic, kind: SessionKind) =>
    Math.max(0, required(topic, kind) - (covered.get(key(examId, topic.id, kind)) ?? 0));

  const future = input.exams
    .filter((e) => e.date > today)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const lastDate = future.length > 0 ? addDays(future[future.length - 1].date, -1) : today;
  const days = buildDays(input, prefs, kept, lastDate);
  const warnings: PlanWarning[] = [];
  const learnedOn = new Map<string, ISODate>();
  // Learning kept from history (done, or planned today) counts as learned on that day.
  const keptLearnToday = new Map<ID, number>();
  for (const s of kept) {
    if (s.kind !== 'leren' || s.status === 'overgeslagen') continue;
    for (const p of s.parts) {
      const k = `${s.examId}|${p.topicId}`;
      const prev = learnedOn.get(k);
      if (!prev || s.date > prev) learnedOn.set(k, s.date);
    }
    if (s.date === today) {
      const mins = s.parts.length > 0 ? s.parts.reduce((sum, p) => sum + p.minutes, 0) : s.minutes;
      keptLearnToday.set(s.examId, (keptLearnToday.get(s.examId) ?? 0) + mins);
    }
  }

  const todayDay = days.get(today);
  const bookToday = (examId: ID | null) => {
    if (!todayDay) return;
    for (const s of kept) {
      if (s.date !== today) continue;
      const own = examId === null ? !future.some((e) => e.id === s.examId) : s.examId === examId;
      if (own) todayDay.free = Math.max(0, todayDay.free - s.minutes);
    }
  };
  bookToday(null);

  for (const exam of future) {
    bookToday(exam.id);
    const topics = exam.topics.length > 0 ? exam.topics : [genericTopic(prefs)];
    if (exam.topics.length === 0) warnings.push({ type: 'geen-leerstof', examId: exam.id });
    const dayBefore = addDays(exam.date, -1);
    const mustDo = topics.reduce((sum, t) => sum + remaining(exam.id, t, 'leren') + remaining(exam.id, t, 'eindherhaling'), 0);

    // 3. Window: leadDays before the exam, extended back to today when it does not fit.
    let first = addDays(exam.date, -prefs.leadDays);
    if (first < today) first = today;
    const freeIn = (from: ISODate) => dateRange(from, dayBefore).reduce((sum, d) => sum + (days.get(d)?.free ?? 0), 0);
    // Blocks kept today mean the plan already started today; keep it that way.
    const startedToday = kept.some((k) => k.date === today && k.examId === exam.id && k.status !== 'overgeslagen');
    if (startedToday || freeIn(first) < mustDo) first = today;
    const window = dateRange(first, dayBefore).map((d) => days.get(d)!).filter((d) => d && d.free >= 5);
    let missing = 0;

    // 4a. Final reviews on the last study days.
    let finalFrom = dayBefore;
    for (const topic of topics) {
      let need = remaining(exam.id, topic, 'eindherhaling');
      for (let i = window.length - 1; i >= 0 && need > 0; i--) {
        const got = allocate(window[i], exam.id, topic.id, 'eindherhaling', need);
        if (got > 0 && window[i].date < finalFrom) finalFrom = window[i].date;
        need -= got;
      }
      missing += need;
    }

    // 4b. Learning, spread by plan style, on days up to the first final-review day.
    const learnDays = window.filter((d) => d.date <= finalFrom);
    const order = prefs.planStyle === 'laat' ? [...learnDays].reverse() : learnDays;
    // Learning goes into the days in a single forward pass. With 'gespreid' every day takes its
    // share of the work that is still open at that point; today's share is based on the work
    // open at the start of today, so keeping or ticking off today's blocks changes nothing.
    const keptToday = keptLearnToday.get(exam.id) ?? 0;
    const capOf = (d: Day) => d.free + (d.date === today ? keptToday : 0);
    const queue = topics.map((t) => ({ topic: t, need: remaining(exam.id, t, 'leren') }));
    let open = queue.reduce((sum, item) => sum + item.need, 0) + keptToday;
    const fillDay = (d: Day, budget: number) => {
      let left = budget;
      for (const item of queue) {
        if (left < 5) break;
        if (item.need <= 0) continue;
        const got = allocate(d, exam.id, item.topic.id, 'leren', Math.min(item.need, left));
        item.need -= got;
        left -= got;
        if (got > 0) {
          const k = `${exam.id}|${item.topic.id}`;
          const prev = learnedOn.get(k);
          if (!prev || d.date > prev) learnedOn.set(k, d.date);
        }
      }
      return budget - left;
    };
    for (let i = 0; i < order.length; i++) {
      const d = order[i];
      const own = d.date === today ? keptToday : 0;
      let budget = d.free;
      if (prefs.planStyle === 'gespreid') {
        const capRest = order.slice(i).reduce((sum, x) => sum + capOf(x), 0);
        const share = capRest > 0 ? Math.ceil((open * capOf(d)) / capRest / 5) * 5 : 0;
        budget = Math.max(0, Math.min(d.free, share - own));
      }
      open -= fillDay(d, budget) + own;
    }
    for (const d of order) fillDay(d, d.free); // whatever is left after rounding
    missing += queue.reduce((sum, item) => sum + item.need, 0);

    // 4c. Spaced reviews, best effort, between learning and the final review.
    for (const topic of topics) {
      if (topic.id === GENERIC) continue;
      const plan = reviewPlan(topic);
      let need = remaining(exam.id, topic, 'herhalen');
      const learned = learnedOn.get(`${exam.id}|${topic.id}`) ?? addDays(first, -2);
      let earliest = addDays(learned, 2);
      for (const d of window) {
        if (need <= 0) break;
        if (d.date < earliest || d.date > finalFrom) continue;
        if (d.free < plan.minutes) continue;
        need -= allocate(d, exam.id, topic.id, 'herhalen', Math.min(plan.minutes, need));
        earliest = addDays(d.date, 2);
      }
    }

    if (missing > 0) warnings.push({ type: 'te-weinig-tijd', examId: exam.id, missingMinutes: missing });
  }

  // 5. Cut each day's work into blocks.
  const fresh: StudySession[] = [];
  const usedIds = new Set(kept.map((s) => s.id));
  const uniqueId = (base: string) => {
    let id = base;
    for (let n = 2; usedIds.has(id); n++) id = `${base}.${n}`;
    usedIds.add(id);
    return id;
  };
  for (const day of days.values()) {
    const sorted = [...day.allocs].sort(
      (a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.examId.localeCompare(b.examId),
    );
    let cursor = day.start;
    let seq = 0;
    let i = 0;
    while (i < sorted.length) {
      const head = sorted[i];
      const parts: SessionPart[] = [];
      let size = 0;
      while (i < sorted.length && sorted[i].examId === head.examId && sorted[i].kind === head.kind && size < prefs.sessionMinutes) {
        const take = Math.min(sorted[i].minutes, prefs.sessionMinutes - size);
        const last = parts[parts.length - 1];
        if (last && last.topicId === sorted[i].topicId) last.minutes += take;
        else parts.push({ topicId: sorted[i].topicId, minutes: take });
        size += take;
        sorted[i] = { ...sorted[i], minutes: sorted[i].minutes - take };
        if (sorted[i].minutes <= 0) i++;
      }
      if (cursor + size > LATEST_END_MINUTES) break;
      fresh.push({
        id: uniqueId(`${head.examId}:${head.kind}:${day.date}:${seq}`),
        examId: head.examId,
        parts: parts.filter((p) => p.topicId !== GENERIC),
        date: day.date,
        start: formatTime(cursor),
        minutes: size,
        kind: head.kind,
        method: pickMethod(prefs, head.kind, weekdayIndex(day.date) + seq),
        status: 'gepland',
        pinned: false,
      });
      seq++;
      cursor += size + prefs.breakMinutes;
    }
  }

  const sessions = [...kept, ...fresh].sort(
    (a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start) || a.id.localeCompare(b.id),
  );
  return { sessions, warnings };
}

/** Per-topic progress for one exam, derived from the sessions. */
export function topicProgress(exam: Exam, sessions: StudySession[], _prefs: Preferences): TopicProgress[] {
  return exam.topics.map((topic) => {
    let doneMinutes = 0;
    let plannedMinutes = 0;
    for (const s of sessions) {
      if (s.examId !== exam.id) continue;
      for (const p of s.parts) {
        if (p.topicId !== topic.id) continue;
        if (s.status === 'gedaan') doneMinutes += p.minutes;
        else if (s.status === 'gepland') plannedMinutes += p.minutes;
      }
    }
    const requiredMinutes = KIND_ORDER.reduce((sum, k) => sum + required(topic, k), 0);
    return { topicId: topic.id, requiredMinutes, doneMinutes, plannedMinutes };
  });
}
