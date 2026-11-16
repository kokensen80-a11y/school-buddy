import { forwardRef, type ButtonHTMLAttributes, type MouseEvent, type ReactNode } from 'react';
import { Spinner } from './Spinner';
import { cx } from './cx';
import './Button.css';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** `primary` is white with black text, `secondary` translucent, `ghost` text only, `danger` red. */
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  /** `md` is 44px high, `lg` 52px, `sm` 36px (44px touch area) for section headers and callouts. */
  size?: 'sm' | 'md' | 'lg';
  /** Stretches the button to the full width of its container. */
  block?: boolean;
  /** Icon shown before the label. */
  icon?: ReactNode;
  /** Shows a spinner over the label and ignores presses; the button keeps its size and focus. */
  loading?: boolean;
}

/** Text button. Defaults to `type="button"`, so set `type="submit"` inside a form. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    block = false,
    icon,
    loading = false,
    className,
    children,
    type = 'button',
    onClick,
    ...rest
  },
  ref,
) {
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (loading) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  };

  return (
    <button
      ref={ref}
      type={type}
      className={cx(
        'sb-button',
        `sb-button--${variant}`,
        `sb-button--${size}`,
        block && 'sb-button--block',
        loading && 'sb-button--loading',
        className,
      )}
      aria-busy={loading || undefined}
      aria-disabled={loading || undefined}
      onClick={handleClick}
      {...rest}
    >
      <span className="sb-button__content">
        {icon != null && (
          <span className="sb-button__icon" aria-hidden="true">
            {icon}
          </span>
        )}
        {children != null && <span className="sb-button__label">{children}</span>}
      </span>
      {loading && <Spinner className="sb-button__spinner" label="Bezig…" />}
    </button>
  );
});
