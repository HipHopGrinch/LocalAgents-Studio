import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { Terminal as TerminalIcon, Play, Square, Trash2, X } from 'lucide-react';

interface TerminalPanelProps {
  isOpen: boolean;
  onClose: () => void;
  workspacePath: string;
  /** Full-height pane (mobile web console). */
  fill?: boolean;
}

const HEIGHT_KEY = 'la.terminal.height';
const MAX_CHUNKS = 2000;
const MIN_HEIGHT = 120;

function readStoredHeight(): number {
  try {
    const n = Number(localStorage.getItem(HEIGHT_KEY));
    if (Number.isFinite(n) && n >= MIN_HEIGHT) return n;
  } catch {
    /* private mode / blocked storage */
  }
  return 256;
}

function clampHeight(n: number): number {
  const max = Math.max(160, Math.min(720, window.innerHeight - 160));
  return Math.round(Math.min(max, Math.max(MIN_HEIGHT, n)));
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
  fill = false
}) => {
  const [output, setOutput] = useState<string[]>([]);
  const [command, setCommand] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [height, setHeight] = useState(() => clampHeight(readStoredHeight()));
  const heightRef = useRef(height);
  const logRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  heightRef.current = height;

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

  const startResize = (e: React.PointerEvent) => {
    if (fill) return;
    e.preventDefault();
    const startY = e.clientY;
    const startH = heightRef.current;
    const move = (ev: PointerEvent) => {
      setHeight(clampHeight(startH - (ev.clientY - startY)));
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const next = clampHeight(startH - (ev.clientY - startY));
      setHeight(next);
      persistHeight(next);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const bumpHeight = (delta: number) => {
    setHeight(prev => {
      const next = clampHeight(prev + delta);
      persistHeight(next);
      return next;
    });
  };

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
    setIsRunning(false);
  };

  const handleClear = async () => {
    setOutput([]);
    await window.electronAPI?.clearTerminalBuffer();
  };

  return (
    <div
      style={fill ? undefined : { height }}
      className={`${
        fill ? 'h-full' : 'shrink-0'
      } bg-[var(--surface-1)] border-[var(--border)] flex flex-col font-mono text-xs select-text`}
    >
      {!fill && (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize terminal"
          aria-valuemin={MIN_HEIGHT}
          aria-valuemax={720}
          aria-valuenow={height}
          tabIndex={0}
          onPointerDown={startResize}
          onKeyDown={e => {
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              bumpHeight(24);
            } else if (e.key === 'ArrowDown') {
              e.preventDefault();
              bumpHeight(-24);
            }
          }}
          className="h-1.5 shrink-0 cursor-row-resize border-t border-[var(--border)] bg-[#18181c] hover:bg-indigo-500/80 focus-visible:bg-indigo-500 outline-none"
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
