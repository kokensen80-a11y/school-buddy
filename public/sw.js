/*
 * School Buddy service worker. Plain JavaScript: no build step, no imports.
 *
 * What it does:
 *   1. Offline. The app shell (index.html) is fetched network-first with the cached copy as
 *      fallback; other same-origin GET requests inside the app's folder are answered from the
 *      cache and refreshed in the background. Nothing else is touched or cached. When the
 *      worker is registered as sw.js?dev=1 (Vite dev server) it does not cache at all.
 *   2. Notification clicks. Focuses the open app (and tells it where to go) or opens it.
 *   3. Reminders. A service worker cannot wake itself up at a chosen time. Whenever the
 *      browser does run it (Periodic Background Sync where that exists, activation, or an
 *      'sb-check' message from a page) it shows the reminders from the stored queue that
 *      became due in the last 90 minutes and were not delivered yet.
 *
 * Everything is relative to self.registration.scope, so the app works from any folder.
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
'use strict';

/** Raise this to throw away everything that was cached by earlier releases. */
const VERSION = 'v1';

const SCOPE = self.registration.scope;
const DEV = new URL(self.location.href).searchParams.has('dev');
const CACHE_PREFIX = 'school-buddy:' + new URL(SCOPE).pathname + ':';
const CACHE = CACHE_PREFIX + VERSION;
/** With a cached app shell at hand, a slow network gets this long before the copy is used. */
const NAVIGATION_TIMEOUT_MS = 3000;

const DB_NAME = 'school-buddy-notifications';
const DB_VERSION = 1;
const QUEUE_STORE = 'queue';
const FIRED_STORE = 'fired';
/** Same grace period as the page (DEFAULT_GRACE_MINUTES in reminders.ts). */
const GRACE_MS = 90 * 60 * 1000;
const REMINDER_SYNC_TAG = 'sb-reminders';
/** Same images as the page uses (NOTIFICATION_ICON and NOTIFICATION_BADGE in engine.ts). */
const NOTIFICATION_ICON = SCOPE + 'icons/icon-192.png';
const NOTIFICATION_BADGE = SCOPE + 'icons/badge-96.png';

const ignore = () => undefined;
/** Runs a step and swallows its failure, so one broken step never breaks the event around it. */
const quietly = (step) => Promise.resolve().then(step).catch(ignore);
const after = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ───────────────────────── Life cycle ─────────────────────────

self.addEventListener('install', (event) => {
  self.skipWaiting();
  if (!DEV) event.waitUntil(quietly(precache));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    quietly(dropOldCaches)
      .then(() => quietly(() => self.clients.claim()))
      .then(() => quietly(showDueReminders)),
  );
});

/** Caches the app shell and the files it refers to, so the app also starts offline after one visit. */
async function precache() {
  const cache = await self.caches.open(CACHE);
  const response = await self.fetch(SCOPE, { cache: 'reload' });
  if (!response.ok) return;

  const html = await response.clone().text();
  await cache.put(SCOPE, await withoutRedirect(response));

  // The notification images are not mentioned in index.html, but are needed offline as well.
  const assets = new Set([NOTIFICATION_ICON, NOTIFICATION_BADGE]);
  for (const match of html.matchAll(/\s(?:src|href)="([^"]+)"/g)) {
    const url = inScope(match[1]);
    if (url && url !== SCOPE) assets.add(url);
  }
  await Promise.all([...assets].map((url) => cache.add(url).catch(ignore)));
}

/** The absolute URL of a reference in index.html, or null when it points outside the app. */
function inScope(reference) {
  try {
    const url = new URL(reference, SCOPE);
    url.hash = '';
    return url.href.startsWith(SCOPE) ? url.href : null;
  } catch {
    return null;
  }
}

async function dropOldCaches() {
  const names = await self.caches.keys();
  const old = names.filter((name) => name.startsWith(CACHE_PREFIX) && (DEV || name !== CACHE));
  await Promise.all(old.map((name) => self.caches.delete(name)));
}

// ───────────────────────── Offline ─────────────────────────

if (!DEV) {
  self.addEventListener('fetch', (event) => {
    const request = event.request;
    // Only GET requests inside the app's own folder are ours (that also excludes other origins).
    if (request.method !== 'GET' || !request.url.startsWith(SCOPE)) return;
    if (request.headers.has('range')) return;
    // fetch() throws on such a request (browser developer tools send them); the browser answers it.
    if (request.cache === 'only-if-cached' && request.mode !== 'same-origin') return;

    let answer;
    if (request.mode !== 'navigate') answer = staleWhileRevalidate(event);
    else if (isAppShell(request.url)) answer = appShell(event);
    else return;
    // Whatever goes wrong with the cache, the request still gets its plain network answer.
    event.respondWith(answer.catch(() => self.fetch(request)));
  });
}

function isAppShell(url) {
  const { origin, pathname } = new URL(url);
  const page = origin + pathname;
  return page === SCOPE || page === SCOPE + 'index.html';
}

/** A response that came through a redirect may not answer a navigation; rebuild it without that flag. */
async function withoutRedirect(response) {
  if (!response.redirected) return response;
  return new Response(await response.arrayBuffer(), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

/** Network first; the cached shell when the network fails, answers with an error or is too slow. */
async function appShell(event) {
  const cache = await self.caches.open(CACHE);
  const cached = await cache.match(SCOPE);
  const fresh = self.fetch(event.request).then((response) => {
    if (response.ok) {
      const copy = response.clone();
      event.waitUntil(quietly(async () => cache.put(SCOPE, await withoutRedirect(copy))));
    }
    return response;
  });
  if (!cached) return fresh;

  event.waitUntil(fresh.catch(ignore));
  const response = await Promise.race([fresh.catch(ignore), after(NAVIGATION_TIMEOUT_MS)]);
  // A redirect is handed back so the browser can follow it.
  return response && (response.ok || response.type === 'opaqueredirect') ? response : cached;
}

/** The cached copy at once (when there is one), refreshed from the network in the background. */
async function staleWhileRevalidate(event) {
  const cache = await self.caches.open(CACHE);
  const cached = await cache.match(event.request);
  const fresh = self.fetch(event.request).then((response) => {
    if (response.status === 200 && response.type === 'basic') {
      const copy = response.clone();
      event.waitUntil(quietly(() => cache.put(event.request, copy)));
    }
    return response;
  });
  if (!cached) return fresh;

  event.waitUntil(fresh.catch(ignore));
  return cached;
}

// ───────────────────────── Notification clicks ─────────────────────────

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data;
  const link = data && typeof data.link === 'string' && data.link.startsWith('#') ? data.link : '';
  event.waitUntil(quietly(() => openApp(link)));
});

async function openApp(link) {
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const ours = windows.filter((client) => client.url.startsWith(SCOPE));
  const client = ours.find((candidate) => candidate.focused) || ours[0];
  if (!client) {
    await self.clients.openWindow(SCOPE + link);
    return;
  }
  client.postMessage({ type: 'sb-navigate', link });
  await client.focus();
}

// ───────────────────────── Reminders ─────────────────────────

self.addEventListener('periodicsync', (event) => {
  if (event.tag === REMINDER_SYNC_TAG) event.waitUntil(quietly(showDueReminders));
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'sb-check') event.waitUntil(quietly(showDueReminders));
});

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = self.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore(QUEUE_STORE, { keyPath: 'accountId' });
      const fired = db.createObjectStore(FIRED_STORE, { keyPath: ['accountId', 'reminderId'] });
      fired.createIndex('firedAt', 'firedAt');
      fired.createIndex('pendingFor', 'pendingFor');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('IndexedDB open blocked'));
  });
}

function readQueues(db) {
  return new Promise((resolve, reject) => {
    const request = db.transaction(QUEUE_STORE, 'readonly').objectStore(QUEUE_STORE).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Records the reminder as fired. Resolves to true only when nobody else had done so yet. */
function claim(db, accountId, reminder, now) {
  return new Promise((resolve) => {
    let added = false;
    const transaction = db.transaction(FIRED_STORE, 'readwrite');
    const request = transaction.objectStore(FIRED_STORE).add({
      accountId,
      reminderId: reminder.id,
      firedAt: now,
      pendingFor: accountId,
      reminder,
    });
    request.onsuccess = () => {
      added = true;
    };
    request.onerror = (event) => event.preventDefault();
    transaction.oncomplete = () => resolve(added);
    transaction.onabort = () => resolve(false);
  });
}

async function showDueReminders() {
  if (!self.Notification || self.Notification.permission !== 'granted') return;

  const db = await openDatabase();
  try {
    const now = Date.now();
    for (const queue of await readQueues(db)) {
      for (const reminder of queue.reminders || []) {
        const at = Date.parse(reminder.at);
        if (!(at <= now && at >= now - GRACE_MS)) continue;
        await quietly(async () => {
          if (!(await claim(db, queue.accountId, reminder, now))) return;
          await self.registration.showNotification(reminder.title, {
            body: reminder.body,
            tag: reminder.id,
            icon: NOTIFICATION_ICON,
            badge: NOTIFICATION_BADGE,
            lang: 'nl',
            data: { link: reminder.link || '' },
          });
        });
      }
    }
  } finally {
    db.close();
  }
}
