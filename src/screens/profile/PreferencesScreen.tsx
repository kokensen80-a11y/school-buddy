import { useState } from 'react';
import { Button, Screen, Section, Stack, TopBar, useConfirm, useToast } from '../../components/ui';
import {
  MethodPicker,
  PlanStylePicker,
  StudyTimesEditor,
  WeekdayMinutesEditor,
} from '../../components/domain/PrefEditors';
import { actions, usePrefs } from '../../lib/store';
import { DEFAULT_PREFS } from '../../lib/defaults';
import { goBack } from '../../lib/router';
import type { Preferences } from '../../types';

/** All study preferences on one page; saved together. */
export default function PreferencesScreen() {
  const saved = usePrefs();
  const toast = useToast();
  const confirm = useConfirm();
  const [draft, setDraft] = useState<Preferences>(() => structuredClone(saved));
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const patch = (p: Partial<Preferences>) => setDraft((d) => ({ ...d, ...p }));

  const back = async () => {
    if (dirty) {
      const ok = await confirm({
        title: 'Wijzigingen weggooien?',
        message: 'Je aanpassingen worden niet bewaard.',
        confirmLabel: 'Weggooien',
        cancelLabel: 'Blijven',
        destructive: true,
      });
      if (!ok) return;
    }
    goBack({ name: 'profiel' });
  };

  const save = async () => {
    setBusy(true);
    const { notifications: _ignored, ...study } = draft;
    const result = await actions.updatePrefs(study);
    setBusy(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success('Opgeslagen. Je planning is bijgewerkt.');
  };

  const reset = () => {
    const { notifications: _keep, ...defaults } = structuredClone(DEFAULT_PREFS);
    setDraft((d) => ({ ...d, ...defaults }));
  };

  return (
    <Screen
      topBar={<TopBar title="Studievoorkeuren" onBack={() => void back()} />}
      bottomBar={
        dirty ? (
          <Button block size="lg" loading={busy} onClick={() => void save()}>
            Opslaan
          </Button>
        ) : undefined
      }
    >
      <Stack gap={6}>
        <Section label="Tijd per dag">
          <WeekdayMinutesEditor value={draft.minutesPerWeekday} onChange={(minutesPerWeekday) => patch({ minutesPerWeekday })} />
        </Section>
        <Section label="Wanneer">
          <StudyTimesEditor value={draft} onChange={(t) => patch(t)} />
        </Section>
        <Section label="Hoe je leert">
          <MethodPicker value={draft.methods} onChange={(methods) => patch({ methods })} />
        </Section>
        <Section label="Verdeling">
          <PlanStylePicker
            value={draft.planStyle}
            leadDays={draft.leadDays}
            onChange={(planStyle) => patch({ planStyle })}
            onLeadDays={(leadDays) => patch({ leadDays })}
          />
        </Section>
        <Button variant="ghost" onClick={reset}>
          Standaard herstellen
        </Button>
      </Stack>
    </Screen>
  );
}
