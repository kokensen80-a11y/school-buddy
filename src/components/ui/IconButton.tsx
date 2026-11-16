import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from 'react';
import { Badge } from './Badge';
import { cx } from './cx';
import './IconButton.css';

export interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'children'> {
  /** What the button does, e.g. "Terug". Required: the icon alone says nothing to a screen reader. */
  'aria-label': string;
  /** The icon, e.g. `<ChevronLeft />`. It is sized by the button. */
  children: ReactNode;
  /** `glass` is a floating glass circle; `plain` has no surface, for use inside a `GlassPill`. */
  variant?: 'glass' | 'plain';
  /** `md` is 44px, `sm` is 36px with an invisible 44px touch area. */
  size?: 'md' | 'sm';
  /** Count shown in a small bubble on the corner (hidden for 0). */
  badge?: number;
}

/** Round icon-only button. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { children, variant = 'glass', size = 'md', badge = 0, className, type = 'button', ...rest },
  ref,
) {
  const label = badge > 0 ? `${rest['aria-label']} (${badge})` : rest['aria-label'];
  return (
    <button
      ref={ref}
      type={type}
      className={cx(
        'sb-icon-button',
        `sb-icon-button--${variant}`,
        `sb-icon-button--${size}`,
        variant === 'glass' && 'sb-glass',
        className,
      )}
      {...rest}
      aria-label={label}
    >
      <span className="sb-icon-button__icon" aria-hidden="true">
        {children}
      </span>
      {badge > 0 && <Badge count={badge} className="sb-icon-button__badge" />}
    </button>
  );
});

export interface GlassPillProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

/** A floating glass capsule that groups a few controls, like the action pill of the top bar. */
export const GlassPill = forwardRef<HTMLDivElement, GlassPillProps>(function GlassPill(
  { children, className, ...rest },
  ref,
) {
  return (
    <div ref={ref} className={cx('sb-glass-pill', 'sb-glass', className)} {...rest}>
      {children}
    </div>
  );
});
