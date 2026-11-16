import { forwardRef, type HTMLAttributes, type ReactNode, type Ref } from 'react';
import { cx } from './cx';
import './Card.css';

export interface CardProps extends Omit<HTMLAttributes<HTMLElement>, 'onClick'> {
  children: ReactNode;
  /** Makes the whole card a button with press feedback. Do not nest other buttons inside. */
  onClick?: () => void;
  /** Inner padding. Use `none` for a card that holds `ListRow`s. */
  padding?: 'none' | 'sm' | 'md' | 'lg';
  /** Only for a clickable card. */
  disabled?: boolean;
}

/** Rounded glass panel that groups related content. */
export const Card = forwardRef<HTMLElement, CardProps>(function Card(
  { children, onClick, padding = 'md', disabled, className, ...rest },
  ref,
) {
  const classes = cx(
    'sb-card',
    `sb-card--pad-${padding}`,
    onClick && 'sb-card--interactive',
    className,
  );
  if (onClick) {
    return (
      <button
        ref={ref as Ref<HTMLButtonElement>}
        type="button"
        className={classes}
        onClick={onClick}
        disabled={disabled}
        {...rest}
      >
        {children}
      </button>
    );
  }
  return (
    <div ref={ref as Ref<HTMLDivElement>} className={classes} {...rest}>
      {children}
    </div>
  );
});
