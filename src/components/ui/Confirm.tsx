import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Button } from './Button';
import { Sheet } from './Sheet';
import './Confirm.css';

export interface ConfirmOptions {
  /** The question, e.g. "Toets verwijderen?". */
  title: string;
  /** What will happen, in one or two sentences. */
  message?: string;
  /** Label of the confirming button, e.g. "Verwijderen". */
  confirmLabel: string;
  /** Label of the cancel button. */
  cancelLabel?: string;
  /** Red confirm button, and focus starts on cancel, for actions that cannot be undone. */
  destructive?: boolean;
}

export type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export interface ConfirmProviderProps {
  children: ReactNode;
}

/**
 * Hosts the confirmation sheet used by `useConfirm()`. Wrap the app in it once.
 * Cancel, Escape and a press outside the sheet all answer `false`.
 */
export function ConfirmProvider({ children }: ConfirmProviderProps) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const [open, setOpen] = useState(false);
  const resolver = useRef<((confirmed: boolean) => void) | null>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const messageId = useId();

  const settle = useCallback((confirmed: boolean) => {
    resolver.current?.(confirmed);
    resolver.current = null;
    setOpen(false);
  }, []);

  const confirm = useCallback<ConfirmFn>(
    (next) =>
      new Promise<boolean>((resolve) => {
        // A question that is still open is answered with "no" before the next one is asked.
        resolver.current?.(false);
        resolver.current = resolve;
        setOptions(next);
        setOpen(true);
      }),
    [],
  );

  useEffect(() => () => resolver.current?.(false), []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {options && (
        <Sheet
          open={open}
          onClose={() => settle(false)}
          role="alertdialog"
          title={options.title}
          aria-describedby={options.message ? messageId : undefined}
          showClose={false}
          initialFocusRef={options.destructive ? cancelRef : confirmRef}
          footer={
            <div className="sb-confirm__actions">
              <Button
                ref={confirmRef}
                variant={options.destructive ? 'danger' : 'primary'}
                size="lg"
                block
                onClick={() => settle(true)}
              >
                {options.confirmLabel}
              </Button>
              <Button
                ref={cancelRef}
                variant="secondary"
                size="lg"
                block
                onClick={() => settle(false)}
              >
                {options.cancelLabel ?? 'Annuleren'}
              </Button>
            </div>
          }
        >
          {options.message && (
            <p id={messageId} className="sb-confirm__message">
              {options.message}
            </p>
          )}
        </Sheet>
      )}
    </ConfirmContext.Provider>
  );
}

/**
 * Returns a function that asks the user to confirm something and resolves to `true`
 * (confirmed) or `false` (cancelled). Needs a `ConfirmProvider` above.
 *
 * @example
 * const confirm = useConfirm();
 * const ok = await confirm({ title: 'Toets verwijderen?', confirmLabel: 'Verwijderen' });
 * if (ok) removeExam();
 */
export function useConfirm(): ConfirmFn {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error('useConfirm must be used inside a <ConfirmProvider>.');
  return confirm;
}
