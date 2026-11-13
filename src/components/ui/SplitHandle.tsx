import React from 'react';

interface SplitHandleProps {
  /** ARIA orientation. `vertical` is a column bar (width). `horizontal` is a row bar (height). */
  orientation: 'vertical' | 'horizontal';
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  /** Pane whose size `value` stores. ArrowRight / ArrowDown always move the bar that way. */
  valueSide?: 'before' | 'after';
  /** Double-click restores this preferred size (not clamped to the live window). */
  resetValue?: number;
  active?: boolean;
  disabled?: boolean;
  onPointerDown?: (event: React.PointerEvent<HTMLElement>) => void;
  onChange: (value: number) => void;
  onCommit: (value: number) => void;
}

function clamp(value: number, min: number, max: number): number {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  if (!Number.isFinite(value)) return lo;
  return Math.round(Math.min(hi, Math.max(lo, value)));
}

/**
 * Keyboard-operable pane splitter. The hit target is 8px; negative margin
 * keeps the flex gap at the 1px line.
 */
export const SplitHandle: React.FC<SplitHandleProps> = ({
  orientation,
  label,
  value,
  min,
  max,
  step = 16,
  valueSide = 'before',
  resetValue,
  active = false,
  disabled = false,
  onPointerDown,
  onChange,
  onCommit
}) => {
  const commitLive = (next: number) => {
    const clamped = clamp(next, min, max);
    onChange(clamped);
    onCommit(clamped);
  };

  const commitReset = () => {
    if (resetValue == null || disabled) return;
    onChange(resetValue);
    onCommit(resetValue);
  };

  const horizontal = orientation === 'horizontal';

  return (
    <div
      role="separator"
      aria-orientation={orientation}
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={Math.round(min)}
      aria-valuemax={Math.round(max)}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : 0}
      onPointerDown={event => {
        if (disabled || event.button !== 0) return;
        if (resetValue != null && event.detail >= 2) {
          event.preventDefault();
          event.stopPropagation();
          commitReset();
          return;
        }
        onPointerDown?.(event);
      }}
      onDoubleClick={event => {
        if (disabled || resetValue == null) return;
        event.preventDefault();
        commitReset();
      }}
      onKeyDown={e => {
        if (disabled) return;
        if (e.key === 'Home') {
          e.preventDefault();
          commitLive(min);
          return;
        }
        if (e.key === 'End') {
          e.preventDefault();
          commitLive(max);
          return;
        }
        const towardEnd = e.key === 'ArrowRight' || e.key === 'ArrowDown';
        const towardStart = e.key === 'ArrowLeft' || e.key === 'ArrowUp';
        if (!towardEnd && !towardStart) return;
        e.preventDefault();
        const barDelta = (towardEnd ? 1 : -1) * step * (e.shiftKey ? 3 : 1);
        const valueDelta = valueSide === 'before' ? barDelta : -barDelta;
        commitLive(value + valueDelta);
      }}
      className={`group relative z-20 shrink-0 touch-none select-none outline-none ${
        horizontal
          ? 'h-2 -my-[3.5px] w-full cursor-row-resize'
          : 'w-2 -mx-[3.5px] cursor-col-resize self-stretch'
      } ${disabled ? 'pointer-events-none cursor-default opacity-40' : ''}`}
    >
      <span
        aria-hidden
        className={`pointer-events-none absolute ${
          horizontal
            ? 'left-0 right-0 top-1/2 h-px -translate-y-1/2'
            : 'top-0 bottom-0 left-1/2 w-px -translate-x-1/2'
        } ${
          active
            ? 'bg-indigo-500'
            : 'bg-[#52525b] group-hover:bg-indigo-400 group-focus-visible:bg-indigo-500'
        }`}
      />
    </div>
  );
};
