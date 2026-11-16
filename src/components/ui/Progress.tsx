import type { CSSProperties, ReactNode } from 'react';
import { cx } from './cx';
import { resolveColor, type ColorValue } from './color';
import './Progress.css';

const clamp01 = (value: number) => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0);

const colorStyle = (color: ColorValue | undefined) =>
  color == null ? undefined : ({ '--sb-progress-color': resolveColor(color) } as CSSProperties);

export interface ProgressBarProps {
  /** Progress from 0 to 1. */
  value: number;
  /** Colour of the filled part: a subject colour name or any CSS colour. Default: the green accent. */
  color?: ColorValue;
  /** What the bar measures, e.g. "Voortgang Biologie". */
  'aria-label'?: string;
  'aria-labelledby'?: string;
  className?: string;
}

/** Thin horizontal progress bar. */
export function ProgressBar({ value, color, className, ...aria }: ProgressBarProps) {
  const fraction = clamp01(value);
  return (
    <div
      className={cx('sb-progress-bar', className)}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(fraction * 100)}
      style={colorStyle(color)}
      {...aria}
    >
      <div className="sb-progress-bar__fill" style={{ transform: `scaleX(${fraction})` }} />
    </div>
  );
}

export interface ProgressRingProps {
  /** Progress from 0 to 1. */
  value: number;
  /** Colour of the arc: a subject colour name or any CSS colour. Defaults to the green accent. */
  color?: ColorValue;
  /** Outer diameter in pixels. */
  size?: number;
  /** Width of the ring in pixels. */
  thickness?: number;
  /** Centred inside the ring, e.g. "60%" or an icon. */
  children?: ReactNode;
  /** What the ring measures, e.g. "Voortgang Biologie". */
  'aria-label'?: string;
  'aria-labelledby'?: string;
  className?: string;
}

/** Circular progress indicator with room for a short label in the middle. */
export function ProgressRing({
  value,
  color,
  size = 48,
  thickness = 5,
  children,
  className,
  ...aria
}: ProgressRingProps) {
  const fraction = clamp01(value);
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  return (
    <div
      className={cx('sb-progress-ring', className)}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(fraction * 100)}
      style={{ ...colorStyle(color), width: size, height: size }}
      {...aria}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle
          className="sb-progress-ring__track"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={thickness}
        />
        <circle
          className="sb-progress-ring__arc"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={thickness}
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - fraction)}
        />
      </svg>
      {children != null && <span className="sb-progress-ring__label">{children}</span>}
    </div>
  );
}
