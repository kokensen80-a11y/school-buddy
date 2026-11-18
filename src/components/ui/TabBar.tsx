import type { CSSProperties, ReactNode } from 'react';
import { Badge } from './Badge';
import { cx } from './cx';
import './TabBar.css';

export interface TabBarItem<K extends string = string> {
  key: K;
  /** Short label under the icon. */
  label: string;
  /** Icon of the tab, e.g. `<House />`. */
  icon: ReactNode;
  /** Icon shown while the tab is active. Without it the normal icon gets a soft fill. */
  activeIcon?: ReactNode;
  /** Count shown on the icon (hidden for 0). */
  badge?: number;
}

export interface TabBarProps<K extends string = string> {
  /** Two to five tabs. */
  items: ReadonlyArray<TabBarItem<K>>;
  /** Key of the active tab. */
  value: K;
  /** Called with the key of the pressed tab (also when it is already active). */
  onChange: (key: K) => void;
  /** Accessible name of the navigation landmark. */
  'aria-label'?: string;
  /** Round button in the middle of the bar, e.g. "add". */
  center?: { label: string; icon: ReactNode; onClick: () => void };
  className?: string;
}

/**
 * The floating glass tab bar, fixed near the bottom and centred. Render it once in
 * the app shell, next to the screens, and give tab-root screens `withTabBar`.
 */
export function TabBar<K extends string = string>({
  items,
  value,
  onChange,
  'aria-label': ariaLabel = 'Hoofdmenu',
  center,
  className,
}: TabBarProps<K>) {
  const half = Math.ceil(items.length / 2);
  const style = { '--sb-tab-count': items.length + (center ? 1 : 0) } as CSSProperties;

  const tab = (item: TabBarItem<K>) => {
    const active = item.key === value;
    const badge = item.badge ?? 0;
    return (
      <button
        key={item.key}
        type="button"
        className={cx('sb-tab-bar__tab', active && 'sb-tab-bar__tab--active')}
        aria-current={active ? 'page' : undefined}
        aria-label={badge > 0 ? `${item.label} (${badge})` : undefined}
        onClick={() => onChange(item.key)}
      >
        <span
          className={cx('sb-tab-bar__icon', active && item.activeIcon == null && 'sb-tab-bar__icon--soft-fill')}
          aria-hidden="true"
        >
          {active && item.activeIcon != null ? item.activeIcon : item.icon}
          {badge > 0 && <Badge count={badge} className="sb-tab-bar__badge" />}
        </span>
        <span className="sb-tab-bar__label">{item.label}</span>
      </button>
    );
  };

  return (
    <nav className={cx('sb-tab-bar', className)} aria-label={ariaLabel}>
      <div className="sb-tab-bar__inner" style={style}>
        {items.slice(0, half).map(tab)}
        {center && (
          <div className="sb-tab-bar__center-slot">
            <button type="button" className="sb-tab-bar__center" aria-label={center.label} onClick={center.onClick}>
              {center.icon}
            </button>
          </div>
        )}
        {items.slice(half).map(tab)}
      </div>
    </nav>
  );
}
