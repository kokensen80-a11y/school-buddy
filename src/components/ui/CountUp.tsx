import { useEffect, useRef, useState } from 'react';
import { prefersReducedMotion } from './motion';

/**
 * A whole number that counts up to its value (and from the old value to a new one),
 * easing out over `duration` ms. Shows the value straight away when motion is reduced,
 * the page is hidden or animation frames are not available.
 */
export function CountUp({ value, duration = 900 }: { value: number; duration?: number }) {
  const canAnimate = () =>
    typeof window !== 'undefined' &&
    typeof window.requestAnimationFrame === 'function' &&
    !prefersReducedMotion() &&
    !(typeof document !== 'undefined' && document.hidden);
  const [shown, setShown] = useState(() => (canAnimate() ? 0 : value));
  const from = useRef(shown);

  useEffect(() => {
    if (!canAnimate()) {
      setShown(value);
      from.current = value;
      return;
    }
    const start = performance.now();
    const begin = from.current;
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const next = Math.round(begin + (value - begin) * eased);
      setShown(next);
      from.current = next;
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, duration]);

  return <>{shown}</>;
}
