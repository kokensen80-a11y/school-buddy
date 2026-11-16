import type { CSSProperties, ReactNode } from 'react';
import type { SubjectColor } from '../../types';
import { cx } from './cx';
import './Subject.css';

const subjectStyle = (color: SubjectColor) =>
  ({ '--sb-subject-color': `var(--subject-${color})` }) as CSSProperties;

export interface SubjectDotProps {
  color: SubjectColor;
  /** Diameter in pixels. */
  size?: number;
  className?: string;
}

/** Decorative dot in the colour of a subject. Always show the subject name next to it. */
export function SubjectDot({ color, size = 10, className }: SubjectDotProps) {
  return (
    <span
      className={cx('sb-subject-dot', className)}
      style={{ ...subjectStyle(color), width: size, height: size }}
      aria-hidden="true"
    />
  );
}

export interface SubjectTagProps {
  color: SubjectColor;
  /** The subject name, e.g. "Biologie". */
  children: ReactNode;
  className?: string;
}

/** Pill with a subject's colour dot and name, softly tinted in that colour. */
export function SubjectTag({ color, children, className }: SubjectTagProps) {
  return (
    <span className={cx('sb-subject-tag', className)} style={subjectStyle(color)}>
      <span className="sb-subject-tag__dot" aria-hidden="true" />
      <span className="sb-subject-tag__label">{children}</span>
    </span>
  );
}
