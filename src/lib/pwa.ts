/**
 * PWA helpers: service-worker registration and "install the app" support.
 *
 * The service worker (public/sw.js) makes the app work offline and handles clicks on
 * notifications. It cannot deliver reminders at a chosen time by itself; see
 * notifications/engine.ts for what is and is not possible.
 */
import { useSyncExternalStore } from 'react';

// ───────────────────────── Service worker ─────────────────────────

/** Must match REMINDER_SYNC_TAG in public/sw.js. */
const REMINDER_SYNC_TAG = 'sb-reminders';
/** How often we would like the browser to wake the worker. The browser decides; expect far less. */
const REMINDER_SYNC_INTERVAL_MS = 60 * 60 * 1000;

/** Periodic Background Sync is Chromium-only and not part of the standard DOM typings. */
interface PeriodicSyncRegistration extends ServiceWorkerRegistration {
  periodicSync?: {
    register(tag: string, options: { minInterval: number }): Promise<void>;
  };
}

/** The service worker asks an open app to navigate after a click on a notification. */
function handleWorkerMessage(event: MessageEvent): void {
  const message: unknown = event.data;
  if (typeof message !== 'object' || message === null) return;
  const { type, link } = message as { type?: unknown; link?: unknown };
  if (type === 'sb-navigate' && typeof link === 'string' && link.startsWith('#')) {
    window.location.hash = link;
  }
}

/**
 * Asks the browser to wake the worker now and then, so it can show reminders that are due.
 * Only Chromium offers this, only for an installed app, and it picks the moments itself.
 */
async function requestPeriodicSync(registration: PeriodicSyncRegistration): Promise<void> {
  if (!registration.periodicSync || !navigator.permissions) return;
  try {
    const status = await navigator.permissions.query({
      name: 'periodic-background-sync' as PermissionName,
    });
    if (status.state !== 'granted') return;
    await registration.periodicSync.register(REMINDER_SYNC_TAG, {
      minInterval: REMINDER_SYNC_INTERVAL_MS,
    });
  } catch {
    // Not supported or not allowed: reminders then only arrive while the app is open.
  }
}

async function register(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  try {
    navigator.serviceWorker.addEventListener('message', handleWorkerMessage);
    // Relative to the page, so the app can live in any folder. The dev flag switches caching off.
    const registration = await navigator.serviceWorker.register(
      import.meta.env.DEV ? 'sw.js?dev=1' : 'sw.js',
    );
    void navigator.serviceWorker.ready.then(requestPeriodicSync);
    return registration;
  } catch {
    // Insecure origin, private mode, blocked by the browser: the app works without it.
    return null;
  }
}

let registered: Promise<ServiceWorkerRegistration | null> | null = null;

/**
 * Registers the service worker. Call once when the app starts; later calls return the same
 * result. Resolves to null where service workers are unavailable. Never rejects.
 */
export function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  registered ??= register();
  return registered;
}

// ───────────────────────── Environment ─────────────────────────

const STANDALONE_QUERY = '(display-mode: standalone)';

function standaloneQuery(): MediaQueryList | null {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(STANDALONE_QUERY)
    : null;
}

/** True when the app runs as an installed app (home screen / own window) instead of a browser tab. */
export function isStandalone(): boolean {
  if (typeof navigator === 'undefined') return false;
  // iOS Safari has its own flag for a web app opened from the home screen.
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return iosStandalone || standaloneQuery()?.matches === true;
}

/** True on iPhone, iPod and iPad (iPadOS presents itself as a Mac with a touch screen). */
export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
  );
}

// ───────────────────────── Install prompt ─────────────────────────

/** Chromium's install event; not part of the standard DOM typings. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<unknown>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export interface InstallPrompt {
  /** The browser offers its own install dialog; show an install button. */
  canInstall: boolean;
  /** Opens the browser's install dialog. Resolves to true when the user installed the app. */
  promptInstall: () => Promise<boolean>;
  /** The app already runs as an installed app. */
  isStandalone: boolean;
  /** iOS has no install dialog: explain "Deel → Zet op beginscherm" instead. */
  needsIOSInstructions: boolean;
}

let installEvent: BeforeInstallPromptEvent | null = null;
const installListeners = new Set<() => void>();

function setInstallEvent(event: BeforeInstallPromptEvent | null): void {
  installEvent = event;
  installListeners.forEach((listener) => listener());
}

// The browser fires this once, often before React has mounted, so it is captured right away.
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    // Keeps the browser's own banner away; the app shows its own button.
    event.preventDefault();
    setInstallEvent(event as BeforeInstallPromptEvent);
  });
  window.addEventListener('appinstalled', () => setInstallEvent(null));
}

async function promptInstall(): Promise<boolean> {
  const event = installEvent;
  if (!event) return false;
  // The browser accepts one prompt() per event.
  setInstallEvent(null);
  try {
    await event.prompt();
    return (await event.userChoice).outcome === 'accepted';
  } catch {
    return false;
  }
}

function subscribeInstall(onChange: () => void): () => void {
  installListeners.add(onChange);
  return () => installListeners.delete(onChange);
}

function subscribeStandalone(onChange: () => void): () => void {
  const query = standaloneQuery();
  // Safari before 14 has no addEventListener on a media query; standalone never changes there anyway.
  if (!query || typeof query.addEventListener !== 'function') return () => undefined;
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

const hasInstallEvent = () => installEvent !== null;
const never = () => false;

/** Everything a screen needs to offer "install this app", kept up to date. */
export function useInstallPrompt(): InstallPrompt {
  const canPrompt = useSyncExternalStore(subscribeInstall, hasInstallEvent, never);
  const standalone = useSyncExternalStore(subscribeStandalone, isStandalone, never);
  return {
    canInstall: canPrompt && !standalone,
    promptInstall,
    isStandalone: standalone,
    needsIOSInstructions: isIOS() && !standalone,
  };
}
