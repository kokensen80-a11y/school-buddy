import { useEffect, useState, type ReactNode } from 'react';
import {
  Button,
  Card,
  Heading,
  ListRow,
  ProgressBar,
  Screen,
  Stack,
  Switch,
  Text,
  TopBar,
  useToast,
} from '../../components/ui';
import { LogoMark } from '../../components/Logo';
import {
  MethodPicker,
  PlanStylePicker,
  StudyTimesEditor,
  WeekdayMinutesEditor,
  weekTotal,
} from '../../components/domain/PrefEditors';
import { actions, useAccount, usePrefs } from '../../lib/store';
import { formatDuration } from '../../lib/date';
import {
  PLAN_STYLES,
  STUDY_METHODS,
} from '../../lib/labels';
import { DEFAULT_PREFS } from '../../lib/defaults';
import { navigate } from '../../lib/router';
import { permissionState, requestPermission } from '../../lib/notifications/engine';
import type { Preferences } from '../../types';
import './OnboardingScreen.css';

const STEPS = ['welkom', 'tijd', 'wanneer', 'hoe', 'verdeling', 'herinneringen', 'samenvatting'] as const;
type Step = (typeof STEPS)[number];
const LAST = STEPS.length - 1;
const HEADING_ID = 'sb-onboarding-heading';

/** One-time personal set-up after registering: seven short steps, saved together at the end. */
export default function OnboardingScreen() {
  const account = useAccount();
  const savedPrefs = usePrefs();
  const toast = useToast();
  const [draft, setDraft] = useState<Preferences>(() => structuredClone(savedPrefs));
  const [index, setIndex] = useState(0);
  const [returnToSummary, setReturnToSummary] = useState(false);
  const [busy, setBusy] = useState(false);
  const step: Step = STEPS[index];
  const firstName = account?.name.trim().split(/\s+/)[0] ?? '';

  useEffect(() => {
    if (index > 0) document.getElementById(HEADING_ID)?.focus({ preventScroll: true });
  }, [index]);

  const patch = (p: Partial<Preferences>) => setDraft((d) => ({ ...d, ...p }));
  const goTo = (i: number) => setIndex(Math.max(0, Math.min(LAST, i)));
  const next = () => {
    if (returnToSummary) {
      setReturnToSummary(false);
      goTo(LAST);
    } else {
      goTo(index + 1);
    }
  };
  const jumpTo = (target: Step) => {
    setReturnToSummary(true);
    goTo(STEPS.indexOf(target));
  };

  const finish = async (prefs: Preferences, destination: 'toets-nieuw' | 'home') => {
    if (busy) return;
    setBusy(true);
    const saved = await actions.updatePrefs(prefs);
    const done = saved.ok ? await actions.completeOnboarding() : saved;
    setBusy(false);
    if (!done.ok) {
      toast.error(done.error);
      return;
    }
    navigate({ name: destination }, { replace: true });
  };

  const bottomBar =
    step === 'samenvatting' ? (
      <Stack gap={2}>
        <Button size="lg" block loading={busy} onClick={() => void finish(draft, 'toets-nieuw')}>
          Eerste toets toevoegen
        </Button>
        <Button size="lg" block variant="ghost" disabled={busy} onClick={() => void finish(draft, 'home')}>
          Eerst even rondkijken
        </Button>
      </Stack>
    ) : (
      <Stack gap={2}>
        <Button size="lg" block onClick={next}>
          {step === 'welkom' ? 'Beginnen' : returnToSummary ? 'Terug naar overzicht' : 'Volgende'}
        </Button>
        {step === 'welkom' && (
          <Button
            variant="ghost"
            block
            disabled={busy}
            onClick={() => void finish(structuredClone(DEFAULT_PREFS), 'home')}
          >
            Overslaan en standaard gebruiken
          </Button>
        )}
      </Stack>
    );

  return (
    <Screen
      topBar={index > 0 ? <TopBar title={`Stap ${index + 1} van ${STEPS.length}`} onBack={() => goTo(index - 1)} /> : undefined}
      bottomBar={bottomBar}
    >
      {index > 0 && (
        <ProgressBar
          className="sb-ob-progress"
          value={(index + 1) / STEPS.length}
          color="#0a0a0a"
          aria-label="Voortgang van de instellingen"
        />
      )}
      <div className="sb-ob-step" key={step}>
        {step === 'welkom' && (
          <div className="sb-ob-welcome">
            <LogoMark size={80} />
            <Heading level={1} size="title">
              Hoi {firstName}, welkom bij School Buddy
            </Heading>
            <ol className="sb-ob-welcome__list">
              <li>Je vertelt hoe en wanneer jij het liefst leert.</li>
              <li>Je zet je toetsen en leerstof erin.</li>
              <li>School Buddy maakt jouw planning en geeft je een seintje.</li>
            </ol>
            <Text tone="secondary">Het duurt nog geen minuut.</Text>
          </div>
        )}

        {step === 'tijd' && (
          <StepFrame title="Hoeveel tijd heb je per dag?" intro="Zet een dag op 0 als je dan niet wilt leren. Dat wordt dan een rustdag.">
            <WeekdayMinutesEditor value={draft.minutesPerWeekday} onChange={(minutesPerWeekday) => patch({ minutesPerWeekday })} />
          </StepFrame>
        )}

        {step === 'wanneer' && (
          <StepFrame title="Wanneer leer je het liefst?" intro="Je planning begint op deze tijden en werkt in blokken met korte pauzes.">
            <StudyTimesEditor value={draft} onChange={(t) => patch(t)} />
          </StepFrame>
        )}

        {step === 'hoe' && (
          <StepFrame title="Hoe leer je het liefst?" intro="Kies wat bij je past, je favoriet eerst. School Buddy wisselt daartussen af.">
            <MethodPicker value={draft.methods} onChange={(methods) => patch({ methods })} />
          </StepFrame>
        )}

        {step === 'verdeling' && (
          <StepFrame title="Hoe verdeel je het werk?" intro="Zo verdeelt School Buddy de leerstof over de dagen voor een toets.">
            <PlanStylePicker
              value={draft.planStyle}
              leadDays={draft.leadDays}
              onChange={(planStyle) => patch({ planStyle })}
              onLeadDays={(leadDays) => patch({ leadDays })}
            />
          </StepFrame>
        )}

        {step === 'herinneringen' && (
          <RemindersStep draft={draft} patch={patch} />
        )}

        {step === 'samenvatting' && (
          <StepFrame
            title="Zo gaan we het doen"
            intro="Tik op een regel om iets aan te passen. Je kunt dit later ook nog veranderen bij Profiel."
          >
            <Card padding="none">
              <ListRow
                title="Tijd per week"
                subtitle={formatDuration(weekTotal(draft.minutesPerWeekday))}
                chevron
                onClick={() => jumpTo('tijd')}
              />
              <ListRow
                title="Blokken"
                subtitle={`${draft.sessionMinutes} min leren, ${draft.breakMinutes} min pauze`}
                chevron
                onClick={() => jumpTo('wanneer')}
              />
              <ListRow
                title="Starttijden"
                subtitle={`Doordeweeks ${draft.weekdayStart} · weekend ${draft.weekendStart}`}
                chevron
                onClick={() => jumpTo('wanneer')}
              />
              <ListRow
                title="Zo leer je"
                subtitle={draft.methods.map((m) => STUDY_METHODS[m].label).join(', ')}
                chevron
                onClick={() => jumpTo('hoe')}
              />
              <ListRow
                title="Verdeling"
                subtitle={`${PLAN_STYLES[draft.planStyle].label} · begin ${draft.leadDays} dagen vooraf`}
                chevron
                onClick={() => jumpTo('verdeling')}
              />
              <ListRow
                title="Herinneringen"
                subtitle={draft.notifications.enabled ? 'Aan' : 'Uit'}
                chevron
                onClick={() => jumpTo('herinneringen')}
              />
            </Card>
          </StepFrame>
        )}
      </div>
    </Screen>
  );
}

interface StepFrameProps {
  title: string;
  intro: string;
  children: ReactNode;
}

function StepFrame({ title, intro, children }: StepFrameProps) {
  return (
    <Stack gap={5}>
      <Stack gap={2}>
        <Heading level={1} size="title" id={HEADING_ID} tabIndex={-1} className="sb-ob-heading">
          {title}
        </Heading>
        <Text tone="secondary">{intro}</Text>
      </Stack>
      {children}
    </Stack>
  );
}

function RemindersStep({
  draft,
  patch,
}: {
  draft: Preferences;
  patch: (p: Partial<Preferences>) => void;
}) {
  const [permission, setPermission] = useState(permissionState);

  const toggle = async (on: boolean) => {
    if (!on) {
      patch({ notifications: { ...draft.notifications, enabled: false } });
      return;
    }
    const state = permission === 'default' ? await requestPermission() : permission;
    setPermission(state);
    patch({ notifications: { ...draft.notifications, enabled: state === 'granted' } });
  };

  return (
    <StepFrame

      title="Wil je een seintje als het tijd is?"
      intro="Bijvoorbeeld 10 minuten voor een leerblok, een overzicht in de ochtend en een paar dagen voor een toets."
    >
      <Card padding="none">
        <ListRow
          title="Herinneringen"
          trailing={
            <Switch
              checked={draft.notifications.enabled}
              disabled={permission === 'unsupported' || permission === 'denied'}
              aria-label="Herinneringen"
              onChange={(on) => void toggle(on)}
            />
          }
        />
      </Card>
      <Text tone="secondary" size="md" aria-live="polite">
        {permission === 'denied'
          ? 'Je browser blokkeert meldingen voor School Buddy. Je kunt ze later toestaan in de instellingen van je browser.'
          : permission === 'unsupported'
            ? 'Deze browser kan geen meldingen tonen. Zet School Buddy op je beginscherm, dan lukt het wel.'
            : 'Meldingen komen binnen als School Buddy open is of op de achtergrond draait. Wil je ook een seintje als de app dicht is? Zet je planning dan later in de agenda van je telefoon.'}
      </Text>
      {!draft.notifications.enabled && (
        <Text tone="secondary" size="md">
          Liever niet? Geen probleem, je kunt dit later instellen.
        </Text>
      )}
    </StepFrame>
  );
}



