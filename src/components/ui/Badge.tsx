import { cx } from './cx';
import './Badge.css';

export interface BadgeProps {
  /** The number to show. Nothing is rendered for 0 or less. */
  count: number;
  /** Counts above this are shown as "99+". */
  max?: number;
  tone?: 'accent' | 'neutral' | 'danger';
  className?: string;
}

/** Small count bubble, e.g. unread notifications or open study blocks. */
export function Badge({ count, max = 99, tone = 'accent', className }: BadgeProps) {
  if (!(count > 0)) return null;
  return (
    <span className={cx('sb-badge', `sb-badge--${tone}`, className)}>
      {count > max ? `${max}+` : count}
    </span>
  );
}
