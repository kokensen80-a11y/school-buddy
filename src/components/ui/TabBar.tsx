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
  className,
}: TabBarProps<K>) {
  const activeIndex = items.findIndex((item) => item.key === value);
  const style = {
    '--sb-tab-count': items.length,
    '--sb-tab-index': Math.max(activeIndex, 0),
  } as CSSProperties;

  return (
    <nav className={cx('sb-tab-bar', className)} aria-label={ariaLabel}>
      <div className="sb-tab-bar__pill sb-glass sb-glass--smoked" style={style}>
        {activeIndex >= 0 && <span className="sb-tab-bar__indicator" aria-hidden="true" />}
        {items.map((item) => {
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
                className={cx(
                  'sb-tab-bar__icon',
                  active && item.activeIcon == null && 'sb-tab-bar__icon--soft-fill',
                )}
                aria-hidden="true"
              >
                {active && item.activeIcon != null ? item.activeIcon : item.icon}
                {badge > 0 && <Badge count={badge} className="sb-tab-bar__badge" />}
              </span>
              <span className="sb-tab-bar__label">{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
