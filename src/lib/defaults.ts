import type { Preferences, UserData } from '../types';

export const DEFAULT_PREFS: Preferences = {
  // ma–do 1,5 uur, vr 1 uur, za 2 uur, zo 1,5 uur
  minutesPerWeekday: [90, 90, 90, 90, 60, 120, 90],
  sessionMinutes: 30,
  breakMinutes: 10,
  weekdayStart: '16:00',
  weekendStart: '10:00',
  methods: ['samenvatten', 'flashcards', 'oefenen'],
  planStyle: 'gespreid',
  leadDays: 10,
  notifications: {
    enabled: false,
    sessionLeadMinutes: 10,
    dailyDigestTime: '07:30',
    examDaysBefore: [7, 3, 1],
    eveningCheckTime: '20:30',
  },
};

/** A fresh, empty data set for a new account. Always returns new objects. */
export function createEmptyUserData(): UserData {
  return {
    version: 1,
    onboarded: false,
    subjects: [],
    exams: [],
    sessions: [],
    warnings: [],
    prefs: structuredClone(DEFAULT_PREFS),
    blockedDates: [],
    inbox: [],
  };
}
