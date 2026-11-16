import { Button, Callout, Stack } from '../ui';
import { useExams, useWarnings } from '../../lib/store';
import { navigate } from '../../lib/router';
import { warningText } from '../../lib/selectors';
import type { ID } from '../../types';

/** Callouts for the current plan warnings (all, or one exam's). Nothing when there are none. */
export function PlanWarnings({ examId }: { examId?: ID }) {
  const warnings = useWarnings().filter((w) => !examId || w.examId === examId);
  const exams = useExams();
  if (warnings.length === 0) return null;
  return (
    <Stack gap={3}>
      {warnings.map((w) => {
        const text = warningText(w, exams);
        return (
          <Callout
            key={`${w.type}:${w.examId}`}
            tone="warning"
            title={text.title}
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
