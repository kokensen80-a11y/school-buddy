import { IDBObjectStore } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyUserData } from '../defaults';
import { createLocalAuthBackend } from './localAuth';
import { createLocalDataBackend } from './localData';
import {
  NOW,
  blockStorage,
  fillStorage,
  resetBrowserStorage,
  storedAttachmentIds,
} from './testSupport';
import { BackendError } from './types';

const auth = () => createLocalAuthBackend({ iterations: 10, clock: () => NOW });
const SAM = { name: 'Sam', email: 'sam@example.com', password: 'test-wachtwoord-1' };

beforeEach(resetBrowserStorage);
afterEach(() => {
  vi.restoreAllMocks();
});

describe('local auth backend', () => {
  it('registers, signs in and restores the session', async () => {
    const account = await auth().register(SAM);
    expect(account).toStrictEqual({
      id: account.id,
      name: 'Sam',
      email: 'sam@example.com',
      createdAt: NOW.toISOString(),
    });
    await expect(auth().restore()).resolves.toStrictEqual(account);
    await auth().logout();
    await expect(auth().restore()).resolves.toBeNull();
  });

  it('only uses keys that start with "sb."', async () => {
    await auth().register(SAM);
    await createLocalDataBackend().save('some-account', createEmptyUserData());
    const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index));
    expect(keys.sort()).toStrictEqual(['sb.accounts', 'sb.data.some-account', 'sb.session']);
  });

  it('stores a PBKDF2 hash with its iteration count and never the password', async () => {
    await auth().register(SAM);
    const raw = localStorage.getItem('sb.accounts') ?? '';
    expect(raw).not.toContain(SAM.password);
    const [stored] = JSON.parse(raw) as Array<{ password: Record<string, unknown> }>;
    expect(stored.password).toMatchObject({ algorithm: 'PBKDF2-SHA-256', iterations: 10 });
  });

  it('keeps accepting a password after the default iteration count changed', async () => {
    await auth().register(SAM);
    const stronger = createLocalAuthBackend({ iterations: 50 });
    await expect(stronger.login(SAM)).resolves.toMatchObject({ email: SAM.email });
  });

  it('rejects a second account with the same e-mail address, ignoring case and spaces', async () => {
    await auth().register(SAM);
    await expect(auth().register({ ...SAM, email: '  SAM@Example.COM ' })).rejects.toEqual(
      new BackendError('email-taken'),
    );
    expect(JSON.parse(localStorage.getItem('sb.accounts') ?? '[]')).toHaveLength(1);
  });

  it('rejects a wrong password and an unknown e-mail address in the same way', async () => {
    await auth().register(SAM);
    await auth().logout();
    await expect(auth().login({ ...SAM, password: 'verkeerd-wachtwoord' })).rejects.toEqual(
      new BackendError('invalid-credentials'),
    );
    await expect(auth().login({ ...SAM, email: 'wie@example.com' })).rejects.toEqual(
      new BackendError('invalid-credentials'),
    );
    await expect(auth().restore()).resolves.toBeNull();
  });

  it('forgets a session whose account is gone', async () => {
    await auth().register(SAM);
    localStorage.setItem('sb.accounts', '[]');
    await expect(auth().restore()).resolves.toBeNull();
    expect(localStorage.getItem('sb.session')).toBeNull();
  });

  it('ignores damaged account records and a damaged session', async () => {
    const account = await auth().register(SAM);
    const stored = JSON.parse(localStorage.getItem('sb.accounts') ?? '[]') as unknown[];
    localStorage.setItem(
      'sb.accounts',
      JSON.stringify([null, 'x', { id: 'half' }, { ...(stored[0] as object), password: 'plain' }, ...stored]),
    );
    await expect(auth().restore()).resolves.toStrictEqual(account);

    localStorage.setItem('sb.session', '{kapot');
    await expect(auth().restore()).resolves.toBeNull();
    localStorage.setItem('sb.session', '"tekst"');
    await expect(auth().restore()).resolves.toBeNull();
    localStorage.setItem('sb.accounts', '{"geen":"lijst"}');
    await expect(auth().login(SAM)).rejects.toEqual(new BackendError('invalid-credentials'));
  });

  it('reports actions on an account that no longer exists', async () => {
    await expect(auth().updateAccount('weg', { name: 'X' })).rejects.toEqual(
      new BackendError('account-not-found'),
    );
    await expect(auth().changePassword('weg', 'a', 'b')).rejects.toEqual(
      new BackendError('account-not-found'),
    );
    await expect(auth().deleteAccount('weg', 'a')).rejects.toEqual(
      new BackendError('account-not-found'),
    );
  });

  it('leaves no half account behind when the session cannot be stored', async () => {
    const original = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      if (key === 'sb.session') throw new DOMException('full', 'QuotaExceededError');
      original.call(this, key, value);
    });
    await expect(auth().register(SAM)).rejects.toEqual(new BackendError('storage-full'));
    expect(JSON.parse(localStorage.getItem('sb.accounts') ?? 'null')).toStrictEqual([]);
  });

  it('reports full and unreachable storage as such', async () => {
    const release = fillStorage();
    await expect(auth().register(SAM)).rejects.toEqual(new BackendError('storage-full'));
    release();

    const unblock = blockStorage();
    try {
      await expect(auth().restore()).resolves.toBeNull();
      await expect(auth().logout()).resolves.toBeUndefined();
      await expect(auth().register(SAM)).rejects.toEqual(new BackendError('storage-unavailable'));
    } finally {
      unblock();
    }
  });
});

describe('local data backend', () => {
  const backend = createLocalDataBackend();

  it('loads null when nothing was stored and what was saved otherwise', async () => {
    await expect(backend.load('a')).resolves.toBeNull();
    const data = { ...createEmptyUserData(), onboarded: true };
    await backend.save('a', data);
    await expect(backend.load('a')).resolves.toStrictEqual(data);
    await expect(backend.load('b')).resolves.toBeNull();
  });

  it('loads null instead of throwing when the stored text is not JSON', async () => {
    localStorage.setItem('sb.data.a', '{"version":1,');
    await expect(backend.load('a')).resolves.toBeNull();
  });

  it('stores attachment files in the IndexedDB database "school-buddy"', async () => {
    const file = new Blob(['%PDF-1.7 inhoud'], { type: 'application/pdf' });
    await backend.putAttachment('a', 'file-1', file);

    const databases = await indexedDB.databases();
    expect(databases.map((database) => database.name)).toStrictEqual(['school-buddy']);
    await expect(storedAttachmentIds()).resolves.toStrictEqual(['file-1']);

    const loaded = await backend.getAttachment('a', 'file-1');
    expect(loaded).toBeInstanceOf(Blob);
    expect(loaded?.type).toBe('application/pdf');
    expect(loaded?.size).toBe(file.size);
    await expect(loaded?.text()).resolves.toBe('%PDF-1.7 inhoud');
  });

  it('keeps binary content byte for byte', async () => {
    const bytes = Uint8Array.from({ length: 2048 }, (_, index) => (index * 31) % 256);
    await backend.putAttachment('a', 'bin', new Blob([bytes], { type: 'image/png' }));
    const loaded = await backend.getAttachment('a', 'bin');
    expect(new Uint8Array(await (loaded as Blob).arrayBuffer())).toStrictEqual(bytes);
  });

  it('never hands out or deletes a file of another account', async () => {
    await backend.putAttachment('a', 'file-1', new Blob(['van a']));
    await expect(backend.getAttachment('b', 'file-1')).resolves.toBeUndefined();
    await backend.deleteAttachment('b', 'file-1');
    await expect(backend.getAttachment('a', 'file-1')).resolves.toBeInstanceOf(Blob);
    await backend.deleteAttachment('a', 'file-1');
    await expect(backend.getAttachment('a', 'file-1')).resolves.toBeUndefined();
  });

  it('returns undefined for a file that does not exist', async () => {
    await expect(backend.getAttachment('a', 'niets')).resolves.toBeUndefined();
    await expect(backend.deleteAttachment('a', 'niets')).resolves.toBeUndefined();
  });

  it('removes the data and every file of one account, and nothing of another', async () => {
    await backend.save('a', createEmptyUserData());
    await backend.save('b', createEmptyUserData());
    await backend.putAttachment('a', 'a-1', new Blob(['1']));
    await backend.putAttachment('a', 'a-2', new Blob(['2']));
    await backend.putAttachment('b', 'b-1', new Blob(['3']));

    await backend.remove('a');

    expect(localStorage.getItem('sb.data.a')).toBeNull();
    expect(localStorage.getItem('sb.data.b')).not.toBeNull();
    await expect(storedAttachmentIds()).resolves.toStrictEqual(['b-1']);
  });

  it('reports a full disk when a file cannot be stored', async () => {
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    await expect(backend.putAttachment('a', 'file-1', new Blob(['x']))).rejects.toEqual(
      new BackendError('storage-full'),
    );
  });

  it('reports unavailable storage when IndexedDB cannot be opened', async () => {
    vi.stubGlobal('indexedDB', undefined);
    try {
      await expect(backend.putAttachment('a', 'file-1', new Blob(['x']))).rejects.toEqual(
        new BackendError('storage-unavailable'),
      );
      await expect(backend.getAttachment('a', 'file-1')).rejects.toEqual(
        new BackendError('storage-unavailable'),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('reports full and unreachable localStorage when saving data', async () => {
    const release = fillStorage();
    await expect(backend.save('a', createEmptyUserData())).rejects.toEqual(
      new BackendError('storage-full'),
    );
    release();

    const unblock = blockStorage();
    try {
      await expect(backend.load('a')).resolves.toBeNull();
      await expect(backend.save('a', createEmptyUserData())).rejects.toEqual(
        new BackendError('storage-unavailable'),
      );
    } finally {
      unblock();
    }
  });
});
