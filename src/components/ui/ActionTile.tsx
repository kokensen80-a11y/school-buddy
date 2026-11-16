import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from 'react';
import { cx } from './cx';
import './ActionTile.css';

export interface ActionTileProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** Icon shown above the label. */
  icon: ReactNode;
  /** Short label, one or two words. */
  label: string;
  /** `primary` is solid white (one per row), `secondary` translucent grey. */
  variant?: 'primary' | 'secondary';
}

/** A tile with an icon above a label; place two to four of them in an `ActionTileRow`. */
export const ActionTile = forwardRef<HTMLButtonElement, ActionTileProps>(function ActionTile(
  { icon, label, variant = 'secondary', className, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx('sb-action-tile', `sb-action-tile--${variant}`, className)}
      {...rest}
    >
      <span className="sb-action-tile__icon" aria-hidden="true">
        {icon}
      </span>
      <span className="sb-action-tile__label">{label}</span>
    </button>
  );
});

export interface ActionTileRowProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

/** Lays `ActionTile`s out as a row of equal-width tiles. */
export function ActionTileRow({ children, className, ...rest }: ActionTileRowProps) {
  return (
    <div className={cx('sb-action-tile-row', className)} {...rest}>
      {children}
    </div>
  );
}
