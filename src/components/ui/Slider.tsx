import { forwardRef, type CSSProperties, type InputHTMLAttributes } from 'react';
import { useFieldControl } from './Field';
import { cx } from './cx';
import './Slider.css';

export interface SliderProps
  extends Omit<
    InputHTMLAttributes<HTMLInputElement>,
    'type' | 'value' | 'onChange' | 'min' | 'max' | 'step'
  > {
  value: number;
  /** Called with the new value while the thumb moves. */
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Turns the value into the text of the value label, e.g. `formatDuration`. */
  format?: (value: number) => string;
  /** Hides the value label next to the track. */
  hideValue?: boolean;
}

/** Range slider with the current value shown next to it. */
export const Slider = forwardRef<HTMLInputElement, SliderProps>(function Slider(
  {
    value,
    onChange,
    min = 0,
    max = 100,
    step = 1,
    format = String,
    hideValue = false,
    className,
    ...rest
  },
  ref,
) {
  const field = useFieldControl(rest);
  const fraction = max > min ? Math.min(1, Math.max(0, (value - min) / (max - min))) : 0;
  const text = format(value);

  return (
    <div className={cx('sb-slider', className)}>
      <input
        ref={ref}
        type="range"
        className="sb-slider__input"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-valuetext={text}
        style={{ '--sb-slider-fill': `${fraction * 100}%` } as CSSProperties}
        onChange={(event) => onChange(Number(event.target.value))}
        {...rest}
        {...field}
      />
      {!hideValue && (
        <output className="sb-slider__value" htmlFor={field.id}>
          {text}
        </output>
      )}
    </div>
  );
});
