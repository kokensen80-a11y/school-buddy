import { Minus, Plus } from 'lucide-react';
import { useFieldGroupControl } from './Field';
import { cx } from './cx';
import './Stepper.css';

export interface StepperProps {
  value: number;
  /** Called with the new value, already clamped to `min`…`max`. */
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Turns the value into the text shown, e.g. `formatDuration` → "1 u 30 min". */
  format?: (value: number) => string;
  disabled?: boolean;
  id?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  /** Accessible names of the two buttons. */
  decrementLabel?: string;
  incrementLabel?: string;
  className?: string;
}

const decimalsOf = (n: number) => (String(n).split('.')[1] ?? '').length;

/** Number control with a minus and a plus button around the value. */
export function Stepper({
  value,
  onChange,
  min = -Infinity,
  max = Infinity,
  step = 1,
  format = String,
  disabled = false,
  decrementLabel = 'Minder',
  incrementLabel = 'Meer',
  className,
  ...aria
}: StepperProps) {
  const field = useFieldGroupControl(aria);

  const change = (direction: 1 | -1) => {
    const next = Math.min(max, Math.max(min, value + direction * step));
    // Rounds away floating-point noise from fractional steps (0.1 + 0.2).
    const rounded = Number(next.toFixed(Math.max(decimalsOf(step), decimalsOf(value))));
    if (rounded !== value) onChange(rounded);
  };

  return (
    <div
      className={cx('sb-stepper', disabled && 'sb-stepper--disabled', className)}
      role="group"
      aria-label={aria['aria-label']}
      {...field}
    >
      <button
        type="button"
        className="sb-stepper__button"
        aria-label={decrementLabel}
        disabled={disabled || value <= min}
        onClick={() => change(-1)}
      >
        <Minus aria-hidden="true" />
      </button>
      <output className="sb-stepper__value" aria-live="polite">
        {format(value)}
      </output>
      <button
        type="button"
        className="sb-stepper__button"
        aria-label={incrementLabel}
        disabled={disabled || value >= max}
        onClick={() => change(1)}
      >
        <Plus aria-hidden="true" />
      </button>
    </div>
  );
}
