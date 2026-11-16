import { cx } from './cx';
import './Spinner.css';

export interface SpinnerProps {
  /** Diameter in pixels. */
  size?: number;
  /** Text for screen readers. Pass an empty string when the spinner is purely decorative. */
  label?: string;
  className?: string;
}

/** Circular activity indicator in the current text colour. */
export function Spinner({ size = 20, label = 'Laden…', className }: SpinnerProps) {
  return (
    <span
      className={cx('sb-spinner', className)}
      role={label ? 'status' : undefined}
      aria-hidden={label ? undefined : true}
    >
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.22" strokeWidth="2.5" />
        <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
      {label && <span className="sb-visually-hidden">{label}</span>}
    </span>
  );
}
