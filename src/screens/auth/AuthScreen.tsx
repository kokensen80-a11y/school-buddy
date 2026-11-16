import { useEffect, useRef, useState, type FormEvent } from 'react';
import { BellRing, BookOpen, CalendarCheck } from 'lucide-react';
import {
  Button,
  Field,
  Heading,
  Screen,
  Stack,
  Text,
  TextInput,
  TopBar,
} from '../../components/ui';
import { Logo } from '../../components/Logo';
import { actions } from '../../lib/store';
import './AuthScreen.css';

type View = 'welkom' | 'registreren' | 'inloggen';

/** Welcome, register and log in, as three views of one screen. */
export default function AuthScreen() {
  const [view, setView] = useState<View>('welkom');

  if (view === 'welkom') {
    return (
      <Screen
        bottomBar={
          <Stack gap={2}>
            <Button size="lg" block onClick={() => setView('registreren')}>
              Account aanmaken
            </Button>
            <Button size="lg" block variant="ghost" onClick={() => setView('inloggen')}>
              Ik heb al een account
            </Button>
          </Stack>
        }
      >
        <div className="sb-auth-welcome">
          <Logo size={88} />
          <Heading level={1} size="title" className="sb-auth-welcome__promise">
            Jouw toetsen, jouw tempo, jouw planning.
          </Heading>
          <ul className="sb-auth-benefits">
            <li>
              <BookOpen size={22} aria-hidden />
              <span>Zet je toetsen en leerstof erin</span>
            </li>
            <li>
              <CalendarCheck size={22} aria-hidden />
              <span>Krijg een planning die bij jou past</span>
            </li>
            <li>
              <BellRing size={22} aria-hidden />
              <span>Een seintje als het tijd is om te leren</span>
            </li>
          </ul>
        </div>
      </Screen>
    );
  }

  return view === 'registreren' ? (
    <RegisterForm onBack={() => setView('welkom')} onSwitch={() => setView('inloggen')} />
  ) : (
    <LoginForm onBack={() => setView('welkom')} onSwitch={() => setView('registreren')} />
  );
}

interface FormProps {
  onBack: () => void;
  onSwitch: () => void;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function RegisterForm({ onBack, onSwitch }: FormProps) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<{ name?: string; email?: string; password?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const firstField = useAutoFocus();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const next: typeof errors = {};
    if (!name.trim()) next.name = 'Vul je naam in.';
    if (!EMAIL_RE.test(email.trim())) next.email = 'Vul een geldig e-mailadres in.';
    if (password.length < 8) next.password = 'Kies een wachtwoord van minstens 8 tekens.';
    setErrors(next);
    setFormError(null);
    if (Object.keys(next).length > 0) return;
    setBusy(true);
    const result = await actions.register({ name: name.trim(), email: email.trim(), password });
    setBusy(false);
    if (!result.ok) setFormError(result.error);
  };

  return (
    <Screen topBar={<TopBar onBack={onBack} />}>
      <form className="sb-auth-form" onSubmit={submit} noValidate>
        <Heading level={1} size="title">
          Account aanmaken
        </Heading>
        <Field label="Naam" error={errors.name}>
          <TextInput
            ref={firstField}
            value={name}
            onChange={setName}
            autoComplete="name"
            autoCapitalize="words"
          />
        </Field>
        <Field label="E-mailadres" error={errors.email}>
          <TextInput
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="off"
            spellCheck={false}
            value={email}
            onChange={setEmail}
          />
        </Field>
        <Field label="Wachtwoord" hint="Minstens 8 tekens." error={errors.password}>
          <TextInput
            type={showPassword ? 'text' : 'password'}
            autoComplete="new-password"
            value={password}
            onChange={setPassword}
          />
        </Field>
        <Button
          variant="ghost"
          size="sm"
          className="sb-auth-form__toggle"
          onClick={() => setShowPassword((v) => !v)}
        >
          {showPassword ? 'Verberg wachtwoord' : 'Toon wachtwoord'}
        </Button>
        {formError && (
          <Text tone="danger" role="alert">
            {formError}
          </Text>
        )}
        <Button type="submit" size="lg" block loading={busy}>
          Account aanmaken
        </Button>
        <Text size="sm" tone="secondary">
          Je account en je gegevens blijven op dit apparaat. Niemand anders kan erbij.
        </Text>
        <Button variant="ghost" onClick={onSwitch}>
          Ik heb al een account
        </Button>
      </form>
    </Screen>
  );
}

function LoginForm({ onBack, onSwitch }: FormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const firstField = useAutoFocus();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!email.trim() || !password) {
      setError('Vul je e-mailadres en wachtwoord in.');
      return;
    }
    setBusy(true);
    const result = await actions.login({ email: email.trim(), password });
    setBusy(false);
    if (!result.ok) setError(result.error);
  };

  return (
    <Screen topBar={<TopBar onBack={onBack} />}>
      <form className="sb-auth-form" onSubmit={submit} noValidate>
        <Heading level={1} size="title">
          Inloggen
        </Heading>
        <Field label="E-mailadres">
          <TextInput
            ref={firstField}
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="off"
            spellCheck={false}
            value={email}
            onChange={setEmail}
          />
        </Field>
        <Field label="Wachtwoord">
          <TextInput
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={setPassword}
          />
        </Field>
        {error && (
          <Text tone="danger" role="alert">
            {error}
          </Text>
        )}
        <Button type="submit" size="lg" block loading={busy}>
          Inloggen
        </Button>
        <Text size="sm" tone="secondary">
          Wachtwoord vergeten? Omdat alles op dit apparaat staat, kunnen we het niet herstellen.
          Maak dan een nieuw account aan.
        </Text>
        <Button variant="ghost" onClick={onSwitch}>
          Nieuw account aanmaken
        </Button>
      </form>
    </Screen>
  );
}

/** Focuses the returned input once, when the form opens. */
function useAutoFocus() {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return ref;
}
