/**
 * The app's sense of "now" for rendering: hooks that re-render when the minute or the
 * day changes, and when the app comes back to the foreground (a phone may have slept
 * for hours, so timers alone cannot be trusted).
 */
import { useSyncExternalStore } from 'react';
import type { ISODate } from '../types';
import { minutesOfDay, todayISO } from './date';

const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | undefined;

function notify(): void {
  listeners.forEach((listener) => listener());
}

/** Fires just after every minute boundary. */
function arm(): void {
  const delay = 60_000 - (Date.now() % 60_000) + 25;
  timer = setTimeout(() => {
    notify();
    arm();
  }, delay);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    arm();
    document.addEventListener('visibilitychange', notify);
    window.addEventListener('focus', notify);
    window.addEventListener('pageshow', notify);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      clearTimeout(timer);
      timer = undefined;
      document.removeEventListener('visibilitychange', notify);
      window.removeEventListener('focus', notify);
      window.removeEventListener('pageshow', notify);
    }
  };
}

// Snapshots are primitives, so reading them fresh on every call is stable for React.
const getToday = (): ISODate => todayISO(new Date());
const getNowMinutes = (): number => minutesOfDay(new Date());

/** Today's local date; re-renders at midnight and when the app returns to the foreground. */
export function useToday(): ISODate {
  return useSyncExternalStore(subscribe, getToday, getToday);
}

/** Minutes since local midnight; re-renders every minute. */
export function useNowMinutes(): number {
  return useSyncExternalStore(subscribe, getNowMinutes, getNowMinutes);
}
