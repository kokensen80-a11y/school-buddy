import { useRef, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { useFieldGroupControl } from './Field';
import { cx } from './cx';
import './SegmentedControl.css';

export interface SegmentedOption<T extends string | number = string> {
  value: T;
  label: string;
  /** Small icon before the label. */
  icon?: ReactNode;
}

export interface SegmentedControlProps<T extends string | number = string> {
  /** Two to four options. */
  options: ReadonlyArray<SegmentedOption<T>>;
  value: T;
  /** Called with the value of the chosen option. */
  onChange: (value: T) => void;
  disabled?: boolean;
  id?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  className?: string;
}

const KEY_STEP: Record<string, 1 | -1> = {
  ArrowRight: 1,
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowUp: -1,
};

/**
 * Picks exactly one of a few options, like the iOS segmented control. A radio group:
 * Tab reaches the chosen option, the arrow keys move the choice.
 */
export function SegmentedControl<T extends string | number = string>({
  options,
  value,
  onChange,
  disabled = false,
  className,
  ...aria
}: SegmentedControlProps<T>) {
  const field = useFieldGroupControl(aria);
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = options.findIndex((option) => option.value === value);

  const select = (index: number) => {
    const option = options[index];
    if (!option) return;
    buttons.current[index]?.focus();
    if (option.value !== value) onChange(option.value);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const last = options.length - 1;
    const current = Math.max(selectedIndex, 0);
    let next: number;
    if (Object.hasOwn(KEY_STEP, event.key)) {
      next = (current + KEY_STEP[event.key] + options.length) % options.length;
    } else if (event.key === 'Home') {
      next = 0;
    } else if (event.key === 'End') {
      next = last;
    } else {
      return;
    }
    event.preventDefault();
    select(next);
  };

  const style = {
    '--sb-segment-count': options.length,
    '--sb-segment-index': Math.max(selectedIndex, 0),
  } as CSSProperties;

  return (
    <div
      className={cx('sb-segmented', disabled && 'sb-segmented--disabled', className)}
      role="radiogroup"
      aria-label={aria['aria-label']}
      aria-disabled={disabled || undefined}
      style={style}
      onKeyDown={handleKeyDown}
      {...field}
    >
      {selectedIndex >= 0 && <span className="sb-segmented__thumb" aria-hidden="true" />}
      {options.map((option, index) => {
        const checked = index === selectedIndex;
        return (
          <button
            key={option.value}
            ref={(node) => {
              buttons.current[index] = node;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            // Roving tab stop: the chosen option, or the first one when nothing is chosen.
            tabIndex={checked || (selectedIndex < 0 && index === 0) ? 0 : -1}
            disabled={disabled}
            className={cx('sb-segmented__option', checked && 'sb-segmented__option--checked')}
            onClick={() => select(index)}
          >
            {option.icon != null && (
              <span className="sb-segmented__icon" aria-hidden="true">
                {option.icon}
              </span>
            )}
            <span className="sb-segmented__label">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
