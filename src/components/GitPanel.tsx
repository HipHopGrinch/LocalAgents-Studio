import React, { useEffect, useRef, useState } from 'react';
import { GitBranch } from 'lucide-react';

interface GitPanelProps {
  workspacePath: string;
}

type RepoKind = 'unknown' | 'no-folder' | 'not-repo' | 'no-git' | 'ok' | 'error';
type NoteTone = 'info' | 'warn';

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, '').replace(/\r/g, '');
}

function isNotRepo(output: string): boolean {
  return /not a git repository/i.test(output);
}

function isNoGit(output: string): boolean {
  return /not recognized|command not found|ENOENT|No such file or directory/i.test(output);
}

function isNoHead(output: string): boolean {
  return /unknown revision|ambiguous argument 'HEAD'|bad revision 'HEAD'/i.test(output);
}

function friendlyGitError(raw: string): string {
  const text = stripAnsi(raw).trim();
  if (!text) return 'Git command failed.';
  if (isNotRepo(text)) return 'This folder is not a git repository.';
  if (isNoGit(text)) return 'Git is not available on this machine.';
  if (/index\.lock/i.test(text)) return 'Git is busy with another command. Try again in a moment.';
  if (/permission denied|access is denied/i.test(text)) return 'Git could not access a file in this folder.';
  if (/nothing to commit/i.test(text)) return 'Nothing to commit.';
  if (/user\.name|user\.email|please tell me who you are/i.test(text)) {
    return 'Git needs a user.name and user.email before you can commit.';
  }
  if (isNoHead(text)) return 'No commits yet in this repository.';
  const line = text
    .split('\n')
    .map(part => part.trim())
    .find(part => part && !part.startsWith('>') && !/^\[exit\b/.test(part));
  const cleaned = (line || '').replace(/^fatal:\s*/i, '').slice(0, 180);
  if (!cleaned || /^Error:|TypeError|at Object\./.test(cleaned)) return 'Git command failed.';
  return cleaned;
}

function parseStatus(raw: string): { branch: string; changed: number; body: string } {
  const lines = stripAnsi(raw)
    .split('\n')
    .map(line => line.trimEnd())
    .filter(line => line.trim().length > 0);
  const branchLine = lines.find(line => line.startsWith('## '));
  const branch = branchLine ? branchLine.slice(3).split('...')[0].trim() : '';
  const files = lines.filter(line => !line.startsWith('## '));
  return { branch, changed: files.length, body: files.join('\n') };
}

function capText(text: string, max: number): string {
  const clean = stripAnsi(text).trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max)}\n… (truncated)`;
}

/** Status, diff, stage, and commit via silent git:run. No force-push. */
export const GitPanel: React.FC<GitPanelProps> = ({ workspacePath }) => {
  const [open, setOpen] = useState(false);
  const [repoKind, setRepoKind] = useState<RepoKind>('unknown');
  const [branch, setBranch] = useState('');
  const [changed, setChanged] = useState(0);
  const [status, setStatus] = useState('');
  const [diffStat, setDiffStat] = useState('');
  const [diff, setDiff] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const [noteTone, setNoteTone] = useState<NoteTone>('info');
  const [diffReady, setDiffReady] = useState(false);
  const tokenRef = useRef(0);
  const openRef = useRef(open);
  openRef.current = open;

  const refreshRef = useRef<(withDiff: boolean) => Promise<boolean>>(async () => false);

  refreshRef.current = async (withDiff: boolean) => {
    const token = ++tokenRef.current;
    const stale = () => token !== tokenRef.current;
    const root = workspacePath.trim();
    const say = (text: string, tone: NoteTone) => {
      if (stale()) return;
      setNote(text);
      setNoteTone(tone);
    };

    if (!root) {
      if (stale()) return false;
      setRepoKind('no-folder');
      setBranch('');
      setChanged(0);
      setStatus('');
      setDiffStat('');
      setDiff('');
      setDiffReady(false);
      return false;
    }
    if (!window.electronAPI?.gitRun) {
      if (stale()) return false;
      setRepoKind('error');
      say('Git commands are not available in this session.', 'warn');
      return false;
    }

    const runGit = async (args: string[]) => {
      // push is not an allowlisted git:run subcommand.
      if (args[0] === 'push') return { output: 'Force-push is blocked.', code: -1 };
      if (!stale()) setBusy(`git ${args[0] || ''}`.trim());
      try {
        const res = await window.electronAPI.gitRun(args);
        const output = [res?.stdout, res?.stderr, res?.error]
          .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
          .join('\n');
        return {
          output,
          code: typeof res?.code === 'number' ? res.code : 1
        };
      } catch (err: unknown) {
        const raw = err instanceof Error ? err.message : String(err);
        return { output: raw, code: -1 };
      } finally {
        if (!stale()) setBusy('');
      }
    };

    const statusRes = await runGit(['status', '-sb']);
    if (stale()) return false;
    if (isNotRepo(statusRes.output)) {
      setRepoKind('not-repo');
      setBranch('');
      setChanged(0);
      setStatus('');
      setDiffStat('');
      setDiff('');
      setDiffReady(false);
      setNote('');
      return false;
    }
    if (isNoGit(statusRes.output) || (statusRes.code === -1 && !statusRes.output)) {
      setRepoKind('no-git');
      setDiffReady(false);
      say('Git is not available on this machine.', 'warn');
      return false;
    }
    if (statusRes.code !== 0) {
      setRepoKind('error');
      setDiffReady(false);
      say(friendlyGitError(statusRes.output), 'warn');
      return false;
    }

    const parsed = parseStatus(statusRes.output);
    let branchName = parsed.branch;
    if (!branchName) {
      const branchRes = await runGit(['branch', '--show-current']);
      if (stale()) return false;
      if (branchRes.code === 0) branchName = stripAnsi(branchRes.output).trim();
    }
    setRepoKind('ok');
    setBranch(branchName || 'HEAD');
    setChanged(parsed.changed);
    setStatus(parsed.body);
    if (!withDiff) {
      setDiffStat('');
      setDiff('');
      setDiffReady(false);
      return true;
    }

    setDiffReady(false);
    let stat = await runGit(['diff', 'HEAD', '--stat']);
    if (stale()) return false;
    let patch = await runGit(['diff', 'HEAD']);
    if (stale()) return false;
    let diffOk = stat.code === 0 && patch.code === 0;
    if (isNoHead(stat.output) || isNoHead(patch.output)) {
      stat = await runGit(['diff', '--stat']);
      if (stale()) return false;
      patch = await runGit(['diff']);
      if (stale()) return false;
      diffOk = stat.code === 0 && patch.code === 0;
      say('No commits yet. The patch shows unstaged edits to tracked files.', 'info');
    } else if (!diffOk) {
      say(friendlyGitError(stat.output || patch.output), 'warn');
    }
    setDiffStat(capText(diffOk ? stat.output : '', 8000));
    setDiff(capText(diffOk ? patch.output : '', 60000));
    setDiffReady(true);
    return diffOk;
  };

  useEffect(() => {
    const onMsg = (ev: Event) => {
      const text = String((ev as CustomEvent).detail?.message || '').trim();
      if (text) setMessage(text);
    };
    window.addEventListener('la-commit-message', onMsg);
    return () => window.removeEventListener('la-commit-message', onMsg);
  }, []);

  useEffect(() => {
    void refreshRef.current(openRef.current);
    return () => {
      tokenRef.current += 1;
    };
  }, [workspacePath]);

  const stage = async () => {
    if (repoKind !== 'ok') return;
    const ok = window.confirm('Stage all changes in this folder?');
    if (!ok) return;
    if (!window.electronAPI?.gitRun) return;
    setBusy('git add');
    try {
      const res = await window.electronAPI.gitRun(['add', '-A']);
      const output = [res?.stdout, res?.stderr, res?.error].filter(part => typeof part === 'string').join('\n');
      const code = typeof res?.code === 'number' ? res.code : 0;
      if (code !== 0) {
        setNote(friendlyGitError(output));
        setNoteTone('warn');
        return;
      }
    } catch (err: unknown) {
      setNote(friendlyGitError(err instanceof Error ? err.message : String(err)));
      setNoteTone('warn');
      return;
    } finally {
      setBusy('');
    }
    const refreshed = await refreshRef.current(true);
    if (refreshed) {
      setNote('Staged all changes.');
      setNoteTone('info');
    }
  };

  const draft = () => {
    const body = diff.trim() || status.trim();
    if (!body) {
      setNote('Load the diff first.');
      setNoteTone('info');
      return;
    }
    window.dispatchEvent(new CustomEvent('la-draft-commit', { detail: { diff: body } }));
    setNote('Asking the local model for a subject line…');
    setNoteTone('info');
  };

  const commit = async () => {
    const subject = message.replace(/[\r\n]/g, ' ').trim();
    if (!subject) {
      setNote('Commit message is empty.');
      setNoteTone('warn');
      return;
    }
    if (!window.electronAPI?.gitRun) return;
    setBusy('git commit');
    try {
      const res = await window.electronAPI.gitRun(['commit', '-m', subject]);
      const output = [res?.stdout, res?.stderr, res?.error].filter(part => typeof part === 'string').join('\n');
      const code = typeof res?.code === 'number' ? res.code : 0;
      if (code !== 0) {
        setNote(friendlyGitError(output));
        setNoteTone('warn');
      } else {
        const line = stripAnsi(output).split('\n').map(part => part.trim()).find(Boolean);
        setNote(line || 'Commit finished.');
        setNoteTone('info');
      }
    } catch (err: unknown) {
      setNote(friendlyGitError(err instanceof Error ? err.message : String(err)));
      setNoteTone('warn');
    } finally {
      setBusy('');
    }
    await refreshRef.current(true);
  };

  const bar =
    !workspacePath.trim() || repoKind === 'no-folder'
      ? 'No folder open'
      : repoKind === 'not-repo'
        ? 'Not a git repo'
        : repoKind === 'no-git'
          ? 'Git not available'
          : repoKind === 'ok'
            ? `${branch} · ${changed} changed`
            : repoKind === 'error'
              ? 'Git status unavailable'
              : 'status, diff, commit';

  return (
    <div className="shrink-0 border-b border-[var(--border)] bg-[var(--surface-1)]">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next) void refreshRef.current(true);
        }}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-zinc-300 hover:bg-[#18181d]"
      >
        <GitBranch className="w-3.5 h-3.5 text-indigo-300 shrink-0" />
        <span className="font-medium">Git</span>
        <span className="text-zinc-400 truncate">{bar}</span>
        {busy && <span className="ml-auto text-amber-300 truncate">{busy}</span>}
      </button>
      {open && (
        <div className="px-3 pb-2 space-y-2">
          {repoKind === 'no-folder' && (
            <p className="text-[11px] text-zinc-400">No folder open.</p>
          )}
          {repoKind === 'not-repo' && (
            <p className="text-[11px] text-zinc-400">This folder is not a git repository.</p>
          )}
          {repoKind === 'no-git' && (
            <p className="text-[11px] text-amber-200">Git is not available on this machine.</p>
          )}
          {repoKind === 'ok' && (
            <>
              <div className="flex flex-wrap gap-1.5">
                <button type="button" onClick={() => void refreshRef.current(true)} className="px-2 py-1 rounded bg-[#25252e] text-[11px] text-zinc-200">
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
            </>
          )}
          {note && (
            <p className={`text-[11px] whitespace-pre-wrap ${noteTone === 'warn' ? 'text-amber-200' : 'text-zinc-400'}`}>
              {note}
            </p>
          )}
          {repoKind === 'ok' && (
            <>
              <div>
                <div className="text-[11px] text-zinc-400 mb-1">Status</div>
                <pre className="max-h-28 overflow-auto text-[11px] text-zinc-300 whitespace-pre-wrap bg-[#0e0e11] rounded p-2">
                  {status || 'Working tree clean.'}
                </pre>
              </div>
              <div>
                <div className="text-[11px] text-zinc-400 mb-1">Diff stat</div>
                <pre className="max-h-24 overflow-auto text-[11px] text-zinc-300 whitespace-pre-wrap bg-[#0e0e11] rounded p-2">
                  {diffReady ? diffStat || 'No tracked changes.' : 'Loading diff…'}
                </pre>
              </div>
              <div>
                <div className="text-[11px] text-zinc-400 mb-1">Patch</div>
                <pre className="max-h-64 overflow-auto text-[11px] text-zinc-300 whitespace-pre-wrap bg-[#0e0e11] rounded p-2">
                  {diffReady ? diff || 'No patch. Untracked files are listed in status.' : 'Loading patch…'}
                </pre>
              </div>
            </>
          )}
          {repoKind === 'error' && !note && (
            <p className="text-[11px] text-amber-200">Git status could not be read.</p>
          )}
        </div>
      )}
    </div>
  );
};
