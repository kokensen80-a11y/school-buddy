/**
 * The School Buddy brand mark: a friendly face whose smile is an open book.
 * The artwork mirrors public/favicon.svg; change both together (and re-run `npm run icons`).
 */
import { useId, type CSSProperties } from 'react';

const APP_NAME = 'School Buddy';

const SYSTEM_FONT =
  "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

/** Both pages of the open book: flat-topped wings whose lower edge is one smile arc. */
const BOOK_PATH =
  'M243 288Q243 278 234 272.1A211.6 211.6 0 0 0 122 240A22 22 0 0 0 100 262L100 309.8A26 26 0 0 0 109.6 330A232 232 0 0 0 233 380.9Q243 381.6 243 371.6Z' +
  'M269 288Q269 278 278 272.1A211.6 211.6 0 0 1 390 240A22 22 0 0 1 412 262L412 309.8A26 26 0 0 1 402.4 330A232 232 0 0 1 279 380.9Q269 381.6 269 371.6Z';

export interface LogoMarkProps {
  /** Width and height in CSS pixels. */
  size?: number;
  className?: string;
}

export interface LogoProps {
  /** Size of the mark in CSS pixels; the wordmark scales along with it. */
  size?: number;
  className?: string;
  /** 'stacked' puts the wordmark under the mark (welcome screen), 'inline' next to it. */
  layout?: 'stacked' | 'inline';
}

interface MarkProps {
  size: number;
  className?: string;
  /** Hide the mark from assistive technology because visible text already names the app. */
  decorative: boolean;
}

function Mark({ size, className, decorative }: MarkProps) {
  // useId may contain characters that are awkward inside url(#…) references.
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const bg = `sb-bg-${id}`;
  const glow = `sb-glow-${id}`;
  const edge = `sb-edge-${id}`;
  const accessibility = decorative
    ? ({ 'aria-hidden': true } as const)
    : ({ role: 'img', 'aria-label': APP_NAME } as const);

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 512 512"
      width={size}
      height={size}
      className={className}
      style={{ flexShrink: 0 }}
      {...accessibility}
    >
      <defs>
        <linearGradient id={bg} x1="0.3" y1="0" x2="0.7" y2="1">
          <stop offset="0" stopColor="#3a3a3a" />
          <stop offset="1" stopColor="#050505" />
        </linearGradient>
        <radialGradient id={glow} cx="0.5" cy="0" r="0.75">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.22" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={edge} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.36" />
          <stop offset="0.55" stopColor="#fff" stopOpacity="0.04" />
          <stop offset="1" stopColor="#fff" stopOpacity="0.1" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="116" fill={`url(#${bg})`} />
      <rect width="512" height="512" rx="116" fill={`url(#${glow})`} />
      <rect
        x="2"
        y="2"
        width="508"
        height="508"
        rx="114"
        fill="none"
        stroke={`url(#${edge})`}
        strokeWidth="4"
      />
      <g fill="#fff">
        <rect x="160" y="120" width="64" height="84" rx="32" />
        <rect x="288" y="120" width="64" height="84" rx="32" />
        <path d={BOOK_PATH} />
      </g>
    </svg>
  );
}

/** The mark on its own (green tile with the white glyph), announced as "School Buddy". */
export function LogoMark({ size = 48, className }: LogoMarkProps) {
  return <Mark size={size} className={className} decorative={false} />;
}

/** The mark together with the "School Buddy" wordmark; the text takes the surrounding colour. */
export function Logo({ size = 88, className, layout = 'stacked' }: LogoProps) {
  const stacked = layout === 'stacked';
  const containerStyle: CSSProperties = {
    display: 'inline-flex',
    flexDirection: stacked ? 'column' : 'row',
    alignItems: 'center',
    gap: Math.round(size * (stacked ? 0.2 : 0.28)),
  };
  const wordmarkStyle: CSSProperties = {
    fontFamily: SYSTEM_FONT,
    fontWeight: 600,
    fontSize: Math.round(size * (stacked ? 0.32 : 0.5)),
    lineHeight: 1.1,
    letterSpacing: '-0.02em',
    whiteSpace: 'nowrap',
  };

  return (
    <div className={className} style={containerStyle}>
      <Mark size={size} decorative />
      <span style={wordmarkStyle}>{APP_NAME}</span>
    </div>
  );
}
