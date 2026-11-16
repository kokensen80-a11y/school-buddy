import { forwardRef, type CSSProperties, type HTMLAttributes, type ReactNode } from 'react';
import { cx } from './cx';
import './Stack.css';

export interface StackProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  /** `column` stacks vertically (default), `row` lays out horizontally. */
  direction?: 'column' | 'row';
  /** Gap between children as a step of the spacing scale (`3` = 12px). */
  gap?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 8 | 10 | 12;
  align?: 'start' | 'center' | 'end' | 'stretch' | 'baseline';
  justify?: 'start' | 'center' | 'end' | 'between';
  /** Lets a row wrap onto several lines, e.g. for chips. */
  wrap?: boolean;
}

const FLEX_VALUE = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  stretch: 'stretch',
  baseline: 'baseline',
  between: 'space-between',
} as const;

/** Flex layout helper: spaces its children with a gap from the spacing scale. */
export const Stack = forwardRef<HTMLDivElement, StackProps>(function Stack(
  { children, direction = 'column', gap = 3, align, justify, wrap = false, className, style, ...rest },
  ref,
) {
  const stackStyle: CSSProperties = {
    gap: `var(--space-${gap})`,
    alignItems: align && FLEX_VALUE[align],
    justifyContent: justify && FLEX_VALUE[justify],
    ...style,
  };
  return (
    <div
      ref={ref}
      className={cx('sb-stack', `sb-stack--${direction}`, wrap && 'sb-stack--wrap', className)}
      style={stackStyle}
      {...rest}
    >
      {children}
    </div>
  );
});
