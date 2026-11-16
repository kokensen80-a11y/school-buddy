import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { cx } from './cx';
import './ListRow.css';

export interface ListRowProps {
  title: ReactNode;
  /** Muted second line. */
  subtitle?: ReactNode;
  /** Slot before the text: an icon, `SubjectDot`, `Avatar` or `CheckCircle`. */
  leading?: ReactNode;
  /** Slot after the text: a value, `Badge`, `Switch`… */
  trailing?: ReactNode;
  /** Shows a chevron at the end, for rows that open another screen. */
  chevron?: boolean;
  /**
   * Makes the row pressable. The whole row is the touch target, while controls in the
   * leading and trailing slots (a `CheckCircle`, a `Switch`) stay separately clickable.
   */
  onClick?: () => void;
  /** Red title, for actions such as "Verwijderen". */
  destructive?: boolean;
  /** Only for a pressable row. */
  disabled?: boolean;
  /**
   * Renders the row as a `<label>`: pressing anywhere on it toggles the single form
   * control placed in a slot (a `Switch` or `CheckCircle`), and the title names it.
   * Do not combine with `onClick`.
   */
  asLabel?: boolean;
  className?: string;
}

/**
 * One row of a list or a settings group. Consecutive rows are separated by a hairline.
 * Works on its own under a `Section` and inside a `Card` with `padding="none"`.
 */
export function ListRow({
  title,
  subtitle,
  leading,
  trailing,
  chevron = false,
  onClick,
  destructive = false,
  disabled = false,
  asLabel = false,
  className,
}: ListRowProps) {
  const text = (
    <>
      <span className="sb-list-row__title">{title}</span>
      {subtitle != null && <span className="sb-list-row__subtitle">{subtitle}</span>}
    </>
  );
  const Root = asLabel ? 'label' : 'div';

  return (
    <Root
      className={cx(
        'sb-list-row',
        onClick && 'sb-list-row--interactive',
        asLabel && 'sb-list-row--label',
        destructive && 'sb-list-row--destructive',
        className,
      )}
    >
      {leading != null && <span className="sb-list-row__leading">{leading}</span>}
      {onClick ? (
        <button type="button" className="sb-list-row__main" onClick={onClick} disabled={disabled}>
          {text}
        </button>
      ) : (
        <span className="sb-list-row__main">{text}</span>
      )}
      {trailing != null && <span className="sb-list-row__trailing">{trailing}</span>}
      {chevron && <ChevronRight className="sb-list-row__chevron" aria-hidden="true" />}
    </Root>
  );
}
