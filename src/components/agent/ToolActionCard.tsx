import React, { useEffect, useState } from 'react';
import { CheckCircle2, Eye, FileEdit, Terminal } from 'lucide-react';
import { ToolCall } from '../../types';
import { applyEdits, parseEditBlocks } from '../../lib/tools';
import { ErrorCard, clipErrorCause } from './ErrorCard';

export interface ToolActionCardProps {
  tool: ToolCall;
  workspacePath: string;
  onApplyFileWrite: (filePath: string, content: string) => Promise<boolean>;
  onExecuteToolCommand: (command: string) => Promise<string>;
  onOpenFileInEditor: (filePath: string) => void;
  onRunSingleTool?: (tool: ToolCall) => Promise<ToolCall>;
  onDiffFailed?: () => void;
  /** Hide Apply / Run — Reviewer never applies code changes */
  hideApply?: boolean;
}

function diffFailure(raw?: string): string {
  const cause = clipErrorCause(raw, "The patch didn't match the file.");
  if (/^couldn.?t apply/i.test(cause)) return cause;
  return `Couldn't apply this diff. ${cause}`;
}

export const ToolActionCard: React.FC<ToolActionCardProps> = ({
  tool,
  workspacePath,
  onApplyFileWrite,
  onExecuteToolCommand,
  onOpenFileInEditor,
  onRunSingleTool,
  onDiffFailed,
  hideApply
}) => {
  const [applied, setApplied] = useState(tool.status === 'done');
  const [commandOk, setCommandOk] = useState(tool.status === 'done');
  const [loading, setLoading] = useState(false);
  const [kept, setKept] = useState<boolean[]>([]);
  /** Hunk indices this card wrote. null means the whole diff was applied outside the card. */
  const [appliedHunks, setAppliedHunks] = useState<number[] | null>(null);
  const [applyError, setApplyError] = useState('');
  const [commandError, setCommandError] = useState('');

  useEffect(() => {
    if (tool.status === 'done') {
      setApplied(true);
      setCommandOk(true);
    }
    if (tool.status === 'error') {
      setApplied(false);
      setCommandOk(false);
    }
  }, [tool.status]);

  if (tool.name === 'write_file') {
    const filePath = tool.args?.path || 'file';
    const content = tool.body || '';

    const handleApply = async () => {
      setLoading(true);
      setApplyError('');
      try {
        if (onRunSingleTool) {
          const res = await onRunSingleTool(tool);
          setApplied(res.status === 'done');
          if (res.status === 'error') {
            setApplyError(clipErrorCause(res.result, "Couldn't write this file."));
          }
        } else {
          const success = await onApplyFileWrite(filePath, content);
          if (success) {
            tool.status = 'done';
            setApplied(true);
          } else {
            setApplyError("Couldn't write this file.");
          }
        }
      } catch (err: unknown) {
        setApplyError(clipErrorCause(err instanceof Error ? err.message : String(err), "Couldn't write this file."));
      }
      setLoading(false);
    };

    return (
      <div className="bg-[var(--surface-1)] border border-[#2a2a36] rounded-md p-2.5 text-zinc-300 font-mono text-[11px] space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-1.5 truncate">
            <FileEdit className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span className="font-semibold text-zinc-200 truncate">{filePath}</span>
          </div>
          <span className="text-[11px] bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded">
            write_file
          </span>
        </div>

        {!applied && content ? (
          <div className="bg-[#0e0e11] p-2 rounded max-h-24 overflow-y-auto text-[11px] text-zinc-400 whitespace-pre">
            {content.slice(0, 200)}
            {content.length > 200 ? '…' : ''}
          </div>
        ) : null}

        {applyError ? <ErrorCard cause={applyError} /> : null}

        <div className="flex items-center space-x-2 pt-1">
          {!hideApply && (
            <button
              type="button"
              onClick={handleApply}
              disabled={applied || loading}
              className={`flex items-center space-x-1 px-2.5 py-1 rounded text-[11px] font-sans font-medium transition ${
                applied
                  ? 'bg-emerald-600/30 text-emerald-300 border border-emerald-500/40'
                  : 'bg-indigo-600 hover:bg-indigo-500 text-white'
              }`}
            >
              {applied ? (
                <>
                  <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                  <span>Applied</span>
                </>
              ) : (
                <span>Apply to Workspace</span>
              )}
            </button>
          )}
          {hideApply && (
            <span className="text-[11px] text-zinc-400 font-sans">
              Reviewer cannot apply — Send to Planner
            </span>
          )}

          <button
            type="button"
            onClick={() => onOpenFileInEditor(filePath)}
            className="flex items-center space-x-1 px-2 py-1 text-zinc-400 hover:text-white hover:bg-[#25252e] rounded text-[11px] font-sans transition"
          >
            <Eye className="w-3 h-3" />
            <span>Open in Editor</span>
          </button>
        </div>
      </div>
    );
  }

  if (tool.name === 'edit_file') {
    const filePath = tool.args?.path || 'file';
    const body = tool.body || '';
    const blocks = parseEditBlocks(body);
    const keptSafe = blocks.map((_, i) => kept[i] !== false);

    const hunkBody = (list: { search: string; replace: string }[]) =>
      list
        .map(b => `<<<<<<< SEARCH\n${b.search}\n=======\n${b.replace}\n>>>>>>> REPLACE`)
        .join('\n\n');

    const applyBody = async (nextBody: string) => {
      const patched = { ...tool, body: nextBody, status: 'pending' as const };
      if (onRunSingleTool) {
        const res = await onRunSingleTool(patched);
        if (res.status === 'done') {
          tool.status = 'done';
          setApplied(true);
          setApplyError('');
          return true;
        }
        setApplyError(diffFailure(res.result));
        onDiffFailed?.();
        return false;
      }
      if (!window.electronAPI) {
        setApplyError("Couldn't apply this diff. The workspace bridge is unavailable.");
        return false;
      }
      const readRes = await window.electronAPI.execTool(workspacePath, 'read_file', {
        path: filePath,
        raw: true
      });
      if (readRes.error || readRes.content === undefined) {
        setApplyError(diffFailure(readRes.error || "Couldn't read the file."));
        onDiffFailed?.();
        return false;
      }
      const editRes = applyEdits(readRes.content, nextBody);
      if (editRes.content === undefined) {
        setApplyError(diffFailure(editRes.error));
        onDiffFailed?.();
        return false;
      }
      const wrote = await onApplyFileWrite(filePath, editRes.content);
      if (!wrote) {
        setApplyError("Couldn't apply this diff. The write was rejected.");
        onDiffFailed?.();
        return false;
      }
      tool.status = 'done';
      setApplied(true);
      setApplyError('');
      return true;
    };

    const allIdx = blocks.map((_, i) => i);
    const diffApplied = applied || tool.status === 'done';
    const hunkApplied = (i: number) => diffApplied && (appliedHunks ? appliedHunks.includes(i) : true);
    const dropIdx = allIdx.filter(i => !keptSafe[i] && hunkApplied(i));

    const handleApplyEdit = async () => {
      if (!blocks.length) return;
      setLoading(true);
      setApplyError('');
      try {
        if (diffApplied) {
          if (dropIdx.length) {
            const ok = await applyBody(
              hunkBody(dropIdx.map(i => ({ search: blocks[i].replace, replace: blocks[i].search })))
            );
            if (ok) setAppliedHunks(allIdx.filter(i => hunkApplied(i) && !dropIdx.includes(i)));
          }
        } else {
          const chosenIdx = allIdx.filter(i => keptSafe[i]);
          if (chosenIdx.length) {
            const ok = await applyBody(hunkBody(chosenIdx.map(i => blocks[i])));
            if (ok) setAppliedHunks(chosenIdx);
          }
        }
      } catch (err: unknown) {
        setApplyError(diffFailure(err instanceof Error ? err.message : String(err)));
        onDiffFailed?.();
      }
      setLoading(false);
    };

    return (
      <div className="bg-[var(--surface-1)] border border-indigo-500/30 rounded-md p-2.5 text-zinc-300 font-mono text-[11px] space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-1.5 truncate">
            <FileEdit className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
            <span className="font-semibold text-zinc-200 truncate">{filePath}</span>
          </div>
          <span className="text-[11px] bg-indigo-500/20 text-indigo-300 px-1.5 py-0.5 rounded">
            SEARCH/REPLACE Diff
          </span>
        </div>

        {blocks.length > 0 ? (
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {blocks.map((b, i) => (
              <label
                key={i}
                className="flex gap-2 items-start bg-[#0e0e11] rounded px-2 py-1 text-[11px]"
              >
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={keptSafe[i]}
                  onChange={() =>
                    setKept(prev => {
                      const next = blocks.map((_, j) => (prev[j] !== false));
                      next[i] = !next[i];
                      return next;
                    })
                  }
                />
                <span className="whitespace-pre-wrap text-zinc-400">
                  <span className="text-emerald-400/90">{keptSafe[i] ? 'Accept' : 'Reject'}</span>
                  {' '}hunk {i + 1}: {b.replace.slice(0, 140) || b.search.slice(0, 140)}
                  {(b.replace.length > 140 || b.search.length > 140) ? '…' : ''}
                </span>
              </label>
            ))}
          </div>
        ) : !applied && body ? (
          <div className="bg-[#0e0e11] p-2 rounded max-h-24 overflow-y-auto text-[11px] text-zinc-300 whitespace-pre">
            {body.slice(0, 200)}
            {body.length > 200 ? '…' : ''}
          </div>
        ) : null}

        {applyError ? <ErrorCard cause={applyError} /> : null}

        <div className="flex items-center space-x-2 pt-1">
          {!hideApply && (
            <button
              type="button"
              onClick={handleApplyEdit}
              disabled={loading || (blocks.length > 0 && keptSafe.every(k => !k) && tool.status !== 'done' && !applied)}
              className={`flex items-center space-x-1 px-2.5 py-1 rounded text-[11px] font-sans font-medium transition ${
                applied
                  ? 'bg-emerald-600/30 text-emerald-300 border border-emerald-500/40'
                  : 'bg-indigo-600 hover:bg-indigo-500 text-white'
              }`}
            >
              {applied ? (
                <>
                  <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                  <span>{dropIdx.length ? 'Drop rejected hunks' : 'Diff Applied'}</span>
                </>
              ) : (
                <span>Apply accepted hunks</span>
              )}
            </button>
          )}
          {hideApply && (
            <span className="text-[11px] text-zinc-400 font-sans">
              Reviewer cannot apply — Send to Planner
            </span>
          )}

          <button
            type="button"
            onClick={() => onOpenFileInEditor(filePath)}
            className="flex items-center space-x-1 px-2 py-1 text-zinc-400 hover:text-white hover:bg-[#25252e] rounded text-[11px] font-sans transition"
          >
            <Eye className="w-3 h-3" />
            <span>Open in Editor</span>
          </button>
        </div>
      </div>
    );
  }

  if (tool.name === 'run_command') {
    const cmd = tool.body || tool.args?.command || '';
    const handleRun = async () => {
      setLoading(true);
      setCommandError('');
      try {
        if (onRunSingleTool) {
          const updated = await onRunSingleTool(tool);
          const ok = updated.status === 'done';
          setCommandOk(ok);
          setApplied(ok);
          if (!ok && !updated.result) setCommandError('Command failed.');
        } else {
          await onExecuteToolCommand(cmd);
          setCommandOk(true);
          setApplied(true);
        }
      } catch (err: unknown) {
        setCommandOk(false);
        setApplied(false);
        setCommandError(clipErrorCause(err instanceof Error ? err.message : String(err), 'Command failed.'));
      }
      setLoading(false);
    };

    const failed = !commandOk && (tool.status === 'error' || !!commandError);
    const succeeded = commandOk;

    return (
      <div className="bg-[var(--surface-1)] border border-[#2a2a36] rounded-md p-2.5 text-zinc-300 font-mono text-[11px] space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-1.5 truncate">
            <Terminal className="w-3.5 h-3.5 text-sky-400 shrink-0" />
            <span className="font-semibold text-zinc-200">PowerShell Command</span>
          </div>
          <span className={`text-[11px] px-1.5 py-0.5 rounded ${
            failed
              ? 'bg-red-500/20 text-red-300'
              : succeeded
                ? 'bg-emerald-500/20 text-emerald-300'
                : 'bg-sky-500/20 text-sky-300'
          }`}>
            {failed ? 'failed' : succeeded ? 'done' : 'terminal'}
          </span>
        </div>

        <div className="bg-[#0e0e11] p-2 rounded text-[11px] text-zinc-300">
          <code>{cmd}</code>
        </div>

        {commandError ? <ErrorCard cause={commandError} /> : null}

        {tool.result && (
          <div className={`p-2 rounded max-h-32 overflow-y-auto text-[11px] whitespace-pre ${
            failed ? 'bg-red-950/40 text-red-200/90' : 'bg-[#0e0e11] text-zinc-400'
          }`}>
            {tool.result.slice(0, 800)}{tool.result.length > 800 ? '...' : ''}
          </div>
        )}

        <button
          type="button"
          onClick={handleRun}
          disabled={succeeded || loading}
          className={`flex items-center space-x-1 px-2.5 py-1 rounded text-[11px] font-sans font-medium transition ${
            failed
              ? 'bg-rose-600 hover:bg-rose-500 text-white'
              : succeeded
                ? 'bg-emerald-600/30 text-emerald-300 border border-emerald-500/40'
                : 'bg-sky-600 hover:bg-sky-500 text-white'
          }`}
        >
          {loading ? <span>Running…</span> : failed ? <span>Run again</span> : succeeded ? <span>Ran in Terminal</span> : <span>Run in PowerShell</span>}
        </button>
      </div>
    );
  }

  if (tool.name === 'read_file' || tool.name === 'list_dir' || tool.name === 'search' || tool.name === 'read_terminal') {
    const target =
      tool.name === 'read_terminal'
        ? tool.args?.lines
          ? `last ${tool.args.lines} lines`
          : 'IDE terminal'
        : tool.args?.path || tool.args?.query || '.';

    const handleRun = async () => {
      setLoading(true);
      setApplyError('');
      try {
        if (onRunSingleTool) {
          const updated = await onRunSingleTool(tool);
          if (updated.status === 'error') {
            setApplyError(clipErrorCause(updated.result, "Couldn't run this read."));
          }
        } else if (window.electronAPI) {
          const res = await window.electronAPI.execTool(workspacePath, tool.name, tool.args);
          tool.result = res.content || res.error || '(empty)';
          tool.status = res.error ? 'error' : 'done';
          if (res.error) setApplyError(clipErrorCause(res.error, "Couldn't run this read."));
        }
        setApplied(tool.status === 'done');
      } catch (err: unknown) {
        setApplyError(clipErrorCause(err instanceof Error ? err.message : String(err), "Couldn't run this read."));
      }
      setLoading(false);
    };

    const failed = tool.status === 'error' || !!applyError;
    const isDone = !failed && (applied || tool.status === 'done');

    return (
      <div className="bg-[var(--surface-1)] border border-emerald-500/20 rounded-md p-2.5 text-zinc-300 font-mono text-[11px] space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center space-x-1.5 truncate">
            <Eye className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span className="font-semibold text-zinc-200 truncate">{tool.name}: {target}</span>
          </div>
          <div className="flex items-center space-x-2 shrink-0">
            <span className={`text-[11px] px-1.5 py-0.5 rounded font-sans ${
              failed
                ? 'bg-red-500/20 text-red-300'
                : isDone
                  ? 'bg-emerald-500/20 text-emerald-300'
                  : 'bg-zinc-800 text-zinc-400'
            }`}>
              {failed ? 'failed' : isDone ? 'done' : 'pending'}
            </span>
            {!isDone && (
              <button
                type="button"
                onClick={handleRun}
                disabled={loading}
                className="px-2 py-0.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-[11px] font-sans font-medium transition"
              >
                {loading ? 'Reading...' : failed ? 'Retry' : 'Run'}
              </button>
            )}
          </div>
        </div>

        {applyError ? <ErrorCard cause={applyError} /> : null}

        {tool.result && (
          <div className="bg-[#0e0e11] p-2 rounded max-h-28 overflow-y-auto text-[11px] text-zinc-400 whitespace-pre">
            {tool.result.slice(0, 400)}{tool.result.length > 400 ? '...' : ''}
          </div>
        )}
      </div>
    );
  }

  return null;
};
