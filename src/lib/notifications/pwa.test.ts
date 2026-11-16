/** Tests for ../pwa.ts (service-worker registration and install support). */
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { isIOS, isStandalone, useInstallPrompt } from '../pwa';

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const IPAD_AS_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const ANDROID =
  'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';

// ───────────────────────── Browser stand-ins ─────────────────────────

/** Properties put on navigator or window for one test; removed again afterwards. */
const defined: [object, string][] = [];

function define(target: object, name: string, value: unknown): void {
  Object.defineProperty(target, name, { value, configurable: true, writable: true });
  defined.push([target, name]);
}

function setUserAgent(userAgent: string, maxTouchPoints = 0): void {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(userAgent);
  define(navigator, 'maxTouchPoints', maxTouchPoints);
}

/** A controllable `(display-mode: standalone)` media query. */
function stubDisplayMode(standalone: boolean) {
  const listeners = new Set<() => void>();
  const query = {
    matches: standalone,
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
  };
  const matchMedia = vi.fn((_: string) => query);
  define(window, 'matchMedia', matchMedia);
  return {
    matchMedia,
    listeners,
    set(value: boolean) {
      query.matches = value;
      listeners.forEach((listener) => listener());
    },
  };
}

interface FakeServiceWorkerOptions {
  periodicSync?: boolean;
  permission?: 'granted' | 'denied' | 'prompt' | 'error';
  registerFails?: boolean;
}

function stubServiceWorker({ periodicSync = false, permission, registerFails = false }: FakeServiceWorkerOptions = {}) {
  const messageListeners: ((event: MessageEvent) => void)[] = [];
  const periodicRegister = vi.fn(async (_tag: string, _options: { minInterval: number }) => undefined);
  const registration = periodicSync ? { periodicSync: { register: periodicRegister } } : {};
  const register = vi.fn(async (_url: string) => {
    if (registerFails) throw new DOMException('Only secure origins are allowed', 'SecurityError');
    return registration;
  });
  define(navigator, 'serviceWorker', {
    register,
    ready: Promise.resolve(registration),
    addEventListener: (type: string, listener: (event: MessageEvent) => void) => {
      if (type === 'message') messageListeners.push(listener);
    },
  });

  const query = vi.fn(async (_descriptor: { name: string }) => {
    if (permission === 'error') throw new TypeError('Unknown permission name');
    return { state: permission };
  });
  if (permission) define(navigator, 'permissions', { query });

  return {
    register,
    registration,
    periodicRegister,
    query,
    send: (data: unknown) => messageListeners.forEach((listener) => listener({ data } as MessageEvent)),
  };
}

/** A fresh copy of the module, because it registers the worker only once. */
async function loadPwa() {
  vi.resetModules();
  return import('../pwa');
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function renderHook<T>(useHook: () => T) {
  const result: { current?: T } = {};
  function Probe() {
    result.current = useHook();
    return null;
  }
  const root = createRoot(document.createElement('div'));
  act(() => root.render(createElement(Probe)));
  return {
    get current(): T {
      return result.current as T;
    },
    unmount: () => act(() => root.unmount()),
  };
}

function installEvent(outcome: 'accepted' | 'dismissed' = 'accepted') {
  const prompt = vi.fn(async () => undefined);
  const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
    prompt,
    userChoice: Promise.resolve({ outcome }),
  });
  return { event, prompt };
}

beforeAll(() => {
  // Tells React that state updates in this file are wrapped in act().
  define(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
  defined.length = 0;
});

afterEach(() => {
  // Clears the install event that a test may have left in the module.
  act(() => {
    window.dispatchEvent(new Event('appinstalled'));
  });
  for (const [target, name] of defined.splice(0)) Reflect.deleteProperty(target, name);
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  window.location.hash = '';
});

// ───────────────────────── Environment ─────────────────────────

describe('isIOS', () => {
  it('recognises iPhones and iPads, including an iPad that presents itself as a Mac', () => {
    setUserAgent(IPHONE, 5);
    expect(isIOS()).toBe(true);
    setUserAgent(IPAD_AS_MAC, 5);
    expect(isIOS()).toBe(true);
  });

  it('does not mistake a real Mac or an Android phone for iOS', () => {
    setUserAgent(IPAD_AS_MAC, 0);
    expect(isIOS()).toBe(false);
    setUserAgent(ANDROID, 5);
    expect(isIOS()).toBe(false);
  });
});

describe('isStandalone', () => {
  it('is false in a browser tab, also where matchMedia does not exist', () => {
    expect(isStandalone()).toBe(false);
    stubDisplayMode(false);
    expect(isStandalone()).toBe(false);
  });

  it('is true when the app runs in its own window', () => {
    const { matchMedia } = stubDisplayMode(true);
    expect(isStandalone()).toBe(true);
    expect(matchMedia).toHaveBeenCalledWith('(display-mode: standalone)');
  });

  it('is true for an iOS web app opened from the home screen', () => {
    define(navigator, 'standalone', true);
    expect(isStandalone()).toBe(true);
  });
});

// ───────────────────────── Service worker ─────────────────────────

describe('registerServiceWorker', () => {
  it('resolves to null where service workers do not exist', async () => {
    const { registerServiceWorker } = await loadPwa();
    await expect(registerServiceWorker()).resolves.toBeNull();
  });

  it('registers the worker relative to the page, with the dev flag on the dev server', async () => {
    const worker = stubServiceWorker();
    const { registerServiceWorker } = await loadPwa();

    await expect(registerServiceWorker()).resolves.toBe(worker.registration);
    expect(worker.register).toHaveBeenCalledExactlyOnceWith('sw.js?dev=1');
  });

  it('registers the caching worker in a production build', async () => {
    vi.stubEnv('DEV', false);
    const worker = stubServiceWorker();
    const { registerServiceWorker } = await loadPwa();

    await registerServiceWorker();
    expect(worker.register).toHaveBeenCalledExactlyOnceWith('sw.js');
  });

  it('registers only once, however often it is called', async () => {
    const worker = stubServiceWorker();
    const { registerServiceWorker } = await loadPwa();

    const first = registerServiceWorker();
    expect(registerServiceWorker()).toBe(first);
    await first;
    await registerServiceWorker();
    expect(worker.register).toHaveBeenCalledOnce();
  });

  it('resolves to null when registering fails', async () => {
    stubServiceWorker({ registerFails: true });
    const { registerServiceWorker } = await loadPwa();
    await expect(registerServiceWorker()).resolves.toBeNull();
  });

  it('navigates when the worker reports a click on a notification', async () => {
    const worker = stubServiceWorker();
    const { registerServiceWorker } = await loadPwa();
    await registerServiceWorker();

    worker.send({ type: 'sb-navigate', link: '#/agenda/2026-11-16' });
    expect(window.location.hash).toBe('#/agenda/2026-11-16');
  });

  it('ignores other messages and links that are not in-app links', async () => {
    const worker = stubServiceWorker();
    const { registerServiceWorker } = await loadPwa();
    await registerServiceWorker();
    window.location.hash = '#/home';

    for (const data of [
      null,
      'sb-navigate',
      { type: 'iets-anders', link: '#/toetsen' },
      { type: 'sb-navigate' },
      { type: 'sb-navigate', link: 42 },
      { type: 'sb-navigate', link: '' },
      { type: 'sb-navigate', link: 'https://kwaad.example/' },
    ]) {
      worker.send(data);
    }
    expect(window.location.hash).toBe('#/home');
  });

  it('asks for periodic background sync when the browser offers and allows it', async () => {
    const worker = stubServiceWorker({ periodicSync: true, permission: 'granted' });
    const { registerServiceWorker } = await loadPwa();
    await registerServiceWorker();

    await vi.waitFor(() => expect(worker.periodicRegister).toHaveBeenCalledOnce());
    expect(worker.query).toHaveBeenCalledWith({ name: 'periodic-background-sync' });
    expect(worker.periodicRegister).toHaveBeenCalledWith('sb-reminders', { minInterval: 3_600_000 });
  });

  it.each(['denied', 'prompt', 'error'] as const)(
    'does not ask for periodic background sync when the permission is %s',
    async (permission) => {
      const worker = stubServiceWorker({ periodicSync: true, permission });
      const { registerServiceWorker } = await loadPwa();
      await expect(registerServiceWorker()).resolves.toBe(worker.registration);

      await vi.waitFor(() => expect(worker.query).toHaveBeenCalledOnce());
      await settle();
      expect(worker.periodicRegister).not.toHaveBeenCalled();
    },
  );

  it('skips periodic background sync where the browser does not have it', async () => {
    const withoutSync = stubServiceWorker({ permission: 'granted' });
    const { registerServiceWorker } = await loadPwa();
    await registerServiceWorker();
    await settle();
    expect(withoutSync.query).not.toHaveBeenCalled();
  });

  it('survives a browser that refuses the periodic sync after all', async () => {
    const worker = stubServiceWorker({ periodicSync: true, permission: 'granted' });
    worker.periodicRegister.mockRejectedValue(new DOMException('Not allowed', 'NotAllowedError'));
    const { registerServiceWorker } = await loadPwa();

    await expect(registerServiceWorker()).resolves.toBe(worker.registration);
    await vi.waitFor(() => expect(worker.periodicRegister).toHaveBeenCalledOnce());
    await settle();
  });
});

// ───────────────────────── Install prompt ─────────────────────────

describe('useInstallPrompt', () => {
  it('offers nothing in a plain browser tab', () => {
    setUserAgent(ANDROID);
    const hook = renderHook(useInstallPrompt);

    expect(hook.current).toMatchObject({
      canInstall: false,
      isStandalone: false,
      needsIOSInstructions: false,
    });
    hook.unmount();
  });

  it('captures the install event, keeps the browser banner away and installs on request', async () => {
    const hook = renderHook(useInstallPrompt);
    const { event, prompt } = installEvent('accepted');

    act(() => {
      window.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
    expect(hook.current.canInstall).toBe(true);

    let installed: boolean | undefined;
    await act(async () => {
      installed = await hook.current.promptInstall();
    });
    expect(prompt).toHaveBeenCalledOnce();
    expect(installed).toBe(true);
    // The browser accepts one prompt per event.
    expect(hook.current.canInstall).toBe(false);
    await expect(hook.current.promptInstall()).resolves.toBe(false);
    expect(prompt).toHaveBeenCalledOnce();
    hook.unmount();
  });

  it('knows about an install event that fired before the screen was shown', () => {
    act(() => {
      window.dispatchEvent(installEvent().event);
    });
    const hook = renderHook(useInstallPrompt);
    expect(hook.current.canInstall).toBe(true);
    hook.unmount();
  });

  it('reports false when the user dismisses the dialog or the browser refuses it', async () => {
    const hook = renderHook(useInstallPrompt);

    act(() => {
      window.dispatchEvent(installEvent('dismissed').event);
    });
    await expect(hook.current.promptInstall()).resolves.toBe(false);

    const refused = installEvent();
    refused.prompt.mockRejectedValue(new DOMException('Needs a user gesture', 'NotAllowedError'));
    act(() => {
      window.dispatchEvent(refused.event);
    });
    await expect(hook.current.promptInstall()).resolves.toBe(false);
    hook.unmount();
  });

  it('withdraws the offer once the app is installed', () => {
    const hook = renderHook(useInstallPrompt);
    act(() => {
      window.dispatchEvent(installEvent().event);
    });
    expect(hook.current.canInstall).toBe(true);

    act(() => {
      window.dispatchEvent(new Event('appinstalled'));
    });
    expect(hook.current.canInstall).toBe(false);
    hook.unmount();
  });

  it('follows the display mode and offers nothing inside the installed app', () => {
    setUserAgent(IPHONE, 5);
    const display = stubDisplayMode(false);
    const hook = renderHook(useInstallPrompt);
    act(() => {
      window.dispatchEvent(installEvent().event);
    });
    expect(hook.current).toMatchObject({ canInstall: true, isStandalone: false, needsIOSInstructions: true });

    act(() => display.set(true));
    expect(hook.current).toMatchObject({ canInstall: false, isStandalone: true, needsIOSInstructions: false });

    hook.unmount();
    expect(display.listeners.size).toBe(0);
  });

  it('asks for manual instructions on iOS, which has no install dialog', () => {
    setUserAgent(IPHONE, 5);
    const hook = renderHook(useInstallPrompt);
    expect(hook.current).toMatchObject({ canInstall: false, needsIOSInstructions: true });
    hook.unmount();
  });
});
