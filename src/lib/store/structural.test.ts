import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { reuseEqual, shallowEqual } from './structural';

describe('reuseEqual', () => {
  it('returns the previous value itself when nothing changed', () => {
    const prev = { list: [{ id: 'a', tags: ['x'] }, { id: 'b', tags: [] }], n: 1 };
    const next = structuredClone(prev);
    expect(reuseEqual(prev, next)).toBe(prev);
  });

  it('keeps the unchanged parts and replaces only what differs', () => {
    const prev = { list: [{ id: 'a', done: false }, { id: 'b', done: false }], prefs: { x: 1 } };
    const next = { list: [{ id: 'a', done: false }, { id: 'b', done: true }], prefs: { x: 1 } };
    const merged = reuseEqual(prev, next);
    expect(merged).toEqual(next);
    expect(merged).not.toBe(prev);
    expect(merged.list[0]).toBe(prev.list[0]);
    expect(merged.list[1]).not.toBe(prev.list[1]);
    expect(merged.prefs).toBe(prev.prefs);
  });

  it('notices added, removed and reordered entries', () => {
    expect(reuseEqual([1, 2], [1, 2, 3])).toEqual([1, 2, 3]);
    expect(reuseEqual([1, 2, 3], [1, 2])).toEqual([1, 2]);
    expect(reuseEqual({ a: 1, b: 2 }, { a: 1 })).toEqual({ a: 1 });
    expect(reuseEqual({ a: 1 } as Record<string, number>, { a: 1, b: 2 })).toEqual({ a: 1, b: 2 });
    const a = { id: 'a' };
    const b = { id: 'b' };
    const swapped = reuseEqual([a, b], [{ id: 'b' }, { id: 'a' }]);
    expect(swapped).toEqual([b, a]);
  });

  it('does not confuse arrays, objects, null and primitives', () => {
    expect(reuseEqual<unknown>([], {})).toEqual({});
    expect(reuseEqual<unknown>({}, [])).toEqual([]);
    expect(reuseEqual<unknown>(null, { a: 1 })).toEqual({ a: 1 });
    expect(reuseEqual<unknown>({ a: 1 }, null)).toBeNull();
    expect(reuseEqual<unknown>({ a: undefined }, {})).toEqual({});
  });

  it('treats a key named "__proto__" as the plain data it is', () => {
    const next = JSON.parse('{"__proto__":{"admin":true},"b":2}') as Record<string, unknown>;

    const merged = reuseEqual<Record<string, unknown>>({ b: 2 }, next);

    expect(Object.keys(merged)).toStrictEqual(['__proto__', 'b']);
    expect(Object.getPrototypeOf(merged)).toBe(Object.prototype);
    expect(merged.admin).toBeUndefined();
    expect(reuseEqual(next, JSON.parse(JSON.stringify(next)) as typeof next)).toBe(next);
    expect(reuseEqual<unknown>({}, JSON.parse('{"__proto__":0}'))).not.toStrictEqual({});
  });

  it('always equals the next value, and is the previous value when both are equal', () => {
    fc.assert(
      fc.property(fc.jsonValue(), fc.jsonValue(), (prev, next) => {
        expect(reuseEqual(prev, next)).toEqual(next);
        expect(reuseEqual(prev, structuredClone(prev))).toBe(prev);
      }),
    );
  });
});

describe('shallowEqual', () => {
  it('compares flat objects and arrays by their entries', () => {
    const shared = { id: 1 };
    expect(shallowEqual({ a: 1, b: shared }, { a: 1, b: shared })).toBe(true);
    expect(shallowEqual([1, shared], [1, shared])).toBe(true);
    expect(shallowEqual({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(shallowEqual({ a: { id: 1 } }, { a: { id: 1 } })).toBe(false);
    expect(shallowEqual([1, 2], [1, 2, 3])).toBe(false);
    expect(shallowEqual([], {})).toBe(false);
    expect(shallowEqual(null, {})).toBe(false);
    expect(shallowEqual('a', 'a')).toBe(true);
    expect(shallowEqual(Number.NaN, Number.NaN)).toBe(true);
  });

  it('never calls two different class instances equal', () => {
    expect(shallowEqual(new Date(1), new Date(2))).toBe(false);
    expect(shallowEqual(new Map(), new Map())).toBe(false);
  });
});
