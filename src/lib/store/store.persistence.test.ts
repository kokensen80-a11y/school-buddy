import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserData } from '../../types';
import { DEFAULT_PREFS, createEmptyUserData } from '../defaults';
import { MESSAGES } from './messages';
import { sanitizeUserData } from './sanitize';
import {
  NOOR,
  NOW,
  SAM,
  addSampleExam,
  announceStorageChange,
  blockStorage,
  createHarness,
  disposeHarnesses,
  fillStorage,
  resetBrowserStorage,
  signedInHarness,
  storedAttachmentIds,
  type Harness,
} from './testSupport';

const STORAGE_FULL =
  'De opslag van je browser is vol. Verwijder een paar bijlagen of oude toetsen en probeer het opnieuw.';
const STORAGE_UNAVAILABLE =
  'Opslaan lukt niet in deze browser. Zit je in een privévenster? Probeer het dan in een gewoon venster.';

const dataOf = ({ store }: Harness): UserData => {
  const { data } = store.getState();
  if (!data) throw new Error('Expected a signed-in store.');
  return data;
};
const accountIdOf = ({ store }: Harness): string => store.getState().account?.id ?? '';
const dataKeyOf = (harness: Harness) => `sb.data.${accountIdOf(harness)}`;
const storedData = (harness: Harness): unknown =>
  JSON.parse(localStorage.getItem(dataKeyOf(harness)) ?? 'null');

/** A store that is signed in to the same account as `first`: a second tab, or the page after a reload. */
async function secondTab(): Promise<Harness> {
  const harness = createHarness();
  await harness.actions.init();
  return harness;
}

beforeEach(resetBrowserStorage);
afterEach(() => {
  vi.restoreAllMocks();
  disposeHarnesses();
});

describe('saving', () => {
  it('writes the data to localStorage after every change', async () => {
    const harness = await signedInHarness();
    expect(storedData(harness)).toStrictEqual(createEmptyUserData());

    await addSampleExam(harness);
    expect(storedData(harness)).toStrictEqual(dataOf(harness));

    await harness.actions.completeSession(dataOf(harness).sessions[0].id);
    expect(storedData(harness)).toStrictEqual(dataOf(harness));

    await harness.actions.updatePrefs({ notifications: { enabled: true } });
    expect(storedData(harness)).toStrictEqual(dataOf(harness));
  });

  it('stores exactly what a later start reads back', async () => {
    const harness = await signedInHarness();
    const exam = await addSampleExam(harness, { time: '09:15', weight: 2, notes: 'Let op' });
    await harness.actions.addAttachment(exam.id, new File(['x'], 'x.txt', { type: 'text/plain' }));
    await harness.actions.setGrade(exam.id, 6.5);
    await harness.actions.completeSession(dataOf(harness).sessions[0].id);
    await harness.actions.toggleBlockedDate('2026-11-20');
    await harness.actions.addInboxItems([
      { id: 'a', at: NOW.toISOString(), kind: 'toets', title: 'Bijna', body: '', read: false },
    ]);

    expect(sanitizeUserData(storedData(harness), 'unused')).toStrictEqual(dataOf(harness));

    const reloaded = await secondTab();
    expect(reloaded.store.getState()).toStrictEqual(harness.store.getState());
  });
});

describe('damaged or old stored data', () => {
  it('starts with empty data when the stored text is not JSON', async () => {
    const first = await signedInHarness();
    await addSampleExam(first);
    localStorage.setItem(dataKeyOf(first), '{"version":1,"exams":[{');

    const reloaded = await secondTab();

    expect(reloaded.store.getState().status).toBe('signedIn');
    expect(dataOf(reloaded)).toStrictEqual(createEmptyUserData());
  });

  it('repairs what it can and drops what it cannot', async () => {
    const first = await signedInHarness();
    const exam = await addSampleExam(first);
    const stored = storedData(first) as Record<string, unknown[]> & { prefs: unknown };
    stored.exams.push({ id: 'zonder-vak', subjectId: 'weg', title: 'X', date: '2026-12-01' }, 17);
    stored.sessions.push({ id: 'wees', examId: 'weg', date: '2026-12-01', start: '10:00', minutes: 30 });
    stored.subjects.push(null);
    stored.prefs = { sessionMinutes: 'lang', methods: ['zingen'], planStyle: 'laat' };
    delete (stored as Record<string, unknown>).inbox;
    (stored as Record<string, unknown>).version = 0;
    localStorage.setItem(dataKeyOf(first), JSON.stringify(stored));

    const reloaded = await secondTab();

    const data = dataOf(reloaded);
    expect(data.version).toBe(1);
    expect(data.exams).toStrictEqual([exam]);
    expect(data.sessions.map((session) => session.examId)).toStrictEqual([exam.id]);
    expect(data.subjects).toHaveLength(1);
    expect(data.prefs).toStrictEqual({ ...DEFAULT_PREFS, planStyle: 'laat' });
    expect(data.inbox).toStrictEqual([]);
    // The repaired version replaces the damaged one in storage.
    expect(storedData(reloaded)).toStrictEqual(data);
  });

  it('gives an account without stored data an empty start', async () => {
    const first = await signedInHarness();
    localStorage.removeItem(dataKeyOf(first));
    const reloaded = await secondTab();
    expect(dataOf(reloaded)).toStrictEqual(createEmptyUserData());
  });

  it.each([
    ['a damaged account list', 'sb.accounts', '[{"id":'],
    ['an account list of the wrong shape', 'sb.accounts', '{"sam":true}'],
    ['a damaged session', 'sb.session', 'ingelogd'],
    ['a session of the wrong shape', 'sb.session', '[1,2,3]'],
  ])('is simply signed out with %s', async (_case, key, value) => {
    await signedInHarness();
    localStorage.setItem(key, value);

    const reloaded = createHarness();
    await expect(reloaded.actions.init()).resolves.toStrictEqual({ ok: true });

    expect(reloaded.store.getState().status).toBe('signedOut');
  });
});

describe('two tabs', () => {
  it('shows a change that was made in the other tab', async () => {
    const tabA = await signedInHarness();
    const tabB = await secondTab();
    const callsBefore = tabA.plannerCalls.length;
    const notificationsBefore = tabA.notifications();

    await addSampleExam(tabB);
    expect(dataOf(tabA).exams).toStrictEqual([]);
    const written = localStorage.getItem(dataKeyOf(tabB));
    announceStorageChange(dataKeyOf(tabB));

    await vi.waitFor(() => expect(dataOf(tabA)).toStrictEqual(dataOf(tabB)));
    expect(tabA.notifications()).toBe(notificationsBefore + 1);
    // Tab A only adopts: it does not plan or write again, so the tabs cannot ping-pong.
    expect(tabA.plannerCalls).toHaveLength(callsBefore);
    expect(localStorage.getItem(dataKeyOf(tabB))).toBe(written);
  });

  it('keeps the identity of what the other tab did not change', async () => {
    const tabA = await signedInHarness();
    await addSampleExam(tabA);
    const tabB = await secondTab();
    const before = dataOf(tabA);
    const accountBefore = tabA.store.getState().account;

    await tabB.actions.addSubject({ name: 'Frans', color: 'pink' });
    announceStorageChange(dataKeyOf(tabB));

    await vi.waitFor(() => expect(dataOf(tabA).subjects).toHaveLength(2));
    const after = dataOf(tabA);
    expect(after.exams).toBe(before.exams);
    expect(after.sessions).toBe(before.sessions);
    expect(after.prefs).toBe(before.prefs);
    expect(after.subjects[0]).toBe(before.subjects[0]);
    expect(tabA.store.getState().account).toBe(accountBefore);
  });

  it('does nothing when the announced change makes no difference', async () => {
    const tabA = await signedInHarness();
    await addSampleExam(tabA);
    const before = tabA.store.getState();
    const notificationsBefore = tabA.notifications();

    announceStorageChange(dataKeyOf(tabA));
    announceStorageChange('sb.accounts');
    await tabA.actions.replan();

    expect(tabA.store.getState()).toBe(before);
    expect(tabA.notifications()).toBe(notificationsBefore);
  });

  it('signs out when the other tab signs out', async () => {
    const tabA = await signedInHarness();
    const tabB = await secondTab();

    await tabB.actions.logout();
    announceStorageChange('sb.session');

    await vi.waitFor(() => expect(tabA.store.getState().status).toBe('signedOut'));
    expect(tabA.store.getState()).toStrictEqual({ status: 'signedOut', account: null, data: null });
  });

  it('signs out when the other tab deletes the account', async () => {
    const tabA = await signedInHarness();
    const tabB = await secondTab();

    await tabB.actions.deleteAccount({ password: SAM.password });
    announceStorageChange('sb.accounts');

    await vi.waitFor(() => expect(tabA.store.getState().status).toBe('signedOut'));
  });

  it('follows the other tab to another account', async () => {
    const tabA = await signedInHarness(SAM);
    await addSampleExam(tabA);
    const tabB = await secondTab();
    await tabB.actions.logout();
    await tabB.actions.register(NOOR);
    await tabB.actions.addSubject({ name: 'Frans', color: 'pink' });

    announceStorageChange('sb.session');

    await vi.waitFor(() => expect(tabA.store.getState().account?.email).toBe(NOOR.email));
    expect(tabA.store.getState()).toStrictEqual(tabB.store.getState());
  });

  it('shows a new name that was saved in the other tab', async () => {
    const tabA = await signedInHarness();
    const tabB = await secondTab();
    const dataBefore = dataOf(tabA);

    await tabB.actions.updateAccount({ name: 'Samira' });
    announceStorageChange('sb.accounts');

    await vi.waitFor(() => expect(tabA.store.getState().account?.name).toBe('Samira'));
    expect(dataOf(tabA)).toBe(dataBefore);
  });

  it('signs out when the site data was cleared', async () => {
    const tabA = await signedInHarness();
    localStorage.clear();
    announceStorageChange(null);
    await vi.waitFor(() => expect(tabA.store.getState().status).toBe('signedOut'));
  });

  it('ignores keys of others, events of sessionStorage and everything after dispose', async () => {
    const tabA = await signedInHarness();
    const tabB = await secondTab();
    const before = tabA.store.getState();

    localStorage.setItem('iets-anders', '1');
    announceStorageChange('iets-anders');
    await tabB.actions.addSubject({ name: 'Frans', color: 'pink' });
    window.dispatchEvent(
      new StorageEvent('storage', { key: dataKeyOf(tabB), storageArea: sessionStorage }),
    );
    await tabA.actions.replan();
    expect(tabA.store.getState()).toBe(before);

    tabA.store.dispose();
    announceStorageChange(dataKeyOf(tabB));
    await tabA.actions.replan();
    expect(tabA.store.getState()).toBe(before);
  });

  it('does not act on other tabs before it has started itself', async () => {
    await signedInHarness();
    const starting = createHarness();
    announceStorageChange('sb.session');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(starting.store.getState().status).toBe('loading');
    await starting.actions.init();
    expect(starting.store.getState().status).toBe('signedIn');
  });
});

describe('storage that is full or unavailable', () => {
  it('returns a friendly error and leaves the state alone when storage is full', async () => {
    const harness = await signedInHarness();
    const exam = await addSampleExam(harness);
    const before = harness.store.getState();
    const notificationsBefore = harness.notifications();
    const storedBefore = localStorage.getItem(dataKeyOf(harness));
    const full = { ok: false, error: STORAGE_FULL };

    const release = fillStorage();
    await expect(harness.actions.addSubject({ name: 'Frans', color: 'pink' })).resolves.toStrictEqual(full);
    await expect(harness.actions.updateExam(exam.id, { title: 'Nieuw' })).resolves.toStrictEqual(full);
    await expect(harness.actions.completeSession(dataOf(harness).sessions[0].id)).resolves.toStrictEqual(full);
    await expect(harness.actions.updatePrefs({ sessionMinutes: 45 })).resolves.toStrictEqual(full);
    await expect(harness.actions.updateAccount({ name: 'Samira' })).resolves.toStrictEqual(full);
    await expect(
      harness.actions.changePassword({ current: SAM.password, next: 'nieuw-wachtwoord' }),
    ).resolves.toStrictEqual(full);
    release();

    expect(harness.store.getState()).toBe(before);
    expect(harness.notifications()).toBe(notificationsBefore);
    expect(localStorage.getItem(dataKeyOf(harness))).toBe(storedBefore);

    // Once there is room again, everything works as before.
    await expect(harness.actions.addSubject({ name: 'Frans', color: 'pink' })).resolves.toMatchObject({
      ok: true,
    });
    expect(storedData(harness)).toStrictEqual(dataOf(harness));
  });

  it('cannot register or sign in when storage is full', async () => {
    const harness = createHarness();
    await harness.actions.init();
    await harness.actions.register(NOOR);
    await harness.actions.logout();

    const release = fillStorage();
    await expect(harness.actions.register(SAM)).resolves.toStrictEqual({
      ok: false,
      error: STORAGE_FULL,
    });
    await expect(
      harness.actions.login({ email: NOOR.email, password: NOOR.password }),
    ).resolves.toStrictEqual({ ok: false, error: STORAGE_FULL });
    release();

    expect(harness.store.getState().status).toBe('signedOut');
    expect(JSON.parse(localStorage.getItem('sb.accounts') ?? '[]')).toHaveLength(1);
  });

  it('still starts and signs in when only the re-planned data cannot be saved', async () => {
    const first = await signedInHarness();
    await addSampleExam(first);

    const release = fillStorage();
    const reloaded = createHarness();
    await expect(reloaded.actions.init()).resolves.toStrictEqual({ ok: true });
    release();

    expect(reloaded.store.getState()).toStrictEqual(first.store.getState());
  });

  it('starts signed out and explains itself when storage cannot be used at all', async () => {
    const unblock = blockStorage();
    try {
      const harness = createHarness();
      await expect(harness.actions.init()).resolves.toStrictEqual({ ok: true });
      expect(harness.store.getState().status).toBe('signedOut');

      await expect(harness.actions.register(SAM)).resolves.toStrictEqual({
        ok: false,
        error: STORAGE_UNAVAILABLE,
      });
      await expect(
        harness.actions.login({ email: SAM.email, password: SAM.password }),
      ).resolves.toMatchObject({ ok: false });
      await expect(harness.actions.logout()).resolves.toStrictEqual({ ok: true });
      expect(harness.store.getState().status).toBe('signedOut');
    } finally {
      unblock();
    }
  });

  it('returns a friendly error when storage becomes unavailable while signed in', async () => {
    const harness = await signedInHarness();
    const before = harness.store.getState();
    const unblock = blockStorage();
    try {
      await expect(harness.actions.addSubject({ name: 'Frans', color: 'pink' })).resolves.toStrictEqual(
        { ok: false, error: STORAGE_UNAVAILABLE },
      );
    } finally {
      unblock();
    }
    expect(harness.store.getState()).toBe(before);
  });

  it('tells it when the account is gone but its files could not be removed', async () => {
    const harness = await signedInHarness();
    vi.stubGlobal('indexedDB', undefined);
    try {
      await expect(harness.actions.deleteAccount({ password: SAM.password })).resolves.toStrictEqual({
        ok: false,
        error: MESSAGES.accountDataLeftBehind,
      });
    } finally {
      vi.unstubAllGlobals();
    }
    expect(harness.store.getState().status).toBe('signedOut');
    expect(localStorage.getItem('sb.accounts')).toBe('[]');
  });
});

describe('export and import', () => {
  it('exports pretty JSON with a format marker, the account name and the data', async () => {
    const harness = await signedInHarness();
    await addSampleExam(harness);

    const json = harness.actions.exportData();

    expect(json).toContain('\n  "format": "school-buddy-backup"');
    expect(JSON.parse(json)).toStrictEqual({
      format: 'school-buddy-backup',
      version: 1,
      exportedAt: NOW.toISOString(),
      accountName: 'Sam',
      data: dataOf(harness),
    });
  });

  it('never exports the password hash, the salt or the e-mail address', async () => {
    const harness = await signedInHarness();
    const [stored] = JSON.parse(localStorage.getItem('sb.accounts') ?? '[]') as Array<{
      password: { hash: string; salt: string };
    }>;

    const json = harness.actions.exportData();

    expect(json).not.toContain(stored.password.hash);
    expect(json).not.toContain(stored.password.salt);
    expect(json).not.toContain(SAM.email);
    expect(json).not.toContain(SAM.password);
    expect(json).not.toMatch(/password|PBKDF2/i);
  });

  it('brings everything back after an export and an import', async () => {
    const harness = await signedInHarness();
    const exam = await addSampleExam(harness, { time: '09:15', notes: 'Let op' });
    await harness.actions.completeSession(dataOf(harness).sessions[0].id);
    await harness.actions.toggleBlockedDate('2026-11-20');
    await harness.actions.updatePrefs({ sessionMinutes: 45, notifications: { enabled: true } });
    await harness.actions.completeOnboarding();
    await harness.actions.addInboxItems([
      { id: 'a', at: NOW.toISOString(), kind: 'toets', title: 'Bijna', body: 'Nog 3 dagen', read: true },
    ]);
    const exported = dataOf(harness);
    const json = harness.actions.exportData();

    await harness.actions.deleteExam(exam.id);
    await harness.actions.deleteSubject(exam.subjectId);
    await harness.actions.clearInbox();
    await harness.actions.updatePrefs({ sessionMinutes: 20 });
    await addSampleExam(harness, { title: 'Iets heel anders' }, 'Frans');
    const callsBefore = harness.plannerCalls.length;
    const notificationsBefore = harness.notifications();

    await expect(harness.actions.importData(json)).resolves.toStrictEqual({ ok: true });

    expect(dataOf(harness)).toStrictEqual(exported);
    expect(harness.plannerCalls).toHaveLength(callsBefore + 1);
    expect(harness.plannerCalls.at(-1)?.exams).toStrictEqual(exported.exams);
    expect(harness.notifications()).toBe(notificationsBefore + 1);
    expect(storedData(harness)).toStrictEqual(exported);

    const reloaded = await secondTab();
    expect(dataOf(reloaded)).toStrictEqual(exported);
  });

  it('moves the data to another account, without the account itself', async () => {
    const harness = await signedInHarness(SAM);
    await addSampleExam(harness);
    const exported = dataOf(harness);
    const json = harness.actions.exportData();
    await harness.actions.logout();
    await harness.actions.register(NOOR);

    await expect(harness.actions.importData(json)).resolves.toStrictEqual({ ok: true });

    expect(dataOf(harness)).toStrictEqual(exported);
    expect(harness.store.getState().account).toMatchObject({ name: 'Noor', email: NOOR.email });
  });

  it('keeps the attachments whose files are on this device and drops all others', async () => {
    const harness = await signedInHarness();
    const exam = await addSampleExam(harness);
    const kept = await harness.actions.addAttachment(exam.id, new File(['blijft'], 'blijft.txt'));
    if (!kept.ok) throw new Error(kept.error);
    const backup = JSON.parse(harness.actions.exportData()) as { data: UserData };
    // After the export one file is added on the device, and the backup is given an
    // attachment that this device has never seen…
    const added = await harness.actions.addAttachment(exam.id, new File(['later'], 'later.txt'));
    if (!added.ok) throw new Error(added.error);
    const unknown = { ...kept.attachment, id: 'van-een-ander-apparaat', name: 'elders.txt' };
    backup.data.exams[0].attachments.push(unknown);
    // …and a second exam that claims the file of the first one.
    backup.data.exams.push({
      ...backup.data.exams[0],
      id: 'tweede-toets',
      attachments: [{ ...kept.attachment, name: 'dubbel.txt' }],
    });

    await expect(harness.actions.importData(JSON.stringify(backup))).resolves.toStrictEqual({
      ok: true,
    });

    expect(dataOf(harness).exams.map((item) => item.attachments)).toStrictEqual([
      [kept.attachment],
      [],
    ]);
    await expect(storedAttachmentIds()).resolves.toStrictEqual([kept.attachment.id]);
    const blob = await harness.actions.getAttachmentBlob(kept.attachment.id);
    await expect(blob?.text()).resolves.toBe('blijft');
    await expect(harness.actions.getAttachmentBlob(added.attachment.id)).resolves.toBeUndefined();
  });

  it('never takes over attachments of a backup from another account', async () => {
    const harness = await signedInHarness(SAM);
    const exam = await addSampleExam(harness);
    const file = await harness.actions.addAttachment(exam.id, new File(['van sam'], 'sam.txt'));
    if (!file.ok) throw new Error(file.error);
    const json = harness.actions.exportData();
    await harness.actions.logout();
    await harness.actions.register(NOOR);

    await harness.actions.importData(json);

    expect(dataOf(harness).exams[0].attachments).toStrictEqual([]);
    await expect(harness.actions.getAttachmentBlob(file.attachment.id)).resolves.toBeUndefined();
    await expect(storedAttachmentIds()).resolves.toStrictEqual([file.attachment.id]);
  });

  it('sanitises what it imports', async () => {
    const harness = await signedInHarness();
    await addSampleExam(harness);
    const backup = JSON.parse(harness.actions.exportData()) as {
      data: Record<string, unknown[]> & { prefs: unknown };
    };
    backup.data.exams.push({ id: 'kapot', title: 'Zonder vak en datum' });
    backup.data.sessions.push('geen blok');
    backup.data.prefs = { leadDays: -1, methods: ['oefenen', 'tekenen'] };

    await expect(harness.actions.importData(JSON.stringify(backup))).resolves.toStrictEqual({
      ok: true,
    });

    const data = dataOf(harness);
    expect(data.exams).toHaveLength(1);
    expect(data.sessions).toHaveLength(1);
    expect(data.prefs).toStrictEqual({ ...DEFAULT_PREFS, methods: ['oefenen'] });
  });

  it.each([
    ['text that is not JSON', 'Dit is mijn back-up', MESSAGES.importInvalid],
    ['an empty file', '', MESSAGES.importInvalid],
    ['JSON without the format marker', '{"data":{"version":1}}', MESSAGES.importInvalid],
    ['another format', '{"format":"iets-anders","data":{}}', MESSAGES.importInvalid],
    ['a backup without data', '{"format":"school-buddy-backup"}', MESSAGES.importInvalid],
    ['data that is a list', '{"format":"school-buddy-backup","data":[]}', MESSAGES.importInvalid],
    ['a JSON array', '[1,2,3]', MESSAGES.importInvalid],
    ['null', 'null', MESSAGES.importInvalid],
    [
      'a backup of a newer app',
      '{"format":"school-buddy-backup","version":2,"data":{"version":2}}',
      MESSAGES.importTooNew,
    ],
    [
      'data of a newer version',
      '{"format":"school-buddy-backup","version":1,"data":{"version":3}}',
      MESSAGES.importTooNew,
    ],
  ])('refuses %s and keeps the current data', async (_case, json, error) => {
    const harness = await signedInHarness();
    await addSampleExam(harness);
    const before = harness.store.getState();
    const callsBefore = harness.plannerCalls.length;

    await expect(harness.actions.importData(json)).resolves.toStrictEqual({ ok: false, error });

    expect(harness.store.getState()).toBe(before);
    expect(harness.plannerCalls).toHaveLength(callsBefore);
  });

  it('keeps the current data and files when the import cannot be saved', async () => {
    const harness = await signedInHarness();
    const exam = await addSampleExam(harness);
    const file = await harness.actions.addAttachment(exam.id, new File(['x'], 'x.txt'));
    if (!file.ok) throw new Error(file.error);
    const before = harness.store.getState();
    const emptyBackup = JSON.stringify({ format: 'school-buddy-backup', version: 1, data: {} });

    const release = fillStorage();
    const result = await harness.actions.importData(emptyBackup);
    release();

    expect(result).toStrictEqual({ ok: false, error: STORAGE_FULL });
    expect(harness.store.getState()).toBe(before);
    await expect(storedAttachmentIds()).resolves.toStrictEqual([file.attachment.id]);
  });
});
