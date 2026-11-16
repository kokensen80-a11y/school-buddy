import type { ReactNode } from 'react';
import { ChevronLeft } from 'lucide-react';
import { GlassPill, IconButton } from './IconButton';
import { cx } from './cx';
import './TopBar.css';

export interface TopBarAction {
  /** Stable key; defaults to the label. */
  key?: string;
  /** The icon, e.g. `<Pencil />`. */
  icon: ReactNode;
  /** Accessible name of the action, e.g. "Bewerken". */
  label: string;
  onClick: () => void;
  disabled?: boolean;
  /** Count shown on the icon (hidden for 0). */
  badge?: number;
}

export interface TopBarProps {
  /** Screen title; a single line, truncated with an ellipsis. */
  title?: string;
  /** Shows the round glass back button and is called when it is pressed. */
  onBack?: () => void;
  /** Accessible name of the back button. */
  backLabel?: string;
  /** One or two icon actions, grouped in a single glass pill on the right. */
  actions?: TopBarAction[];
  className?: string;
}

/**
 * The floating bar of a detail screen: glass back button, title, glass action pill.
 * Pass it to `Screen` through the `topBar` prop, which pins it and pads the content.
 */
export function TopBar({ title, onBack, backLabel = 'Terug', actions = [], className }: TopBarProps) {
  return (
    <div className={cx('sb-top-bar', className)}>
      {onBack && (
        <IconButton aria-label={backLabel} onClick={onBack}>
          <ChevronLeft />
        </IconButton>
      )}
      {title ? <h1 className="sb-top-bar__title">{title}</h1> : <span className="sb-top-bar__title" />}
      {actions.length > 0 && (
        <GlassPill className="sb-top-bar__actions">
          {actions.map((action) => (
            <IconButton
              key={action.key ?? action.label}
              variant="plain"
              aria-label={action.label}
              onClick={action.onClick}
              disabled={action.disabled}
              badge={action.badge}
            >
              {action.icon}
            </IconButton>
          ))}
        </GlassPill>
      )}
    </div>
  );
}

export interface LargeHeaderProps {
  /** The big title, e.g. "Vandaag". */
  title: string;
  /** Muted line under the title, e.g. the date. */
  subtitle?: ReactNode;
  /** Control on the right, level with the title, e.g. an `IconButton` or `Avatar`. */
  trailing?: ReactNode;
  className?: string;
}

/**
 * Large title for the four tab-root screens, like an iOS large title. It is part of
 * the scrolling content: put it first inside a `Screen` that has no `topBar`.
 */
export function LargeHeader({ title, subtitle, trailing, className }: LargeHeaderProps) {
  return (
    <header className={cx('sb-large-header', className)}>
      <div className="sb-large-header__text">
        <h1 className="sb-large-header__title">{title}</h1>
        {subtitle != null && <p className="sb-large-header__subtitle">{subtitle}</p>}
      </div>
      {trailing != null && <div className="sb-large-header__trailing">{trailing}</div>}
    </header>
  );
}
