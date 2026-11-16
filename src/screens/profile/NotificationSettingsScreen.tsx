import { useEffect, useRef, useState } from 'react';
import { Inbox } from 'lucide-react';
import { Button, Card, ListRow, Screen, Section, Stack, Switch, Text, TopBar, useToast } from '../../components/ui';
import { NotificationPrefsEditor } from '../../components/domain/PrefEditors';
import { actions, usePrefs } from '../../lib/store';
import notifier, { permissionState, requestPermission } from '../../lib/notifications/engine';
import { goBack, navigate } from '../../lib/router';
import type { NotificationPrefs } from '../../types';

/** Reminder settings; every change is saved right away. */
export default function NotificationSettingsScreen() {
  const prefs = usePrefs();
  const toast = useToast();
  const [permission, setPermission] = useState(permissionState);
  const [value, setValue] = useState<NotificationPrefs>(prefs.notifications);
  const [savedNote, setSavedNote] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const save = (next: NotificationPrefs, delay = 500) => {
    setValue(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const result = await actions.updatePrefs({ notifications: next });
      if (!result.ok) toast.error(result.error);
      else {
        setSavedNote(true);
        setTimeout(() => setSavedNote(false), 1500);
      }
    }, delay);
  };

  const toggleMaster = async (on: boolean) => {
    if (!on) return save({ ...value, enabled: false }, 0);
    const state = permission === 'default' ? await requestPermission() : permission;
    setPermission(state);
    save({ ...value, enabled: state === 'granted' }, 0);
  };

  const explanation =
    permission === 'denied'
      ? 'Je browser blokkeert meldingen voor School Buddy. Sta ze toe via het slotje of de instellingen van je browser, en zet ze hier daarna aan.'
      : permission === 'unsupported'
        ? 'Deze browser kan geen meldingen tonen. Op een iPhone werkt het als je School Buddy eerst op je beginscherm zet.'
        : 'Meldingen komen binnen als School Buddy open is of op de achtergrond draait. Wil je zeker een seintje, ook als de app dicht is? Zet je planning dan in de agenda van je telefoon via Profiel.';

  return (
    <Screen topBar={<TopBar title="Herinneringen" onBack={() => goBack({ name: 'profiel' })} />}>
      <Stack gap={6}>
        <Card padding="none">
          <ListRow
            title="Herinneringen"
            subtitle={savedNote ? 'Opgeslagen' : value.enabled ? 'Aan' : 'Uit'}
            trailing={
              <Switch
                checked={value.enabled}
                disabled={permission === 'unsupported' || (permission === 'denied' && !value.enabled)}
                aria-label="Herinneringen"
                onChange={(on) => void toggleMaster(on)}
              />
            }
          />
        </Card>
        <Text size="md" tone="secondary">
          {explanation}
        </Text>
        {permission === 'granted' && value.enabled && (
          <Button
            variant="secondary"
            onClick={() =>
              void notifier.sendTest().then((ok) => (ok ? toast.success('Testmelding verstuurd') : toast.error('Er kon geen melding worden getoond.')))
            }
          >
            Testmelding sturen
          </Button>
        )}

        <Section label="Wanneer">
          <NotificationPrefsEditor value={value} disabled={!value.enabled} onChange={(next) => save(next)} />
        </Section>

        <Card padding="none">
          <ListRow leading={<Inbox size={20} />} title="Bekijk je meldingen" chevron onClick={() => navigate({ name: 'meldingen' })} />
        </Card>
      </Stack>
    </Screen>
  );
}
