import { useState } from 'react';
import { Button, Callout, Stack } from '../ui';
import { useAccount, useExams, useWarnings } from '../../lib/store';
import { navigate } from '../../lib/router';
import { warningText } from '../../lib/selectors';
import type { ID, PlanWarning } from '../../types';

const keyOf = (w: PlanWarning) => `${w.type}:${w.examId}`;

/** Warnings closed with the cross, remembered per account on this device. */
function useHiddenWarnings(accountId: ID | undefined) {
  const storageKey = `sb.hiddenWarnings.${accountId ?? 'none'}`;
  const [hidden, setHidden] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
    } catch {
      return [];
    }
  });
  const hide = (key: string) => {
    const next = [...new Set([...hidden, key])];
    setHidden(next);
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // Storage can be blocked; the warning then only stays hidden until the app reloads.
    }
  };
  return { hidden, hide };
}

/**
 * Callouts for the current plan warnings (all, or one exam's). Nothing when there are none.
 * With `dismissible` each one gets a cross; a closed warning stays hidden in this list.
 */
export function PlanWarnings({ examId, dismissible = false }: { examId?: ID; dismissible?: boolean }) {
  const account = useAccount();
  const { hidden, hide } = useHiddenWarnings(account?.id);
  // Warnings that are animating out after the cross was pressed.
  const [leaving, setLeaving] = useState<string[]>([]);
  const close = (key: string) => {
    setLeaving((l) => [...l, key]);
    window.setTimeout(() => {
      hide(key);
      setLeaving((l) => l.filter((k) => k !== key));
    }, 200);
  };
  const warnings = useWarnings()
    .filter((w) => !examId || w.examId === examId)
    .filter((w) => !dismissible || !hidden.includes(keyOf(w)));
  const exams = useExams();
  if (warnings.length === 0) return null;
  return (
    <Stack gap={3}>
      {warnings.map((w) => {
        const text = warningText(w, exams);
        return (
          <Callout
            key={keyOf(w)}
            tone="warning"
            title={text.title}
            className={leaving.includes(keyOf(w)) ? 'sb-leaving' : undefined}
            onDismiss={dismissible ? () => close(keyOf(w)) : undefined}
            action={
              w.type === 'te-weinig-tijd' ? (
                <Button size="sm" variant="secondary" onClick={() => navigate({ name: 'voorkeuren' })}>
                  Voorkeuren aanpassen
                </Button>
              ) : (
                <Button size="sm" variant="secondary" onClick={() => navigate({ name: 'toets', id: w.examId })}>
                  Leerstof toevoegen
                </Button>
              )
            }
          >
            {text.body}
          </Callout>
        );
      })}
    </Stack>
  );
}
