/**
 * Work that runs while someone is signed in:
 * - keeps the notification engine in sync with the plan (reminders that fire also land in the inbox);
 * - re-plans when a new day starts or the app returns after a while, so missed blocks move.
 */
import { useEffect, useRef } from 'react';
import { actions, useAccount, useData } from '../lib/store';
import { useToday } from '../lib/clock';
import notifier from '../lib/notifications/engine';
import { buildReminders } from '../lib/notifications/reminders';
import type { Reminder } from '../types';

const FOREGROUND_REPLAN_MS = 30 * 60_000;

export function useBackgroundWork(): void {
  const account = useAccount();
  const data = useData();
  const today = useToday();
  const accountId = account?.id;

  // Notifications: debounced, so a burst of changes syncs once.
  useEffect(() => {
    if (!accountId) return;
    const timer = setTimeout(() => {
      const onFire = (r: Reminder) =>
        void actions.addInboxItems([
          { id: r.id, at: r.at, kind: r.kind, title: r.title, body: r.body, link: r.link, read: false },
        ]);
      void notifier.sync(buildReminders({ data, now: new Date() }), { accountId, onFire });
    }, 400);
    return () => clearTimeout(timer);
    // Inbox changes come from onFire itself; they must not trigger another sync.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, data.sessions, data.exams, data.prefs, data.subjects]);

  useEffect(() => {
    return () => void notifier.stop();
  }, [accountId]);

  // New day: yesterday's open blocks become missed and their work is planned again.
  const firstDay = useRef(today);
  useEffect(() => {
    if (today !== firstDay.current) {
      firstDay.current = today;
      void actions.replan();
    }
  }, [today]);

  // Back in the foreground after a long time: re-plan from "now".
  useEffect(() => {
    let hiddenAt = 0;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') hiddenAt = Date.now();
      else if (hiddenAt && Date.now() - hiddenAt > FOREGROUND_REPLAN_MS) void actions.replan();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);
}
