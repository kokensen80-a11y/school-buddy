import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { useFieldControl } from './Field';
import { cx } from './cx';
import './Switch.css';

export interface SwitchProps
  extends Omit<
    ButtonHTMLAttributes<HTMLButtonElement>,
    'onChange' | 'role' | 'aria-checked' | 'children'
  > {
  checked: boolean;
  /** Called with the new state when the switch is flipped. */
  onChange: (checked: boolean) => void;
}

/**
 * iOS-style on/off toggle. Name it with `aria-label`, a `Field`, or by putting it in the
 * trailing slot of a `ListRow` that has `asLabel`.
 */
export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(function Switch(
  { checked, onChange, className, onClick, ...rest },
  ref,
) {
  const field = useFieldControl(rest);
  return (
    <button
      ref={ref}
      type="button"
      role="switch"
      aria-checked={checked}
      className={cx('sb-switch', checked && 'sb-switch--on', className)}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) onChange(!checked);
      }}
      {...rest}
      {...field}
    >
      <span className="sb-switch__thumb" aria-hidden="true" />
    </button>
  );
});
