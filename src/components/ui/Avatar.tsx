import type { CSSProperties } from 'react';
import { SUBJECT_COLOR_ORDER } from '../../lib/labels';
import { cx } from './cx';
import './Avatar.css';

export interface AvatarProps {
  /** Full name; the initials and the colour are derived from it. */
  name: string;
  /** Diameter in pixels. */
  size?: number;
  className?: string;
}

/** First letters of the first and last word of a name: "Sanne de Vries" → "SV". */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const first = Array.from(words[0])[0];
  const last = words.length > 1 ? Array.from(words[words.length - 1])[0] : '';
  return (first + last).toLocaleUpperCase('nl-NL');
}

/** Picks one of the subject colours for a name; the same name always gets the same colour. */
function colorOf(name: string): string {
  let hash = 0;
  for (const char of name.trim().toLowerCase()) hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
  return `var(--subject-${SUBJECT_COLOR_ORDER[hash % SUBJECT_COLOR_ORDER.length]})`;
}

/** The initials of a person on a soft coloured circle. */
export function Avatar({ name, size = 40, className }: AvatarProps) {
  const style = {
    '--sb-avatar-color': colorOf(name),
    width: size,
    height: size,
    fontSize: Math.round(size * 0.4),
  } as CSSProperties;
  return (
    <span className={cx('sb-avatar', className)} style={style} role="img" aria-label={name}>
      <span aria-hidden="true">{initialsOf(name)}</span>
    </span>
  );
}
