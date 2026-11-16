import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { AmbientBackground } from './AmbientBackground';
import type { ColorValue } from './color';
import { cx } from './cx';
import './Screen.css';

export interface ScreenProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  /** Tint of the ambient background: a subject colour name or any CSS colour. */
  tint?: ColorValue;
  /** Reserves room at the bottom so the floating `TabBar` never covers the last content. */
  withTabBar?: boolean;
  /** Bar that floats at the top while the content scrolls underneath, usually a `TopBar`. */
  topBar?: ReactNode;
  /** Content pinned above the bottom edge, e.g. the save button of a form. */
  bottomBar?: ReactNode;
  /** Set to false for full-bleed content; add the side gutter yourself with `var(--gutter)`. */
  padded?: boolean;
}

/**
 * One full screen of the app: ambient background, a scroll container that fills the
 * viewport, and optional floating bars. Handles safe areas, the padding under the top
 * bar and above the tab bar, and keeps content in a centred column on wide screens.
 *
 * The forwarded ref points at the scroll container (e.g. to reset `scrollTop`).
 */
export const Screen = forwardRef<HTMLDivElement, ScreenProps>(function Screen(
  { children, tint, withTabBar = false, topBar, bottomBar, padded = true, className, ...rest },
  ref,
) {
  return (
    <div
      className={cx(
        'sb-screen',
        topBar != null && 'sb-screen--top-bar',
        withTabBar && 'sb-screen--tab-bar',
        bottomBar != null && 'sb-screen--bottom-bar',
        padded && 'sb-screen--padded',
        className,
      )}
      {...rest}
    >
      <AmbientBackground tint={tint} />
      {/* First in the DOM, so the bar comes first for keyboard and screen-reader users. */}
      {topBar != null && (
        <header className="sb-screen__top">
          <div className="sb-screen__top-inner">{topBar}</div>
        </header>
      )}
      <div className="sb-screen__scroll" ref={ref}>
        <div className="sb-screen__column">
          <main className="sb-screen__content">{children}</main>
          {bottomBar != null && <div className="sb-screen__bottom">{bottomBar}</div>}
        </div>
      </div>
      <div className="sb-screen__scrim" aria-hidden="true" />
    </div>
  );
});
