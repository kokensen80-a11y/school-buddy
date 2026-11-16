import type { CSSProperties } from 'react';
import { cx } from './cx';
import { resolveColor, type ColorValue } from './color';
import './AmbientBackground.css';

export interface AmbientBackgroundProps {
  /**
   * Colour the background is tinted with: a subject colour name or any CSS colour.
   * Only the hue and saturation are used, so every tint stays dark enough for white text.
   * Defaults to the School Buddy green.
   */
  tint?: ColorValue;
  className?: string;
}

/**
 * The soft, dark ambient gradient behind every screen. Fixed and full-bleed, purely
 * decorative. `Screen` renders one for you; use it directly only outside a `Screen`.
 */
export function AmbientBackground({ tint, className }: AmbientBackgroundProps) {
  const style = tint
    ? ({ '--sb-ambient-tint': resolveColor(tint) } as CSSProperties)
    : undefined;
  return <div className={cx('sb-ambient', className)} style={style} aria-hidden="true" />;
}
