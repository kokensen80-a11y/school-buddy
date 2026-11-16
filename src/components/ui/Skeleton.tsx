import type { CSSProperties } from 'react';
import { cx } from './cx';
import './Skeleton.css';

export interface SkeletonProps {
  /** Any CSS width; a number is pixels. Defaults to the full width. */
  width?: number | string;
  /** Any CSS height; a number is pixels. Defaults to one line of body text. */
  height?: number | string;
  /** Corner rounding: `text` for lines, `card` for panels, `circle` for avatars. */
  shape?: 'text' | 'card' | 'circle';
  className?: string;
}

/** Shimmering placeholder shown while content is loading. Hidden from screen readers. */
export function Skeleton({ width, height, shape = 'text', className }: SkeletonProps) {
  const style: CSSProperties = { width, height };
  return (
    <span
      className={cx('sb-skeleton', `sb-skeleton--${shape}`, className)}
      style={style}
      aria-hidden="true"
    />
  );
}
