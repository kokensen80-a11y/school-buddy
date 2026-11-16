import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as api from './index';
import { resetBrowserStorage } from './testSupport';

beforeAll(resetBrowserStorage);
afterAll(() => api.store.dispose());

describe('the default store', () => {
  it('exports one store with its actions and hooks bound to it', () => {
    expect(api.actions).toBe(api.store.actions);
    const hooks = [
      api.useAppState,
      api.useAuthStatus,
      api.useAccount,
      api.useData,
      api.useExams,
      api.useSessions,
      api.useSubjects,
      api.usePrefs,
      api.useWarnings,
      api.useInbox,
    ];
    for (const hook of hooks) expect(hook).toBeTypeOf('function');
  });

  it('exports what a test or another backend needs to build a store of its own', () => {
    expect(api.createAppStore).toBeTypeOf('function');
    expect(api.createStoreHooks).toBeTypeOf('function');
    expect(api.createLocalAuthBackend).toBeTypeOf('function');
    expect(api.createLocalDataBackend).toBeTypeOf('function');
    expect(api.sanitizeUserData).toBeTypeOf('function');
    expect(new api.BackendError('storage-full')).toBeInstanceOf(Error);
    expect(api.MAX_ATTACHMENT_BYTES).toBe(15 * 1024 * 1024);
    expect(api.MIN_PASSWORD_LENGTH).toBe(8);
    expect(api.MAX_INBOX_ITEMS).toBe(100);
    expect(api.DEFAULT_PBKDF2_ITERATIONS).toBeGreaterThanOrEqual(300_000);
    expect(api.BACKUP_FORMAT).toBe('school-buddy-backup');
  });

  it('starts at loading and is signed out after init on an empty device', async () => {
    expect(api.store.getState()).toStrictEqual({ status: 'loading', account: null, data: null });
    await expect(api.actions.init()).resolves.toStrictEqual({ ok: true });
    expect(api.store.getState().status).toBe('signedOut');
  });
});
