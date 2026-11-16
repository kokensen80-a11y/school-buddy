/**
 * JSON values in localStorage, for the local backends.
 *
 * localStorage can be missing or locked (private mode, blocked site data) and it can
 * be full. Reading then simply finds nothing; writing rejects with a BackendError
 * that the store turns into a friendly message.
 */
import { BackendError } from './types';

/** Every key School Buddy writes starts with this prefix. */
export const KEY_PREFIX = 'sb.';

function area(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Browsers disagree on the name and code of the "storage is full" error. */
export function isQuotaError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { name, code } = error as { name?: unknown; code?: unknown };
  return (
    name === 'QuotaExceededError' ||
    name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    code === 22 ||
    code === 1014
  );
}

/** The parsed value, or null when the key is missing, unreadable or not valid JSON. */
export function readJson(key: string): unknown {
  try {
    const text = area()?.getItem(key);
    return text == null ? null : (JSON.parse(text) as unknown);
  } catch {
    return null;
  }
}

/** Throws BackendError 'storage-full' or 'storage-unavailable' when the value cannot be stored. */
export function writeJson(key: string, value: unknown): void {
  const storage = area();
  if (!storage) throw new BackendError('storage-unavailable');
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch (error) {
    throw new BackendError(isQuotaError(error) ? 'storage-full' : 'storage-unavailable');
  }
}

export function removeKey(key: string): void {
  try {
    area()?.removeItem(key);
  } catch {
    // Storage that cannot be reached holds nothing that could be removed.
  }
}

/**
 * Calls `listener` when another tab changed a key for which `isRelevant` is true
 * (the browser does not send this event to the tab that made the change).
 *
 * A page that sat in the back/forward cache or slept in the background may have
 * missed such changes, so the listener is also called when the page comes back.
 */
export function onChangeElsewhere(
  isRelevant: (key: string) => boolean,
  listener: () => void,
): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.storageArea !== area()) return;
    // A null key means the whole storage was cleared.
    if (event.key === null || isRelevant(event.key)) listener();
  };
  const onPageShow = (event: PageTransitionEvent) => {
    if (event.persisted) listener();
  };
  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') listener();
  };
  window.addEventListener('storage', onStorage);
  window.addEventListener('pageshow', onPageShow);
  document.addEventListener('visibilitychange', onVisibilityChange);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener('pageshow', onPageShow);
    document.removeEventListener('visibilitychange', onVisibilityChange);
  };
}
