import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from './cx';
import './Typography.css';

export interface HeadingProps extends HTMLAttributes<HTMLHeadingElement> {
  children: ReactNode;
  /** Semantic level of the heading element (h1–h4). */
  level?: 1 | 2 | 3 | 4;
  /** Visual size: `title` 28px bold, `heading` 22px bold, `subheading` 17px semibold. */
  size?: 'title' | 'heading' | 'subheading';
}

/** Heading in one of the three sizes of the type scale. */
export function Heading({ children, level = 2, size = 'heading', className, ...rest }: HeadingProps) {
  const Tag = `h${level}` as const;
  return (
    <Tag className={cx('sb-heading', `sb-heading--${size}`, className)} {...rest}>
      {children}
    </Tag>
  );
}

export interface TextProps extends HTMLAttributes<HTMLElement> {
  children: ReactNode;
  /** Element to render. */
  as?: 'p' | 'span' | 'div';
  /** `base` 17px, `md` 15px, `sm` 13px, `xs` 11px. */
  size?: 'base' | 'md' | 'sm' | 'xs';
  /** Colour. `tertiary` is for decorative text only (low contrast). */
  tone?: 'primary' | 'secondary' | 'tertiary' | 'accent' | 'warning' | 'danger';
  weight?: 'regular' | 'medium' | 'semibold' | 'bold';
  /** Keeps the text on one line and cuts it off with an ellipsis. */
  truncate?: boolean;
}

/** Body text in the type scale, with the muted tones of the design. */
export function Text({
  children,
  as: Tag = 'p',
  size = 'base',
  tone = 'primary',
  weight = 'regular',
  truncate = false,
  className,
  ...rest
}: TextProps) {
  return (
    <Tag
      className={cx(
        'sb-text',
        `sb-text--${size}`,
        `sb-text--${tone}`,
        `sb-text--${weight}`,
        truncate && 'sb-text--truncate',
        className,
      )}
      {...rest}
    >
      {children}
    </Tag>
  );
}
