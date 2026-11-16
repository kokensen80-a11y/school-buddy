import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Reminder } from '../../types';
import defaultNotifier, {
  createNotifier,
  NOTIFICATION_BADGE,
  NOTIFICATION_ICON,
  permissionState,
  requestPermission,
  type NotificationApi,
  type NotificationRegistration,
  type NotifierDeps,
} from './engine';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const T0 = Date.UTC(2026, 10, 16, 14, 0, 0);

// ───────────────────────── Fakes ─────────────────────────

/**
 * Hand-driven clock and timers. `advance` runs the timers that come due, in order, and waits
 * for whatever their callbacks return, so a test continues only after the engine has finished.
 */
function createClock(start = T0) {
  let now = start;
  let lastHandle = 0;
  const timers = new Map<number, { at: number; every: number | null; callback: () => unknown }>();
  const schedule = (callback: () => unknown, ms: number, every: number | null) => {
    lastHandle += 1;
    timers.set(lastHandle, { at: now + ms, every, callback });
    return lastHandle;
  };
  const cancel = (handle: unknown) => {
    timers.delete(handle as number);
  };
  return {
    now: () => now,
    setTimeout: (callback: () => unknown, ms: number) => schedule(callback, ms, null),
    clearTimeout: cancel,
    setInterval: (callback: () => unknown, ms: number) => schedule(callback, ms, ms),
    clearInterval: cancel,
    /** Moves the clock without running any timer, like a laptop that was asleep. */
    jump(ms: number) {
      now += ms;
    },
    async advance(ms: number) {
      const target = now + ms;
      for (;;) {
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.at <= target)
          .sort(([a, x], [b, y]) => x.at - y.at || a - b)[0];
        if (!due) break;
        const [handle, timer] = due;
        now = Math.max(now, timer.at);
        if (timer.every === null) timers.delete(handle);
        else timer.at += timer.every;
        await timer.callback();
      }
      now = target;
    },
    /** Delays of the pending one-shot timers. */
    timeouts: () => [...timers.values()].filter((t) => t.every === null).map((t) => t.at - now),
    intervals: () => [...timers.values()].filter((t) => t.every !== null).map((t) => t.every),
    dropTimeouts() {
      for (const [handle, timer] of timers) if (timer.every === null) timers.delete(handle);
    },
  };
}

interface PageNotification {
  title: string;
  options?: NotificationOptions;
  onclick: unknown;
  closed: boolean;
}

/** A stand-in for the global Notification constructor. */
function createNotificationApi(permission: NotificationPermission = 'granted') {
  const created: PageNotification[] = [];
  class FakeNotification implements PageNotification {
    static permission: NotificationPermission = permission;
    static requestPermission(): Promise<NotificationPermission> {
      return Promise.resolve(FakeNotification.permission);
    }
    onclick: unknown = null;
    closed = false;
    constructor(
      public title: string,
      public options?: NotificationOptions,
    ) {
      created.push(this);
    }
    close() {
      this.closed = true;
    }
  }
  const api: NotificationApi = FakeNotification;
  return { api, created };
}

function createRegistration() {
  const shown: { title: string; options?: NotificationOptions }[] = [];
  const registration: NotificationRegistration = {
    showNotification: async (title, options) => {
      shown.push({ title, options });
    },
  };
  return { registration, shown };
}

function createWake() {
  const callbacks = new Set<() => unknown>();
  return {
    onWake: (callback: () => unknown) => {
      callbacks.add(callback);
      return () => callbacks.delete(callback);
    },
    listeners: () => callbacks.size,
    wake: () => Promise.all([...callbacks].map((callback) => callback())),
  };
}

/**
 * A complete fake browser around one notifier. Pass `indexedDB` (and `clock`) to share them
 * between notifiers; `idb` in the result is the database a test can inspect.
 */
function setup(options: Partial<NotifierDeps> & { clock?: ReturnType<typeof createClock> } = {}) {
  const { clock = createClock(), ...overrides } = options;
  const { api, created } = createNotificationApi();
  const { registration, shown } = createRegistration();
  const wake = createWake();
  const opened: string[] = [];
  const idb: IDBFactory = overrides.indexedDB ?? new IDBFactory();
  const fired: Reminder[] = [];

  const notifier = createNotifier({
    notification: api,
    getRegistration: async () => registration,
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    setInterval: clock.setInterval,
    clearInterval: clock.clearInterval,
    onWake: wake.onWake,
    openLink: (link) => opened.push(link),
    ...overrides,
    indexedDB: overrides.indexedDB === undefined ? idb : overrides.indexedDB,
  });
  const sync = (reminders: Reminder[], accountId = 'anna') =>
    notifier.sync(reminders, { accountId, onFire: (reminder) => fired.push(reminder) });

  return { notifier, sync, clock, shown, created, fired, wake, opened, idb, api };
}

function makeReminder(id: string, at: number, overrides: Partial<Reminder> = {}): Reminder {
  return {
    id,
    at: new Date(at).toISOString(),
    kind: 'sessie',
    title: `Tijd om te leren: ${id}`,
    body: '16:00 · 30 min · Samenvatten · Celdeling',
    link: '#/agenda/2026-11-16',
    ...overrides,
  };
}

const ids = (reminders: { id: string }[]) => reminders.map((reminder) => reminder.id);

// ───────────────────────── Direct access to the shared database ─────────────────────────

/** Opens the database the way engine.ts and sw.js document it; fails the test when they disagree. */
function openDatabase(idb: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = idb.open('school-buddy-notifications', 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore('queue', { keyPath: 'accountId' });
      const fired = db.createObjectStore('fired', { keyPath: ['accountId', 'reminderId'] });
      fired.createIndex('firedAt', 'firedAt');
      fired.createIndex('pendingFor', 'pendingFor');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readAll<T>(idb: IDBFactory, storeName: 'queue' | 'fired'): Promise<T[]> {
  const db = await openDatabase(idb);
  try {
    return await new Promise<T[]>((resolve, reject) => {
      const request = db.transaction(storeName).objectStore(storeName).getAll();
      request.onsuccess = () => resolve(request.result as T[]);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

async function writeFired(idb: IDBFactory, records: object[]): Promise<void> {
  const db = await openDatabase(idb);
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('fired', 'readwrite');
      for (const record of records) transaction.objectStore('fired').put(record);
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

interface QueueRecord {
  accountId: string;
  updatedAt: number;
  reminders: Reminder[];
}

interface FiredRecord {
  accountId: string;
  reminderId: string;
  firedAt: number;
  pendingFor?: string;
  reminder?: Reminder;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ───────────────────────── Permission ─────────────────────────

describe('permissionState', () => {
  it('reports the permission of the browser', () => {
    expect(permissionState(createNotificationApi('granted').api)).toBe('granted');
    expect(permissionState(createNotificationApi('denied').api)).toBe('denied');
    expect(permissionState(createNotificationApi('default').api)).toBe('default');
  });

  it('reports "unsupported" where notifications do not exist', () => {
    expect(permissionState(null)).toBe('unsupported');
    // jsdom has no Notification, like iOS Safari outside an installed app.
    expect(permissionState()).toBe('unsupported');
  });

  it('reads the global Notification by default', () => {
    vi.stubGlobal('Notification', createNotificationApi('denied').api);
    expect(permissionState()).toBe('denied');
  });
});

describe('requestPermission', () => {
  it('resolves with the answer of the promise-based API', async () => {
    const { api } = createNotificationApi('default');
    api.requestPermission = async (): Promise<NotificationPermission> => 'granted';
    await expect(requestPermission(api)).resolves.toBe('granted');
  });

  it('resolves with the answer of the old callback-based API', async () => {
    const { api } = createNotificationApi('default');
    api.requestPermission = (callback) => {
      setTimeout(() => callback?.('denied'), 0);
    };
    await expect(requestPermission(api)).resolves.toBe('denied');
  });

  it('resolves to "unsupported" without the API and never rejects', async () => {
    await expect(requestPermission(null)).resolves.toBe('unsupported');
    await expect(requestPermission()).resolves.toBe('unsupported');

    const rejecting = createNotificationApi('default').api;
    rejecting.requestPermission = () => Promise.reject(new Error('geen gebaar'));
    await expect(requestPermission(rejecting)).resolves.toBe('default');

    const throwing = createNotificationApi('denied').api;
    throwing.requestPermission = () => {
      throw new Error('kapot');
    };
    await expect(requestPermission(throwing)).resolves.toBe('denied');
  });
});

// ───────────────────────── Firing ─────────────────────────

describe('notifier: firing on time', () => {
  it('shows a reminder through the service worker when its time comes, exactly once', async () => {
    const { sync, clock, shown, created, fired } = setup();
    const reminder = makeReminder('bio', T0 + 10 * MINUTE);

    await sync([reminder]);
    expect(shown).toEqual([]);
    expect(clock.timeouts()).toEqual([10 * MINUTE]);

    await clock.advance(10 * MINUTE - 1);
    expect(shown).toEqual([]);

    await clock.advance(1);
    expect(shown).toEqual([
      {
        title: 'Tijd om te leren: bio',
        options: {
          body: '16:00 · 30 min · Samenvatten · Celdeling',
          tag: 'bio',
          icon: NOTIFICATION_ICON,
          badge: NOTIFICATION_BADGE,
          lang: 'nl',
          data: { link: '#/agenda/2026-11-16' },
        },
      },
    ]);
    expect(fired).toEqual([reminder]);
    expect(created).toEqual([]);

    await clock.advance(3 * HOUR);
    await sync([reminder]);
    expect(shown).toHaveLength(1);
    expect(fired).toHaveLength(1);
  });

  it('uses relative icon paths so the app works from a sub-folder', () => {
    expect(NOTIFICATION_ICON).toBe('icons/icon-192.png');
    expect(NOTIFICATION_BADGE).not.toMatch(/^\//);
  });

  it('fires reminders one after the other, each from its own timer', async () => {
    const { sync, clock, fired } = setup();
    await sync([makeReminder('c', T0 + 3 * HOUR), makeReminder('a', T0 + HOUR), makeReminder('b', T0 + 2 * HOUR)]);

    // One timer at a time: the first reminder that is still to come.
    expect(clock.timeouts()).toEqual([HOUR]);
    await clock.advance(HOUR);
    expect(ids(fired)).toEqual(['a']);
    await clock.advance(HOUR);
    expect(ids(fired)).toEqual(['a', 'b']);
    await clock.advance(HOUR);
    expect(ids(fired)).toEqual(['a', 'b', 'c']);
    expect(clock.timeouts()).toEqual([]);
  });

  it('fires reminders with the same moment together', async () => {
    const { sync, clock, shown } = setup();
    await sync([makeReminder('digest', T0 + HOUR), makeReminder('exam', T0 + HOUR)]);
    await clock.advance(HOUR);
    expect(shown.map((n) => n.options?.tag)).toEqual(['digest', 'exam']);
  });

  it('arms timers only for the next 24 hours', async () => {
    const { sync, clock } = setup();
    await sync([makeReminder('far', T0 + DAY + 1)]);
    expect(clock.timeouts()).toEqual([]);

    await sync([makeReminder('far', T0 + DAY + 1), makeReminder('near', T0 + DAY)]);
    expect(clock.timeouts()).toEqual([DAY]);
  });

  it('fires a reminder that was more than 24 hours away at its own time, once', async () => {
    const { sync, clock, fired, shown } = setup();
    const reminders = [makeReminder('far', T0 + 3 * DAY + 7 * MINUTE + 13_000)];
    await sync(reminders);
    expect(clock.timeouts()).toEqual([]);

    // No new sync in between: the engine re-arms by itself as the moment comes closer.
    await clock.advance(3 * DAY + 7 * MINUTE + 12_999);
    expect(fired).toEqual([]);
    expect(clock.timeouts()).toEqual([1]);

    await clock.advance(1);
    expect(ids(fired)).toEqual(['far']);
    await clock.advance(DAY);
    expect(ids(fired)).toEqual(['far']);
    expect(shown).toHaveLength(1);
    expect(clock.timeouts()).toEqual([]);
  });

  it('still fires from the check every minute when a timer got lost', async () => {
    const { sync, clock, fired } = setup();
    await sync([makeReminder('bio', T0 + 90_000)]);
    expect(clock.intervals()).toEqual([MINUTE]);

    clock.dropTimeouts();
    await clock.advance(MINUTE);
    expect(fired).toEqual([]);
    await clock.advance(MINUTE);
    expect(ids(fired)).toEqual(['bio']);
  });

  it('checks again when the page wakes up', async () => {
    const { sync, clock, wake, shown, fired } = setup();
    await sync([makeReminder('bio', T0 + 10 * MINUTE)]);

    // The device slept through the timer.
    clock.jump(20 * MINUTE);
    expect(fired).toEqual([]);
    await wake.wake();
    expect(ids(fired)).toEqual(['bio']);
    expect(shown).toHaveLength(1);
  });

  it('listens to visibility, focus and pageshow by default, until it is stopped', async () => {
    const clock = createClock();
    const { notifier, sync, fired } = setup({ clock, onWake: undefined });
    const removed = [
      vi.spyOn(document, 'removeEventListener'),
      vi.spyOn(window, 'removeEventListener'),
    ];

    for (const [index, wakeUp] of [
      () => document.dispatchEvent(new Event('visibilitychange')),
      () => window.dispatchEvent(new Event('focus')),
      () => window.dispatchEvent(new Event('pageshow')),
    ].entries()) {
      await sync([makeReminder(`r${index}`, clock.now() + MINUTE)]);
      clock.jump(2 * MINUTE);
      wakeUp();
      await vi.waitFor(() => expect(ids(fired)).toContain(`r${index}`));
    }

    await notifier.stop();
    const events = removed.flatMap((spy) => spy.mock.calls.map(([type]) => type));
    expect(events.sort()).toEqual(['focus', 'pageshow', 'visibilitychange']);
  });
});

// ───────────────────────── Catching up ─────────────────────────

describe('notifier: catching up', () => {
  it('still shows a reminder that was missed within the grace period', async () => {
    const { sync, shown, fired } = setup();
    await sync([makeReminder('recent', T0 - 90 * MINUTE)]);
    expect(shown.map((n) => n.options?.tag)).toEqual(['recent']);
    expect(ids(fired)).toEqual(['recent']);
  });

  it('puts an older missed reminder in the inbox only', async () => {
    const { sync, shown, created, fired } = setup();
    await sync([makeReminder('old', T0 - 90 * MINUTE - 1), makeReminder('ancient', T0 - 2 * DAY)]);
    expect(shown).toEqual([]);
    expect(created).toEqual([]);
    expect(ids(fired)).toEqual(['old', 'ancient']);
  });

  it('honours a custom grace period', async () => {
    const { sync, shown, fired } = setup({ graceMinutes: 5 });
    await sync([makeReminder('six', T0 - 6 * MINUTE), makeReminder('four', T0 - 4 * MINUTE)]);
    expect(shown.map((n) => n.options?.tag)).toEqual(['four']);
    expect(ids(fired)).toEqual(['six', 'four']);
  });

  it('hands over what the service worker showed while the app was closed, once', async () => {
    const { sync, shown, fired, idb } = setup();
    const reminder = makeReminder('by-worker', T0 - 20 * MINUTE);
    await writeFired(idb, [
      { accountId: 'anna', reminderId: 'by-worker', firedAt: T0 - 20 * MINUTE, pendingFor: 'anna', reminder },
      {
        accountId: 'bram',
        reminderId: 'other',
        firedAt: T0 - 20 * MINUTE,
        pendingFor: 'bram',
        reminder: makeReminder('other', T0 - 20 * MINUTE),
      },
    ]);

    await sync([reminder]);
    expect(fired).toEqual([reminder]);
    // The worker already showed the system notification.
    expect(shown).toEqual([]);

    await sync([reminder]);
    expect(fired).toHaveLength(1);

    const records = await readAll<FiredRecord>(idb, 'fired');
    expect(records.find((r) => r.accountId === 'anna')).toEqual({
      accountId: 'anna',
      reminderId: 'by-worker',
      firedAt: T0 - 20 * MINUTE,
    });
    expect(records.find((r) => r.accountId === 'bram')?.pendingFor).toBe('bram');
  });

  it('also hands over a worker reminder that is no longer in the list', async () => {
    const { sync, fired, idb } = setup();
    const reminder = makeReminder('gone', T0 - 5 * HOUR);
    await writeFired(idb, [
      { accountId: 'anna', reminderId: 'gone', firedAt: T0 - 5 * HOUR, pendingFor: 'anna', reminder },
    ]);

    await sync([]);
    expect(fired).toEqual([reminder]);
  });
});

// ───────────────────────── At most once ─────────────────────────

describe('notifier: at most once', () => {
  it('does not fire again after a reload', async () => {
    const idb = new IDBFactory();
    const reminders = [makeReminder('bio', T0 - MINUTE), makeReminder('old', T0 - DAY)];

    const first = setup({ indexedDB: idb });
    await first.sync(reminders);
    expect(ids(first.fired)).toEqual(['bio', 'old']);
    expect(first.shown).toHaveLength(1);

    const reloaded = setup({ indexedDB: idb });
    await reloaded.sync(reminders);
    expect(reloaded.fired).toEqual([]);
    expect(reloaded.shown).toEqual([]);
    expect(reloaded.created).toEqual([]);
  });

  it('fires in only one of two tabs that are open at the same time', async () => {
    const idb = new IDBFactory();
    const clock = createClock();
    const tabs = [setup({ indexedDB: idb, clock }), setup({ indexedDB: idb, clock })];
    const reminders = [makeReminder('a', T0 + MINUTE), makeReminder('b', T0 + MINUTE)];

    await Promise.all(tabs.map((tab) => tab.sync(reminders)));
    await clock.advance(MINUTE);

    expect(ids(tabs.flatMap((tab) => tab.fired)).sort()).toEqual(['a', 'b']);
    expect(tabs.flatMap((tab) => tab.shown)).toHaveLength(2);
  });

  it('keeps accounts apart', async () => {
    const idb = new IDBFactory();
    const reminder = makeReminder('bio', T0 - MINUTE);

    const anna = setup({ indexedDB: idb });
    await anna.sync([reminder], 'anna');
    const bram = setup({ indexedDB: idb });
    await bram.sync([reminder], 'bram');
    expect(ids(bram.fired)).toEqual(['bio']);

    // The same tab switching accounts and back.
    await anna.sync([reminder], 'bram');
    await anna.sync([reminder], 'anna');
    expect(ids(anna.fired)).toEqual(['bio']);
  });

  it('delivers the same reminder to a second account that signs in in the same tab', async () => {
    const { sync, fired, shown } = setup();
    const reminder = makeReminder('bio', T0 - MINUTE);

    await sync([reminder], 'anna');
    await sync([reminder], 'bram');
    await sync([reminder], 'anna');
    expect(ids(fired)).toEqual(['bio', 'bio']);
    expect(shown).toHaveLength(2);
  });

  it('records what it fired and prunes records older than 30 days', async () => {
    const { sync, clock, idb } = setup();
    await writeFired(idb, [
      { accountId: 'anna', reminderId: 'stokoud', firedAt: T0 - 30 * DAY - 1 },
      { accountId: 'anna', reminderId: 'net-niet', firedAt: T0 - 30 * DAY },
    ]);

    await sync([makeReminder('bio', T0 + MINUTE)]);
    await clock.advance(MINUTE);

    const records = await readAll<FiredRecord>(idb, 'fired');
    expect(records).toEqual([
      { accountId: 'anna', reminderId: 'bio', firedAt: T0 + MINUTE },
      { accountId: 'anna', reminderId: 'net-niet', firedAt: T0 - 30 * DAY },
    ]);
  });
});

// ───────────────────────── Syncing ─────────────────────────

describe('notifier: sync', () => {
  it('is idempotent', async () => {
    const { sync, clock, shown, fired } = setup();
    const reminders = [makeReminder('due', T0 - MINUTE), makeReminder('soon', T0 + 5 * MINUTE)];

    await Promise.all([sync(reminders), sync(reminders), sync(reminders)]);
    await sync(reminders);
    expect(ids(fired)).toEqual(['due']);
    expect(clock.timeouts()).toEqual([5 * MINUTE]);
    expect(clock.intervals()).toEqual([MINUTE]);

    await clock.advance(5 * MINUTE);
    await sync(reminders);
    expect(ids(fired)).toEqual(['due', 'soon']);
    expect(shown).toHaveLength(2);
  });

  it('replaces the timers when the list changes', async () => {
    const { sync, clock, fired } = setup();
    await sync([makeReminder('moved-away', T0 + 10 * MINUTE)]);
    await sync([makeReminder('new-slot', T0 + 20 * MINUTE)]);
    expect(clock.timeouts()).toEqual([20 * MINUTE]);

    await clock.advance(10 * MINUTE);
    expect(fired).toEqual([]);
    await clock.advance(10 * MINUTE);
    expect(ids(fired)).toEqual(['new-slot']);

    await sync([]);
    expect(clock.timeouts()).toEqual([]);
  });

  it('uses the most recent onFire callback', async () => {
    const { notifier, clock } = setup();
    const first: string[] = [];
    const second: string[] = [];
    const reminders = [makeReminder('bio', T0 + MINUTE)];

    await notifier.sync(reminders, { accountId: 'anna', onFire: (r) => first.push(r.id) });
    await notifier.sync(reminders, { accountId: 'anna', onFire: (r) => second.push(r.id) });
    await clock.advance(MINUTE);

    expect(first).toEqual([]);
    expect(second).toEqual(['bio']);
  });

  it('keeps going when onFire throws, and reports the error', async () => {
    const reportError = vi.fn();
    vi.stubGlobal('reportError', reportError);
    const { notifier } = setup();
    const error = new Error('inbox kapot');
    const delivered: string[] = [];

    await notifier.sync([makeReminder('a', T0 - 2 * MINUTE), makeReminder('b', T0 - MINUTE)], {
      accountId: 'anna',
      onFire: (reminder) => {
        delivered.push(reminder.id);
        if (reminder.id === 'a') throw error;
      },
    });

    expect(delivered).toEqual(['a', 'b']);
    expect(reportError).toHaveBeenCalledExactlyOnceWith(error);
  });

  it('ignores a reminder with an unreadable time', async () => {
    const { sync, clock, fired } = setup();
    await sync([{ ...makeReminder('broken', T0), at: 'geen tijd' }]);
    await clock.advance(HOUR);
    expect(fired).toEqual([]);
    expect(clock.timeouts()).toEqual([]);
  });

  it('stores the queue for the service worker and rewrites it only when it changes', async () => {
    const { sync, clock, idb } = setup();
    const reminders = [makeReminder('bio', T0 + HOUR)];

    await sync(reminders);
    expect(await readAll<QueueRecord>(idb, 'queue')).toEqual([{ accountId: 'anna', updatedAt: T0, reminders }]);

    clock.jump(MINUTE);
    await sync([...reminders]);
    expect((await readAll<QueueRecord>(idb, 'queue'))[0].updatedAt).toBe(T0);

    const changed = [...reminders, makeReminder('wis', T0 + 2 * HOUR)];
    await sync(changed);
    expect(await readAll<QueueRecord>(idb, 'queue')).toEqual([
      { accountId: 'anna', updatedAt: T0 + MINUTE, reminders: changed },
    ]);
  });

  it('keeps only the queue of the account that is signed in', async () => {
    const { sync, idb } = setup();
    await sync([makeReminder('bio', T0 + HOUR)], 'anna');
    await sync([], 'bram');
    expect(await readAll<QueueRecord>(idb, 'queue')).toEqual([{ accountId: 'bram', updatedAt: T0, reminders: [] }]);
  });
});

// ───────────────────────── Stopping ─────────────────────────

describe('notifier: stop', () => {
  it('clears timers, listeners and the stored queue', async () => {
    const { notifier, sync, clock, wake, shown, fired, idb } = setup();
    await sync([makeReminder('bio', T0 + 10 * MINUTE)]);
    expect(wake.listeners()).toBe(1);

    await notifier.stop();
    expect(clock.timeouts()).toEqual([]);
    expect(clock.intervals()).toEqual([]);
    expect(wake.listeners()).toBe(0);
    expect(await readAll<QueueRecord>(idb, 'queue')).toEqual([]);

    await clock.advance(HOUR);
    await wake.wake();
    expect(shown).toEqual([]);
    expect(fired).toEqual([]);
  });

  it('empties a queue left behind by an earlier page load', async () => {
    const idb = new IDBFactory();
    await setup({ indexedDB: idb }).sync([makeReminder('bio', T0 + HOUR)]);

    await setup({ indexedDB: idb }).notifier.stop();
    expect(await readAll<QueueRecord>(idb, 'queue')).toEqual([]);
  });

  it('can be followed by a new sync', async () => {
    const { notifier, sync, clock, fired, idb } = setup();
    const reminders = [makeReminder('bio', T0 + 10 * MINUTE)];
    await sync(reminders);

    // Stop and start in the same tick, as a re-running effect would do.
    void notifier.stop();
    await sync(reminders);
    expect(clock.timeouts()).toEqual([10 * MINUTE]);
    expect(clock.intervals()).toEqual([MINUTE]);
    expect(await readAll<QueueRecord>(idb, 'queue')).toHaveLength(1);

    await clock.advance(10 * MINUTE);
    expect(ids(fired)).toEqual(['bio']);
  });

  it('is harmless when nothing was started', async () => {
    const { notifier } = setup();
    await expect(notifier.stop()).resolves.toBeUndefined();
    await expect(notifier.stop()).resolves.toBeUndefined();
  });

  /**
   * A database that runs `interrupt` when it is opened for the second time. The first open
   * stores the queue; the second belongs to the check, which at that moment has decided what
   * is due and waits for storage. The tests below verify that through the fired log.
   */
  function interruptible(interrupt: () => void) {
    const real = new IDBFactory();
    let opens = 0;
    const factory = {
      open: (name: string, version?: number) => {
        opens += 1;
        if (opens === 2) interrupt();
        return real.open(name, version);
      },
    } as IDBFactory;
    return { factory, real };
  }

  it('delivers nothing when the user logs out while a check is waiting for storage', async () => {
    const page: { current?: ReturnType<typeof setup> } = {};
    const { factory, real } = interruptible(() => void page.current?.notifier.stop());
    page.current = setup({ indexedDB: factory });
    const { sync, shown, created, fired } = page.current;
    const reminder = makeReminder('bio', T0 - MINUTE);

    await sync([reminder]);
    expect(shown).toEqual([]);
    expect(created).toEqual([]);
    expect(fired).toEqual([]);
    // The check really was under way: it had recorded the reminder, and now keeps it for the inbox.
    expect(await readAll<FiredRecord>(real, 'fired')).toEqual([
      { accountId: 'anna', reminderId: 'bio', firedAt: T0, pendingFor: 'anna', reminder },
    ]);

    // Signed in again: the reminder reaches the inbox after all, without a notification.
    await sync([reminder]);
    await sync([reminder]);
    expect(fired).toEqual([reminder]);
    expect(shown).toEqual([]);
  });

  it('never hands a reminder to another account that signs in during a check', async () => {
    const page: { current?: ReturnType<typeof setup> } = {};
    const forBram: Reminder[] = [];
    const { factory, real } = interruptible(
      () => void page.current?.notifier.sync([], { accountId: 'bram', onFire: (r) => forBram.push(r) }),
    );
    page.current = setup({ indexedDB: factory });
    const { sync, shown, fired } = page.current;

    const reminder = makeReminder('van-anna', T0 - MINUTE);
    await sync([reminder], 'anna');
    expect(forBram).toEqual([]);
    expect(fired).toEqual([]);
    expect(shown).toEqual([]);
    expect(await readAll<FiredRecord>(real, 'fired')).toEqual([
      { accountId: 'anna', reminderId: 'van-anna', firedAt: T0, pendingFor: 'anna', reminder },
    ]);

    await sync([reminder], 'anna');
    expect(fired).toEqual([reminder]);
    expect(forBram).toEqual([]);
  });
});

// ───────────────────────── Interrupted while delivering ─────────────────────────

describe('notifier: interrupted while showing a notification', () => {
  /** A registration that runs `interrupt` while its first notification is being shown. */
  function interruptingRegistration(interrupt: () => void) {
    const shown: string[] = [];
    const registration: NotificationRegistration = {
      showNotification: async (title) => {
        shown.push(title);
        if (shown.length === 1) interrupt();
      },
    };
    return { registration, shown };
  }

  it('never gives a reminder to another account that signs in meanwhile, and keeps it for its owner', async () => {
    const page: { current?: ReturnType<typeof setup> } = {};
    const forBram: Reminder[] = [];
    // Both accounts have a reminder with the same id: ids are only unique within an account.
    const ofAnna = [
      makeReminder('dagoverzicht:2026-11-16', T0 - 2 * MINUTE, { title: 'Anna: vandaag' }),
      makeReminder('avondcheck:2026-11-16', T0 - MINUTE, { title: 'Anna: nog open' }),
    ];
    const ofBram = [makeReminder('avondcheck:2026-11-16', T0 - MINUTE, { title: 'Bram: nog open' })];
    const { registration, shown } = interruptingRegistration(
      () => void page.current?.notifier.sync(ofBram, { accountId: 'bram', onFire: (r) => forBram.push(r) }),
    );
    page.current = setup({ getRegistration: async () => registration });
    const { sync, fired } = page.current;

    await sync(ofAnna, 'anna');
    // Bram's own reminder with that id is not mistaken for the one of Anna.
    await vi.waitFor(() => expect(forBram.map((r) => r.title)).toEqual(['Bram: nog open']));
    expect(fired.map((r) => r.title)).toEqual(['Anna: vandaag']);
    expect(shown).toEqual(['Anna: vandaag', 'Bram: nog open']);

    // Anna signs in again: what she missed lands in her inbox, once.
    await sync(ofAnna, 'anna');
    await sync(ofAnna, 'anna');
    expect(fired.map((r) => r.title)).toEqual(['Anna: vandaag', 'Anna: nog open']);
    expect(forBram).toHaveLength(1);
    expect(shown).toHaveLength(2);
  });

  it('keeps what it could not deliver before a logout for the next time that account signs in', async () => {
    const page: { current?: ReturnType<typeof setup> } = {};
    const { registration, shown } = interruptingRegistration(() => void page.current?.notifier.stop());
    const idb = new IDBFactory();
    page.current = setup({ indexedDB: idb, getRegistration: async () => registration });
    const reminders = [makeReminder('a', T0 - 2 * MINUTE), makeReminder('b', T0 - MINUTE)];

    await page.current.sync(reminders);
    expect(ids(page.current.fired)).toEqual(['a']);
    expect(shown).toEqual(['Tijd om te leren: a']);

    // After a reload, on the same device.
    const reloaded = setup({ indexedDB: idb });
    await reloaded.sync(reminders);
    await reloaded.sync(reminders);
    expect(ids(reloaded.fired)).toEqual(['b']);
  });

  it('delivers the rest after a logout when it can only remember in memory', async () => {
    const page: { current?: ReturnType<typeof setup> } = {};
    const { registration } = interruptingRegistration(() => void page.current?.notifier.stop());
    page.current = setup({ indexedDB: null, getRegistration: async () => registration });
    const { sync, fired } = page.current;
    const reminders = [makeReminder('a', T0 - 2 * MINUTE), makeReminder('b', T0 - MINUTE)];

    await sync(reminders);
    expect(ids(fired)).toEqual(['a']);
    await sync(reminders);
    await sync(reminders);
    expect(ids(fired)).toEqual(['a', 'b']);
  });

  it('gives a reminder to the app even when its notification never finishes showing', async () => {
    const registration: NotificationRegistration = { showNotification: () => new Promise(() => undefined) };
    const { sync, fired } = setup({ getRegistration: async () => registration });

    void sync([makeReminder('bio', T0 - MINUTE)]);
    await vi.waitFor(() => expect(ids(fired)).toEqual(['bio']));
  });
});

describe('notifier: sync from inside onFire', () => {
  it('delivers every reminder once when the app syncs again for each inbox item', async () => {
    const { notifier, clock, shown } = setup();
    const delivered: string[] = [];
    let reminders = [makeReminder('a', T0 - 2 * MINUTE), makeReminder('b', T0 - MINUTE), makeReminder('c', T0 + MINUTE)];
    const syncAgain = (): Promise<void> =>
      notifier.sync(reminders, {
        accountId: 'anna',
        onFire: (reminder) => {
          delivered.push(reminder.id);
          // The inbox item changes the state of the app, which recomputes its reminders and
          // syncs again; here the new list even holds one more reminder that is already due.
          if (!reminder.id.startsWith('extra')) {
            reminders = [...reminders, makeReminder(`extra-${reminder.id}`, clock.now() - MINUTE)];
          }
          void syncAgain();
        },
      });

    await syncAgain();
    await vi.waitFor(() => expect(delivered).toHaveLength(4));
    await clock.advance(MINUTE);
    await vi.waitFor(() => expect(delivered).toHaveLength(6));
    await clock.advance(5 * MINUTE);
    await notifier.sync(reminders, { accountId: 'anna', onFire: (reminder) => delivered.push(reminder.id) });

    expect([...delivered].sort()).toEqual(['a', 'b', 'c', 'extra-a', 'extra-b', 'extra-c']);
    expect(shown.map((n) => n.options?.tag).sort()).toEqual(['a', 'b', 'c', 'extra-a', 'extra-b', 'extra-c']);
    expect(clock.intervals()).toEqual([MINUTE]);
    expect(clock.timeouts()).toEqual([]);
  });
});

// ───────────────────────── Missing permission and missing APIs ─────────────────────────

describe('notifier: fallbacks', () => {
  it.each(['denied', 'default'] as const)('skips the system notification when permission is %s', async (permission) => {
    const { api, created } = createNotificationApi(permission);
    const { sync, shown, fired, notifier } = setup({ notification: api });

    await sync([makeReminder('bio', T0 - MINUTE)]);
    expect(shown).toEqual([]);
    expect(created).toEqual([]);
    expect(ids(fired)).toEqual(['bio']);
    await expect(notifier.sendTest()).resolves.toBe(false);
  });

  it('works without the Notification API', async () => {
    const { sync, shown, fired, notifier } = setup({ notification: null });
    await sync([makeReminder('bio', T0 - MINUTE)]);
    expect(shown).toEqual([]);
    expect(ids(fired)).toEqual(['bio']);
    await expect(notifier.sendTest()).resolves.toBe(false);
  });

  it.each([
    ['there is no service worker', async () => undefined],
    ['the service worker is not active yet', async () => ({ showNotification: () => Promise.reject(new TypeError('No active registration')) })],
    ['looking up the service worker fails', () => Promise.reject(new Error('geen toegang'))],
  ] satisfies [string, NotifierDeps['getRegistration']][])(
    'shows the notification from the page when %s',
    async (_, getRegistration) => {
      const { sync, created, opened, fired } = setup({ getRegistration });
      await sync([makeReminder('bio', T0 - MINUTE)]);

      expect(created).toHaveLength(1);
      expect(created[0].title).toBe('Tijd om te leren: bio');
      expect(created[0].options?.tag).toBe('bio');
      expect(ids(fired)).toEqual(['bio']);

      // A click closes the notification and opens the link in the app.
      (created[0].onclick as () => void)();
      expect(created[0].closed).toBe(true);
      expect(opened).toEqual(['#/agenda/2026-11-16']);
    },
  );

  it('never throws when the Notification constructor is not allowed (Android Chrome)', async () => {
    const { api } = createNotificationApi();
    const Illegal = function () {
      throw new TypeError('Illegal constructor');
    } as unknown as NotificationApi;
    Object.defineProperty(Illegal, 'permission', { value: api.permission });
    const { sync, fired, notifier } = setup({ notification: Illegal, getRegistration: async () => undefined });

    await expect(sync([makeReminder('bio', T0 - MINUTE)])).resolves.toBeUndefined();
    expect(ids(fired)).toEqual(['bio']);
    await expect(notifier.sendTest()).resolves.toBe(false);
  });

  it('fires once per page load when IndexedDB is missing', async () => {
    const { sync, clock, shown, fired } = setup({ indexedDB: null });
    const reminders = [makeReminder('due', T0 - MINUTE), makeReminder('soon', T0 + MINUTE)];

    await sync(reminders);
    await sync(reminders);
    await clock.advance(5 * MINUTE);
    await sync(reminders);
    expect(ids(fired)).toEqual(['due', 'soon']);
    expect(shown).toHaveLength(2);
  });

  it('fires once per page load when IndexedDB refuses to open', async () => {
    const broken = {
      open: () => {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      },
    } as unknown as IDBFactory;
    const { notifier, sync, fired } = setup({ indexedDB: broken });
    const reminders = [makeReminder('due', T0 - MINUTE)];

    await sync(reminders);
    await sync(reminders);
    expect(ids(fired)).toEqual(['due']);
    await expect(notifier.stop()).resolves.toBeUndefined();
  });

  it('fires from memory when IndexedDB reports an error instead of opening', async () => {
    // Firefox in private browsing: open() returns a request that fails a moment later.
    const failing = {
      open: () => {
        const request = { error: new DOMException('A mutation operation was attempted', 'InvalidStateError') } as {
          error: DOMException;
          onerror?: () => void;
        };
        queueMicrotask(() => request.onerror?.());
        return request;
      },
    } as unknown as IDBFactory;
    const { sync, clock, fired, shown } = setup({ indexedDB: failing });
    const reminders = [makeReminder('due', T0 - MINUTE), makeReminder('soon', T0 + MINUTE)];

    await sync(reminders);
    await sync(reminders);
    await clock.advance(2 * MINUTE);
    expect(ids(fired)).toEqual(['due', 'soon']);
    expect(shown).toHaveLength(2);
  });

  it('leaves out the link when a reminder has none', async () => {
    const { sync, shown } = setup();
    await sync([makeReminder('bio', T0 - MINUTE, { link: undefined })]);
    expect(shown[0].options?.data).toEqual({ link: '' });
  });
});

// ───────────────────────── Test notification ─────────────────────────

describe('notifier: sendTest', () => {
  it('shows a Dutch test notification that links to the notification settings', async () => {
    const { notifier, shown } = setup();
    await expect(notifier.sendTest()).resolves.toBe(true);

    expect(shown).toHaveLength(1);
    expect(shown[0].title).toBe('Meldingen staan aan');
    expect(shown[0].options).toMatchObject({
      body: 'Zo ziet een herinnering van School Buddy eruit.',
      tag: 'sb-test',
      icon: NOTIFICATION_ICON,
      data: { link: '#/profiel/meldingen' },
    });
  });
});

describe('default notifier', () => {
  it('is ready to use and safe to stop in an environment without notifications', async () => {
    expect(typeof defaultNotifier.sync).toBe('function');
    await expect(defaultNotifier.sendTest()).resolves.toBe(false);
  });
});
