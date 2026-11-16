import { useId, type HTMLAttributes, type ReactNode } from 'react';
import { cx } from './cx';
import './Section.css';

export interface SectionProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  /** Small muted label above the hairline, e.g. "Leerstof". */
  label: string;
  /** Control on the right of the label, e.g. a ghost `Button` or a count. */
  trailing?: ReactNode;
  children: ReactNode;
}

/** A labelled block of content: muted label, hairline divider, then the children. */
export function Section({ label, trailing, children, className, ...rest }: SectionProps) {
  const labelId = useId();
  return (
    <section className={cx('sb-section', className)} aria-labelledby={labelId} {...rest}>
      <div className="sb-section__header">
        <h2 id={labelId} className="sb-section__label">
          {label}
        </h2>
        {trailing != null && <div className="sb-section__trailing">{trailing}</div>}
      </div>
      <div className="sb-section__body">{children}</div>
    </section>
  );
}

export interface DividerProps {
  className?: string;
}

/** Hairline separator. */
export function Divider({ className }: DividerProps) {
  return <hr className={cx('sb-divider', className)} />;
}
