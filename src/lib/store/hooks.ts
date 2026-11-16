/**
 * React bindings for a store. The store itself knows nothing about React; these
 * hooks subscribe a component to it through useSyncExternalStore.
 */
import { useRef, useSyncExternalStore } from 'react';
import type {
  Account,
  Exam,
  InboxItem,
  PlanWarning,
  Preferences,
  StudySession,
  Subject,
  UserData,
} from '../../types';
import { shallowEqual } from './structural';
import type { AppState, AppStore, AuthStatus } from './types';

export interface StoreHooks {
  /**
   * The part of the state that `selector` picks. The component re-renders only when
   * that part changes. A selector may build a new object or array on every call
   * (`s => ({ a: s.account, n: s.data?.exams.length })`): results that are
   * shallow-equal to the previous one keep the previous identity.
   */
  useAppState<T>(selector: (state: AppState) => T): T;
  useAuthStatus(): AuthStatus;
  useAccount(): Account | null;
  /** The data of the signed-in account. Throws when nobody is signed in. */
  useData(): UserData;
  useExams(): Exam[];
  useSessions(): StudySession[];
  useSubjects(): Subject[];
  usePrefs(): Preferences;
  useWarnings(): PlanWarning[];
  useInbox(): InboxItem[];
}

function requireData(state: AppState): UserData {
  if (!state.data) {
    throw new Error(
      'School Buddy store: this hook needs a signed-in account. ' +
        'Render the component only while useAuthStatus() returns "signedIn".',
    );
  }
  return state.data;
}

const selectStatus = (state: AppState) => state.status;
const selectAccount = (state: AppState) => state.account;
const selectExams = (state: AppState) => requireData(state).exams;
const selectSessions = (state: AppState) => requireData(state).sessions;
const selectSubjects = (state: AppState) => requireData(state).subjects;
const selectPrefs = (state: AppState) => requireData(state).prefs;
const selectWarnings = (state: AppState) => requireData(state).warnings;
const selectInbox = (state: AppState) => requireData(state).inbox;

export function createStoreHooks(store: Pick<AppStore, 'getState' | 'subscribe'>): StoreHooks {
  function useAppState<T>(selector: (state: AppState) => T): T {
    // What the previous getSnapshot call saw and returned. React calls getSnapshot
    // several times per render and expects the same answer while nothing changed.
    const last = useRef<{ state: AppState; selector: (state: AppState) => T; value: T } | null>(
      null,
    );

    const getSnapshot = (): T => {
      const state = store.getState();
      const previous = last.current;
      if (previous && previous.state === state && previous.selector === selector) {
        return previous.value;
      }
      const selected = selector(state);
      const value = previous && shallowEqual(previous.value, selected) ? previous.value : selected;
      last.current = { state, selector, value };
      return value;
    };

    return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
  }

  return {
    useAppState,
    useAuthStatus: () => useAppState(selectStatus),
    useAccount: () => useAppState(selectAccount),
    useData: () => useAppState(requireData),
    useExams: () => useAppState(selectExams),
    useSessions: () => useAppState(selectSessions),
    useSubjects: () => useAppState(selectSubjects),
    usePrefs: () => useAppState(selectPrefs),
    useWarnings: () => useAppState(selectWarnings),
    useInbox: () => useAppState(selectInbox),
  };
}
