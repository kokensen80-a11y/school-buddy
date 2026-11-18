/**
 * The data changes behind the actions, as pure functions: a recipe takes the current
 * UserData and returns the next one (or a friendly failure). No storage, no planner,
 * no clock; the store supplies the timestamp and the id generator, re-plans and saves.
 *
 * Recipes never mutate their input. They do not have to care about object identity:
 * the store keeps every part that did not change (see structural.ts).
 */
import type {
  AttachmentMeta,
  Exam,
  ID,
  InboxItem,
  ISODate,
  ISODateTime,
  StudySession,
  Subject,
  TimeOfDay,
  Topic,
  UserData,
} from '../../types';
import { isValidISODate, isValidTime } from '../date';
import { ALL_EXAM_KINDS, SUBJECT_COLOR_ORDER } from '../labels';
import { MESSAGES, fail } from './messages';
import {
  cleanGrade,
  cleanText,
  cleanTopicMinutes,
  cleanWeight,
  normalizeInbox,
  oneOf,
  optionalExamFields,
  sanitizeInboxItem,
  sanitizePrefs,
  subjectNameKey,
} from './sanitize';
import { reuseEqual } from './structural';
import type {
  ExamDraft,
  ExamPatch,
  Failure,
  PrefsPatch,
  SubjectInput,
  SubjectPatch,
  TopicDraft,
  TopicPatch,
} from './types';

export interface MutationContext {
  now: ISODateTime;
  newId: () => ID;
}

/** The outcome of a recipe: the next data plus what the action hands back to its caller. */
export type Step<T extends object = object> = Failure | { ok: true; data: UserData; extra: T };

export type Recipe<T extends object = object> = (
  data: UserData,
  context: MutationContext,
) => Step<T>;

function step(data: UserData): Step;
function step<T extends object>(data: UserData, extra: T): Step<T>;
function step(data: UserData, extra: object = {}): Step {
  return { ok: true, data, extra };
}

/**
 * `patch` laid over `current`. A field that cannot be empty keeps its current value
 * when the patch holds `undefined` for it, the same as when the patch leaves it out.
 */
function merge<T extends object>(current: T, patch: Partial<T>, required: Array<keyof T>): T {
  const merged = { ...current, ...patch };
  for (const key of required) {
    if (patch[key] === undefined) merged[key] = current[key];
  }
  return merged;
}

// ───────────────────────── Everything at once ─────────────────────────

/** Changes nothing; the store uses it to re-run the planner on the current data. */
export const keepData = (): Recipe => (data) => step(data);

/** Replaces all data (import). */
export const replaceData =
  (next: UserData): Recipe =>
  () =>
    step(next);

// ───────────────────────── Preferences ─────────────────────────

/**
 * The current preferences are the fallback of the sanitiser, so every field that is
 * missing from the patch (also inside `notifications`) or invalid keeps its current value.
 */
export const updatePrefs =
  (patch: PrefsPatch): Recipe =>
  (data) =>
    step({ ...data, prefs: sanitizePrefs({ ...data.prefs, ...patch }, data.prefs) });

export const completeOnboarding = (): Recipe => (data) => step({ ...data, onboarded: true });

// ───────────────────────── Subjects ─────────────────────────

const sameName = (a: string, b: string) => subjectNameKey(a) === subjectNameKey(b);

export const addSubject =
  (input: SubjectInput): Recipe<{ subject: Subject }> =>
  (data, { newId }) => {
    const name = cleanText(input.name);
    if (!name) return fail(MESSAGES.subjectNameRequired);
    const existing = data.subjects.find((subject) => sameName(subject.name, name));
    if (existing) return step(data, { subject: existing });
    const subject: Subject = {
      id: newId(),
      name,
      color: oneOf(SUBJECT_COLOR_ORDER, input.color) ?? 'gray',
    };
    return step({ ...data, subjects: [...data.subjects, subject] }, { subject });
  };

export const updateSubject =
  (id: ID, patch: SubjectPatch): Recipe<{ subject: Subject }> =>
  (data) => {
    const current = data.subjects.find((subject) => subject.id === id);
    if (!current) return fail(MESSAGES.subjectNotFound);
    const name = patch.name === undefined ? current.name : cleanText(patch.name);
    if (!name) return fail(MESSAGES.subjectNameRequired);
    if (data.subjects.some((other) => other.id !== id && sameName(other.name, name))) {
      return fail(MESSAGES.subjectNameTaken);
    }
    const subject: Subject = {
      id,
      name,
      color: oneOf(SUBJECT_COLOR_ORDER, patch.color) ?? current.color,
    };
    const subjects = data.subjects.map((other) => (other.id === id ? subject : other));
    return step({ ...data, subjects }, { subject });
  };

export const deleteSubject =
  (id: ID): Recipe =>
  (data) => {
    if (data.exams.some((exam) => exam.subjectId === id)) return fail(MESSAGES.subjectInUse);
    if (!data.subjects.some((subject) => subject.id === id)) return step(data);
    return step({ ...data, subjects: data.subjects.filter((subject) => subject.id !== id) });
  };

// ───────────────────────── Exams ─────────────────────────

type ExamFields = Omit<ExamDraft, 'topics'>;

const findExam = (data: UserData, id: ID) => data.exams.find((exam) => exam.id === id);

const replaceExam = (data: UserData, exam: Exam): UserData => ({
  ...data,
  exams: data.exams.map((other) => (other.id === exam.id ? exam : other)),
});

/** Validates the editable fields and combines them with the parts of the exam the user cannot edit. */
function buildExam(
  fields: ExamFields,
  subjects: Subject[],
  fixed: Pick<Exam, 'id' | 'topics' | 'attachments' | 'createdAt'>,
  now: ISODateTime,
): Failure | { ok: true; exam: Exam } {
  const title = cleanText(fields.title);
  if (!title) return fail(MESSAGES.examTitleRequired);
  if (!subjects.some((subject) => subject.id === fields.subjectId)) {
    return fail(MESSAGES.examSubjectRequired);
  }
  if (!isValidISODate(fields.date)) return fail(MESSAGES.dateInvalid);
  if (fields.time !== undefined && fields.time !== '' && !isValidTime(fields.time)) {
    return fail(MESSAGES.timeInvalid);
  }
  if (fields.endTime !== undefined && fields.endTime !== '' && !isValidTime(fields.endTime)) {
    return fail(MESSAGES.timeInvalid);
  }
  if (fields.weight !== undefined && cleanWeight(fields.weight) === undefined) {
    return fail(MESSAGES.weightInvalid);
  }
  if (fields.grade !== undefined && cleanGrade(fields.grade) === undefined) {
    return fail(MESSAGES.gradeInvalid);
  }
  return {
    ok: true,
    exam: {
      id: fixed.id,
      subjectId: fields.subjectId,
      title,
      kind: oneOf(ALL_EXAM_KINDS, fields.kind) ?? 'toets',
      date: fields.date,
      ...optionalExamFields(fields),
      topics: fixed.topics,
      attachments: fixed.attachments,
      createdAt: fixed.createdAt,
      updatedAt: now,
    },
  };
}

function buildTopic(draft: TopicDraft, id: ID): Failure | { ok: true; topic: Topic } {
  const title = cleanText(draft.title);
  if (!title) return fail(MESSAGES.topicTitleRequired);
  const estMinutes = cleanTopicMinutes(draft.estMinutes);
  if (estMinutes === undefined) return fail(MESSAGES.topicMinutesInvalid);
  const topic: Topic = {
    id,
    title,
    estMinutes,
    difficulty: draft.difficulty === 1 || draft.difficulty === 3 ? draft.difficulty : 2,
    mastered: draft.mastered === true,
  };
  const notes = cleanText(draft.notes);
  if (notes) topic.notes = notes;
  return { ok: true, topic };
}

/** A draft keeps its id only when that id belongs to one of the `existing` topics (each id once). */
function buildTopics(
  drafts: Array<TopicDraft & { id?: ID }>,
  existing: Topic[],
  newId: () => ID,
): Failure | { ok: true; topics: Topic[] } {
  const reusableIds = new Set(existing.map((topic) => topic.id));
  const topics: Topic[] = [];
  for (const draft of drafts) {
    const id = draft.id !== undefined && reusableIds.delete(draft.id) ? draft.id : newId();
    const built = buildTopic(draft, id);
    if (!built.ok) return built;
    topics.push(built.topic);
  }
  return { ok: true, topics };
}

export const addExam =
  (draft: ExamDraft): Recipe<{ exam: Exam }> =>
  (data, { now, newId }) => {
    const built = buildExam(
      draft,
      data.subjects,
      { id: newId(), topics: [], attachments: [], createdAt: now },
      now,
    );
    if (!built.ok) return built;
    const topics = buildTopics(draft.topics, [], newId);
    if (!topics.ok) return topics;
    const exam: Exam = { ...built.exam, topics: topics.topics };
    return step({ ...data, exams: [...data.exams, exam] }, { exam });
  };

export const updateExam =
  (id: ID, patch: ExamPatch): Recipe<{ exam: Exam }> =>
  (data, { now, newId }) => {
    const current = findExam(data, id);
    if (!current) return fail(MESSAGES.examNotFound);
    const { topics: topicDrafts, ...fields } = patch;
    const merged = merge<ExamFields>(current, fields, ['subjectId', 'title', 'kind', 'date']);
    const built = buildExam(merged, data.subjects, current, now);
    if (!built.ok) return built;
    const topics = topicDrafts ? buildTopics(topicDrafts, current.topics, newId) : undefined;
    if (topics && !topics.ok) return topics;
    const exam: Exam = topics ? { ...built.exam, topics: topics.topics } : built.exam;
    // Only a real change gets a new timestamp (and is saved and announced).
    if (reuseEqual(current, { ...exam, updatedAt: current.updatedAt }) === current) {
      return step(data, { exam: current });
    }
    return step(replaceExam(data, exam), { exam });
  };

/** Also removes the blocks of the exam. (Its warnings go with the re-plan that follows.) */
export const deleteExam =
  (id: ID): Recipe =>
  (data) => {
    if (!findExam(data, id)) return step(data);
    return step({
      ...data,
      exams: data.exams.filter((exam) => exam.id !== id),
      sessions: data.sessions.filter((session) => session.examId !== id),
    });
  };

export const setGrade =
  (id: ID, grade: number | undefined): Recipe<{ exam: Exam }> =>
  (data, { now }) => {
    const current = findExam(data, id);
    if (!current) return fail(MESSAGES.examNotFound);
    const clean = grade === undefined ? undefined : cleanGrade(grade);
    if (grade !== undefined && clean === undefined) return fail(MESSAGES.gradeInvalid);
    if (clean === current.grade) return step(data, { exam: current });
    const exam: Exam = { ...current, updatedAt: now };
    if (clean === undefined) delete exam.grade;
    else exam.grade = clean;
    return step(replaceExam(data, exam), { exam });
  };

// ───────────────────────── Topics ─────────────────────────

const withTopics = (data: UserData, exam: Exam, topics: Topic[], now: ISODateTime): UserData =>
  replaceExam(data, { ...exam, topics, updatedAt: now });

export const addTopics =
  (examId: ID, drafts: TopicDraft[]): Recipe<{ topics: Topic[] }> =>
  (data, { now, newId }) => {
    const exam = findExam(data, examId);
    if (!exam) return fail(MESSAGES.examNotFound);
    const built = buildTopics(drafts, [], newId);
    if (!built.ok) return built;
    if (built.topics.length === 0) return step(data, { topics: [] });
    const topics = [...exam.topics, ...built.topics];
    return step(withTopics(data, exam, topics, now), { topics: built.topics });
  };

export const updateTopic =
  (examId: ID, topicId: ID, patch: TopicPatch): Recipe<{ topic: Topic }> =>
  (data, { now }) => {
    const exam = findExam(data, examId);
    if (!exam) return fail(MESSAGES.examNotFound);
    const current = exam.topics.find((topic) => topic.id === topicId);
    if (!current) return fail(MESSAGES.topicNotFound);
    const merged = merge<TopicDraft>(current, patch, [
      'title',
      'estMinutes',
      'difficulty',
      'mastered',
    ]);
    const built = buildTopic(merged, topicId);
    if (!built.ok) return built;
    if (reuseEqual(current, built.topic) === current) return step(data, { topic: current });
    const topics = exam.topics.map((topic) => (topic.id === topicId ? built.topic : topic));
    return step(withTopics(data, exam, topics, now), { topic: built.topic });
  };

export const deleteTopic =
  (examId: ID, topicId: ID): Recipe =>
  (data, { now }) => {
    const exam = findExam(data, examId);
    if (!exam || !exam.topics.some((topic) => topic.id === topicId)) return step(data);
    const topics = exam.topics.filter((topic) => topic.id !== topicId);
    return step(withTopics(data, exam, topics, now));
  };

/** `toIndex` is the position in the final list; out-of-range values are clamped. */
export const moveTopic =
  (examId: ID, topicId: ID, toIndex: number): Recipe =>
  (data, { now }) => {
    const exam = findExam(data, examId);
    if (!exam) return fail(MESSAGES.examNotFound);
    const from = exam.topics.findIndex((topic) => topic.id === topicId);
    if (from === -1) return fail(MESSAGES.topicNotFound);
    const to = Number.isFinite(toIndex)
      ? Math.max(0, Math.min(exam.topics.length - 1, Math.round(toIndex)))
      : from;
    if (to === from) return step(data);
    const topics = [...exam.topics];
    topics.splice(to, 0, ...topics.splice(from, 1));
    return step(withTopics(data, exam, topics, now));
  };

// ───────────────────────── Attachments (metadata; the files live in the DataBackend) ─────────────────────────

export const addAttachment =
  (examId: ID, attachment: AttachmentMeta): Recipe<{ attachment: AttachmentMeta }> =>
  (data, { now }) => {
    const exam = findExam(data, examId);
    if (!exam) return fail(MESSAGES.examNotFound);
    const attachments = [...exam.attachments, attachment];
    return step(replaceExam(data, { ...exam, attachments, updatedAt: now }), { attachment });
  };

export const removeAttachment =
  (examId: ID, attachmentId: ID): Recipe =>
  (data, { now }) => {
    const exam = findExam(data, examId);
    if (!exam || !exam.attachments.some((attachment) => attachment.id === attachmentId)) {
      return step(data);
    }
    const attachments = exam.attachments.filter((attachment) => attachment.id !== attachmentId);
    return step(replaceExam(data, { ...exam, attachments, updatedAt: now }));
  };

// ───────────────────────── Sessions ─────────────────────────

const changeSession =
  (id: ID, change: (session: StudySession, now: ISODateTime) => StudySession): Recipe =>
  (data, { now }) => {
    if (!data.sessions.some((session) => session.id === id)) {
      return fail(MESSAGES.sessionNotFound);
    }
    const sessions = data.sessions.map((session) =>
      session.id === id ? change(session, now) : session,
    );
    return step({ ...data, sessions });
  };

function withStatus(session: StudySession, status: 'gepland' | 'overgeslagen'): StudySession {
  const changed: StudySession = { ...session, status };
  delete changed.completedAt;
  return changed;
}

/** Completing a block that is already done keeps its original completion time. */
export const completeSession = (id: ID): Recipe =>
  changeSession(id, (session, now) => ({
    ...session,
    status: 'gedaan',
    completedAt: session.status === 'gedaan' && session.completedAt ? session.completedAt : now,
  }));

export const reopenSession = (id: ID): Recipe =>
  changeSession(id, (session) => withStatus(session, 'gepland'));

export const skipSession = (id: ID): Recipe =>
  changeSession(id, (session) => withStatus(session, 'overgeslagen'));

/** Moving a block by hand pins it, so the planner leaves its date and start alone. */
export const moveSession =
  (id: ID, to: { date: ISODate; start: TimeOfDay }): Recipe =>
  (data, context) => {
    if (!isValidISODate(to.date)) return fail(MESSAGES.dateInvalid);
    if (!isValidTime(to.start)) return fail(MESSAGES.timeInvalid);
    const move = changeSession(id, (session) => ({
      ...session,
      date: to.date,
      start: to.start,
      pinned: true,
    }));
    return move(data, context);
  };

export const unpinSession = (id: ID): Recipe =>
  changeSession(id, (session) => ({ ...session, pinned: false }));

// ───────────────────────── Blocked dates ─────────────────────────

export const toggleBlockedDate =
  (date: ISODate): Recipe<{ blocked: boolean }> =>
  (data) => {
    if (!isValidISODate(date)) return fail(MESSAGES.dateInvalid);
    const blocked = !data.blockedDates.includes(date);
    const blockedDates = blocked
      ? [...data.blockedDates, date].sort()
      : data.blockedDates.filter((other) => other !== date);
    return step({ ...data, blockedDates }, { blocked });
  };

// ───────────────────────── Inbox ─────────────────────────

/**
 * Keeps the newest items, newest first. An item whose id is already in the inbox is
 * ignored: of two items with the same id the first one wins, and the inbox comes first.
 */
export const addInboxItems =
  (items: InboxItem[]): Recipe =>
  (data) => {
    const added = items.flatMap((item) => sanitizeInboxItem(item) ?? []);
    return step({ ...data, inbox: normalizeInbox([...data.inbox, ...added]) });
  };

export const markInboxRead =
  (id: string | 'all'): Recipe =>
  (data) => {
    const inbox = data.inbox.map((item) =>
      id === 'all' || item.id === id ? { ...item, read: true } : item,
    );
    return step({ ...data, inbox });
  };

export const clearInbox = (): Recipe => (data) => step({ ...data, inbox: [] });
