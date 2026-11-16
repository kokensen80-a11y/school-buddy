/**
 * Structural sharing for plain JSON-like data.
 *
 * Returns a value that is deep-equal to `next` but reuses every part of `prev`
 * that did not change. When nothing changed at all, `prev` itself is returned.
 * This keeps object identities stable (a re-plan that produces the same sessions
 * gives the same array), so subscribers and React components only see real changes.
 */
export function reuseEqual<T>(prev: T, next: T): T {
  if (Object.is(prev, next)) return prev;

  if (Array.isArray(prev) && Array.isArray(next)) {
    const merged = next.map((item, index) => reuseEqual(prev[index], item));
    const unchanged =
      prev.length === next.length && merged.every((item, index) => item === prev[index]);
    return (unchanged ? prev : merged) as T;
  }

  if (isPlainObject(prev) && isPlainObject(next)) {
    const keys = Object.keys(next);
    let unchanged = keys.length === Object.keys(prev).length;
    const entries = keys.map((key): [string, unknown] => {
      // Own values only: for a key such as "__proto__", prev[key] could be inherited.
      const previous = Object.hasOwn(prev, key) ? prev[key] : undefined;
      const value = reuseEqual(previous, next[key]);
      if (!Object.hasOwn(prev, key) || value !== previous) unchanged = false;
      return [key, value];
    });
    // fromEntries defines every key as an own property; assigning merged["__proto__"]
    // would replace the prototype of the result instead.
    return (unchanged ? prev : Object.fromEntries(entries)) as T;
  }

  return next;
}

/** Object literals and JSON data, not arrays or class instances (Date, Blob, Map…). */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** True when both values are identical, or are flat arrays or plain objects with identical entries. */
export function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => Object.is(item, b[index]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = Object.keys(a);
    return (
      keys.length === Object.keys(b).length &&
      keys.every((key) => Object.hasOwn(b, key) && Object.is(a[key], b[key]))
    );
  }
  return false;
}
