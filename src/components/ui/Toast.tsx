import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { CircleCheck, CircleExclamationPoint, Info } from 'lucide-react';
import { cx } from './cx';
import { prefersReducedMotion } from './motion';
import './Toast.css';

export interface ToastApi {
  /** Green confirmation, e.g. "Toets opgeslagen". */
  success: (message: string) => void;
  /** Red message for something that went wrong. */
  error: (message: string) => void;
  /** Neutral glass message. */
  info: (message: string) => void;
}

type ToastTone = keyof ToastApi;

interface ToastState {
  id: number;
  tone: ToastTone;
  message: string;
  leaving: boolean;
}

const TONE_ICON = {
  success: <CircleCheck />,
  error: <CircleExclamationPoint />,
  info: <Info />,
} as const;

/** Length of the leave animation in Toast.css. */
const EXIT_MS = 200;

const ToastContext = createContext<ToastApi | null>(null);

export interface ToastProviderProps {
  children: ReactNode;
  /** How long a toast stays visible, in milliseconds. */
  duration?: number;
}

/**
 * Shows short messages in a pill at the top of the screen. One toast is visible at a
 * time: a new one replaces the current one. Toasts disappear by themselves and on tap.
 * Wrap the app in it once and call `useToast()` anywhere below.
 */
export function ToastProvider({ children, duration = 3500 }: ToastProviderProps) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const nextId = useRef(0);
  const hideTimer = useRef<number | undefined>(undefined);
  const removeTimer = useRef<number | undefined>(undefined);

  const clearTimers = useCallback(() => {
    window.clearTimeout(hideTimer.current);
    window.clearTimeout(removeTimer.current);
  }, []);

  const dismiss = useCallback(() => {
    clearTimers();
    setToast((current) => (current ? { ...current, leaving: true } : current));
    removeTimer.current = window.setTimeout(
      () => setToast(null),
      prefersReducedMotion() ? 0 : EXIT_MS,
    );
  }, [clearTimers]);

  const show = useCallback(
    (tone: ToastTone, message: string) => {
      clearTimers();
      nextId.current += 1;
      setToast({ id: nextId.current, tone, message, leaving: false });
      hideTimer.current = window.setTimeout(dismiss, duration);
    },
    [clearTimers, dismiss, duration],
  );

  useEffect(() => clearTimers, [clearTimers]);

  const api = useMemo<ToastApi>(
    () => ({
      success: (message) => show('success', message),
      error: (message) => show('error', message),
      info: (message) => show('info', message),
    }),
    [show],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      {createPortal(
        <div className="sb-toast-region" role="status" aria-live="polite" aria-atomic="true">
          {toast && (
            <div
              key={toast.id}
              className={cx(
                'sb-toast',
                `sb-toast--${toast.tone}`,
                toast.tone === 'info' && 'sb-glass sb-glass--smoked',
                toast.leaving && 'sb-toast--leaving',
              )}
              onClick={dismiss}
            >
              <span className="sb-toast__icon" aria-hidden="true">
                {TONE_ICON[toast.tone]}
              </span>
              <span className="sb-toast__message">{toast.message}</span>
            </div>
          )}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}

/** Returns `{ success, error, info }` to show a toast. Needs a `ToastProvider` above. */
export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error('useToast must be used inside a <ToastProvider>.');
  return api;
}
