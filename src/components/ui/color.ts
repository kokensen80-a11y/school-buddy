import type { SubjectColor } from '../../types';
import { SUBJECT_COLORS } from '../../lib/labels';

/**
 * A colour accepted by the kit: one of the ten subject colour names (mapped to the
 * subject palette, not to the CSS keyword of the same name) or any CSS colour value.
 */
export type ColorValue = SubjectColor | (string & {});

/** Turns a `ColorValue` into a CSS colour: subject names become their palette token. */
export function resolveColor(color: ColorValue): string {
  return Object.hasOwn(SUBJECT_COLORS, color) ? `var(--subject-${color})` : color;
}
