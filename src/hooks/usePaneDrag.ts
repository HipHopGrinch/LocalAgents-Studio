import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

export interface PaneDragOptions {
  axis: 'x' | 'y';
  /** Which side of the bar the stored number belongs to. */
  valueSide: 'before' | 'after';
  disabled?: boolean;
  getMin: () => number;
  getMax: () => number;
  /** Logical size to restore when the gesture is cancelled. */
  getValue: () => number;
  /** The pane being sized. Its client box is sampled once at pointerdown. */
  getPane: () => HTMLElement | null;
  onPreview: (value: number) => void;
  onCommit: (value: number) => void;
}

/** Web console sets documentElement zoom. Electron webFrame zoom leaves this empty. */
function pageZoom(): number {
  const zoom = Number(document.documentElement.style.zoom);
  return Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return Number.isFinite(min) ? Math.round(min) : 0;
  const lo = Number.isFinite(min) ? min : value;
  const hi = Number.isFinite(max) ? max : value;
  if (hi < lo) return Math.round(Math.max(0, Math.min(value, hi)));
  return Math.round(Math.min(hi, Math.max(lo, value)));
}

/**
 * Pointer drag for a pane splitter. A gesture commits on pointerup only.
 * Escape, blur, pointercancel, a lost capture, or the handle going away restores
 * the size captured at pointerdown.
 */
export function usePaneDrag(options: PaneDragOptions): {
  dragging: boolean;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
} {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const stopRef = useRef<(() => void) | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (options.disabled) stopRef.current?.();
  }, [options.disabled]);

  useEffect(() => () => stopRef.current?.(), []);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const opts = optionsRef.current;
    if (opts.disabled) return;
    if (stopRef.current) stopRef.current();

    const handle = event.currentTarget;
    if (!handle.isConnected) return;
    const pointerId = event.pointerId;
    event.preventDefault();
    event.stopPropagation();
    handle.focus({ preventScroll: true });
    try {
      handle.setPointerCapture(pointerId);
    } catch {
      /* pointer already gone */
    }

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    const hadSelectNone = document.body.classList.contains('select-none');
    document.body.style.cursor = opts.axis === 'y' ? 'row-resize' : 'col-resize';
    document.body.style.userSelect = 'none';
    if (!hadSelectNone) document.body.classList.add('select-none');

    const pane = opts.getPane();
    const zoom = pageZoom();
    const startPointer = opts.axis === 'y' ? event.clientY : event.clientX;
    const visualBase = pane ? (opts.axis === 'y' ? pane.clientHeight : pane.clientWidth) : opts.getValue();
    const snapshot = opts.getValue();
    let point = startPointer;
    let moved = false;
    let frame = 0;
    let latest = snapshot;
    let ended = false;
    let chromeRestored = false;

    const restoreChrome = () => {
      if (chromeRestored) return;
      chromeRestored = true;
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      if (!hadSelectNone) document.body.classList.remove('select-none');
    };

    const measure = (pos: number) => {
      const live = optionsRef.current;
      const delta = (pos - startPointer) / zoom;
      const signed = live.valueSide === 'before' ? delta : -delta;
      return clamp(visualBase + signed, live.getMin(), live.getMax());
    };

    const detach = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', onBlur);
      handle.removeEventListener('lostpointercapture', onLost);
      try {
        if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
      } catch {
        /* already released */
      }
      if (stopRef.current === cancel) stopRef.current = null;
      setDragging(false);
    };

    const cancel = () => {
      if (ended) return;
      ended = true;
      try {
        optionsRef.current.onPreview(snapshot);
      } finally {
        try {
          detach();
        } finally {
          restoreChrome();
        }
      }
    };

    const finish = (ev: PointerEvent) => {
      if (ended) return;
      ended = true;
      handle.removeEventListener('lostpointercapture', onLost);
      try {
        point = optionsRef.current.axis === 'y' ? ev.clientY : ev.clientX;
        if (Math.abs(point - startPointer) > 2) moved = true;
        if (frame) cancelAnimationFrame(frame);
        frame = 0;
        if (moved) {
          latest = measure(point);
          optionsRef.current.onPreview(latest);
          optionsRef.current.onCommit(latest);
        }
      } finally {
        try {
          detach();
        } finally {
          restoreChrome();
        }
      }
    };

    const onMove = (ev: PointerEvent) => {
      if (ended) return;
      if (!handle.isConnected || optionsRef.current.disabled) {
        cancel();
        return;
      }
      if ((ev.buttons & 1) === 0) return;
      point = optionsRef.current.axis === 'y' ? ev.clientY : ev.clientX;
      if (Math.abs(point - startPointer) > 2) moved = true;
      if (!moved || frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (ended || !moved) return;
        if (!handle.isConnected || optionsRef.current.disabled) {
          cancel();
          return;
        }
        latest = measure(point);
        optionsRef.current.onPreview(latest);
      });
    };

    const onUp = (ev: PointerEvent) => finish(ev);
    const onCancel = () => cancel();
    const onLost = () => {
      if (ended) return;
      cancel();
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      ev.preventDefault();
      cancel();
    };
    const onBlur = () => cancel();

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', onBlur);
    handle.addEventListener('lostpointercapture', onLost);
    stopRef.current = cancel;
    setDragging(true);
  }, []);

  return { dragging, onPointerDown };
}
