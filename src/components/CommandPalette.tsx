import React, { useEffect, useMemo, useState } from 'react';
import { useDialog } from './ui/useDialog';

export interface CommandPaletteAction {
  id: string;
  label: string;
  hint?: string;
  keywords?: string;
  run: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  actions: CommandPaletteAction[];
}

/** Subsequence match. Higher is better. Null when the query does not fit. */
function fuzzyScore(query: string, text: string): number | null {
  const q = query.trim().toLowerCase();
  const hay = text.toLowerCase();
  if (!q) return 1;
  let qi = 0;
  let score = 0;
  let streak = 0;
  for (let i = 0; i < hay.length && qi < q.length; i++) {
    if (hay[i] !== q[qi]) {
      streak = 0;
      continue;
    }
    qi += 1;
    streak += 1;
    score += streak * 2;
    if (i === 0 || hay[i - 1] === ' ' || hay[i - 1] === '-') score += 4;
  }
  return qi === q.length ? score : null;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({ open, onClose, actions }) => {
  const { dialogProps, overlayProps } = useDialog({
    open,
    onClose,
    label: 'Command palette'
  });
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
    }
  }, [open]);

  const matches = useMemo(() => {
    const ranked = actions
      .map(action => {
        const score = fuzzyScore(query, `${action.label} ${action.hint || ''} ${action.keywords || ''}`);
        return score == null ? null : { action, score };
      })
      .filter((row): row is { action: CommandPaletteAction; score: number } => row != null);
    ranked.sort((a, b) => b.score - a.score || a.action.label.localeCompare(b.action.label));
    return ranked.map(row => row.action);
  }, [actions, query]);

  useEffect(() => {
    setActive(index => Math.min(index, Math.max(0, matches.length - 1)));
  }, [matches.length]);

  if (!open) return null;

  const runAt = (index: number) => {
    const action = matches[index];
    if (!action) return;
    action.run();
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[80] bg-black/60 flex items-start justify-center pt-[12vh] px-4"
      {...overlayProps}
    >
      <div
        {...dialogProps}
        className="w-full max-w-lg bg-[#161619] border border-[#2e2e38] rounded-xl shadow-2xl overflow-hidden outline-none"
      >
        <input
          value={query}
          onChange={e => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={e => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive(index => Math.min(matches.length - 1, index + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive(index => Math.max(0, index - 1));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              runAt(active);
            }
          }}
          placeholder="Type a command"
          aria-label="Command palette filter"
          aria-controls="command-palette-list"
          aria-activedescendant={matches[active] ? `command-palette-${matches[active].id}` : undefined}
          className="w-full bg-[#121215] border-b border-[#2e2e38] text-zinc-100 placeholder-zinc-500 text-sm px-3 py-2.5 outline-none"
        />
        <ul id="command-palette-list" role="listbox" aria-label="Commands" className="max-h-80 overflow-y-auto py-1">
          {matches.length === 0 ? (
            <li className="px-3 py-3 text-xs text-zinc-500">No matching commands</li>
          ) : (
            matches.map((action, index) => (
              <li key={action.id} role="presentation">
                <button
                  id={`command-palette-${action.id}`}
                  type="button"
                  role="option"
                  aria-selected={index === active}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => runAt(index)}
                  className={`w-full text-left px-3 py-2 flex items-center justify-between gap-3 text-xs ${
                    index === active ? 'bg-indigo-600/25 text-zinc-100' : 'text-zinc-300 hover:bg-[#22222a]'
                  }`}
                >
                  <span className="truncate">{action.label}</span>
                  {action.hint && <span className="text-[11px] text-zinc-500 shrink-0">{action.hint}</span>}
                </button>
              </li>
            ))
          )}
        </ul>
        <div className="px-3 py-1.5 border-t border-[#27272a] text-[11px] text-zinc-500">
          Ctrl+K to close · Enter to run · Esc to dismiss
        </div>
      </div>
    </div>
  );
};
