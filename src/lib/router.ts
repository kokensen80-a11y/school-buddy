/**
 * Tiny hash router. Hash URLs keep the app working from any folder and make the
 * browser / phone back button work.
 *
 *   #/home                      Home tab
 *   #/agenda                    Agenda tab            (#/agenda/2026-11-16 opens on that day)
 *   #/toetsen                   Exams tab
 *   #/toetsen/nieuw             New exam
 *   #/toetsen/<id>              Exam detail
 *   #/toetsen/<id>/bewerken     Edit exam
 *   #/profiel                   Profile tab
 *   #/profiel/voorkeuren        Study preferences
 *   #/profiel/meldingen         Notification settings
 *   #/meldingen                 Notification centre (inbox)
 */
import { useSyncExternalStore } from 'react';
import type { ID, ISODate } from '../types';
import { isValidISODate } from './date';

export type Route =
  | { name: 'home' }
  | { name: 'agenda'; date?: ISODate }
  | { name: 'toetsen' }
  | { name: 'toets-nieuw' }
  | { name: 'toets'; id: ID }
  | { name: 'toets-bewerken'; id: ID }
  | { name: 'profiel' }
  | { name: 'voorkeuren' }
  | { name: 'meldingen-instellingen' }
  | { name: 'meldingen' };

export type TabName = 'home' | 'agenda' | 'toetsen' | 'profiel';

export function parseHash(hash: string): Route {
  const parts = hash
    .replace(/^#\/?/, '')
    .split('/')
    .filter(Boolean)
    .map(decodeURIComponent);
  const [a, b, c] = parts;
  switch (a) {
    case 'agenda':
      return b && isValidISODate(b) ? { name: 'agenda', date: b } : { name: 'agenda' };
    case 'toetsen':
      if (!b) return { name: 'toetsen' };
      if (b === 'nieuw') return { name: 'toets-nieuw' };
      return c === 'bewerken' ? { name: 'toets-bewerken', id: b } : { name: 'toets', id: b };
    case 'profiel':
      if (b === 'voorkeuren') return { name: 'voorkeuren' };
      if (b === 'meldingen') return { name: 'meldingen-instellingen' };
      return { name: 'profiel' };
    case 'meldingen':
      return { name: 'meldingen' };
    default:
      return { name: 'home' };
  }
}

export function toHash(route: Route): string {
  switch (route.name) {
    case 'home':
      return '#/home';
    case 'agenda':
      return route.date ? `#/agenda/${route.date}` : '#/agenda';
    case 'toetsen':
      return '#/toetsen';
    case 'toets-nieuw':
      return '#/toetsen/nieuw';
    case 'toets':
      return `#/toetsen/${encodeURIComponent(route.id)}`;
    case 'toets-bewerken':
      return `#/toetsen/${encodeURIComponent(route.id)}/bewerken`;
    case 'profiel':
      return '#/profiel';
    case 'voorkeuren':
      return '#/profiel/voorkeuren';
    case 'meldingen-instellingen':
      return '#/profiel/meldingen';
    case 'meldingen':
      return '#/meldingen';
  }
}

/** The tab a route belongs to (which tab-bar item lights up). */
export function tabOf(route: Route): TabName {
  switch (route.name) {
    case 'agenda':
      return 'agenda';
    case 'toetsen':
    case 'toets-nieuw':
    case 'toets':
    case 'toets-bewerken':
      return 'toetsen';
    case 'profiel':
    case 'voorkeuren':
    case 'meldingen-instellingen':
      return 'profiel';
    default:
      return 'home';
  }
}

/** True for the four top-level tab screens (they show the tab bar, no back button). */
export function isTabRoot(route: Route): boolean {
  return (
    route.name === 'home' ||
    route.name === 'agenda' ||
    route.name === 'toetsen' ||
    route.name === 'profiel'
  );
}

/** Number of in-app navigations so far, so `goBack` knows whether history.back() stays in the app. */
let depth = 0;

export function navigate(route: Route, opts: { replace?: boolean } = {}): void {
  const hash = toHash(route);
  if (opts.replace) {
    window.location.replace(hash);
  } else if (window.location.hash !== hash) {
    depth += 1;
    window.location.hash = hash;
  }
}

/** Go back; when the app was opened directly on this screen, go to `fallback` instead. */
export function goBack(fallback: Route): void {
  if (depth > 0) {
    depth -= 1;
    window.history.back();
  } else {
    navigate(fallback, { replace: true });
  }
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

const getHash = () => window.location.hash;

/** The current route; re-renders on navigation. */
export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, getHash, () => '');
  return parseHash(hash);
}
