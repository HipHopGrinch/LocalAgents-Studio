import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { Terminal as TerminalIcon, Play, Square, Trash2, X } from 'lucide-react';
import { SplitHandle } from './ui/SplitHandle';
import { usePaneDrag } from '../hooks/usePaneDrag';
import {
  TERMINAL_DEFAULT,
  TERMINAL_MIN,
  renderedTerminalHeight,
  terminalMaxHeight
} from '../lib/paneLayout';

interface TerminalPanelProps {
  isOpen: boolean;
  onClose: () => void;
  workspacePath: string;
  /** Full-height pane (mobile web console). */
  fill?: boolean;
  /** Bump to restore the default height from Reset pane sizes. */
  resetNonce?: number;
}

const HEIGHT_KEY = 'la.terminal.height';
const MAX_CHUNKS = 2000;
/** Survives unmount so hiding the editor does not apply the same reset twice. */
let appliedTerminalReset = 0;

function readStoredHeight(): number {
  try {
    const n = Number(localStorage.getItem(HEIGHT_KEY));
    if (Number.isFinite(n) && n >= TERMINAL_MIN) return n;
  } catch {
    /* private mode / blocked storage */
  }
  return TERMINAL_DEFAULT;
}

function persistHeight(n: number) {
  try {
    localStorage.setItem(HEIGHT_KEY, String(Math.round(n)));
  } catch {
    /* ignore */
  }
}

function capChunks(chunks: string[]): string[] {
  if (chunks.length <= MAX_CHUNKS) return chunks;
  return chunks.slice(chunks.length - MAX_CHUNKS);
}

function piecesFromText(data: string): string[] {
  const parts = data.split('\n');
  if (parts.length <= 1) return [data];
  const pieces = parts
    .map((line, i) => (i < parts.length - 1 ? `${line}\n` : line))
    .filter(part => part.length > 0);
  return pieces.length ? pieces : [data];
}

function appendOutput(prev: string[], data: string): string[] {
  return capChunks(prev.concat(piecesFromText(data)));
}

export const TerminalPanel: React.FC<TerminalPanelProps> = ({
  isOpen,
  onClose,
  workspacePath,
  fill = false,
  resetNonce = 0
}) => {
  const [output, setOutput] = useState<string[]>([]);
  const [command, setCommand] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [storedHeight, setStoredHeight] = useState(readStoredHeight);
  const [previewHeight, setPreviewHeight] = useState<number | null>(null);
  const [columnHeight, setColumnHeight] = useState(() =>
    typeof window !== 'undefined' ? window.innerHeight : 920
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const columnHeightRef = useRef(columnHeight);
  columnHeightRef.current = columnHeight;
  const storedHeightRef = useRef(storedHeight);
  storedHeightRef.current = storedHeight;
  const height = previewHeight ?? renderedTerminalHeight(storedHeight, columnHeight);
  const heightMax = terminalMaxHeight(columnHeight);

  useEffect(() => {
    if (!resetNonce || resetNonce === appliedTerminalReset) return;
    appliedTerminalReset = resetNonce;
    setStoredHeight(TERMINAL_DEFAULT);
    setPreviewHeight(null);
    persistHeight(TERMINAL_DEFAULT);
  }, [resetNonce]);

  useEffect(() => {
    if (!window.electronAPI) return;

    const cleanupOut = window.electronAPI.onTerminalOutput((data: string) => {
      setOutput(prev => appendOutput(prev, data));
    });
    const cleanupState = window.electronAPI.onTerminalState((s: { running: boolean }) => {
      setIsRunning(s.running);
    });

    return () => {
      cleanupOut();
      cleanupState();
    };
  }, []);

  useEffect(() => {
    if (!isOpen || !window.electronAPI) return;
    let cancelled = false;
    (async () => {
      try {
        const snap = await window.electronAPI.getTerminalBuffer({ maxChars: 50000 });
        if (cancelled) return;
        if (snap.content && snap.content !== '(terminal is empty)') {
          setOutput(capChunks(piecesFromText(snap.content)));
        }
        setIsRunning(snap.running);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const onLogScroll = () => {
    const el = logRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  };

  useLayoutEffect(() => {
    const el = logRef.current;
    if (!el || !stickRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [output, isOpen]);

  useEffect(() => {
    if (!isOpen || fill) return;
    const parent = rootRef.current?.parentElement;
    if (!parent || typeof ResizeObserver === 'undefined') return;
    const publish = () => setColumnHeight(parent.clientHeight);
    const obs = new ResizeObserver(publish);
    obs.observe(parent);
    publish();
    return () => obs.disconnect();
  }, [isOpen, fill]);

  const commitHeight = (next: number) => {
    setPreviewHeight(null);
    setStoredHeight(next);
    persistHeight(next);
  };

  const heightDrag = usePaneDrag({
    axis: 'y',
    valueSide: 'after',
    disabled: fill,
    getMin: () => Math.min(TERMINAL_MIN, renderedTerminalHeight(storedHeightRef.current, columnHeightRef.current)),
    getMax: () =>
      Math.max(
        terminalMaxHeight(columnHeightRef.current),
        renderedTerminalHeight(storedHeightRef.current, columnHeightRef.current)
      ),
    getValue: () => storedHeightRef.current,
    getPane: () => rootRef.current,
    onPreview: next => {
      setPreviewHeight(next === storedHeightRef.current ? null : next);
    },
    onCommit: commitHeight
  });

  if (!isOpen) return null;

  const handleRun = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!command.trim() || isRunning) return;

    const cmdToRun = command;
    setCommand('');
    setIsRunning(true);

    try {
      await window.electronAPI.executeCommand(cmdToRun, workspacePath);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Command failed.';
      setOutput(prev => appendOutput(prev, `\nError: ${message}\n`));
      setIsRunning(false);
    }
  };

  const handleKill = async () => {
    await window.electronAPI.killCommand();
  };

  const handleClear = async () => {
    setOutput([]);
    await window.electronAPI?.clearTerminalBuffer();
  };

  return (
    <div
      ref={rootRef}
      style={fill ? undefined : { height }}
      className={`${
        fill ? 'h-full' : 'shrink-0'
      } bg-[var(--surface-1)] border-[var(--border)] flex flex-col font-mono text-xs select-text`}
    >
      {!fill && (
        <SplitHandle
          orientation="horizontal"
          label="Resize terminal"
          value={height}
          min={Math.min(TERMINAL_MIN, height)}
          max={Math.max(height, heightMax)}
          valueSide="after"
          resetValue={TERMINAL_DEFAULT}
          active={heightDrag.dragging}
          onPointerDown={heightDrag.onPointerDown}
          onChange={setPreviewHeight}
          onCommit={commitHeight}
        />
      )}

      <div className={`h-8 bg-[#18181c] ${fill ? 'border-t border-[var(--border)]' : ''} border-b border-[var(--border)] px-3 flex items-center justify-between text-zinc-400`}>
        <div className="flex items-center space-x-2">
          <TerminalIcon className="w-3.5 h-3.5 text-indigo-400" />
          <span className="font-semibold text-zinc-300">PowerShell</span>
          {isRunning && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[11px] text-amber-300">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse motion-reduce:animate-none" aria-hidden="true" />
              Running
            </span>
          )}
        </div>

        <div className="flex items-center space-x-2">
          {isRunning && (
            <button
              type="button"
              onClick={handleKill}
              className="flex items-center space-x-1 px-2 py-0.5 bg-red-600/20 hover:bg-red-600/30 text-red-300 border border-red-500/30 rounded text-[11px] transition"
              title="Stop this terminal command. Agent commands keep running."
              aria-label="Stop this terminal command. Agent commands keep running."
            >
              <Square className="w-2.5 h-2.5" />
              <span>Stop</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleClear}
            className="p-1 hover:text-white hover:bg-[#27272a] rounded transition"
            aria-label="Clear terminal"
            title="Clear terminal"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={onClose}
            className="p-1 hover:text-white hover:bg-[#27272a] rounded transition"
            aria-label="Close terminal"
            title="Close panel"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div
        ref={logRef}
        onScroll={onLogScroll}
        className="flex-1 p-3 overflow-y-auto whitespace-pre-wrap select-text text-zinc-300 font-mono text-[11px] leading-relaxed"
      >
        {output.length === 0 ? (
          <span className="text-zinc-400">LocalAgents PowerShell Terminal. Ready for commands.</span>
        ) : (
          output.map((line, idx) => <span key={idx}>{line}</span>)
        )}
      </div>

      <form onSubmit={handleRun} className="h-9 border-t border-[var(--border)] bg-[#16161a] px-3 flex items-center space-x-2">
        <span className="text-indigo-400 font-bold">PS &gt;</span>
        <input
          type="text"
          value={command}
          onChange={e => setCommand(e.target.value)}
          placeholder="Run local script, git, cargo, npm, etc..."
          disabled={isRunning}
          aria-label="Terminal command"
          className="flex-1 bg-transparent text-zinc-200 outline-none text-xs font-mono placeholder-zinc-500"
        />
        <button
          type="submit"
          disabled={isRunning || !command.trim()}
          aria-label="Run command"
          className="p-1 text-zinc-400 hover:text-white disabled:opacity-30 rounded transition"
        >
          <Play className="w-3.5 h-3.5 text-emerald-400" />
        </button>
      </form>
    </div>
  );
};
