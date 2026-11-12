import React from 'react';

interface SplitHandleProps {
  /** ARIA orientation. `vertical` is a column bar (width). `horizontal` is a row bar (height). */
  orientation: 'vertical' | 'horizontal';
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  active?: boolean;
  onDragStart: () => void;
  onChange: (value: number) => void;
  onCommit: (value: number) => void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

/**
 * Keyboard-operable pane splitter. Left/Right change a vertical separator.
 * Up/Down change a horizontal separator (and also work on a vertical one).
 */
export const SplitHandle: React.FC<SplitHandleProps> = ({
  orientation,
  label,
  value,
  min,
  max,
  step = 16,
  active = false,
  onDragStart,
  onChange,
  onCommit
}) => {
  const apply = (next: number) => {
    const clamped = clamp(next, min, max);
    onChange(clamped);
    onCommit(clamped);
  };

  return (
    <div
      role="separator"
      aria-orientation={orientation}
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onMouseDown={() => onDragStart()}
      onKeyDown={e => {
        const grow =
          orientation === 'horizontal'
            ? e.key === 'ArrowUp' || e.key === 'ArrowRight'
            : e.key === 'ArrowRight' || e.key === 'ArrowUp';
        const shrink =
          orientation === 'horizontal'
            ? e.key === 'ArrowDown' || e.key === 'ArrowLeft'
            : e.key === 'ArrowLeft' || e.key === 'ArrowDown';
        if (e.key === 'Home') {
          e.preventDefault();
          apply(min);
          return;
        }
        if (e.key === 'End') {
          e.preventDefault();
          apply(max);
          return;
        }
        if (!grow && !shrink) return;
        e.preventDefault();
        const delta = (grow ? step : -step) * (e.shiftKey ? 3 : 1);
        apply(value + delta);
      }}
      className={`shrink-0 outline-none focus-visible:bg-indigo-500 ${
        orientation === 'horizontal' ? 'h-1 cursor-row-resize' : 'w-1 cursor-col-resize'
      } ${active ? 'bg-indigo-500' : 'bg-transparent hover:bg-indigo-500/60'}`}
    />
  );
};
