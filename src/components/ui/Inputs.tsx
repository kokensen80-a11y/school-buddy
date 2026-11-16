import {
  forwardRef,
  useCallback,
  useLayoutEffect,
  useRef,
  type InputHTMLAttributes,
  type ReactNode,
  type Ref,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { ChevronDown } from 'lucide-react';
import { useFieldControl } from './Field';
import { cx } from './cx';
import './Inputs.css';

export interface TextInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> {
  value?: string;
  /** Called with the new text on every change. */
  onChange?: (value: string) => void;
}

/** Single-line text field. Inside a `Field` it is labelled and described automatically. */
export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  { onChange, className, type = 'text', ...rest },
  ref,
) {
  const field = useFieldControl(rest);
  return (
    <input
      ref={ref}
      type={type}
      className={cx('sb-control', className)}
      onChange={(event) => onChange?.(event.target.value)}
      {...rest}
      {...field}
    />
  );
});

export interface TextAreaProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> {
  value?: string;
  /** Called with the new text on every change. */
  onChange?: (value: string) => void;
  /** Height when empty, in lines of text. */
  minRows?: number;
}

/** Multi-line text field that grows with its content (up to 40% of the screen, then it scrolls). */
export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  { onChange, minRows = 3, className, value, ...rest },
  ref,
) {
  const innerRef = useRef<HTMLTextAreaElement | null>(null);

  const setRefs = useCallback(
    (node: HTMLTextAreaElement | null) => {
      innerRef.current = node;
      if (typeof ref === 'function') ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );

  const fitToContent = useCallback(() => {
    const node = innerRef.current;
    if (!node) return;
    const borders = node.offsetHeight - node.clientHeight;
    node.style.height = 'auto';
    node.style.height = `${node.scrollHeight + borders}px`;
  }, []);

  useLayoutEffect(fitToContent, [fitToContent, value, minRows]);

  const field = useFieldControl(rest);
  return (
    <textarea
      ref={setRefs}
      rows={minRows}
      value={value}
      className={cx('sb-control', className)}
      onChange={(event) => onChange?.(event.target.value)}
      onInput={fitToContent}
      {...rest}
      {...field}
    />
  );
});

export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
  disabled?: boolean;
}

export interface SelectProps<T extends string = string>
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'value' | 'onChange' | 'multiple'> {
  /** The selected value, or `''` when nothing is chosen yet. */
  value?: T | '';
  /** Called with the value of the chosen option. */
  onChange?: (value: T) => void;
  /** The choices. Alternatively pass `<option>` elements as children. */
  options?: ReadonlyArray<SelectOption<T>>;
  /** Shown while the value is `''`; it cannot be picked itself. */
  placeholder?: string;
  children?: ReactNode;
  ref?: Ref<HTMLSelectElement>;
}

/** Native select in the style of the other fields: the phone shows its own picker. */
export function Select<T extends string = string>({
  value,
  onChange,
  options,
  placeholder,
  children,
  className,
  ref,
  ...rest
}: SelectProps<T>) {
  const field = useFieldControl(rest);
  return (
    <span className="sb-select">
      <select
        ref={ref}
        value={value}
        className={cx(
          'sb-control',
          'sb-select__control',
          placeholder != null && value === '' && 'sb-select__control--placeholder',
          className,
        )}
        onChange={(event) => onChange?.(event.target.value as T)}
        {...rest}
        {...field}
      >
        {placeholder != null && (
          <option value="" disabled hidden>
            {placeholder}
          </option>
        )}
        {options?.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
        {children}
      </select>
      <ChevronDown className="sb-select__chevron" aria-hidden="true" />
    </span>
  );
}

export interface DateInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange' | 'min' | 'max'> {
  /** The date as 'YYYY-MM-DD', or `''` when empty. */
  value?: string;
  /** Called with 'YYYY-MM-DD', or `''` when the field is cleared. */
  onChange?: (value: string) => void;
  /** Earliest and latest allowed date, as 'YYYY-MM-DD'. */
  min?: string;
  max?: string;
}

/** Native date picker in the style of the other fields. */
export const DateInput = forwardRef<HTMLInputElement, DateInputProps>(function DateInput(
  { onChange, className, ...rest },
  ref,
) {
  const field = useFieldControl(rest);
  return (
    <input
      ref={ref}
      type="date"
      className={cx('sb-control', className)}
      onChange={(event) => onChange?.(event.target.value)}
      {...rest}
      {...field}
    />
  );
});

export interface TimeInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange' | 'min' | 'max'> {
  /** The time as 'HH:mm' (24h), or `''` when empty. */
  value?: string;
  /** Called with 'HH:mm', or `''` when the field is cleared. */
  onChange?: (value: string) => void;
  /** Earliest and latest allowed time, as 'HH:mm'. */
  min?: string;
  max?: string;
}

/** Native time picker in the style of the other fields. */
export const TimeInput = forwardRef<HTMLInputElement, TimeInputProps>(function TimeInput(
  { onChange, className, ...rest },
  ref,
) {
  const field = useFieldControl(rest);
  return (
    <input
      ref={ref}
      type="time"
      className={cx('sb-control', className)}
      // Browsers add seconds when a step below a minute is set; the kit always reports 'HH:mm'.
      onChange={(event) => onChange?.(event.target.value.slice(0, 5))}
      {...rest}
      {...field}
    />
  );
});
