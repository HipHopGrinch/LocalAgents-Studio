import { useEffect, useRef } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Dialog behavior for an overlay: initial focus, Tab focus trap, Escape to close,
 * and focus restored to the opener on close.
 *
 * Spread `dialogProps` onto the dialog panel and `overlayProps` onto the backdrop.
 */
export function useDialog(opts: { open: boolean; onClose: () => void; labelledBy?: string; label?: string }) {
  const { open, onClose, labelledBy, label } = opts;
  const panelRef = useRef<HTMLDivElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>(FOCUSABLE);
    (first || panel)?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab' || !panelRef.current) return;
      const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        el => el.offsetParent !== null
      );
      if (!items.length) return;
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      if (opener && document.contains(opener)) opener.focus();
    };
  }, [open]);

  return {
    panelRef,
    dialogProps: {
      ref: panelRef,
      role: 'dialog' as const,
      'aria-modal': true,
      'aria-labelledby': labelledBy,
      'aria-label': labelledBy ? undefined : label,
      tabIndex: -1
    },
    overlayProps: {
      onMouseDown: (e: React.MouseEvent) => {
        if (e.target === e.currentTarget) onCloseRef.current();
      }
    }
  };
}
