import { afterEach, describe, expect, it, vi } from 'vitest';
import { newId } from './ids';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('newId', () => {
  it('returns a different UUID every time', () => {
    const ids = Array.from({ length: 200 }, newId);
    expect(new Set(ids).size).toBe(200);
    for (const id of ids) expect(id).toMatch(UUID_V4);
  });

  it('builds a UUID from random bytes where crypto.randomUUID is missing (plain http)', () => {
    vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) });
    const ids = Array.from({ length: 200 }, newId);
    expect(new Set(ids).size).toBe(200);
    for (const id of ids) expect(id).toMatch(UUID_V4);
  });

  it('still works without any crypto object', () => {
    vi.stubGlobal('crypto', undefined);
    const ids = Array.from({ length: 50 }, newId);
    expect(new Set(ids).size).toBe(50);
    for (const id of ids) expect(id).toMatch(UUID_V4);
  });
});
