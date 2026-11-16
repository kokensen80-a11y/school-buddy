import type { ReactNode } from 'react';
import { CircleCheck, Info, TriangleExclamationPoint } from 'lucide-react';
import { cx } from './cx';
import './Callout.css';

export interface CalloutProps {
  /** Sets the colour and the default icon. */
  tone?: 'info' | 'success' | 'warning' | 'danger';
  /** Short bold line. */
  title?: string;
  /** The message. */
  children?: ReactNode;
  /** Replaces the default icon of the tone. */
  icon?: ReactNode;
  /** Usually a small `Button`, shown under the message. */
  action?: ReactNode;
  className?: string;
}

const TONE_ICON = {
  info: <Info />,
  success: <CircleCheck />,
  warning: <TriangleExclamationPoint />,
  danger: <TriangleExclamationPoint />,
} as const;

/** Inline notice inside a screen, e.g. a planning warning ("Te weinig tijd voor deze toets"). */
export function Callout({ tone = 'info', title, children, icon, action, className }: CalloutProps) {
  return (
    <div className={cx('sb-callout', `sb-callout--${tone}`, className)}>
      <span className="sb-callout__icon" aria-hidden="true">
        {icon ?? TONE_ICON[tone]}
      </span>
      <div className="sb-callout__body">
        {title && <p className="sb-callout__title">{title}</p>}
        {children != null && <div className="sb-callout__text">{children}</div>}
        {action != null && <div className="sb-callout__action">{action}</div>}
      </div>
    </div>
  );
}
