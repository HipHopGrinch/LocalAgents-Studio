import React, { useEffect, useState } from 'react';
import { Bug, ExternalLink, FolderOpen } from 'lucide-react';

/** Settings path, logs, and GitHub error report. */
export const SupportPanel: React.FC = () => {
  const [settingsFilePath, setSettingsFilePath] = useState('');
  const [logsFilePath, setLogsFilePath] = useState('');
  const [note, setNote] = useState<{ text: string; tone: 'success' | 'error' } | null>(null);
  const [bugReportNote, setBugReportNote] = useState('');
  const [bugReportBusy, setBugReportBusy] = useState(false);

  useEffect(() => {
    if (!window.electronAPI) return;
    window.electronAPI.settingsPath().then(setSettingsFilePath).catch(() => setSettingsFilePath(''));
    window.electronAPI.logsPath?.().then(setLogsFilePath).catch(() => setLogsFilePath(''));
  }, []);

  const flash = (text: string, tone: 'success' | 'error') => {
    setNote({ text, tone });
    window.setTimeout(() => setNote(current => (current?.text === text ? null : current)), 4000);
  };

  return (
    <div className="flex-1 p-6 overflow-y-auto">
      <div className="bg-[#121215] border border-[#272730] rounded-xl p-4 space-y-3">
        <h3 className="text-sm font-bold text-zinc-100">Local settings (not in the EXE)</h3>
        <p className="text-xs text-zinc-400 leading-relaxed">
          Endpoints, API keys, chats, and layout are saved per Windows user under AppData. Shipping or copying the
          portable EXE does not include your machine config. Use Export / Import on the Endpoints section for an
          encrypted node backup across rebuilds.
        </p>
        <code className="block text-[11px] font-mono text-indigo-300/90 break-all bg-[#0e0e11] rounded px-2 py-1.5 border border-[#2a2a34]">
          {settingsFilePath || '%APPDATA%\\LocalAgents Studio\\settings.json'}
        </code>
        <code className="block text-[11px] font-mono text-indigo-300/90 break-all bg-[#0e0e11] rounded px-2 py-1.5 border border-[#2a2a34]">
          {logsFilePath || '%APPDATA%\\LocalAgents Studio\\logs\\studio.log'}
        </code>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => window.electronAPI?.openSettingsFolder()}
            className="inline-flex items-center space-x-1.5 px-2.5 py-1 text-[11px] text-zinc-200 bg-[#1e1e24] hover:bg-[#282830] border border-[#2c2c36] rounded transition"
          >
            <FolderOpen className="w-3.5 h-3.5 text-indigo-400" aria-hidden="true" />
            <span>Open settings folder</span>
          </button>
          <button
            type="button"
            onClick={async () => {
              const res = await window.electronAPI?.readLogTail?.();
              const text = res?.text?.trim();
              if (!text) {
                flash(res?.error || 'No log yet', 'error');
                return;
              }
              try {
                await navigator.clipboard.writeText(text);
                flash('Copied recent logs', 'success');
              } catch {
                flash('Could not copy logs', 'error');
              }
            }}
            className="inline-flex items-center space-x-1.5 px-2.5 py-1 text-[11px] text-zinc-200 bg-[#1e1e24] hover:bg-[#282830] border border-[#2c2c36] rounded transition"
          >
            <span>Copy recent logs</span>
          </button>
          <button
            type="button"
            onClick={() => window.electronAPI?.openLogsFolder?.()}
            className="inline-flex items-center space-x-1.5 px-2.5 py-1 text-[11px] text-zinc-200 bg-[#1e1e24] hover:bg-[#282830] border border-[#2c2c36] rounded transition"
          >
            <FolderOpen className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" />
            <span>Open logs folder</span>
          </button>
          {note && (
            <span className={`text-[11px] ${note.tone === 'error' ? 'text-red-300' : 'text-emerald-300'}`} role={note.tone === 'error' ? 'alert' : 'status'}>
              {note.text}
            </span>
          )}
        </div>

        <div className="mt-1 pt-3 border-t border-[#272730] space-y-2">
          <h4 className="text-xs font-semibold text-zinc-200 flex items-center gap-1.5">
            <Bug className="w-3.5 h-3.5 text-rose-400" aria-hidden="true" />
            Report error on GitHub
          </h4>
          <p className="text-[11px] text-zinc-400 leading-relaxed">
            Opens a new GitHub issue with redacted Studio logs (API keys stripped). Sign in to GitHub in your browser
            to submit. Attach the saved <code className="text-zinc-300">bug-report-*.txt</code> from the logs folder if
            needed.
          </p>
          <textarea
            value={bugReportNote}
            onChange={e => setBugReportNote(e.target.value)}
            rows={3}
            placeholder="What went wrong? (optional but helpful)"
            aria-label="What went wrong"
            className="w-full text-xs bg-[#0e0e11] border border-[#2a2a34] rounded-lg px-2.5 py-2 text-zinc-200 placeholder:text-zinc-600 resize-y min-h-[64px]"
          />
          <button
            type="button"
            disabled={bugReportBusy}
            onClick={async () => {
              if (!window.electronAPI?.reportLogsToGitHub) {
                flash('Update required for GitHub report', 'error');
                return;
              }
              setBugReportBusy(true);
              try {
                const res = await window.electronAPI.reportLogsToGitHub({
                  note: bugReportNote.trim()
                });
                if (res?.error) {
                  flash(res.error, 'error');
                  return;
                }
                if (res?.logText) {
                  try {
                    await navigator.clipboard.writeText(res.logText);
                  } catch {
                    /* clipboard is best-effort */
                  }
                }
                flash(
                  res?.reportName ? `Issue draft opened · ${res.reportName} saved and copied` : 'Issue draft opened',
                  'success'
                );
              } finally {
                setBugReportBusy(false);
              }
            }}
            className="inline-flex items-center space-x-1.5 px-2.5 py-1.5 text-[11px] font-medium text-white bg-rose-600/90 hover:bg-rose-500 disabled:opacity-50 border border-rose-500/40 rounded transition"
          >
            <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{bugReportBusy ? 'Opening…' : 'Submit logs to GitHub'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
