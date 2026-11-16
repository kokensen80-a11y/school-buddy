/**
 * Shared helpers for the store tests (not part of the app): a store on the real
 * local backends with a fast password hash, a fixed clock and a recording planner.
 */
import { IDBFactory } from 'fake-indexeddb';
import type { Exam, PlanInput, PlanResult, PlanWarning, StudySession } from '../../types';
import { createAppStore } from './createStore';
import { createLocalAuthBackend } from './localAuth';
import { createLocalDataBackend } from './localData';
import type { Actions, AppStore, ExamDraft, Planner, RegisterInput } from './types';

/** Monday 16 November 2026, 15:30 local time. */
export const NOW = new Date(2026, 10, 16, 15, 30, 0, 0);
export const TODAY = '2026-11-16';
export const NOW_MINUTES = 15 * 60 + 30;

export const SAM: RegisterInput = {
  name: 'Sam',
  email: 'sam@example.com',
  password: 'test-wachtwoord-1',
};

export const NOOR: RegisterInput = {
  name: 'Noor',
  email: 'noor@example.com',
  password: 'test-wachtwoord-2',
};

/** Empties localStorage and replaces IndexedDB by a fresh, empty one. */
export function resetBrowserStorage(): void {
  localStorage.clear();
  globalThis.indexedDB = new IDBFactory();
}

/**
 * A tiny deterministic planner: keeps the blocks of exams that still exist, gives
 * every exam without blocks one block today, and warns about exams without topics.
 */
export function fakePlan(input: PlanInput): PlanResult {
  const examIds = new Set(input.exams.map((exam) => exam.id));
  const sessions: StudySession[] = input.previous.filter((session) => examIds.has(session.examId));
  for (const exam of input.exams) {
    if (sessions.some((session) => session.examId === exam.id)) continue;
    sessions.push({
      id: `blok-${exam.id}`,
      examId: exam.id,
      parts: exam.topics.slice(0, 1).map((topic) => ({ topicId: topic.id, minutes: 30 })),
      date: input.today,
      start: '16:00',
      minutes: 30,
      kind: 'leren',
      method: input.prefs.methods[0],
      status: 'gepland',
      pinned: false,
    });
  }
  const warnings: PlanWarning[] = input.exams
    .filter((exam) => exam.topics.length === 0)
    .map((exam) => ({ type: 'geen-leerstof', examId: exam.id }));
  return { sessions, warnings };
}

export interface Harness {
  store: AppStore;
  actions: Actions;
  /** Every input the planner was called with, oldest first. */
  plannerCalls: PlanInput[];
  /** How often subscribers were notified. */
  notifications: () => number;
  setNow: (now: Date) => void;
}

const openStores: AppStore[] = [];

/** A new store on the shared browser storage: also what a page reload or a second tab gives you. */
export function createHarness(planner: Planner = fakePlan): Harness {
  let now = NOW;
  const clock = () => now;
  const plannerCalls: PlanInput[] = [];
  const store = createAppStore({
    auth: createLocalAuthBackend({ iterations: 10, clock }),
    data: createLocalDataBackend(),
    planner: (input) => {
      plannerCalls.push(input);
      return planner(input);
    },
    clock,
  });
  openStores.push(store);
  let notifications = 0;
  store.subscribe(() => {
    notifications += 1;
  });
  return {
    store,
    actions: store.actions,
    plannerCalls,
    notifications: () => notifications,
    setNow: (next) => {
      now = next;
    },
  };
}

/** Detaches every store made by createHarness from the window. Call it after each test. */
export function disposeHarnesses(): void {
  for (const store of openStores.splice(0)) store.dispose();
}

/** A started store with a freshly registered, signed-in account. */
export async function signedInHarness(
  account: RegisterInput = SAM,
  planner?: Planner,
): Promise<Harness> {
  const harness = createHarness(planner);
  await harness.actions.init();
  const result = await harness.actions.register(account);
  if (!result.ok) throw new Error(`Could not register the test account: ${result.error}`);
  return harness;
}

export function examDraft(subjectId: string, overrides: Partial<ExamDraft> = {}): ExamDraft {
  return {
    subjectId,
    title: 'Hoofdstuk 3 en 4',
    kind: 'toets',
    date: '2026-11-27',
    topics: [
      { title: 'Hoofdstuk 3', estMinutes: 60, difficulty: 2, mastered: false },
      { title: 'Hoofdstuk 4', estMinutes: 45, difficulty: 3, mastered: false },
    ],
    ...overrides,
  };
}

/** Adds a subject and an exam with two topics; returns the stored exam. */
export async function addSampleExam(
  { actions }: Harness,
  overrides: Partial<ExamDraft> = {},
  subjectName = 'Biologie',
): Promise<Exam> {
  const subject = await actions.addSubject({ name: subjectName, color: 'green' });
  if (!subject.ok) throw new Error(`Could not add the test subject: ${subject.error}`);
  const exam = await actions.addExam(examDraft(subject.subject.id, overrides));
  if (!exam.ok) throw new Error(`Could not add the test exam: ${exam.error}`);
  return exam.exam;
}

/** Tells this window that "another tab" changed a localStorage key, as the browser would. */
export function announceStorageChange(key: string | null): void {
  window.dispatchEvent(
    new StorageEvent('storage', {
      key,
      newValue: key === null ? null : localStorage.getItem(key),
      storageArea: localStorage,
    }),
  );
}

/** The ids of every attachment file in IndexedDB, of all accounts together. */
export function storedAttachmentIds(): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('school-buddy');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const database = open.result;
      if (!database.objectStoreNames.contains('attachments')) {
        database.close();
        resolve([]);
        return;
      }
      const keys = database.transaction('attachments').objectStore('attachments').getAllKeys();
      keys.onerror = () => reject(keys.error);
      keys.onsuccess = () => {
        database.close();
        resolve(keys.result.map(String).sort());
      };
    };
  });
}

/** Makes every localStorage write fail as if the storage were full, until the returned function is called. */
export function fillStorage(): () => void {
  const original = Storage.prototype.setItem;
  Storage.prototype.setItem = () => {
    throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
  };
  return () => {
    Storage.prototype.setItem = original;
  };
}

/** Makes localStorage unreachable, as with blocked site data, until the returned function is called. */
export function blockStorage(): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(window, 'localStorage');
  if (!descriptor) throw new Error('This test environment has no own window.localStorage.');
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    get() {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    },
  });
  return () => {
    Object.defineProperty(window, 'localStorage', descriptor);
  };
}
