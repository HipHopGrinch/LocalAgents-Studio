import React, { useEffect, useState } from 'react';
import { CheckCircle2, Eye, FileEdit, Terminal } from 'lucide-react';
import { ToolCall } from '../../types';
import { applyEdits, parseEditBlocks } from '../../lib/tools';

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
  const [loading, setLoading] = useState(false);
  const [kept, setKept] = useState<boolean[]>([]);

  useEffect(() => {
    if (tool.status === 'done') setApplied(true);
  }, [tool.status]);

  if (tool.name === 'write_file') {
    const filePath = tool.args?.path || 'file';
    const content = tool.body || '';

    const handleApply = async () => {
      setLoading(true);
      if (onRunSingleTool) {
        const res = await onRunSingleTool(tool);
        setApplied(res.status === 'done');
      } else {
        const success = await onApplyFileWrite(filePath, content);
        if (success) {
          tool.status = 'done';
          setApplied(true);
        }
      }
      setLoading(false);
    };

    return (
      <div className="bg-[#121215] border border-[#2a2a36] rounded-md p-2.5 text-zinc-300 font-mono text-[11px] space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-1.5 truncate">
            <FileEdit className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span className="font-semibold text-zinc-200 truncate">{filePath}</span>
          </div>
          <span className="text-[9px] bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded">
            write_file
          </span>
        </div>

        {!applied && content ? (
          <div className="bg-[#0e0e11] p-2 rounded max-h-24 overflow-y-auto text-[10px] text-zinc-400 whitespace-pre">
            {content.slice(0, 200)}
            {content.length > 200 ? '…' : ''}
          </div>
        ) : null}

        <div className="flex items-center space-x-2 pt-1">
          {!hideApply && (
            <button
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
            <span className="text-[10px] text-zinc-500 font-sans">
              Reviewer cannot apply — Send to Planner
            </span>
          )}

          <button
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
          return true;
        }
        onDiffFailed?.();
        return false;
      }
      if (!window.electronAPI) return false;
      const absPath = filePath.includes(':') ? filePath : `${workspacePath}\\${filePath.replace(/^[\\/]+/, '')}`;
      const readRes = await window.electronAPI.readFile(absPath);
      if (readRes.content === undefined) return false;
      const editRes = applyEdits(readRes.content, nextBody);
      if (editRes.content === undefined) {
        alert(`Could not apply diff: ${editRes.error}`);
        onDiffFailed?.();
        return false;
      }
      await onApplyFileWrite(filePath, editRes.content);
      tool.status = 'done';
      setApplied(true);
      return true;
    };

    const handleApplyEdit = async () => {
      const chosen = blocks.filter((_, i) => keptSafe[i]);
      const rejected = blocks.filter((_, i) => !keptSafe[i]);
      if (!chosen.length && !rejected.length) return;
      setLoading(true);
      if (applied || tool.status === 'done') {
        if (rejected.length) {
          await applyBody(hunkBody(rejected.map(b => ({ search: b.replace, replace: b.search }))));
        }
      } else if (chosen.length) {
        await applyBody(hunkBody(chosen));
      }
      setLoading(false);
    };

    return (
      <div className="bg-[#121215] border border-indigo-500/30 rounded-md p-2.5 text-zinc-300 font-mono text-[11px] space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-1.5 truncate">
            <FileEdit className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
            <span className="font-semibold text-zinc-200 truncate">{filePath}</span>
          </div>
          <span className="text-[9px] bg-indigo-500/20 text-indigo-300 px-1.5 py-0.5 rounded">
            SEARCH/REPLACE Diff
          </span>
        </div>

        {blocks.length > 0 ? (
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {blocks.map((b, i) => (
              <label
                key={i}
                className="flex gap-2 items-start bg-[#0e0e11] rounded px-2 py-1 text-[10px]"
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
          <div className="bg-[#0e0e11] p-2 rounded max-h-24 overflow-y-auto text-[10px] text-zinc-300 whitespace-pre">
            {body.slice(0, 200)}
            {body.length > 200 ? '…' : ''}
          </div>
        ) : null}

        <div className="flex items-center space-x-2 pt-1">
          {!hideApply && (
            <button
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
                  <span>{keptSafe.every(Boolean) ? 'Diff Applied' : 'Drop rejected hunks'}</span>
                </>
              ) : (
                <span>Apply accepted hunks</span>
              )}
            </button>
          )}
          {hideApply && (
            <span className="text-[10px] text-zinc-500 font-sans">
              Reviewer cannot apply — Send to Planner
            </span>
          )}

          <button
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
      if (onRunSingleTool) {
        const updated = await onRunSingleTool(tool);
        setApplied(updated.status === 'done' || updated.status === 'error');
      } else {
        await onExecuteToolCommand(cmd);
        setApplied(true);
      }
      setLoading(false);
    };

    const failed = tool.status === 'error';
    const isDone = applied || tool.status === 'done' || failed;

    return (
      <div className="bg-[#121215] border border-[#2a2a36] rounded-md p-2.5 text-zinc-300 font-mono text-[11px] space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-1.5 truncate">
            <Terminal className="w-3.5 h-3.5 text-sky-400 shrink-0" />
            <span className="font-semibold text-zinc-200">PowerShell Command</span>
          </div>
          <span className={`text-[9px] px-1.5 py-0.5 rounded ${
            failed
              ? 'bg-red-500/20 text-red-300'
              : isDone
                ? 'bg-emerald-500/20 text-emerald-300'
                : 'bg-sky-500/20 text-sky-300'
          }`}>
            {failed ? 'failed' : isDone ? 'done' : 'terminal'}
          </span>
        </div>

        <div className="bg-[#0e0e11] p-2 rounded text-[10px] text-zinc-300">
          <code>{cmd}</code>
        </div>

        {tool.result && (
          <div className={`p-2 rounded max-h-32 overflow-y-auto text-[10px] whitespace-pre ${
            failed ? 'bg-red-950/40 text-red-200/90' : 'bg-[#0e0e11] text-zinc-400'
          }`}>
            {tool.result.slice(0, 800)}{tool.result.length > 800 ? '...' : ''}
          </div>
        )}

        <button
          onClick={handleRun}
          disabled={isDone || loading}
          className={`flex items-center space-x-1 px-2.5 py-1 rounded text-[11px] font-sans font-medium transition ${
            failed
              ? 'bg-red-600/30 text-red-200 border border-red-500/40'
              : isDone
                ? 'bg-emerald-600/30 text-emerald-300 border border-emerald-500/40'
                : 'bg-sky-600 hover:bg-sky-500 text-white'
          }`}
        >
          {failed ? <span>Failed — see output</span> : isDone ? <span>Ran in Terminal</span> : <span>Run in PowerShell</span>}
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
      if (onRunSingleTool) {
        await onRunSingleTool(tool);
      } else if (window.electronAPI) {
        const res = await window.electronAPI.execTool(workspacePath, tool.name, tool.args);
        tool.result = res.content || res.error || '(empty)';
        tool.status = res.error ? 'error' : 'done';
      }
      setApplied(tool.status === 'done');
      setLoading(false);
    };

    const isDone = applied || tool.status === 'done';

    return (
      <div className="bg-[#121215] border border-emerald-500/20 rounded-md p-2.5 text-zinc-300 font-mono text-[11px] space-y-1.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-1.5 truncate">
            <Eye className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span className="font-semibold text-zinc-200 truncate">{tool.name}: {target}</span>
          </div>
          <div className="flex items-center space-x-2">
            <span className={`text-[9px] px-1.5 py-0.5 rounded font-sans ${
              isDone
                ? 'bg-emerald-500/20 text-emerald-300'
                : 'bg-zinc-800 text-zinc-400'
            }`}>
              {isDone ? 'done' : 'pending'}
            </span>
            {!isDone && (
              <button
                onClick={handleRun}
                disabled={loading}
                className="px-2 py-0.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-[10px] font-sans font-medium transition"
              >
                {loading ? 'Reading...' : 'Run'}
              </button>
            )}
          </div>
        </div>

        {tool.result && (
          <div className="bg-[#0e0e11] p-2 rounded max-h-28 overflow-y-auto text-[10px] text-zinc-400 whitespace-pre">
            {tool.result.slice(0, 400)}{tool.result.length > 400 ? '...' : ''}
          </div>
        )}
      </div>
    );
  }

  return null;
};
