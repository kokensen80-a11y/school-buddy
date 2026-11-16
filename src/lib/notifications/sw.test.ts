/**
 * Runs the real public/sw.js against a fake service-worker global scope. The reminder tests
 * share one in-memory IndexedDB between the worker and the real engine, so they also prove
 * that both sides agree on the database.
 */
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import workerSource from '../../../public/sw.js?raw';
import type { Reminder } from '../../types';
import engineSource from './engine.ts?raw';
import { createNotifier } from './engine';

const SCOPE = 'https://school.test/klas/app/';
const CACHE = 'school-buddy:/klas/app/:v1';
const MINUTE = 60_000;
const T0 = Date.UTC(2026, 10, 16, 14, 0, 0);

// ───────────────────────── Fake service-worker scope ─────────────────────────

interface FakeRequest {
  url: string;
  method: string;
  mode: string;
  cache: string;
  headers: Headers;
}

function request(path: string, init: Partial<Omit<FakeRequest, 'url' | 'headers'>> & { headers?: HeadersInit } = {}): FakeRequest {
  return {
    url: new URL(path, SCOPE).href,
    method: init.method ?? 'GET',
    mode: init.mode ?? 'cors',
    cache: init.cache ?? 'default',
    headers: new Headers(init.headers),
  };
}

/** Gives a Response the network-only properties that a script cannot set through the constructor. */
function mark(response: Response, type: string, redirected: boolean): Response {
  Object.defineProperty(response, 'type', { value: type });
  Object.defineProperty(response, 'redirected', { value: redirected });
  return response;
}

/** A response as the network delivers it: same-origin ("basic") unless stated otherwise. */
function networkResponse(body: string, init: { status?: number; type?: string; redirected?: boolean } = {}): Response {
  return mark(new Response(body, { status: init.status ?? 200 }), init.type ?? 'basic', init.redirected ?? false);
}

const urlOf = (input: FakeRequest | string) => (typeof input === 'string' ? input : input.url);

type Route = Response | Error | (() => Promise<Response>);

interface FakeClient {
  url: string;
  focused: boolean;
  focus: () => Promise<void>;
  postMessage: (message: unknown) => void;
}

interface WorkerOptions {
  dev?: boolean;
  idb?: IDBFactory;
  permission?: NotificationPermission | null;
  brokenCaches?: boolean;
}

function loadWorker({ dev = false, idb = new IDBFactory(), permission = 'granted', brokenCaches = false }: WorkerOptions = {}) {
  const handlers = new Map<string, (event: object) => void>();
  const stores = new Map<string, Map<string, Response>>();
  const routes = new Map<string, Route>();
  const fetched: string[] = [];
  const shown: { title: string; options: NotificationOptions }[] = [];
  const clients: FakeClient[] = [];
  const opened: string[] = [];
  let failNotifications = 0;

  const fetch = async (input: FakeRequest | string): Promise<Response> => {
    const url = urlOf(input);
    fetched.push(url);
    const route = routes.get(url);
    if (route === undefined) throw new TypeError(`offline: ${url}`);
    if (route instanceof Error) throw route;
    // Every request gets its own copy, so a route can be fetched more than once.
    return route instanceof Response ? mark(route.clone(), route.type, route.redirected) : route();
  };

  const caches = {
    async open(name: string) {
      if (brokenCaches) throw new DOMException('Cache storage is disabled', 'SecurityError');
      let store = stores.get(name);
      if (!store) stores.set(name, (store = new Map()));
      const entries = store;
      return {
        match: async (input: FakeRequest | string) => entries.get(urlOf(input))?.clone(),
        put: async (input: FakeRequest | string, response: Response) => {
          entries.set(urlOf(input), response);
        },
        add: async (url: string) => {
          const response = await fetch(url);
          if (!response.ok) throw new TypeError(`bad status for ${url}`);
          entries.set(url, response);
        },
      };
    },
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
  };

  const self = {
    location: { href: `${SCOPE}sw.js${dev ? '?dev=1' : ''}` },
    registration: {
      scope: SCOPE,
      showNotification: async (title: string, options: NotificationOptions) => {
        if (failNotifications > 0) {
          failNotifications -= 1;
          throw new TypeError('No notification permission');
        }
        shown.push({ title, options });
      },
    },
    addEventListener: (type: string, handler: (event: object) => void) => handlers.set(type, handler),
    skipWaiting: vi.fn(async () => undefined),
    clients: {
      claim: vi.fn(async () => undefined),
      matchAll: async () => clients,
      openWindow: async (url: string) => {
        opened.push(url);
        return null;
      },
    },
    caches,
    fetch,
    indexedDB: idb,
    Notification: permission === null ? undefined : { permission },
  };
  new Function('self', workerSource)(self);

  /** Fires an event at the worker. `finished` settles when everything it kept alive is done. */
  function dispatch(type: string, init: object = {}) {
    const waits: Promise<unknown>[] = [];
    let response: Promise<Response> | undefined;
    handlers.get(type)?.({
      ...init,
      waitUntil: (promise: Promise<unknown>) => waits.push(Promise.resolve(promise)),
      respondWith: (promise: Promise<Response>) => {
        response = Promise.resolve(promise);
      },
    });
    const answer = response as Promise<Response> | undefined;
    const finished = async () => {
      // Like the browser: the event lives until its answer is there and all extensions are done.
      await answer?.catch(() => undefined);
      // Handlers may extend the event while it is running.
      for (let index = 0; index < waits.length; index += 1) await waits[index];
    };
    return { response: answer, finished };
  }

  const cached = async (name: string, url: string) => stores.get(name)?.get(url)?.clone().text();

  return {
    self,
    handlers,
    dispatch,
    routes,
    fetched,
    stores,
    cached,
    shown,
    clients,
    opened,
    idb,
    failNextNotifications: (count: number) => {
      failNotifications = count;
    },
  };
}

function makeReminder(id: string, at: number): Reminder {
  return {
    id,
    at: new Date(at).toISOString(),
    kind: 'sessie',
    title: `Tijd om te leren: ${id}`,
    body: '16:00 · 30 min',
    link: '#/agenda/2026-11-16',
  };
}

/** The app in a browser tab at a fixed moment: the real engine on the given database, timers disabled. */
function openPage(idb: IDBFactory, now: number) {
  const fired: Reminder[] = [];
  const shown: string[] = [];
  const notifier = createNotifier({
    notification: null,
    getRegistration: async () => ({
      showNotification: async (title) => {
        shown.push(title);
      },
    }),
    indexedDB: idb,
    now: () => now,
    setTimeout: () => 0,
    clearTimeout: () => undefined,
    setInterval: () => 0,
    clearInterval: () => undefined,
    onWake: () => () => undefined,
  });
  const sync = (reminders: Reminder[], accountId = 'anna') =>
    notifier.sync(reminders, { accountId, onFire: (reminder) => fired.push(reminder) });
  return { notifier, sync, fired, shown };
}

function setNow(now: number) {
  // Only the clock: IndexedDB needs the real timers.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(now);
}

afterEach(() => {
  vi.useRealTimers();
});

// ───────────────────────── Shared contract with the engine ─────────────────────────

describe('service worker and engine', () => {
  it('document the IndexedDB schema with the very same block', () => {
    const block = (source: string) => {
      const lines = source.split('\n');
      const start = lines.findIndex((line) => line.includes('Shared IndexedDB schema'));
      const end = lines.findIndex((line, index) => index > start && /^ \* ─+$/.test(line));
      return start >= 0 && end > start ? lines.slice(start, end + 1).join('\n') : null;
    };

    expect(block(workerSource)).not.toBeNull();
    expect(block(workerSource)).toBe(block(engineSource));
  });

  it('agree on names, grace period and icons', () => {
    for (const literal of ["'school-buddy-notifications'", "'queue'", "'fired'", "'firedAt'", "'pendingFor'", "['accountId', 'reminderId']"]) {
      expect(workerSource).toContain(literal);
      expect(engineSource).toContain(literal);
    }
    for (const image of ["'icons/icon-192.png'", "'icons/badge-96.png'"]) {
      expect(workerSource).toContain(image);
      expect(engineSource).toContain(image);
    }
  });
});

// ───────────────────────── Reminders ─────────────────────────

describe('service worker: reminders', () => {
  it('shows a due reminder from the queue once and leaves it for the inbox of the app', async () => {
    const idb = new IDBFactory();
    const reminder = makeReminder('bio', T0 + 10 * MINUTE);
    await openPage(idb, T0).sync([reminder, makeReminder('later', T0 + 60 * MINUTE)]);

    // The app is closed; the browser wakes the worker a quarter of an hour later.
    setNow(T0 + 15 * MINUTE);
    const worker = loadWorker({ idb });
    await worker.dispatch('periodicsync', { tag: 'sb-reminders' }).finished();

    expect(worker.shown).toEqual([
      {
        title: 'Tijd om te leren: bio',
        options: {
          body: '16:00 · 30 min',
          tag: 'bio',
          icon: `${SCOPE}icons/icon-192.png`,
          badge: `${SCOPE}icons/badge-96.png`,
          lang: 'nl',
          data: { link: '#/agenda/2026-11-16' },
        },
      },
    ]);

    await worker.dispatch('periodicsync', { tag: 'sb-reminders' }).finished();
    expect(worker.shown).toHaveLength(1);

    // The app is opened again: the reminder lands in the inbox, without a second notification.
    const page = openPage(idb, T0 + 20 * MINUTE);
    await page.sync([reminder, makeReminder('later', T0 + 60 * MINUTE)]);
    expect(page.fired).toEqual([reminder]);
    expect(page.shown).toEqual([]);

    await page.sync([reminder]);
    expect(page.fired).toHaveLength(1);
  });

  it('skips what the page already delivered', async () => {
    const idb = new IDBFactory();
    const reminder = makeReminder('bio', T0 - MINUTE);
    const page = openPage(idb, T0);
    await page.sync([reminder]);
    expect(page.fired).toEqual([reminder]);

    setNow(T0 + MINUTE);
    const worker = loadWorker({ idb });
    await worker.dispatch('periodicsync', { tag: 'sb-reminders' }).finished();
    expect(worker.shown).toEqual([]);
  });

  it('leaves reminders outside the grace period to the app', async () => {
    const idb = new IDBFactory();
    const old = makeReminder('old', T0 + MINUTE);
    const future = makeReminder('future', T0 + 10 * 60 * MINUTE);
    await openPage(idb, T0).sync([old, future]);

    // 92 minutes later: `old` is 91 minutes overdue, one minute past the grace period.
    setNow(T0 + 92 * MINUTE);
    const worker = loadWorker({ idb });
    await worker.dispatch('periodicsync', { tag: 'sb-reminders' }).finished();
    expect(worker.shown).toEqual([]);

    const page = openPage(idb, T0 + 93 * MINUTE);
    await page.sync([old, future]);
    expect(page.fired).toEqual([old]);
  });

  it('shows a reminder that is exactly at the edge of the grace period', async () => {
    const idb = new IDBFactory();
    await openPage(idb, T0).sync([makeReminder('edge', T0 + MINUTE)]);

    setNow(T0 + 91 * MINUTE);
    const worker = loadWorker({ idb });
    await worker.dispatch('periodicsync', { tag: 'sb-reminders' }).finished();
    expect(worker.shown.map((n) => n.options.tag)).toEqual(['edge']);
  });

  it.each(['denied', 'default', null] as const)('does nothing without permission (%s)', async (permission) => {
    const idb = new IDBFactory();
    const reminder = makeReminder('bio', T0 + MINUTE);
    await openPage(idb, T0).sync([reminder]);

    setNow(T0 + 5 * MINUTE);
    const worker = loadWorker({ idb, permission });
    await worker.dispatch('periodicsync', { tag: 'sb-reminders' }).finished();
    expect(worker.shown).toEqual([]);

    // Not marked as delivered: the app still gets it.
    const page = openPage(idb, T0 + 6 * MINUTE);
    await page.sync([reminder]);
    expect(page.fired).toEqual([reminder]);
  });

  it('also checks on activation and on an sb-check message, but not on other events', async () => {
    const idb = new IDBFactory();
    await openPage(idb, T0).sync([makeReminder('a', T0 + MINUTE), makeReminder('b', T0 + 3 * MINUTE)]);
    const worker = loadWorker({ idb });

    setNow(T0 + 2 * MINUTE);
    await worker.dispatch('periodicsync', { tag: 'iets-anders' }).finished();
    await worker.dispatch('message', { data: { type: 'iets-anders' } }).finished();
    await worker.dispatch('message', { data: null }).finished();
    expect(worker.shown).toEqual([]);

    await worker.dispatch('message', { data: { type: 'sb-check' } }).finished();
    expect(worker.shown.map((n) => n.options.tag)).toEqual(['a']);

    setNow(T0 + 4 * MINUTE);
    await worker.dispatch('activate').finished();
    expect(worker.shown.map((n) => n.options.tag)).toEqual(['a', 'b']);
  });

  it('shows nothing after the app stopped (logout)', async () => {
    const idb = new IDBFactory();
    const page = openPage(idb, T0);
    await page.sync([makeReminder('bio', T0 + MINUTE)]);
    await page.notifier.stop();

    setNow(T0 + 2 * MINUTE);
    const worker = loadWorker({ idb });
    await worker.dispatch('periodicsync', { tag: 'sb-reminders' }).finished();
    expect(worker.shown).toEqual([]);
  });

  it('creates the database itself when the app never did, in a form the app can use', async () => {
    const idb = new IDBFactory();
    setNow(T0);
    const worker = loadWorker({ idb });
    await worker.dispatch('periodicsync', { tag: 'sb-reminders' }).finished();
    expect(worker.shown).toEqual([]);

    const reminder = makeReminder('bio', T0 - MINUTE);
    const page = openPage(idb, T0);
    await page.sync([reminder]);
    expect(page.fired).toEqual([reminder]);

    const reloaded = openPage(idb, T0);
    await reloaded.sync([reminder]);
    expect(reloaded.fired).toEqual([]);
  });

  it('carries on when one notification cannot be shown or storage is unavailable', async () => {
    const idb = new IDBFactory();
    await openPage(idb, T0).sync([makeReminder('a', T0 + MINUTE), makeReminder('b', T0 + MINUTE)]);

    setNow(T0 + 2 * MINUTE);
    const worker = loadWorker({ idb });
    worker.failNextNotifications(1);
    await worker.dispatch('periodicsync', { tag: 'sb-reminders' }).finished();
    expect(worker.shown.map((n) => n.options.tag)).toEqual(['b']);

    const broken = { open: () => { throw new DOMException('insecure', 'SecurityError'); } } as unknown as IDBFactory;
    const withoutStorage = loadWorker({ idb: broken });
    await expect(withoutStorage.dispatch('periodicsync', { tag: 'sb-reminders' }).finished()).resolves.toBeUndefined();
    await expect(withoutStorage.dispatch('activate').finished()).resolves.toBeUndefined();
  });
});

// ───────────────────────── Notification clicks ─────────────────────────

describe('service worker: notification click', () => {
  function client(url: string, focused = false) {
    const messages: unknown[] = [];
    let focusCalls = 0;
    const fake: FakeClient = {
      url,
      focused,
      focus: async () => {
        focusCalls += 1;
      },
      postMessage: (message) => messages.push(message),
    };
    return { fake, messages, focusCalls: () => focusCalls };
  }

  function click(worker: ReturnType<typeof loadWorker>, data: unknown) {
    const close = vi.fn();
    const event = worker.dispatch('notificationclick', { notification: { close, data } });
    return { close, finished: event.finished };
  }

  it('focuses the open app and tells it where to go', async () => {
    const worker = loadWorker();
    const background = client(`${SCOPE}#/home`);
    const front = client(`${SCOPE}#/toetsen`, true);
    const otherApp = client('https://school.test/andere-app/', true);
    worker.clients.push(otherApp.fake, background.fake, front.fake);

    const { close, finished } = click(worker, { link: '#/agenda/2026-11-16' });
    await finished();

    expect(close).toHaveBeenCalledOnce();
    expect(front.messages).toEqual([{ type: 'sb-navigate', link: '#/agenda/2026-11-16' }]);
    expect(front.focusCalls()).toBe(1);
    expect(background.messages).toEqual([]);
    expect(otherApp.messages).toEqual([]);
    expect(worker.opened).toEqual([]);
  });

  it('uses a background window when none has focus', async () => {
    const worker = loadWorker();
    const background = client(`${SCOPE}index.html#/home`);
    worker.clients.push(background.fake);

    await click(worker, { link: '#/toetsen/ex-1' }).finished();
    expect(background.messages).toEqual([{ type: 'sb-navigate', link: '#/toetsen/ex-1' }]);
    expect(background.focusCalls()).toBe(1);
  });

  it('opens the app at the link when no window is open', async () => {
    const worker = loadWorker();
    worker.clients.push(client('https://school.test/andere-app/').fake);

    await click(worker, { link: '#/toetsen/ex-1' }).finished();
    expect(worker.opened).toEqual([`${SCOPE}#/toetsen/ex-1`]);
  });

  it.each([undefined, null, {}, { link: 42 }, { link: 'https://kwaad.example/' }, { link: '//kwaad.example' }])(
    'opens the app itself when the notification carries no usable link (%j)',
    async (data) => {
      const worker = loadWorker();
      const { close, finished } = click(worker, data);
      await finished();
      expect(close).toHaveBeenCalledOnce();
      expect(worker.opened).toEqual([SCOPE]);
    },
  );

  it('survives a window that cannot be focused', async () => {
    const worker = loadWorker();
    const stubborn = client(`${SCOPE}`);
    stubborn.fake.focus = () => Promise.reject(new Error('InvalidAccessError'));
    worker.clients.push(stubborn.fake);

    await expect(click(worker, { link: '#/home' }).finished()).resolves.toBeUndefined();
    expect(stubborn.messages).toEqual([{ type: 'sb-navigate', link: '#/home' }]);
  });
});

// ───────────────────────── Offline ─────────────────────────

const INDEX_HTML = `<!doctype html>
<html lang="nl">
  <head>
    <link rel="manifest" href="./manifest.webmanifest">
    <link rel="icon" href="./icons/icon-192.png">
    <link rel="preconnect" href="https://fonts.example.com">
    <link rel="stylesheet" crossorigin href="./assets/index-abc.css">
    <script type="module" crossorigin src="./assets/index-abc.js"></script>
  </head>
  <body><a href="#/home">Home</a><a href="/andere-app/x.js">Buiten</a></body>
</html>`;

describe('service worker: install and activate', () => {
  it('takes over at once and caches the app shell with the files it refers to', async () => {
    const worker = loadWorker();
    worker.routes.set(SCOPE, networkResponse(INDEX_HTML));
    worker.routes.set(`${SCOPE}manifest.webmanifest`, networkResponse('{}'));
    worker.routes.set(`${SCOPE}icons/icon-192.png`, networkResponse('nee', { status: 404 }));
    worker.routes.set(`${SCOPE}assets/index-abc.css`, networkResponse('body{}'));
    worker.routes.set(`${SCOPE}assets/index-abc.js`, networkResponse('app()'));
    worker.routes.set(`${SCOPE}icons/badge-96.png`, networkResponse('png'));

    await worker.dispatch('install').finished();

    expect(worker.self.skipWaiting).toHaveBeenCalledOnce();
    // icon-192.png answers 404 here: one missing file does not stop the others.
    expect([...(worker.stores.get(CACHE)?.keys() ?? [])].sort()).toEqual([
      SCOPE,
      `${SCOPE}assets/index-abc.css`,
      `${SCOPE}assets/index-abc.js`,
      `${SCOPE}icons/badge-96.png`,
      `${SCOPE}manifest.webmanifest`,
    ]);
    expect(await worker.cached(CACHE, SCOPE)).toBe(INDEX_HTML);
    // Nothing outside the app's own folder was requested.
    expect(worker.fetched.every((url) => url.startsWith(SCOPE))).toBe(true);
  });

  it('installs even when the network or the cache fails', async () => {
    const offline = loadWorker();
    await expect(offline.dispatch('install').finished()).resolves.toBeUndefined();
    expect(offline.stores.get(CACHE)?.size ?? 0).toBe(0);

    const serverError = loadWorker();
    serverError.routes.set(SCOPE, networkResponse('kapot', { status: 500 }));
    await serverError.dispatch('install').finished();
    expect(serverError.stores.get(CACHE)?.size ?? 0).toBe(0);

    const noCaches = loadWorker({ brokenCaches: true });
    await expect(noCaches.dispatch('install').finished()).resolves.toBeUndefined();
  });

  it('stores a redirected shell as a plain response', async () => {
    const worker = loadWorker();
    worker.routes.set(SCOPE, networkResponse('<html></html>', { redirected: true }));
    await worker.dispatch('install').finished();

    const stored = worker.stores.get(CACHE)?.get(SCOPE);
    expect(stored?.redirected).toBe(false);
    expect(await stored?.clone().text()).toBe('<html></html>');
  });

  it('removes its own old caches on activate, leaves others alone and claims the open pages', async () => {
    const worker = loadWorker();
    worker.stores.set('school-buddy:/klas/app/:v0', new Map());
    worker.stores.set(CACHE, new Map());
    worker.stores.set('school-buddy:/andere-map/:v0', new Map());
    worker.stores.set('iets-van-een-andere-app', new Map());

    await worker.dispatch('activate').finished();

    expect([...worker.stores.keys()].sort()).toEqual([
      'iets-van-een-andere-app',
      'school-buddy:/andere-map/:v0',
      CACHE,
    ]);
    expect(worker.self.clients.claim).toHaveBeenCalledOnce();
  });
});

describe('service worker: app shell (navigation)', () => {
  const navigate = (path = '') => ({ request: request(path, { mode: 'navigate' }) });

  it('answers from the network and keeps a copy', async () => {
    const worker = loadWorker();
    worker.routes.set(SCOPE, networkResponse('<html>v2</html>'));

    const event = worker.dispatch('fetch', navigate());
    expect(await (await event.response)?.text()).toBe('<html>v2</html>');
    await event.finished();
    expect(await worker.cached(CACHE, SCOPE)).toBe('<html>v2</html>');
  });

  it('falls back to the cached shell when offline', async () => {
    const worker = loadWorker();
    worker.routes.set(SCOPE, networkResponse('<html>v1</html>'));
    await worker.dispatch('fetch', navigate()).finished();

    worker.routes.clear();
    for (const path of ['', 'index.html', '?bron=startscherm']) {
      const event = worker.dispatch('fetch', navigate(path));
      expect(await (await event.response)?.text()).toBe('<html>v1</html>');
      await event.finished();
    }
  });

  it('prefers the fresh shell over the cached one', async () => {
    const worker = loadWorker();
    worker.routes.set(SCOPE, networkResponse('<html>v1</html>'));
    await worker.dispatch('fetch', navigate()).finished();

    worker.routes.set(SCOPE, networkResponse('<html>v2</html>'));
    const event = worker.dispatch('fetch', navigate());
    expect(await (await event.response)?.text()).toBe('<html>v2</html>');
    await event.finished();
    expect(await worker.cached(CACHE, SCOPE)).toBe('<html>v2</html>');
  });

  it('uses the cached shell when the server answers with an error', async () => {
    const worker = loadWorker();
    worker.routes.set(SCOPE, networkResponse('<html>v1</html>'));
    await worker.dispatch('fetch', navigate()).finished();

    worker.routes.set(SCOPE, networkResponse('Bad gateway', { status: 502 }));
    const event = worker.dispatch('fetch', navigate());
    expect(await (await event.response)?.text()).toBe('<html>v1</html>');
    await event.finished();
    expect(await worker.cached(CACHE, SCOPE)).toBe('<html>v1</html>');
  });

  it('uses the cached shell when the network takes longer than three seconds', async () => {
    const worker = loadWorker();
    worker.routes.set(SCOPE, networkResponse('<html>v1</html>'));
    await worker.dispatch('fetch', navigate()).finished();

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    worker.routes.set(SCOPE, () => new Promise<Response>(() => undefined));
    const event = worker.dispatch('fetch', navigate());
    let answered = false;
    void event.response?.then(() => {
      answered = true;
    });

    await vi.advanceTimersByTimeAsync(2999);
    expect(answered).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await (await event.response)?.text()).toBe('<html>v1</html>');
  });

  it('passes a server error through when there is no cached shell, and fails when offline', async () => {
    const worker = loadWorker();
    worker.routes.set(SCOPE, networkResponse('Onderhoud', { status: 503 }));
    const event = worker.dispatch('fetch', navigate());
    expect((await event.response)?.status).toBe(503);
    await event.finished();
    expect(worker.stores.get(CACHE)?.has(SCOPE) ?? false).toBe(false);

    worker.routes.clear();
    await expect(worker.dispatch('fetch', navigate()).response).rejects.toThrow('offline');
  });

  it('hands a redirect back to the browser', async () => {
    const worker = loadWorker();
    worker.routes.set(SCOPE, networkResponse('<html>v1</html>'));
    await worker.dispatch('fetch', navigate()).finished();

    const redirect = networkResponse('', { type: 'opaqueredirect' });
    Object.defineProperty(redirect, 'ok', { value: false });
    worker.routes.set(`${SCOPE}index.html`, async () => redirect);
    const event = worker.dispatch('fetch', navigate('index.html'));
    expect(await event.response).toBe(redirect);
    await event.finished();
  });

  it('leaves navigations to other documents alone', () => {
    const worker = loadWorker();
    expect(worker.dispatch('fetch', navigate('bijlage.pdf')).response).toBeUndefined();
    expect(worker.dispatch('fetch', { request: request('/andere-app/', { mode: 'navigate' }) }).response).toBeUndefined();
    expect(worker.fetched).toEqual([]);
  });

  it('still answers from the network when the cache is unavailable', async () => {
    const worker = loadWorker({ brokenCaches: true });
    worker.routes.set(SCOPE, networkResponse('<html>v1</html>'));
    const event = worker.dispatch('fetch', navigate());
    expect(await (await event.response)?.text()).toBe('<html>v1</html>');
  });
});

describe('service worker: static files', () => {
  const asset = `${SCOPE}assets/index-abc.js`;
  const get = (path = 'assets/index-abc.js', init = {}) => ({ request: request(path, init) });

  it('answers from the cache and refreshes it in the background', async () => {
    const worker = loadWorker();
    worker.routes.set(asset, networkResponse('v1'));

    const first = worker.dispatch('fetch', get());
    expect(await (await first.response)?.text()).toBe('v1');
    await first.finished();

    worker.routes.set(asset, networkResponse('v2'));
    const second = worker.dispatch('fetch', get());
    expect(await (await second.response)?.text()).toBe('v1');
    await second.finished();
    expect(await worker.cached(CACHE, asset)).toBe('v2');

    worker.routes.clear();
    const offline = worker.dispatch('fetch', get());
    expect(await (await offline.response)?.text()).toBe('v2');
    await expect(offline.finished()).resolves.toBeUndefined();
  });

  it('does not cache errors or responses that are not plain same-origin ones', async () => {
    const worker = loadWorker();
    worker.routes.set(asset, networkResponse('weg', { status: 404 }));
    const missing = worker.dispatch('fetch', get());
    expect((await missing.response)?.status).toBe(404);
    await missing.finished();

    worker.routes.set(`${SCOPE}deel.mp4`, networkResponse('stukje', { status: 206 }));
    await worker.dispatch('fetch', get('deel.mp4')).finished();
    worker.routes.set(`${SCOPE}vreemd.js`, networkResponse('?', { type: 'opaque' }));
    await worker.dispatch('fetch', get('vreemd.js')).finished();

    expect(worker.stores.get(CACHE)?.size ?? 0).toBe(0);
  });

  it('fails like the network does when a file is neither cached nor reachable', async () => {
    const worker = loadWorker();
    await expect(worker.dispatch('fetch', get()).response).rejects.toThrow('offline');
  });

  it('never touches other methods, other origins, other folders or range requests', () => {
    const worker = loadWorker();
    const untouched = [
      request('api/opslaan', { method: 'POST' }),
      request('assets/index-abc.js', { method: 'HEAD' }),
      request('https://fonts.example.com/font.woff2'),
      request('/andere-app/app.js'),
      request('https://school.test/klas/apparaat.js'),
      request('video.mp4', { headers: { range: 'bytes=0-' } }),
      // fetch() refuses such a request outside 'same-origin' mode; only the browser can answer it.
      request('assets/index-abc.js', { cache: 'only-if-cached', mode: 'no-cors' }),
    ];
    for (const req of untouched) {
      expect(worker.dispatch('fetch', { request: req }).response).toBeUndefined();
    }
    expect(worker.fetched).toEqual([]);
    expect(worker.stores.size).toBe(0);
  });

  it('still answers from the network when the cache is unavailable', async () => {
    const worker = loadWorker({ brokenCaches: true });
    worker.routes.set(asset, networkResponse('v1'));
    expect(await (await worker.dispatch('fetch', get()).response)?.text()).toBe('v1');
  });
});

describe('service worker: dev mode (?dev=1)', () => {
  it('does not intercept requests and does not cache anything', async () => {
    const worker = loadWorker({ dev: true });
    worker.routes.set(SCOPE, networkResponse(INDEX_HTML));

    expect(worker.handlers.has('fetch')).toBe(false);
    await worker.dispatch('install').finished();
    expect(worker.self.skipWaiting).toHaveBeenCalledOnce();
    expect(worker.fetched).toEqual([]);
    expect(worker.stores.size).toBe(0);
  });

  it('throws away caches of an earlier production worker on activate', async () => {
    const worker = loadWorker({ dev: true });
    worker.stores.set(CACHE, new Map());
    worker.stores.set('iets-van-een-andere-app', new Map());

    await worker.dispatch('activate').finished();
    expect([...worker.stores.keys()]).toEqual(['iets-van-een-andere-app']);
  });

  it('still handles notification clicks and reminders', async () => {
    const idb = new IDBFactory();
    await openPage(idb, T0).sync([makeReminder('bio', T0 + MINUTE)]);

    setNow(T0 + 2 * MINUTE);
    const worker = loadWorker({ dev: true, idb });
    await worker.dispatch('periodicsync', { tag: 'sb-reminders' }).finished();
    expect(worker.shown.map((n) => n.options.tag)).toEqual(['bio']);

    await worker.dispatch('notificationclick', { notification: { close: () => undefined, data: { link: '#/home' } } }).finished();
    expect(worker.opened).toEqual([`${SCOPE}#/home`]);
  });
});
