import type { ReactNode } from 'react';
import { cx } from './cx';
import './EmptyState.css';

export interface EmptyStateProps {
  /** Icon shown in a soft glass circle. */
  icon?: ReactNode;
  title: string;
  /** One or two friendly sentences that say what to do next. */
  text?: ReactNode;
  /** Usually a `Button`. */
  action?: ReactNode;
  className?: string;
}

/** Centred placeholder for a list or screen that has nothing to show yet. */
export function EmptyState({ icon, title, text, action, className }: EmptyStateProps) {
  return (
    <div className={cx('sb-empty-state', className)}>
      {icon != null && (
        <div className="sb-empty-state__icon" aria-hidden="true">
          {icon}
        </div>
      )}
      <h2 className="sb-empty-state__title">{title}</h2>
      {text != null && <p className="sb-empty-state__text">{text}</p>}
      {action != null && <div className="sb-empty-state__action">{action}</div>}
    </div>
  );
}
