import { useEffect, useState } from 'react';
import {
  AmbientBackground,
  Button,
  ConfirmProvider,
  Spinner,
  Stack,
  Text,
  ToastProvider,
} from './components/ui';
import { LogoMark } from './components/Logo';
import { actions, useAuthStatus, useData } from './lib/store';
import AuthScreen from './screens/auth/AuthScreen';
import OnboardingScreen from './screens/onboarding/OnboardingScreen';
import MainShell from './app/MainShell';
import './App.css';

export default function App() {
  return (
    <ToastProvider>
      <ConfirmProvider>
        <Gate />
      </ConfirmProvider>
    </ToastProvider>
  );
}

/** Decides what to show: splash while loading, welcome when signed out, onboarding once, then the app. */
function Gate() {
  const status = useAuthStatus();
  const [initError, setInitError] = useState<string | null>(null);

  const start = () => {
    setInitError(null);
    void actions.init().then((result) => {
      if (!result.ok) setInitError(result.error);
    });
  };

  useEffect(start, []);

  if (initError && status !== 'signedIn') {
    return (
      <div className="sb-splash">
        <AmbientBackground />
        <Stack gap={4} align="center">
          <LogoMark size={64} />
          <Text tone="secondary">{initError}</Text>
          <Button onClick={start}>Opnieuw proberen</Button>
        </Stack>
      </div>
    );
  }
  if (status === 'loading') {
    return (
      <div className="sb-splash" aria-busy="true">
        <AmbientBackground />
        <Stack gap={6} align="center">
          <LogoMark size={72} />
          <Spinner />
        </Stack>
      </div>
    );
  }
  if (status === 'signedOut') return <AuthScreen />;
  return <SignedIn />;
}

function SignedIn() {
  const data = useData();
  if (!data.onboarded) return <OnboardingScreen />;
  return <MainShell />;
}
