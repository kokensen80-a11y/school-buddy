/**
 * Regression tests from the review of the store: state that leaks or is changed in
 * place, files and accounts that outlive what points to them, patches that reset
 * what they do not mention, a planner that misbehaves, and tabs that missed a change.
 */
import { StrictMode, act, createElement, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InboxItem, PlanInput, UserData } from '../../types';
import { createStoreHooks } from './hooks';
import { MESSAGES } from './messages';
import {
  NOOR,
  NOW,
  SAM,
  addSampleExam,
  announceStorageChange,
  createHarness,
  disposeHarnesses,
  examDraft,
  fakePlan,
  resetBrowserStorage,
  signedInHarness,
  storedAttachmentIds,
  type Harness,
} from './testSupport';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW_ISO = NOW.toISOString();
const LATER = new Date(2026, 10, 17, 9, 0);

const dataOf = ({ store }: Harness): UserData => {
  const { data } = store.getState();
  if (!data) throw new Error('Expected a signed-in store.');
  return data;
};
const accountIdOf = ({ store }: Harness): string => store.getState().account?.id ?? '';
const dataKeyOf = (harness: Harness) => `sb.data.${accountIdOf(harness)}`;

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

/** Unwraps a successful result; a failure fails the test with its message. */
async function done<T extends object>(
  action: Promise<({ ok: true } & T) | { ok: false; error: string }>,
): Promise<{ ok: true } & T> {
  const result = await action;
  if (!result.ok) throw new Error(result.error);
  return result;
}

const inboxItem = (id: string, link?: string): InboxItem => ({
  id,
  at: NOW_ISO,
  kind: 'toets',
  title: `Melding ${id}`,
  body: '',
  read: false,
  ...(link === undefined ? {} : { link }),
});

beforeEach(resetBrowserStorage);
afterEach(() => {
  vi.restoreAllMocks();
  disposeHarnesses();
});

describe('snapshots', () => {
  it('no action changes a published snapshot or its own input in place', async () => {
    const harness = await signedInHarness();
    const { actions, store } = harness;
    // Frozen objects throw on every write, which would make the action fail.
    deepFreeze(store.getState());
    store.subscribe(() => deepFreeze(store.getState()));

    const { subject } = await done(actions.addSubject(deepFreeze({ name: 'Bio', color: 'green' })));
    await done(actions.updateSubject(subject.id, deepFreeze({ name: 'Biologie', color: 'teal' })));
    const { exam } = await done(actions.addExam(deepFreeze(examDraft(subject.id))));
    await done(
      actions.updateExam(exam.id, deepFreeze({ title: 'Nieuw', topics: [...exam.topics] })),
    );
    await done(actions.setGrade(exam.id, 7.5));
    await done(actions.setGrade(exam.id, undefined));
    const { topics } = await done(
      actions.addTopics(
        exam.id,
        deepFreeze([{ title: 'H5', estMinutes: 30, difficulty: 1, mastered: false }]),
      ),
    );
    await done(actions.updateTopic(exam.id, topics[0].id, deepFreeze({ mastered: true })));
    await done(actions.moveTopic(exam.id, topics[0].id, 0));
    await done(actions.deleteTopic(exam.id, topics[0].id));
    const { attachment } = await done(actions.addAttachment(exam.id, new File(['x'], 'x.txt')));
    await done(actions.removeAttachment(exam.id, attachment.id));
    const [session] = dataOf(harness).sessions;
    await done(actions.completeSession(session.id));
    await done(actions.reopenSession(session.id));
    await done(actions.skipSession(session.id));
    await done(
      actions.moveSession(session.id, deepFreeze({ date: '2026-11-20', start: '10:00' })),
    );
    await done(actions.unpinSession(session.id));
    await done(actions.toggleBlockedDate('2026-11-21'));
    await done(actions.toggleBlockedDate('2026-11-19'));
    await done(actions.toggleBlockedDate('2026-11-21'));
    await done(
      actions.updatePrefs(deepFreeze({ leadDays: 5, notifications: { enabled: true } })),
    );
    await done(actions.completeOnboarding());
    await done(actions.addInboxItems(deepFreeze([inboxItem('a'), inboxItem('b')])));
    await done(actions.markInboxRead('a'));
    await done(actions.markInboxRead('all'));
    await done(actions.clearInbox());
    await done(actions.replan());
    await done(actions.importData(actions.exportData()));
    await done(actions.updateAccount(deepFreeze({ name: 'Sammie' })));
    await done(actions.deleteExam(exam.id));
    await done(actions.deleteSubject(subject.id));
    await done(actions.logout());
    await done(actions.login(SAM));
  });

  it('a planner that sorts and edits its input in place cannot touch what was published', async () => {
    const sloppy = (input: PlanInput) => {
      const result = structuredClone(fakePlan(input));
      input.exams.reverse();
      input.previous.reverse();
      for (const session of input.previous) session.minutes += 5;
      input.prefs.methods.length = 0;
      input.blockedDates.push('2026-12-25');
      return result;
    };
    const harness = await signedInHarness(SAM, sloppy);
    await addSampleExam(harness);
    await addSampleExam(harness, { title: 'Tweede toets' }, 'Frans');
    const before = harness.store.getState();
    const copy = structuredClone(before);

    await expect(harness.actions.replan()).resolves.toStrictEqual({ ok: true });

    expect(before).toStrictEqual(copy);
    expect(harness.store.getState()).toStrictEqual(copy);
  });
});

describe('attachments of other exams', () => {
  it('keeps the file when removeAttachment names an exam that does not hold it', async () => {
    const harness = await signedInHarness();
    const exam = await addSampleExam(harness);
    const other = await addSampleExam(harness, { title: 'Andere toets' }, 'Frans');
    const { attachment } = await done(
      harness.actions.addAttachment(exam.id, new File(['inhoud'], 'x.txt')),
    );

    await harness.actions.removeAttachment(other.id, attachment.id);
    await harness.actions.removeAttachment('bestaat-niet', attachment.id);

    expect(dataOf(harness).exams[0].attachments).toStrictEqual([attachment]);
    await expect(storedAttachmentIds()).resolves.toStrictEqual([attachment.id]);
    const blob = await harness.actions.getAttachmentBlob(attachment.id);
    await expect(blob?.text()).resolves.toBe('inhoud');
  });
});

describe('patches', () => {
  it('updateExam leaves a required field alone when the patch holds undefined for it', async () => {
    const harness = await signedInHarness();
    const exam = await addSampleExam(harness, { kind: 'so', location: 'Lokaal 3' });

    const result = await harness.actions.updateExam(exam.id, {
      subjectId: undefined,
      title: undefined,
      kind: undefined,
      date: undefined,
      location: undefined,
      notes: 'Let op',
    });

    expect(result).toMatchObject({
      ok: true,
      exam: {
        subjectId: exam.subjectId,
        title: exam.title,
        kind: 'so',
        date: exam.date,
        notes: 'Let op',
      },
    });
    // An optional field is still cleared by undefined.
    expect(result.ok && 'location' in result.exam).toBe(false);
  });

  it('updateTopic leaves a required field alone when the patch holds undefined for it', async () => {
    const harness = await signedInHarness();
    const exam = await addSampleExam(harness);
    const topic = exam.topics[1];
    await harness.actions.updateTopic(exam.id, topic.id, { mastered: true, notes: 'Blz. 12' });

    const result = await harness.actions.updateTopic(exam.id, topic.id, {
      title: undefined,
      estMinutes: undefined,
      difficulty: undefined,
      mastered: undefined,
      notes: undefined,
    });

    expect(result).toStrictEqual({
      ok: true,
      topic: { id: topic.id, title: 'Hoofdstuk 4', estMinutes: 45, difficulty: 3, mastered: true },
    });
  });

  it.each([
    ['updateExam with an empty patch', (h: Harness, id: string) => h.actions.updateExam(id, {})],
    [
      'updateExam with the values it already has',
      (h: Harness, id: string) => {
        const [{ title, date, kind, topics }] = dataOf(h).exams;
        return h.actions.updateExam(id, { title: ` ${title} `, date, kind, topics });
      },
    ],
    [
      'updateTopic with the values it already has',
      (h: Harness, id: string) => {
        const [topic] = dataOf(h).exams[0].topics;
        return h.actions.updateTopic(id, topic.id, { title: topic.title, mastered: false });
      },
    ],
    ['setGrade with the grade it already has', (h: Harness, id: string) => h.actions.setGrade(id, 7.5)],
  ])('%s changes nothing: no new timestamp, no save, no notification', async (_case, act) => {
    const harness = await signedInHarness();
    const exam = await addSampleExam(harness);
    await harness.actions.setGrade(exam.id, 7.5);
    harness.setNow(LATER);
    await harness.actions.replan();
    const before = harness.store.getState();
    const notificationsBefore = harness.notifications();
    const setItem = vi.spyOn(Storage.prototype, 'setItem');

    const result = await act(harness, exam.id);

    expect(result.ok).toBe(true);
    expect(harness.store.getState()).toBe(before);
    expect(harness.notifications()).toBe(notificationsBefore);
    expect(setItem).not.toHaveBeenCalled();
  });
});

describe('a planner that crashes while signing in', () => {
  const crash = () => {
    throw new Error('planner bug');
  };

  it('does not lock you out at start: you get your data with the plan as it was stored', async () => {
    const first = await signedInHarness();
    await addSampleExam(first);

    const reloaded = createHarness(crash);
    await expect(reloaded.actions.init()).resolves.toStrictEqual({ ok: true });

    expect(reloaded.store.getState()).toStrictEqual(first.store.getState());
    // What depends on the planner still reports the problem; the rest keeps working.
    await expect(reloaded.actions.replan()).resolves.toStrictEqual({
      ok: false,
      error: MESSAGES.unknown,
    });
    await expect(reloaded.actions.completeOnboarding()).resolves.toStrictEqual({ ok: true });
    expect(JSON.parse(reloaded.actions.exportData())).toMatchObject({ accountName: 'Sam' });
  });

  it('does not leave login half done: the session and the state agree', async () => {
    const first = await signedInHarness();
    await addSampleExam(first);
    const stored = dataOf(first);
    await first.actions.logout();

    const other = createHarness(crash);
    await other.actions.init();
    const result = await other.actions.login({ email: SAM.email, password: SAM.password });

    expect(result).toMatchObject({ ok: true, account: { email: SAM.email } });
    expect(other.store.getState().status).toBe('signedIn');
    expect(dataOf(other)).toStrictEqual(stored);
    expect(localStorage.getItem('sb.session')).toContain(accountIdOf(other));
  });
});

describe('inbox links', () => {
  it('keeps in-app links only, whoever hands in the item', async () => {
    const harness = await signedInHarness();

    await harness.actions.addInboxItems([
      inboxItem('script', 'javascript:alert(1)'),
      inboxItem('extern', 'https://evil.example/'),
      inboxItem('pad', '/toetsen'),
      inboxItem('intern', '#/toetsen/abc'),
    ]);

    const links = Object.fromEntries(dataOf(harness).inbox.map((item) => [item.id, item.link]));
    expect(links).toStrictEqual({
      script: undefined,
      extern: undefined,
      pad: undefined,
      intern: '#/toetsen/abc',
    });
  });
});

describe('a tab that missed what happened elsewhere', () => {
  /** A second store on the same storage whose changes are not announced by a storage event. */
  const silentTab = async (): Promise<Harness> => {
    const harness = createHarness();
    await harness.actions.init();
    return harness;
  };

  it('looks again when the page comes back from the back/forward cache', async () => {
    const tabA = await signedInHarness();
    const tabB = await silentTab();
    await tabB.actions.addSubject({ name: 'Frans', color: 'pink' });
    const callsBefore = tabA.plannerCalls.length;

    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));

    await vi.waitFor(() => expect(dataOf(tabA)).toStrictEqual(dataOf(tabB)));
    expect(tabA.plannerCalls).toHaveLength(callsBefore);
  });

  it('looks again when the tab becomes visible, and signs out when the account is gone', async () => {
    const tabA = await signedInHarness();
    const tabB = await silentTab();
    await tabB.actions.deleteAccount({ password: SAM.password });

    document.dispatchEvent(new Event('visibilitychange'));

    await vi.waitFor(() => expect(tabA.store.getState().status).toBe('signedOut'));
  });

  it('does not look when the page is shown for the first time or is being hidden', async () => {
    const tabA = await signedInHarness();
    const tabB = await silentTab();
    await tabB.actions.addSubject({ name: 'Frans', color: 'pink' });
    const before = tabA.store.getState();

    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: false }));
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    await tabA.actions.completeOnboarding();

    expect(dataOf(tabA).subjects).toStrictEqual([]);
    expect(tabA.store.getState()).not.toBe(before);
  });

  it('stops looking after dispose', async () => {
    const tabA = await signedInHarness();
    const tabB = await silentTab();
    await tabB.actions.addSubject({ name: 'Frans', color: 'pink' });
    tabA.store.dispose();

    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(dataOf(tabA).subjects).toStrictEqual([]);
  });
});

describe('accounts in two tabs', () => {
  it('a signed-out tab follows a login in another tab, with that account only', async () => {
    const tabA = await signedInHarness(SAM);
    await addSampleExam(tabA);
    await tabA.actions.logout();
    await tabA.actions.register(NOOR);
    await tabA.actions.logout();
    const tabB = createHarness();
    await tabB.actions.init();
    await tabB.actions.login({ email: SAM.email, password: SAM.password });

    announceStorageChange('sb.session');

    await vi.waitFor(() => expect(tabA.store.getState().status).toBe('signedIn'));
    expect(tabA.store.getState()).toStrictEqual(tabB.store.getState());
    expect(dataOf(tabA).exams).toHaveLength(1);
  });

  it('a tab that has not heard of an account switch still writes to its own account only', async () => {
    const tabA = await signedInHarness(SAM);
    const samKey = dataKeyOf(tabA);
    const tabB = createHarness();
    await tabB.actions.init();
    await tabB.actions.logout();
    await tabB.actions.register(NOOR);
    await tabB.actions.addSubject({ name: 'Frans', color: 'pink' });
    const noorStored = localStorage.getItem(dataKeyOf(tabB));

    await tabA.actions.addSubject({ name: 'Duits', color: 'red' });

    expect(localStorage.getItem(dataKeyOf(tabB))).toBe(noorStored);
    expect(localStorage.getItem(samKey)).toContain('Duits');
    expect(localStorage.getItem(samKey)).not.toContain('Frans');
  });

  it('a change to the stored data of another account changes nothing here', async () => {
    const tabA = await signedInHarness(SAM);
    const before = tabA.store.getState();
    localStorage.setItem('sb.data.iemand-anders', JSON.stringify({ version: 1, onboarded: true }));

    announceStorageChange('sb.data.iemand-anders');
    await tabA.actions.replan();

    expect(tabA.store.getState()).toBe(before);
  });
});

describe('hooks in StrictMode', () => {
  it('start the store once and render once per real change', async () => {
    const consoleError = vi.spyOn(console, 'error');
    const first = await signedInHarness();
    await addSampleExam(first);
    const reloaded = createHarness();
    const hooks = createStoreHooks(reloaded.store);
    const picked: unknown[] = [];

    function Exams() {
      const exams = hooks.useExams();
      picked.push(
        hooks.useAppState((state) => ({ titles: state.data?.exams.map((exam) => exam.title) })),
      );
      return createElement('p', null, String(exams.length));
    }
    function App() {
      const status = hooks.useAuthStatus();
      useEffect(() => {
        void reloaded.actions.init();
      }, []);
      return status === 'signedIn' ? createElement(Exams) : createElement('p', null, status);
    }

    const container = document.createElement('div');
    const root = createRoot(container);
    await act(async () => {
      root.render(createElement(StrictMode, null, createElement(App)));
      await reloaded.actions.init();
    });
    expect(container.textContent).toBe('1');
    expect(reloaded.plannerCalls).toHaveLength(1);

    const rendersBefore = picked.length;
    await act(async () => {
      await reloaded.actions.replan();
      await reloaded.actions.markInboxRead('all');
    });
    expect(picked).toHaveLength(rendersBefore);

    act(() => root.unmount());
    expect(consoleError).not.toHaveBeenCalled();
  });
});
