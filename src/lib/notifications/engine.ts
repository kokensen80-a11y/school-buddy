/**
 * Notification engine (browser side).
 *
 * A web page cannot schedule a notification for a future moment: without a push server,
 * notifications can only be shown while the page or its service worker is running. So this
 * engine
 *   1. fires reminders from timers while the app is open (also in a background tab, where
 *      timers are throttled, hence the extra checks every minute and whenever the page wakes up);
 *   2. catches up when the app is opened later: a reminder that was missed only just is still
 *      shown, older ones go to the in-app inbox only;
 *   3. stores the queue so the service worker (public/sw.js) can show due reminders when the
 *      browser happens to wake it up (Periodic Background Sync, where that exists).
 * For reminders that must arrive while the app is closed there is the calendar export (ics.ts).
 *
 * ─── Shared IndexedDB schema: keep this block identical in engine.ts and public/sw.js ───
 * Database 'school-buddy-notifications', version 1. All times are epoch milliseconds.
 *
 * Store 'queue', keyPath 'accountId'
 *   { accountId: string, updatedAt: number, reminders: Reminder[] }
 *   The reminders the page computed most recently for the signed-in account, where
 *   Reminder = { id, at (ISO timestamp), kind, title, body, link? }.
 *   Holds at most one record: the page replaces the whole store on every sync and empties
 *   it on logout. Read by the service worker.
 *
 * Store 'fired', keyPath ['accountId', 'reminderId']
 *   { accountId: string, reminderId: string, firedAt: number,
 *     pendingFor?: string, reminder?: Reminder }
 *   One record per delivered reminder. Delivering starts with add() of this record; add()
 *   fails when the key exists, so of the page, other tabs and the service worker exactly
 *   one delivers a reminder.
 *   pendingFor (= accountId) and reminder mark a reminder that the in-app inbox has not seen
 *   yet. The service worker sets them (it shows the system notification itself), and so does
 *   a page whose user signed out before the reminder could be handed to the app. A page of
 *   that account hands such reminders to the app and removes both fields.
 *   Index 'firedAt' on firedAt: the page deletes records older than 30 days.
 *   Index 'pendingFor' on pendingFor: contains only the records that have that field.
 * ────────────────────────────────────────────────────────────────────────────────────────
 */
import type { Reminder } from '../../types';
import { DEFAULT_GRACE_MINUTES } from './reminders';

const DB_NAME = 'school-buddy-notifications';
const DB_VERSION = 1;
const QUEUE_STORE = 'queue';
const FIRED_STORE = 'fired';
const FIRED_AT_INDEX = 'firedAt';
const PENDING_INDEX = 'pendingFor';

/** Relative to the page, so they also resolve when the app is served from a sub-folder. */
export const NOTIFICATION_ICON = 'icons/icon-192.png';
export const NOTIFICATION_BADGE = 'icons/badge-96.png';

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
/** Timers are only armed this far ahead; later reminders are picked up by a later sync or check. */
const ARM_WINDOW_MS = DAY_MS;
/** Safety net for throttled or dropped timers. */
const CHECK_INTERVAL_MS = MINUTE_MS;
const FIRED_LOG_RETENTION_MS = 30 * DAY_MS;

// ───────────────────────── Platform ─────────────────────────

export type NotificationPermissionState = 'granted' | 'denied' | 'default' | 'unsupported';

/** The parts of the global Notification constructor the engine uses. */
export interface NotificationApi {
  readonly permission: NotificationPermission;
  requestPermission(
    callback?: (permission: NotificationPermission) => void,
  ): Promise<NotificationPermission> | void;
  new (title: string, options?: NotificationOptions): { onclick: unknown; close(): void };
}

/** The part of a ServiceWorkerRegistration the engine uses. */
export interface NotificationRegistration {
  /** Rejects while the registration has no active worker yet. */
  showNotification(title: string, options?: NotificationOptions): Promise<void>;
}

/** Everything that touches the platform. Tests replace these; the app uses the defaults. */
export interface NotifierDeps {
  /** The Notification constructor, or null where the browser has none. */
  notification: NotificationApi | null;
  /** The service-worker registration of this page, if there is one. */
  getRegistration: () => Promise<NotificationRegistration | undefined>;
  /** null where storage is unavailable; the engine then only remembers what it fired in memory. */
  indexedDB: IDBFactory | null;
  now: () => number;
  setTimeout: (callback: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
  setInterval: (callback: () => void, ms: number) => unknown;
  clearInterval: (handle: unknown) => void;
  /** Calls back whenever the page becomes visible, gets focus or is restored. Returns the unsubscribe. */
  onWake: (callback: () => void) => () => void;
  /** Opens an in-app link after a click on a notification shown by the page itself. */
  openLink: (link: string) => void;
  /** Reminders missed by at most this much still get a system notification. */
  graceMinutes: number;
}

function globalNotification(): NotificationApi | null {
  return typeof Notification === 'undefined' ? null : Notification;
}

/** Reading `indexedDB` itself throws in some sandboxed or storage-blocked contexts. */
function globalIndexedDB(): IDBFactory | null {
  try {
    return typeof indexedDB === 'undefined' ? null : indexedDB;
  } catch {
    return null;
  }
}

function listenForWake(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  document.addEventListener('visibilitychange', callback);
  window.addEventListener('focus', callback);
  window.addEventListener('pageshow', callback);
  return () => {
    document.removeEventListener('visibilitychange', callback);
    window.removeEventListener('focus', callback);
    window.removeEventListener('pageshow', callback);
  };
}

function browserDeps(): NotifierDeps {
  return {
    notification: globalNotification(),
    getRegistration: async () =>
      typeof navigator !== 'undefined' && 'serviceWorker' in navigator
        ? navigator.serviceWorker.getRegistration()
        : undefined,
    indexedDB: globalIndexedDB(),
    now: () => Date.now(),
    setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
    clearTimeout: (handle) => globalThis.clearTimeout(handle as number),
    setInterval: (callback, ms) => globalThis.setInterval(callback, ms),
    clearInterval: (handle) => globalThis.clearInterval(handle as number),
    onWake: listenForWake,
    openLink: (link) => {
      window.focus();
      if (link) window.location.hash = link;
    },
    graceMinutes: DEFAULT_GRACE_MINUTES,
  };
}

// ───────────────────────── Permission ─────────────────────────

/** `api` is only passed by tests; null stands for a browser without notifications. */
export function permissionState(
  api: NotificationApi | null = globalNotification(),
): NotificationPermissionState {
  return api ? api.permission : 'unsupported';
}

/**
 * Asks the browser for permission. Must be called from a user gesture (a click or tap).
 * Never rejects: when asking fails, the current state is returned.
 */
export async function requestPermission(
  api: NotificationApi | null = globalNotification(),
): Promise<NotificationPermissionState> {
  if (!api) return 'unsupported';
  try {
    return await new Promise<NotificationPermission>((resolve, reject) => {
      // Old Safari only knows the callback form and returns nothing.
      const answer = api.requestPermission(resolve);
      if (answer) answer.then(resolve, reject);
    });
  } catch {
    return api.permission;
  }
}

// ───────────────────────── Storage ─────────────────────────

interface Delivery {
  /** Ids this page was the first to record: it has to deliver them. */
  claimed: Set<string>;
  /** Reminders the service worker showed that the inbox has not seen yet. */
  pending: Reminder[];
}

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore(QUEUE_STORE, { keyPath: 'accountId' });
      const fired = db.createObjectStore(FIRED_STORE, { keyPath: ['accountId', 'reminderId'] });
      fired.createIndex(FIRED_AT_INDEX, 'firedAt');
      fired.createIndex(PENDING_INDEX, 'pendingFor');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('IndexedDB open blocked'));
  });
}

/** Runs `work` in one transaction and resolves with its result once the transaction is committed. */
function transact<T>(
  db: IDBDatabase,
  storeName: string,
  work: (store: IDBObjectStore) => T,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite');
    const result = work(transaction.objectStore(storeName));
    transaction.oncomplete = () => resolve(result);
    transaction.onabort = () => reject(transaction.error);
  });
}

/** Opens the database for one piece of work. Storage problems never surface: `fallback` is returned. */
async function withDatabase<T>(
  factory: IDBFactory | null,
  fallback: T,
  work: (db: IDBDatabase) => Promise<T>,
): Promise<T> {
  if (!factory) return fallback;
  let db: IDBDatabase | undefined;
  try {
    db = await openDatabase(factory);
    return await work(db);
  } catch {
    return fallback;
  } finally {
    db?.close();
  }
}

function pruneFiredLog(store: IDBObjectStore, before: number): void {
  const request = store.index(FIRED_AT_INDEX).openCursor();
  request.onsuccess = () => {
    const cursor = request.result;
    // The index is ordered by time: stop at the first record that is recent enough.
    if (!cursor || cursor.value.firedAt >= before) return;
    cursor.delete();
    cursor.continue();
  };
}

/**
 * Records the due reminders as fired and collects what the service worker left for the inbox,
 * in a single transaction. That makes the outcome the same whichever of the page, another tab
 * or the service worker gets there first.
 */
function recordDelivery(
  db: IDBDatabase,
  accountId: string,
  due: Reminder[],
  now: number,
  prune: boolean,
): Promise<Delivery> {
  return transact(db, FIRED_STORE, (store) => {
    const delivery: Delivery = { claimed: new Set(), pending: [] };
    if (prune) pruneFiredLog(store, now - FIRED_LOG_RETENTION_MS);

    for (const reminder of due) {
      const request = store.add({ accountId, reminderId: reminder.id, firedAt: now });
      request.onsuccess = () => delivery.claimed.add(reminder.id);
      request.onerror = (event) => {
        // Already fired elsewhere: skip this one, but keep the transaction alive for the rest.
        if (request.error?.name === 'ConstraintError') event.preventDefault();
      };
    }

    const request = store.index(PENDING_INDEX).openCursor(accountId);
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      const record = cursor.value;
      delivery.pending.push(record.reminder);
      delete record.pendingFor;
      delete record.reminder;
      cursor.update(record);
      cursor.continue();
    };
    return delivery;
  });
}

/**
 * Leaves reminders that are recorded as fired, but could not be handed to the app any more,
 * for the inbox of their account.
 */
function keepForInbox(
  db: IDBDatabase,
  accountId: string,
  reminders: Reminder[],
  now: number,
): Promise<void> {
  return transact(db, FIRED_STORE, (store) => {
    for (const reminder of reminders) {
      const reminderId = reminder.id;
      store.put({ accountId, reminderId, firedAt: now, pendingFor: accountId, reminder });
    }
  });
}

// ───────────────────────── Notifier ─────────────────────────

export interface SyncOptions {
  /** The signed-in account; every reminder fires at most once per account. */
  accountId: string;
  /** Called once for every delivered reminder, so the app can add it to the in-app inbox. */
  onFire: (reminder: Reminder) => void;
}

export interface Notifier {
  /**
   * Makes `reminders` the complete, current list for this account. Idempotent and cheap: call
   * it on every state change. Resolves when everything that is due has been delivered; never rejects.
   */
  sync(reminders: Reminder[], options: SyncOptions): Promise<void>;
  /** Stops all timers and listeners and forgets the stored queue. Call on logout. Never rejects. */
  stop(): Promise<void>;
  /** Shows a test notification now. Resolves to false when that was not possible. */
  sendTest(): Promise<boolean>;
}

interface Session extends SyncOptions {
  reminders: Reminder[];
}

export function createNotifier(overrides: Partial<NotifierDeps> = {}): Notifier {
  // An override that is present but undefined keeps the default (null is a real value: "absent").
  const given = Object.entries(overrides).filter(([, value]) => value !== undefined);
  const deps: NotifierDeps = { ...browserDeps(), ...Object.fromEntries(given) };
  const graceMs = deps.graceMinutes * MINUTE_MS;

  let session: Session | null = null;
  /** Ids this instance has dealt with for `handledAccount`, so they are not looked up again. */
  const handled = new Set<string>();
  let handledAccount: string | null = null;
  let timer: unknown = null;
  let interval: unknown = null;
  let stopListening: (() => void) | null = null;
  /** What this instance last wrote to the queue store (null = emptied); undefined = not known yet. */
  let storedQueue: string | null | undefined;
  let pruned = false;

  /** All storage work runs one after the other, in the order it was requested. */
  let tail: Promise<void> = Promise.resolve();
  /**
   * Turns `task` into a request that queues it behind the work already waiting. A request made
   * while the task has not started yet does not queue a second run: that run will see the
   * latest state anyway. The returned promise settles after the run and never rejects.
   */
  const queued = (task: () => Promise<void>): (() => Promise<void>) => {
    let waiting = false;
    return () => {
      if (!waiting) {
        waiting = true;
        tail = tail
          .then(() => {
            waiting = false;
            return task();
          })
          .catch(() => undefined);
      }
      return tail;
    };
  };

  async function show(title: string, body: string, tag: string, link: string): Promise<boolean> {
    const api = deps.notification;
    if (!api || api.permission !== 'granted') return false;
    const options: NotificationOptions = {
      body,
      tag,
      icon: NOTIFICATION_ICON,
      badge: NOTIFICATION_BADGE,
      lang: 'nl',
      data: { link },
    };
    try {
      const registration = await deps.getRegistration();
      if (registration) {
        await registration.showNotification(title, options);
        return true;
      }
    } catch {
      // No active worker yet, or the worker refused: fall back to a notification owned by the page.
    }
    try {
      // Throws on Android Chrome, which only allows notifications through a service worker.
      const notification = new api(title, options);
      notification.onclick = () => {
        notification.close();
        deps.openLink(link);
      };
      return true;
    } catch {
      return false;
    }
  }

  function fire(reminder: Reminder): void {
    try {
      session?.onFire(reminder);
    } catch (error) {
      // A failing callback must not cost the other reminders their turn; surface it instead.
      if (typeof globalThis.reportError === 'function') globalThis.reportError(error);
    }
  }

  /** Arms one timer for the first reminder after `after` that this instance has not handled. */
  function arm(after: number): void {
    if (timer !== null) deps.clearTimeout(timer);
    timer = null;
    if (!session) return;

    let next = Infinity;
    for (const reminder of session.reminders) {
      const at = Date.parse(reminder.at);
      if (at > after && at < next && !handled.has(reminder.id)) next = at;
    }
    const delay = Math.max(0, next - deps.now());
    if (delay <= ARM_WINDOW_MS) timer = deps.setTimeout(check, delay);
  }

  async function deliverDue(): Promise<void> {
    const current = session;
    if (!current) return;
    /** False once the user has signed out or another account has signed in. */
    const signedIn = () => session?.accountId === current.accountId;

    const now = deps.now();
    const due = current.reminders.filter(
      (reminder) => Date.parse(reminder.at) <= now && !handled.has(reminder.id),
    );
    const prune = !pruned;
    const { claimed, pending } = await withDatabase<Delivery>(
      deps.indexedDB,
      { claimed: new Set(due.map((reminder) => reminder.id)), pending: [] },
      (db) => recordDelivery(db, current.accountId, due, now, prune),
    );
    pruned = true;

    // During every wait in here the user can sign out or switch accounts. From then on nothing
    // is shown or handed over any more: `handled` and `onFire` belong to whoever is signed in
    // now. What is left is kept for the inbox of this account.
    const undelivered: Reminder[] = [];
    for (const reminder of due) {
      if (!signedIn()) {
        if (claimed.has(reminder.id)) undelivered.push(reminder);
        continue;
      }
      handled.add(reminder.id);
      if (!claimed.has(reminder.id)) continue;
      // The app first: the inbox must not depend on how long the system notification takes.
      fire(reminder);
      if (now - Date.parse(reminder.at) <= graceMs) {
        await show(reminder.title, reminder.body, reminder.id, reminder.link ?? '');
      }
    }
    for (const reminder of pending) {
      if (signedIn()) fire(reminder);
      else undelivered.push(reminder);
    }
    if (undelivered.length > 0) {
      await withDatabase(deps.indexedDB, undefined, (db) =>
        keepForInbox(db, current.accountId, undelivered, now),
      );
    }
    arm(now);
  }

  /** Makes the stored queue match the session: its reminders while signed in, nothing after stop(). */
  async function storeQueue(): Promise<void> {
    const current = session;
    const wanted = current ? JSON.stringify([current.accountId, current.reminders]) : null;
    if (wanted === storedQueue) return;
    storedQueue = await withDatabase(deps.indexedDB, storedQueue, async (db) => {
      await transact(db, QUEUE_STORE, (store) => {
        store.clear();
        if (current) {
          store.put({
            accountId: current.accountId,
            updatedAt: deps.now(),
            reminders: current.reminders,
          });
        }
      });
      return wanted;
    });
  }

  const check = queued(deliverDue);
  const saveQueue = queued(storeQueue);

  return {
    sync(reminders, { accountId, onFire }) {
      if (handledAccount !== accountId) handled.clear();
      handledAccount = accountId;
      session = { accountId, onFire, reminders };

      interval ??= deps.setInterval(check, CHECK_INTERVAL_MS);
      stopListening ??= deps.onWake(check);
      arm(deps.now());
      void saveQueue();
      return check();
    },

    stop() {
      session = null;
      if (timer !== null) deps.clearTimeout(timer);
      if (interval !== null) deps.clearInterval(interval);
      stopListening?.();
      timer = null;
      interval = null;
      stopListening = null;
      return saveQueue();
    },

    sendTest() {
      return show(
        'Meldingen staan aan',
        'Zo ziet een herinnering van School Buddy eruit.',
        'sb-test',
        '#/profiel/meldingen',
      );
    },
  };
}

/** The notifier of the app. */
const notifier: Notifier = createNotifier();
export default notifier;
