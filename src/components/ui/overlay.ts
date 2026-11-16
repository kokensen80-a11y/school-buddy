import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/** Panels of the open modal layers, bottom to top. Only the top one reacts to the keyboard. */
const layers: HTMLElement[] = [];
let overflowBeforeLock = '';

function lockBodyScroll(): void {
  if (layers.length === 0) {
    overflowBeforeLock = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
}

function unlockBodyScroll(): void {
  if (layers.length === 0) document.body.style.overflow = overflowBeforeLock;
}

/**
 * Modal behaviour for an overlay panel while `active`: moves focus into the panel,
 * keeps Tab inside it, calls `onEscape` for the Escape key, locks page scroll and
 * gives focus back to where it was when the layer closes. Layers can be stacked.
 */
export function useModalLayer(
  active: boolean,
  panelRef: RefObject<HTMLElement | null>,
  onEscape: () => void,
  initialFocusRef?: RefObject<HTMLElement | null>,
): void {
  const onEscapeRef = useRef(onEscape);
  useEffect(() => {
    onEscapeRef.current = onEscape;
  });

  useEffect(() => {
    const panel = panelRef.current;
    if (!active || !panel) return;

    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    lockBodyScroll();
    layers.push(panel);
    (initialFocusRef?.current ?? panel).focus({ preventScroll: true });

    const onKeyDown = (event: KeyboardEvent) => {
      if (layers[layers.length - 1] !== panel) return;
      if (event.key === 'Escape') {
        event.stopPropagation();
        onEscapeRef.current();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const current = document.activeElement;
      const outside = !panel.contains(current);
      if (!first || !last) {
        event.preventDefault();
        panel.focus();
      } else if (event.shiftKey && (outside || current === first || current === panel)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (outside || current === last)) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      layers.splice(layers.indexOf(panel), 1);
      unlockBodyScroll();
      if (previouslyFocused?.isConnected) previouslyFocused.focus({ preventScroll: true });
    };
  }, [active, panelRef, initialFocusRef]);
}
