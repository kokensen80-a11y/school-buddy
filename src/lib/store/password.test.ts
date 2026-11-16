import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_PBKDF2_ITERATIONS,
  hashPassword,
  isPasswordHash,
  verifyPassword,
} from './password';
import { BackendError } from './types';

const FAST = 10;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('password hashing', () => {
  it('uses at least 300 000 PBKDF2 iterations by default', () => {
    expect(DEFAULT_PBKDF2_ITERATIONS).toBeGreaterThanOrEqual(300_000);
  });

  it('stores a salted hash with its iteration count, never the password', async () => {
    const stored = await hashPassword('correct horse', FAST);
    expect(stored.algorithm).toBe('PBKDF2-SHA-256');
    expect(stored.iterations).toBe(FAST);
    expect(atob(stored.salt)).toHaveLength(16);
    expect(atob(stored.hash)).toHaveLength(32);
    expect(JSON.stringify(stored)).not.toContain('correct horse');
    expect(isPasswordHash(stored)).toBe(true);
  });

  it('hashes with the default iteration count when none is given', async () => {
    const stored = await hashPassword('correct horse');
    expect(stored.iterations).toBe(DEFAULT_PBKDF2_ITERATIONS);
    await expect(verifyPassword('correct horse', stored)).resolves.toBe(true);
  });

  it('gives every hash its own random salt', async () => {
    const first = await hashPassword('same password', FAST);
    const second = await hashPassword('same password', FAST);
    expect(first.salt).not.toBe(second.salt);
    expect(first.hash).not.toBe(second.hash);
  });

  it('accepts the right password and rejects a wrong one', async () => {
    const stored = await hashPassword('correct horse', FAST);
    await expect(verifyPassword('correct horse', stored)).resolves.toBe(true);
    await expect(verifyPassword('correct horsf', stored)).resolves.toBe(false);
    await expect(verifyPassword('', stored)).resolves.toBe(false);
  });

  it('verifies with the iteration count that was stored with the hash', async () => {
    const stored = await hashPassword('correct horse', 25);
    await expect(verifyPassword('correct horse', stored)).resolves.toBe(true);
    await expect(verifyPassword('correct horse', { ...stored, iterations: 26 })).resolves.toBe(
      false,
    );
  });

  it('treats differently composed but identical characters as the same password', async () => {
    const stored = await hashPassword('café-wachtwoord', FAST);
    await expect(verifyPassword('café-wachtwoord', stored)).resolves.toBe(true);
  });

  it('rejects instead of crashing when the stored hash is damaged', async () => {
    const stored = await hashPassword('correct horse', FAST);
    await expect(verifyPassword('correct horse', { ...stored, hash: '%%%' })).resolves.toBe(false);
    await expect(
      verifyPassword('correct horse', { ...stored, hash: stored.hash.slice(0, 8) }),
    ).resolves.toBe(false);
  });

  it('recognises what is and is not a stored hash', () => {
    expect(isPasswordHash(null)).toBe(false);
    expect(isPasswordHash('hash')).toBe(false);
    expect(isPasswordHash({ algorithm: 'PBKDF2-SHA-256', iterations: 0, salt: 'a', hash: 'b' })).toBe(
      false,
    );
    expect(isPasswordHash({ algorithm: 'MD5', iterations: 10, salt: 'a', hash: 'b' })).toBe(false);
  });

  it('fails with a clear error where WebCrypto is not available (plain http)', async () => {
    vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) });
    await expect(hashPassword('correct horse', FAST)).rejects.toEqual(
      new BackendError('crypto-unavailable'),
    );
  });
});
