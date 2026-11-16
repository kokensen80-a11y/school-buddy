import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createEmptyUserData } from '../defaults';
import { MESSAGES } from './messages';
import {
  NOOR,
  NOW,
  SAM,
  addSampleExam,
  createHarness,
  disposeHarnesses,
  fakePlan,
  resetBrowserStorage,
  signedInHarness,
  storedAttachmentIds,
} from './testSupport';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const storedAccounts = () =>
  JSON.parse(localStorage.getItem('sb.accounts') ?? '[]') as Array<{ id: string; email: string }>;

beforeEach(resetBrowserStorage);
afterEach(disposeHarnesses);

describe('starting up', () => {
  it('goes from loading to signed out when there is no session', async () => {
    const { store, actions, notifications } = createHarness();
    expect(store.getState()).toStrictEqual({ status: 'loading', account: null, data: null });

    await expect(actions.init()).resolves.toStrictEqual({ ok: true });

    expect(store.getState()).toStrictEqual({ status: 'signedOut', account: null, data: null });
    expect(notifications()).toBe(1);
  });

  it('runs only once, however often init is called', async () => {
    const { actions, notifications } = createHarness();
    const first = actions.init();
    const second = actions.init();
    expect(second).toBe(first);
    await Promise.all([first, second]);
    await actions.init();
    expect(notifications()).toBe(1);
  });

  it('never stays on the loading screen when the planner crashes', async () => {
    const first = await signedInHarness();
    const reloaded = createHarness(() => {
      throw new Error('planner bug');
    });
    await expect(reloaded.actions.init()).resolves.toStrictEqual({ ok: true });
    // Signed in with the data as it was stored: see store.hardening.test.ts.
    expect(reloaded.store.getState()).toStrictEqual(first.store.getState());
  });

  it('stops telling a subscriber that unsubscribed', async () => {
    const { store, actions } = createHarness();
    let calls = 0;
    const unsubscribe = store.subscribe(() => {
      calls += 1;
    });
    await actions.init();
    unsubscribe();
    await actions.register(SAM);
    expect(calls).toBe(1);
  });
});

describe('register', () => {
  it('creates the account with empty data and signs in, in one state change', async () => {
    const { store, actions, notifications, plannerCalls } = createHarness();
    await actions.init();

    const result = await actions.register(SAM);

    const { status, account, data } = store.getState();
    expect(result).toStrictEqual({ ok: true, account });
    expect(status).toBe('signedIn');
    expect(account).toStrictEqual({
      id: expect.stringMatching(UUID),
      name: 'Sam',
      email: 'sam@example.com',
      createdAt: NOW.toISOString(),
    });
    expect(data).toStrictEqual(createEmptyUserData());
    expect(notifications()).toBe(2);
    expect(plannerCalls).toHaveLength(0);
  });

  it('trims the name and the e-mail address', async () => {
    const { store, actions } = createHarness();
    await actions.init();
    await actions.register({ ...SAM, name: '  Sam de Vries ', email: '  Sam@Example.com  ' });
    expect(store.getState().account).toMatchObject({
      name: 'Sam de Vries',
      email: 'Sam@Example.com',
    });
  });

  it.each([
    ['an empty name', { ...SAM, name: '   ' }, MESSAGES.nameRequired],
    ['an e-mail address without @', { ...SAM, email: 'sam.example.com' }, MESSAGES.emailInvalid],
    ['an e-mail address without domain', { ...SAM, email: 'sam@school' }, MESSAGES.emailInvalid],
    ['an e-mail address with a space', { ...SAM, email: 'sam smit@x.nl' }, MESSAGES.emailInvalid],
    ['an empty e-mail address', { ...SAM, email: '' }, MESSAGES.emailInvalid],
    ['a password of 7 characters', { ...SAM, password: '1234567' }, MESSAGES.passwordTooShort],
  ])('refuses %s with a friendly message', async (_case, input, error) => {
    const { store, actions, notifications } = createHarness();
    await actions.init();

    await expect(actions.register(input)).resolves.toStrictEqual({ ok: false, error });

    expect(store.getState().status).toBe('signedOut');
    expect(notifications()).toBe(1);
    expect(localStorage.getItem('sb.accounts')).toBeNull();
    expect(localStorage.getItem('sb.session')).toBeNull();
  });

  it('accepts a password of exactly 8 characters', async () => {
    const { actions } = createHarness();
    await actions.init();
    await expect(actions.register({ ...SAM, password: '12345678' })).resolves.toMatchObject({
      ok: true,
    });
  });

  it('refuses an e-mail address that is already in use, ignoring case and spaces', async () => {
    const first = await signedInHarness(SAM);
    const samId = first.store.getState().account?.id;

    const result = await first.actions.register({
      name: 'Tweede Sam',
      email: '  SAM@Example.COM ',
      password: 'een-ander-wachtwoord',
    });

    expect(result).toStrictEqual({
      ok: false,
      error: 'Er is al een account met dit e-mailadres.',
    });
    expect(storedAccounts()).toHaveLength(1);
    expect(first.store.getState().account?.id).toBe(samId);
  });

  it('never writes the password to storage', async () => {
    await signedInHarness(SAM);
    const everything = Array.from({ length: localStorage.length }, (_, index) =>
      localStorage.getItem(localStorage.key(index) ?? ''),
    ).join('\n');
    expect(everything).not.toContain(SAM.password);
    expect(everything).toContain('PBKDF2-SHA-256');
  });
});

describe('login and logout', () => {
  it('signs out and in again with the same data', async () => {
    const harness = await signedInHarness(SAM);
    const exam = await addSampleExam(harness);
    const before = harness.store.getState();

    await expect(harness.actions.logout()).resolves.toStrictEqual({ ok: true });
    expect(harness.store.getState()).toStrictEqual({
      status: 'signedOut',
      account: null,
      data: null,
    });
    expect(localStorage.getItem('sb.session')).toBeNull();

    const result = await harness.actions.login({ email: SAM.email, password: SAM.password });
    expect(result).toStrictEqual({ ok: true, account: before.account });
    expect(harness.store.getState()).toStrictEqual(before);
    expect(harness.store.getState().data?.exams).toStrictEqual([exam]);
  });

  it('accepts the e-mail address in any case and with spaces around it', async () => {
    const harness = await signedInHarness(SAM);
    await harness.actions.logout();
    const result = await harness.actions.login({
      email: '  SAM@EXAMPLE.com ',
      password: SAM.password,
    });
    expect(result.ok).toBe(true);
    expect(harness.store.getState().status).toBe('signedIn');
  });

  it('refuses a wrong password and an unknown address with the same message', async () => {
    const harness = await signedInHarness(SAM);
    await harness.actions.logout();
    const before = harness.notifications();
    const error = 'Je e-mailadres of wachtwoord klopt niet.';

    await expect(
      harness.actions.login({ email: SAM.email, password: 'verkeerd-wachtwoord' }),
    ).resolves.toStrictEqual({ ok: false, error });
    await expect(
      harness.actions.login({ email: 'onbekend@example.com', password: SAM.password }),
    ).resolves.toStrictEqual({ ok: false, error });
    await expect(harness.actions.login({ email: '', password: '' })).resolves.toStrictEqual({
      ok: false,
      error,
    });

    expect(harness.store.getState().status).toBe('signedOut');
    expect(harness.notifications()).toBe(before);
    expect(localStorage.getItem('sb.session')).toBeNull();
  });

  it('re-plans once when signing in, because time has passed since the last visit', async () => {
    const harness = await signedInHarness(SAM);
    await addSampleExam(harness);
    await harness.actions.logout();
    const callsBefore = harness.plannerCalls.length;
    const notificationsBefore = harness.notifications();

    await harness.actions.login({ email: SAM.email, password: SAM.password });

    expect(harness.plannerCalls).toHaveLength(callsBefore + 1);
    expect(harness.notifications()).toBe(notificationsBefore + 1);
  });

  it('logging out twice is harmless', async () => {
    const harness = await signedInHarness(SAM);
    await harness.actions.logout();
    const before = harness.notifications();
    await expect(harness.actions.logout()).resolves.toStrictEqual({ ok: true });
    expect(harness.notifications()).toBe(before);
  });
});

describe('session restore after a reload', () => {
  it('a new store on the same storage is signed in with the same account and data', async () => {
    const first = await signedInHarness(SAM);
    await addSampleExam(first);
    await first.actions.updatePrefs({ sessionMinutes: 45 });
    await first.actions.completeOnboarding();
    const before = first.store.getState();

    const reloaded = createHarness();
    expect(reloaded.store.getState().status).toBe('loading');
    await expect(reloaded.actions.init()).resolves.toStrictEqual({ ok: true });

    expect(reloaded.store.getState()).toStrictEqual(before);
    expect(reloaded.notifications()).toBe(1);
  });

  it('re-plans exactly once at start, with the time of that moment', async () => {
    const first = await signedInHarness(SAM);
    const exam = await addSampleExam(first);

    const later = new Date(2026, 10, 18, 7, 5);
    const reloaded = createHarness((input) => ({
      sessions: fakePlan(input).sessions.map((session) => ({ ...session, date: input.today })),
      warnings: [{ type: 'te-weinig-tijd', examId: exam.id, missingMinutes: 15 }],
    }));
    reloaded.setNow(later);
    await reloaded.actions.init();

    expect(reloaded.plannerCalls).toHaveLength(1);
    expect(reloaded.plannerCalls[0]).toMatchObject({ today: '2026-11-18', nowMinutes: 425 });
    const data = reloaded.store.getState().data;
    expect(data?.sessions.map((session) => session.date)).toStrictEqual(['2026-11-18']);
    expect(data?.warnings).toStrictEqual([
      { type: 'te-weinig-tijd', examId: exam.id, missingMinutes: 15 },
    ]);
    // The new plan was saved as well.
    const third = createHarness();
    await third.actions.init();
    expect(third.plannerCalls[0].previous.map((session) => session.date)).toStrictEqual([
      '2026-11-18',
    ]);
  });

  it('stays signed out after a logout', async () => {
    const first = await signedInHarness(SAM);
    await first.actions.logout();
    const reloaded = createHarness();
    await reloaded.actions.init();
    expect(reloaded.store.getState().status).toBe('signedOut');
  });

  it('signs out when the account of the stored session no longer exists', async () => {
    await signedInHarness(SAM);
    localStorage.setItem('sb.accounts', '[]');
    const reloaded = createHarness();
    await expect(reloaded.actions.init()).resolves.toStrictEqual({ ok: true });
    expect(reloaded.store.getState().status).toBe('signedOut');
    expect(localStorage.getItem('sb.session')).toBeNull();
  });
});

describe('two accounts on one device', () => {
  it('keeps their data and files strictly apart', async () => {
    const harness = await signedInHarness(SAM);
    const { store, actions } = harness;
    const samId = store.getState().account?.id ?? '';
    const samExam = await addSampleExam(harness, { title: 'Toets van Sam' });
    const samFile = await actions.addAttachment(
      samExam.id,
      new File(['van sam'], 'sam.txt', { type: 'text/plain' }),
    );
    if (!samFile.ok) throw new Error(samFile.error);
    await actions.toggleBlockedDate('2026-11-20');
    await actions.logout();

    const noor = await actions.register(NOOR);
    if (!noor.ok) throw new Error(noor.error);
    expect(noor.account.id).not.toBe(samId);
    expect(store.getState().data).toStrictEqual(createEmptyUserData());

    // Noor cannot reach anything of Sam, not even with the right ids.
    await expect(actions.getAttachmentBlob(samFile.attachment.id)).resolves.toBeUndefined();
    await expect(actions.updateExam(samExam.id, { title: 'Gekaapt' })).resolves.toStrictEqual({
      ok: false,
      error: MESSAGES.examNotFound,
    });
    await actions.removeAttachment(samExam.id, samFile.attachment.id);
    await actions.deleteExam(samExam.id);

    const noorExam = await addSampleExam(harness, { title: 'Toets van Noor' }, 'Frans');
    await actions.logout();

    expect(JSON.parse(localStorage.getItem(`sb.data.${samId}`) ?? '{}').exams).toHaveLength(1);
    expect(
      JSON.parse(localStorage.getItem(`sb.data.${noor.account.id}`) ?? '{}').exams,
    ).toHaveLength(1);

    await actions.login({ email: SAM.email, password: SAM.password });
    const samData = store.getState().data;
    expect(samData?.exams.map((exam) => exam.title)).toStrictEqual(['Toets van Sam']);
    expect(samData?.subjects.map((subject) => subject.name)).toStrictEqual(['Biologie']);
    expect(samData?.blockedDates).toStrictEqual(['2026-11-20']);
    expect(samData?.exams[0].attachments).toStrictEqual([samFile.attachment]);
    const blob = await actions.getAttachmentBlob(samFile.attachment.id);
    await expect(blob?.text()).resolves.toBe('van sam');

    await actions.logout();
    await actions.login({ email: NOOR.email, password: NOOR.password });
    expect(store.getState().data?.exams).toStrictEqual([noorExam]);
    expect(store.getState().data?.blockedDates).toStrictEqual([]);
  });

  it("does not accept one account's password for the other", async () => {
    const harness = await signedInHarness(SAM);
    await harness.actions.logout();
    await harness.actions.register(NOOR);
    await harness.actions.logout();
    const result = await harness.actions.login({ email: SAM.email, password: NOOR.password });
    expect(result.ok).toBe(false);
  });
});

describe('updateAccount', () => {
  it('changes the name and survives a reload', async () => {
    const harness = await signedInHarness(SAM);
    const account = harness.store.getState().account;
    const before = harness.notifications();

    const result = await harness.actions.updateAccount({ name: '  Samira ' });

    const updated = { ...account, name: 'Samira' };
    expect(result).toStrictEqual({ ok: true, account: updated });
    expect(harness.store.getState().account).toStrictEqual(updated);
    expect(harness.notifications()).toBe(before + 1);

    const reloaded = createHarness();
    await reloaded.actions.init();
    expect(reloaded.store.getState().account).toStrictEqual(updated);
  });

  it('changes the e-mail address used to sign in', async () => {
    const harness = await signedInHarness(SAM);
    await harness.actions.updateAccount({ email: 'samira@example.com' });
    await harness.actions.logout();

    const oldAddress = await harness.actions.login({ email: SAM.email, password: SAM.password });
    expect(oldAddress.ok).toBe(false);
    const newAddress = await harness.actions.login({
      email: 'samira@example.com',
      password: SAM.password,
    });
    expect(newAddress.ok).toBe(true);
  });

  it('refuses an empty name, an invalid address and an address of somebody else', async () => {
    const harness = await signedInHarness(SAM);
    await harness.actions.logout();
    await harness.actions.register(NOOR);
    const before = harness.store.getState();

    await expect(harness.actions.updateAccount({ name: '  ' })).resolves.toStrictEqual({
      ok: false,
      error: MESSAGES.nameRequired,
    });
    await expect(harness.actions.updateAccount({ email: 'noor@' })).resolves.toStrictEqual({
      ok: false,
      error: MESSAGES.emailInvalid,
    });
    await expect(harness.actions.updateAccount({ email: 'SAM@example.com' })).resolves.toStrictEqual(
      { ok: false, error: 'Er is al een account met dit e-mailadres.' },
    );
    expect(harness.store.getState()).toBe(before);
  });

  it('lets you change the capitals in your own address, and does nothing for an empty patch', async () => {
    const harness = await signedInHarness(SAM);
    const result = await harness.actions.updateAccount({ email: 'Sam@Example.com' });
    expect(result).toMatchObject({ ok: true, account: { email: 'Sam@Example.com' } });

    const before = harness.store.getState();
    await expect(harness.actions.updateAccount({})).resolves.toMatchObject({ ok: true });
    expect(harness.store.getState()).toBe(before);
  });
});

describe('changePassword', () => {
  it('refuses a wrong current password and a new one that is too short', async () => {
    const harness = await signedInHarness(SAM);
    await expect(
      harness.actions.changePassword({ current: 'fout-wachtwoord', next: 'nieuw-wachtwoord' }),
    ).resolves.toStrictEqual({ ok: false, error: 'Dat wachtwoord klopt niet.' });
    await expect(
      harness.actions.changePassword({ current: SAM.password, next: 'kort' }),
    ).resolves.toStrictEqual({ ok: false, error: MESSAGES.passwordTooShort });

    await harness.actions.logout();
    const stillOld = await harness.actions.login({ email: SAM.email, password: SAM.password });
    expect(stillOld.ok).toBe(true);
  });

  it('replaces the password', async () => {
    const harness = await signedInHarness(SAM);
    await expect(
      harness.actions.changePassword({ current: SAM.password, next: 'nieuw-wachtwoord' }),
    ).resolves.toStrictEqual({ ok: true });
    expect(harness.store.getState().status).toBe('signedIn');
    expect(localStorage.getItem('sb.accounts')).not.toContain('nieuw-wachtwoord');

    await harness.actions.logout();
    const oldPassword = await harness.actions.login({ email: SAM.email, password: SAM.password });
    expect(oldPassword.ok).toBe(false);
    const newPassword = await harness.actions.login({
      email: SAM.email,
      password: 'nieuw-wachtwoord',
    });
    expect(newPassword.ok).toBe(true);
  });
});

describe('deleteAccount', () => {
  it('refuses a wrong password and changes nothing', async () => {
    const harness = await signedInHarness(SAM);
    await addSampleExam(harness);
    const before = harness.store.getState();

    await expect(harness.actions.deleteAccount({ password: 'fout-wachtwoord' })).resolves.toStrictEqual(
      { ok: false, error: 'Dat wachtwoord klopt niet.' },
    );

    expect(harness.store.getState()).toBe(before);
    expect(storedAccounts()).toHaveLength(1);
  });

  it('removes the account, its data, its files and its session, and nothing of others', async () => {
    const harness = await signedInHarness(NOOR);
    const { store, actions } = harness;
    const noorId = store.getState().account?.id ?? '';
    const noorExam = await addSampleExam(harness, {}, 'Frans');
    const noorFile = await actions.addAttachment(noorExam.id, new File(['noor'], 'noor.txt'));
    if (!noorFile.ok) throw new Error(noorFile.error);
    await actions.logout();

    await actions.register(SAM);
    const samId = store.getState().account?.id ?? '';
    const samExam = await addSampleExam(harness);
    const other = await addSampleExam(harness, { title: 'Tweede toets' });
    await actions.addAttachment(samExam.id, new File(['een'], 'een.txt'));
    await actions.addAttachment(samExam.id, new File(['twee'], 'twee.txt'));
    await actions.addAttachment(other.id, new File(['drie'], 'drie.txt'));
    await expect(storedAttachmentIds()).resolves.toHaveLength(4);
    const before = harness.notifications();

    await expect(actions.deleteAccount({ password: SAM.password })).resolves.toStrictEqual({
      ok: true,
    });

    expect(store.getState()).toStrictEqual({ status: 'signedOut', account: null, data: null });
    expect(harness.notifications()).toBe(before + 1);
    expect(storedAccounts().map((account) => account.id)).toStrictEqual([noorId]);
    expect(localStorage.getItem(`sb.data.${samId}`)).toBeNull();
    expect(localStorage.getItem('sb.session')).toBeNull();
    expect(localStorage.getItem(`sb.data.${noorId}`)).not.toBeNull();
    await expect(storedAttachmentIds()).resolves.toStrictEqual([noorFile.attachment.id]);

    // The address is free again, and the old password opens nothing.
    const gone = await actions.login({ email: SAM.email, password: SAM.password });
    expect(gone.ok).toBe(false);
    const again = await actions.register(SAM);
    expect(again.ok).toBe(true);
    expect(store.getState().data).toStrictEqual(createEmptyUserData());
  });

  it('is gone after a reload too', async () => {
    const harness = await signedInHarness(SAM);
    await harness.actions.deleteAccount({ password: SAM.password });
    const reloaded = createHarness();
    await reloaded.actions.init();
    expect(reloaded.store.getState().status).toBe('signedOut');
  });
});

describe('without a signed-in account', () => {
  it('every data action answers with a friendly error instead of throwing', async () => {
    const { store, actions, notifications } = createHarness();
    await actions.init();
    const notSignedIn = { ok: false, error: 'Je bent niet ingelogd.' };

    const results = await Promise.all([
      actions.updateAccount({ name: 'X' }),
      actions.changePassword({ current: 'a', next: 'bbbbbbbb' }),
      actions.deleteAccount({ password: 'a' }),
      actions.updatePrefs({ sessionMinutes: 45 }),
      actions.completeOnboarding(),
      actions.addSubject({ name: 'Frans', color: 'pink' }),
      actions.updateSubject('x', { name: 'Duits' }),
      actions.deleteSubject('x'),
      actions.addExam({ subjectId: 'x', title: 'T', kind: 'toets', date: '2026-12-01', topics: [] }),
      actions.updateExam('x', { title: 'T' }),
      actions.deleteExam('x'),
      actions.setGrade('x', 7),
      actions.addTopics('x', []),
      actions.updateTopic('x', 'y', { mastered: true }),
      actions.deleteTopic('x', 'y'),
      actions.moveTopic('x', 'y', 0),
      actions.addAttachment('x', new Blob(['x'])),
      actions.removeAttachment('x', 'y'),
      actions.completeSession('x'),
      actions.reopenSession('x'),
      actions.skipSession('x'),
      actions.moveSession('x', { date: '2026-12-01', start: '10:00' }),
      actions.unpinSession('x'),
      actions.toggleBlockedDate('2026-12-01'),
      actions.replan(),
      actions.addInboxItems([]),
      actions.markInboxRead('all'),
      actions.clearInbox(),
      actions.importData('{}'),
    ]);

    for (const result of results) expect(result).toStrictEqual(notSignedIn);
    await expect(actions.getAttachmentBlob('x')).resolves.toBeUndefined();
    expect(() => actions.exportData()).toThrow(/signed-in account/);
    expect(store.getState().status).toBe('signedOut');
    expect(notifications()).toBe(1);
  });
});
