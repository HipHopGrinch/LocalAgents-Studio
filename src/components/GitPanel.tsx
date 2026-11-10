import React, { useEffect, useState } from 'react';
import { GitBranch } from 'lucide-react';

interface GitPanelProps {
  workspacePath: string;
}

/** Status, diff, stage, and commit through the Studio terminal. No force-push. */
export const GitPanel: React.FC<GitPanelProps> = ({ workspacePath }) => {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState('');
  const [diff, setDiff] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    const onMsg = (ev: Event) => {
      const text = String((ev as CustomEvent).detail?.message || '').trim();
      if (text) setMessage(text);
    };
    window.addEventListener('la-commit-message', onMsg);
    return () => window.removeEventListener('la-commit-message', onMsg);
  }, []);

  const run = async (command: string) => {
    if (!window.electronAPI?.executeCommand) {
      setNote('Terminal API unavailable');
      return '';
    }
    if (/git\s+push\b/i.test(command) && /(--force|\s-f\b)/i.test(command)) {
      setNote('Force-push is blocked.');
      return '';
    }
    setBusy(command);
    setNote('');
    try {
      const res = await window.electronAPI.executeCommand(command, workspacePath);
      return typeof res?.output === 'string' ? res.output : '';
    } catch (err: any) {
      setNote(err?.message || String(err));
      return '';
    } finally {
      setBusy('');
    }
  };

  const refresh = async () => {
    const out = await run('git status --short; git diff --stat');
    setStatus(out.slice(-2500));
    const patch = await run('git diff');
    setDiff(patch.slice(-8000));
  };

  const stage = async () => {
    await run('git add -A');
    await refresh();
  };

  const draft = () => {
    const body = diff.trim() || status.trim();
    if (!body) {
      setNote('Load git diff first.');
      return;
    }
    window.dispatchEvent(new CustomEvent('la-draft-commit', { detail: { diff: body } }));
    setNote('Asking the local model for a subject line…');
  };

  const commit = async () => {
    // Single-quote for PowerShell so $(...) / $vars / backticks are not expanded.
    const subject = message.replace(/[\r\n]/g, ' ').replace(/'/g, "''").trim();
    if (!subject) {
      setNote('Commit message is empty.');
      return;
    }
    const out = await run(`git commit -m '${subject}'`);
    setNote(out.slice(-500) || 'Commit finished. Check the terminal if git printed nothing.');
    await refresh();
  };

  return (
    <div className="shrink-0 border-b border-[#27272a] bg-[#121215]">
      <button
        type="button"
        onClick={() => {
          setOpen(v => !v);
          if (!open && !status) void refresh();
        }}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-zinc-300 hover:bg-[#18181d]"
      >
        <GitBranch className="w-3.5 h-3.5 text-indigo-300" />
        <span className="font-medium">Git</span>
        <span className="text-zinc-500">{open ? 'hide' : 'status, diff, commit'}</span>
        {busy && <span className="ml-auto text-amber-300 truncate">{busy}</span>}
      </button>
      {open && (
        <div className="px-3 pb-2 space-y-2">
          <div className="flex flex-wrap gap-1.5">
            <button type="button" onClick={() => void refresh()} className="px-2 py-1 rounded bg-[#25252e] text-[11px] text-zinc-200">
              Status
            </button>
            <button type="button" onClick={() => void stage()} className="px-2 py-1 rounded bg-[#25252e] text-[11px] text-zinc-200">
              Stage all
            </button>
            <button type="button" onClick={draft} className="px-2 py-1 rounded bg-[#25252e] text-[11px] text-zinc-200">
              Draft message
            </button>
            <button type="button" onClick={() => void commit()} className="px-2 py-1 rounded bg-indigo-600 text-[11px] text-white">
              Commit
            </button>
          </div>
          <textarea
            value={message}
            onChange={e => setMessage(e.target.value)}
            placeholder="Commit subject"
            rows={2}
            className="w-full bg-[#18181d] border border-[#2c2c38] text-zinc-200 rounded px-2 py-1 text-[11px]"
          />
          {note && <p className="text-[10px] text-zinc-400 whitespace-pre-wrap">{note}</p>}
          <pre className="max-h-28 overflow-auto text-[10px] text-zinc-400 whitespace-pre-wrap bg-[#0e0e11] rounded p-2">
            {status || 'No status yet.'}
          </pre>
        </div>
      )}
    </div>
  );
};
