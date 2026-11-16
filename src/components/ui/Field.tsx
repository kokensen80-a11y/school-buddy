import { createContext, useContext, useId, useMemo, type ReactNode } from 'react';
import { cx } from './cx';
import './Field.css';

interface FieldContextValue {
  /** Id for the single control of the field; absent for a group. */
  controlId?: string;
  labelId: string;
  /** Id of the hint or error text, when there is one. */
  describedBy?: string;
  invalid: boolean;
}

const FieldContext = createContext<FieldContextValue | null>(null);

interface ControlAria {
  id?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean | 'true' | 'false' | 'grammar' | 'spelling';
}

const joinIds = (...ids: Array<string | undefined>) => ids.filter(Boolean).join(' ') || undefined;

/**
 * Wires a form control to the surrounding `Field`: its id (for the label), the hint or
 * error text and the invalid state. Props passed to the control itself win.
 */
export function useFieldControl(own: ControlAria): ControlAria {
  const field = useContext(FieldContext);
  return {
    id: own.id ?? field?.controlId,
    'aria-describedby': joinIds(own['aria-describedby'], field?.describedBy),
    'aria-invalid': own['aria-invalid'] ?? (field?.invalid || undefined),
  };
}

/**
 * Like `useFieldControl`, for controls that are not a native form element (a radio
 * group, a stepper): they are named through `aria-labelledby` instead of `<label for>`.
 */
export function useFieldGroupControl(own: ControlAria & { 'aria-label'?: string }): ControlAria {
  const field = useContext(FieldContext);
  const hasOwnName = own['aria-label'] != null || own['aria-labelledby'] != null;
  return {
    id: own.id ?? field?.controlId,
    'aria-labelledby': own['aria-labelledby'] ?? (hasOwnName ? undefined : field?.labelId),
    'aria-describedby': joinIds(own['aria-describedby'], field?.describedBy),
  };
}

export interface FieldProps {
  /** Text of the label above the control. */
  label: ReactNode;
  /** Help text under the control. */
  hint?: ReactNode;
  /** Error message; replaces the hint and marks the control as invalid. Falsy values show nothing. */
  error?: ReactNode;
  /** Adds a muted "optioneel" behind the label. */
  optional?: boolean;
  /**
   * For a set of controls under one label (chips, two inputs side by side): renders a
   * labelled group instead of a `<label>`, and the controls keep their own ids.
   */
  group?: boolean;
  /** One form control from this kit, or several when `group` is set. */
  children: ReactNode;
  className?: string;
}

/**
 * Label, hint and error for a form control. Controls from this kit placed inside pick
 * up the id, `aria-describedby` and `aria-invalid` by themselves.
 */
export function Field({
  label,
  hint,
  error,
  optional = false,
  group = false,
  children,
  className,
}: FieldProps) {
  const uid = useId();
  const labelId = `${uid}-label`;
  const controlId = group ? undefined : `${uid}-control`;
  const hasError = error != null && error !== false && error !== '';
  const message = hasError ? error : hint;
  const hasMessage = message != null && message !== false && message !== '';
  const messageId = hasMessage ? `${uid}-message` : undefined;

  const context = useMemo<FieldContextValue>(
    () => ({ controlId, labelId, describedBy: messageId, invalid: hasError }),
    [controlId, labelId, messageId, hasError],
  );

  const labelContent = (
    <>
      {label}
      {optional && <span className="sb-field__optional"> · optioneel</span>}
    </>
  );

  return (
    <div
      className={cx('sb-field', className)}
      role={group ? 'group' : undefined}
      aria-labelledby={group ? labelId : undefined}
      aria-describedby={group ? messageId : undefined}
    >
      {group ? (
        <div id={labelId} className="sb-field__label">
          {labelContent}
        </div>
      ) : (
        <label id={labelId} htmlFor={controlId} className="sb-field__label">
          {labelContent}
        </label>
      )}
      <FieldContext.Provider value={context}>{children}</FieldContext.Provider>
      {hasMessage && (
        <p id={messageId} className={hasError ? 'sb-field__error' : 'sb-field__hint'}>
          {message}
        </p>
      )}
    </div>
  );
}
