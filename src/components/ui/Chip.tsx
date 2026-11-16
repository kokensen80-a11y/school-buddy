import {
  forwardRef,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
} from 'react';
import { cx } from './cx';
import { resolveColor, type ColorValue } from './color';
import './Chip.css';

export interface ChipProps extends HTMLAttributes<HTMLSpanElement> {
  children: ReactNode;
  /** Small icon before the text. */
  icon?: ReactNode;
  /** Shows a colour dot before the text: a subject colour name or any CSS colour. */
  color?: ColorValue;
}

/** Outlined pill with muted text for a tag or a small fact ("30 min"). Not interactive. */
export function Chip({ children, icon, color, className, ...rest }: ChipProps) {
  return (
    <span className={cx('sb-chip', className)} {...rest}>
      {color != null && (
        <span
          className="sb-chip__dot"
          style={{ '--sb-dot-color': resolveColor(color) } as CSSProperties}
          aria-hidden="true"
        />
      )}
      {icon != null && (
        <span className="sb-chip__icon" aria-hidden="true">
          {icon}
        </span>
      )}
      <span className="sb-chip__label">{children}</span>
    </span>
  );
}

export interface ChoiceChipProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange' | 'aria-pressed'> {
  children: ReactNode;
  selected: boolean;
  /** Called with the new state when the chip is pressed. */
  onChange?: (selected: boolean) => void;
  /** Small icon before the text. */
  icon?: ReactNode;
}

/**
 * Selectable pill (a toggle button with `aria-pressed`). Put several in a wrapping row
 * for a multi-select such as the preferred study methods.
 */
export const ChoiceChip = forwardRef<HTMLButtonElement, ChoiceChipProps>(function ChoiceChip(
  { children, selected, onChange, icon, className, type = 'button', onClick, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx('sb-choice-chip', selected && 'sb-choice-chip--selected', className)}
      aria-pressed={selected}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) onChange?.(!selected);
      }}
      {...rest}
    >
      {icon != null && (
        <span className="sb-choice-chip__icon" aria-hidden="true">
          {icon}
        </span>
      )}
      <span className="sb-choice-chip__label">{children}</span>
    </button>
  );
});
