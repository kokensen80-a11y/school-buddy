import { useRef, useState } from 'react';
import { Bell, CalendarPlus, Download, LogOut, SlidersHorizontal, Trash, Upload } from 'lucide-react';
import {
  Avatar,
  Button,
  Card,
  Field,
  LargeHeader,
  ListRow,
  Screen,
  Section,
  Sheet,
  Stack,
  Text,
  TextInput,
  useConfirm,
  useToast,
} from '../../components/ui';
import { LogoMark } from '../../components/Logo';
import { actions, useAccount, useData, usePrefs } from '../../lib/store';
import { useToday } from '../../lib/clock';
import { buildICS, downloadICS } from '../../lib/ics';
import { permissionState } from '../../lib/notifications/engine';
import { useInstallPrompt } from '../../lib/pwa';
import { navigate } from '../../lib/router';
import { formatDuration } from '../../lib/date';
import { weekTotal } from '../../components/domain/PrefEditors';
import './profile.css';

const APP_VERSION = '0.1.0';

export default function ProfileScreen() {
  const account = useAccount();
  const prefs = usePrefs();
  const data = useData();
  const today = useToday();
  const toast = useToast();
  const confirm = useConfirm();
  const install = useInstallPrompt();
  const fileRef = useRef<HTMLInputElement>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const permission = permissionState();
  const notifyLabel = !prefs.notifications.enabled
    ? 'Uit'
    : permission === 'denied'
      ? 'Geblokkeerd in je browser'
      : permission === 'granted'
        ? 'Aan'
        : 'Aan, nog geen toestemming';

  const exportCalendar = () => {
    const hasFuture = data.sessions.some((s) => s.status === 'gepland' && s.date >= today) || data.exams.some((e) => e.date >= today);
    if (!hasFuture) {
      toast.info('Er staat nog niets in je planning om te exporteren.');
      return;
    }
    downloadICS(buildICS({ data, now: new Date() }), 'school-buddy.ics');
    toast.success('Agendabestand gedownload. Open het om het toe te voegen.');
  };

  const backup = () => {
    const blob = new Blob([actions.exportData()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `school-buddy-${today}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    toast.success('Reservekopie gedownload');
  };

  const restore = async (file: File | undefined) => {
    if (!file) return;
    const ok = await confirm({
      title: 'Reservekopie terugzetten?',
      message: 'Je huidige toetsen, leerstof en planning worden vervangen door die uit het bestand.',
      confirmLabel: 'Terugzetten',
      destructive: true,
    });
    if (!ok) return;
    const result = await actions.importData(await file.text());
    if (!result.ok) toast.error(result.error);
    else toast.success('Reservekopie teruggezet');
  };

  return (
    <Screen withTabBar>
      <LargeHeader title="Profiel" />
      <Stack gap={6}>
        <Card onClick={() => setAccountOpen(true)}>
          <div className="sb-profile-account">
            <Avatar name={account?.name ?? ''} />
            <Stack gap={1}>
              <Text weight="semibold">{account?.name}</Text>
              <Text size="md" tone="secondary">
                {account?.email}
              </Text>
            </Stack>
          </div>
        </Card>

        <Section label="Leren">
          <Card padding="none">
            <ListRow
              leading={<SlidersHorizontal size={20} />}
              title="Studievoorkeuren"
              subtitle={`${formatDuration(weekTotal(prefs.minutesPerWeekday))} per week · blokken van ${prefs.sessionMinutes} min`}
              chevron
              onClick={() => navigate({ name: 'voorkeuren' })}
            />
            <ListRow
              leading={<Bell size={20} />}
              title="Herinneringen"
              subtitle={notifyLabel}
              chevron
              onClick={() => navigate({ name: 'meldingen-instellingen' })}
            />
          </Card>
        </Section>

        <Section label="Agenda van je telefoon">
          <Stack gap={3}>
            <Text size="md" tone="secondary">
              Zet je planning in de agenda van je telefoon. Dan krijg je ook een herinnering als School Buddy dicht is.
              Exporteer opnieuw na grote wijzigingen.
            </Text>
            <Button variant="secondary" icon={<CalendarPlus size={18} />} onClick={exportCalendar}>
              Planning naar agenda
            </Button>
          </Stack>
        </Section>

        {!install.isStandalone && (install.canInstall || install.needsIOSInstructions) && (
          <Section label="App">
            {install.canInstall ? (
              <Button variant="secondary" onClick={() => void install.promptInstall()}>
                Zet School Buddy op je beginscherm
              </Button>
            ) : (
              <Text size="md" tone="secondary">
                Tik in Safari op de deelknop en kies "Zet op beginscherm". Dan werkt School Buddy als een app en kun je
                meldingen krijgen.
              </Text>
            )}
          </Section>
        )}

        <Section label="Gegevens">
          <Stack gap={3}>
            <Text size="md" tone="secondary">
              Je gegevens staan alleen op dit apparaat. Maak af en toe een reservekopie.
            </Text>
            <Card padding="none">
              <ListRow leading={<Download size={20} />} title="Reservekopie maken" onClick={backup} />
              <ListRow leading={<Upload size={20} />} title="Reservekopie terugzetten" onClick={() => fileRef.current?.click()} />
            </Card>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(e) => {
                void restore(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </Stack>
        </Section>

        <Section label="Account">
          <Card padding="none">
            <ListRow leading={<LogOut size={20} />} title="Uitloggen" onClick={() => void actions.logout()} />
            <ListRow leading={<Trash size={20} />} title="Account verwijderen" destructive onClick={() => setDeleteOpen(true)} />
          </Card>
        </Section>

        <div className="sb-profile-footer">
          <LogoMark size={28} />
          <Text size="sm" tone="secondary">
            School Buddy {APP_VERSION}
          </Text>
        </div>
      </Stack>

      <AccountSheet open={accountOpen} onClose={() => setAccountOpen(false)} />
      <DeleteSheet open={deleteOpen} onClose={() => setDeleteOpen(false)} />
    </Screen>
  );
}

function AccountSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const account = useAccount();
  const toast = useToast();
  const [name, setName] = useState(account?.name ?? '');
  const [email, setEmail] = useState(account?.email ?? '');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);

  const saveAccount = async () => {
    setBusy(true);
    const result = await actions.updateAccount({ name: name.trim(), email: email.trim() });
    setBusy(false);
    if (!result.ok) toast.error(result.error);
    else {
      toast.success('Opgeslagen');
      onClose();
    }
  };

  const savePassword = async () => {
    if (next.length < 8) {
      toast.error('Kies een nieuw wachtwoord van minstens 8 tekens.');
      return;
    }
    setBusy(true);
    const result = await actions.changePassword({ current, next });
    setBusy(false);
    if (!result.ok) toast.error(result.error);
    else {
      setCurrent('');
      setNext('');
      toast.success('Wachtwoord gewijzigd');
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="Account" showClose>
      <Stack gap={6}>
        <Stack gap={4}>
          <Field label="Naam">
            <TextInput value={name} onChange={setName} autoComplete="name" />
          </Field>
          <Field label="E-mailadres">
            <TextInput type="email" inputMode="email" autoCapitalize="off" value={email} onChange={setEmail} />
          </Field>
          <Button loading={busy} onClick={() => void saveAccount()}>
            Opslaan
          </Button>
        </Stack>
        <Stack gap={4}>
          <Field label="Huidig wachtwoord">
            <TextInput type="password" autoComplete="current-password" value={current} onChange={setCurrent} />
          </Field>
          <Field label="Nieuw wachtwoord" hint="Minstens 8 tekens.">
            <TextInput type="password" autoComplete="new-password" value={next} onChange={setNext} />
          </Field>
          <Button variant="secondary" disabled={!current || !next} onClick={() => void savePassword()}>
            Wachtwoord wijzigen
          </Button>
        </Stack>
      </Stack>
    </Sheet>
  );
}

function DeleteSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const remove = async () => {
    setBusy(true);
    const result = await actions.deleteAccount({ password });
    setBusy(false);
    if (!result.ok) toast.error(result.error);
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Account verwijderen"
      showClose
      role="alertdialog"
      footer={
        <Button variant="danger" block size="lg" loading={busy} disabled={!password} onClick={() => void remove()}>
          Alles verwijderen
        </Button>
      }
    >
      <Stack gap={4}>
        <Text>
          Je account, je toetsen, je leerstof en je planning worden van dit apparaat verwijderd. Dit kun je niet
          ongedaan maken.
        </Text>
        <Field label="Wachtwoord ter bevestiging">
          <TextInput type="password" autoComplete="current-password" value={password} onChange={setPassword} />
        </Field>
      </Stack>
    </Sheet>
  );
}
