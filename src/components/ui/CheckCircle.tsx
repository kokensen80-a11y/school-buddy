import { forwardRef, type CSSProperties, type InputHTMLAttributes } from 'react';
import { cx } from './cx';
import { resolveColor, type ColorValue } from './color';
import './CheckCircle.css';

export interface CheckCircleProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'checked' | 'onChange' | 'size'> {
  checked: boolean;
  /** Called with the new state when the circle is pressed. */
  onChange: (checked: boolean) => void;
  /** Fill colour when checked: a subject colour name or any CSS colour. Default: the green accent. */
  color?: ColorValue;
  /** Diameter of the circle in pixels; the touch target stays 44px. */
  size?: number;
}

/**
 * Round checkbox in the style of iOS Reminders, for ticking off a study block.
 * It is a real checkbox: name it with `aria-label` (e.g. "Celdeling afvinken") or a label.
 */
export const CheckCircle = forwardRef<HTMLInputElement, CheckCircleProps>(function CheckCircle(
  { checked, onChange, color, size = 26, className, style, ...rest },
  ref,
) {
  const circleStyle = {
    '--sb-check-size': `${size}px`,
    ...(color != null && { '--sb-check-color': resolveColor(color) }),
    ...style,
  } as CSSProperties;

  return (
    <span className={cx('sb-check-circle', className)} style={circleStyle}>
      <input
        ref={ref}
        type="checkbox"
        className="sb-check-circle__input"
        checked={checked}
        onChange={(event) => {
          // Marks the box as touched so the tick animation plays for presses, not on first render.
          event.target.dataset.touched = '';
          onChange(event.target.checked);
        }}
        {...rest}
      />
      <span className="sb-check-circle__ring" aria-hidden="true" />
      <svg className="sb-check-circle__mark" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6.5 12.5l3.6 3.6 7.4-8" pathLength="1" />
      </svg>
    </span>
  );
});
