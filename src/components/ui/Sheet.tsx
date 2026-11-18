import {
  useEffect,
  useId,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { IconButton } from './IconButton';
import { cx } from './cx';
import { prefersReducedMotion } from './motion';
import { useModalLayer } from './overlay';
import './Sheet.css';

export interface SheetProps {
  open: boolean;
  /** Called for the close button, a backdrop press, Escape and a downward swipe on the handle. */
  onClose: () => void;
  /** Heading of the sheet; also its accessible name. Pass `aria-label` when there is no title. */
  title?: string;
  /** Scrollable content. */
  children: ReactNode;
  /** Stays at the bottom of the sheet while the body scrolls, e.g. the save button. */
  footer?: ReactNode;
  /** Shows the round close button in the header. */
  showClose?: boolean;
  /** Accessible name of the close button. */
  closeLabel?: string;
  /** Element that gets focus when the sheet opens. Defaults to the sheet itself. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Use `alertdialog` for a question that needs an answer. */
  role?: 'dialog' | 'alertdialog';
  'aria-label'?: string;
  'aria-describedby'?: string;
  className?: string;
}

/** Length of the slide-out animation in Sheet.css. */
/** About 20% shorter than the 320ms entrance. */
const EXIT_MS = 256;
/** A swipe on the handle further down than this closes the sheet. */
const DISMISS_DISTANCE = 96;

/**
 * Modal bottom sheet: a glass panel that slides up over the screen. It is rendered in
 * a portal, traps focus, locks page scroll, closes on Escape and backdrop press, and
 * returns focus to the element that opened it.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
  showClose = true,
  closeLabel = 'Sluiten',
  initialFocusRef,
  role = 'dialog',
  'aria-label': ariaLabel,
  'aria-describedby': ariaDescribedBy,
  className,
}: SheetProps) {
  // Stays mounted a little longer than `open`, so the slide-out animation can play.
  const [present, setPresent] = useState(open);
  if (open && !present) setPresent(true);

  const panelRef = useRef<HTMLDivElement>(null);
  const dragStartY = useRef<number | null>(null);
  const dragOffset = useRef(0);
  const titleId = useId();

  useEffect(() => {
    if (open) {
      panelRef.current?.style.removeProperty('--sb-sheet-drag');
      return;
    }
    if (!present) return;
    const timer = window.setTimeout(() => setPresent(false), prefersReducedMotion() ? 0 : EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [open, present]);

  useModalLayer(open, panelRef, onClose, initialFocusRef);

  if (!present) return null;

  const setDragOffset = (offset: number) => {
    dragOffset.current = offset;
    panelRef.current?.style.setProperty('--sb-sheet-drag', `${offset}px`);
  };

  const handleDragStart = (event: PointerEvent<HTMLDivElement>) => {
    if (!open || (event.target as Element).closest('button')) return;
    dragStartY.current = event.clientY;
    event.currentTarget.setPointerCapture(event.pointerId);
    panelRef.current?.setAttribute('data-dragging', '');
  };

  const handleDragMove = (event: PointerEvent<HTMLDivElement>) => {
    if (dragStartY.current === null) return;
    setDragOffset(Math.max(0, event.clientY - dragStartY.current));
  };

  const handleDragEnd = (event: PointerEvent<HTMLDivElement>) => {
    if (dragStartY.current === null) return;
    dragStartY.current = null;
    panelRef.current?.removeAttribute('data-dragging');
    if (event.type === 'pointerup' && dragOffset.current > DISMISS_DISTANCE) {
      // Keep the offset: the slide-out continues from where the finger let go.
      onClose();
    } else {
      setDragOffset(0);
    }
  };

  return createPortal(
    <div className="sb-sheet" data-state={open ? 'open' : 'closing'}>
      <div className="sb-sheet__backdrop" onClick={onClose} />
      <div
        ref={panelRef}
        className={cx('sb-sheet__panel', 'sb-glass', className)}
        role={role}
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : ariaLabel}
        aria-describedby={ariaDescribedBy}
        tabIndex={-1}
      >
        <div
          className="sb-sheet__header"
          onPointerDown={handleDragStart}
          onPointerMove={handleDragMove}
          onPointerUp={handleDragEnd}
          onPointerCancel={handleDragEnd}
        >
          <span className="sb-sheet__handle" aria-hidden="true" />
          {(title || showClose) && (
            <div className="sb-sheet__title-row">
              {title ? (
                <h2 id={titleId} className="sb-sheet__title">
                  {title}
                </h2>
              ) : (
                <span className="sb-sheet__title" />
              )}
              {showClose && (
                <IconButton size="sm" aria-label={closeLabel} onClick={onClose}>
                  <X />
                </IconButton>
              )}
            </div>
          )}
        </div>
        <div className={cx('sb-sheet__body', footer == null && 'sb-sheet__body--last')}>
          {children}
        </div>
        {footer != null && <div className="sb-sheet__footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
