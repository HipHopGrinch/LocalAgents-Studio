import React from 'react';
import { Copy, ExternalLink, Eye, EyeOff, Globe, RefreshCw } from 'lucide-react';

export interface WebConsoleStatusView {
  enabled: boolean;
  port: number;
  listening: boolean;
  hasPassword: boolean;
  urls: string[];
  candidateUrls?: string[];
  clientCount: number;
  lanEnabled?: boolean;
  allowShell?: boolean;
  tls?: boolean;
}

export type WebConsoleNoteTone = 'success' | 'error' | 'warning' | 'info';

export interface WebConsolePatch {
  enabled?: boolean;
  port?: number;
  password?: string;
  lanEnabled?: boolean;
  allowShell?: boolean;
  tlsCertPath?: string;
  tlsKeyPath?: string;
}

interface RemotePanelProps {
  webEnabled: boolean;
  webPort: number;
  webPassword: string;
  webShowPassword: boolean;
  webStatus: WebConsoleStatusView | null;
  webBusy: boolean;
  webNote: string;
  webNoteTone: WebConsoleNoteTone;
  lanEnabled: boolean;
  allowShell: boolean;
  tlsCertPath: string;
  tlsKeyPath: string;
  onPortChange: (port: number) => void;
  onPasswordChange: (password: string) => void;
  onToggleShowPassword: () => void;
  onLanEnabledChange: (enabled: boolean) => void;
  onAllowShellChange: (enabled: boolean) => void;
  onTlsCertChange: (path: string) => void;
  onTlsKeyChange: (path: string) => void;
  onApply: (patch: WebConsolePatch) => void;
  onRefresh: () => void;
  onCopied: (url: string) => void;
}

const noteClass: Record<WebConsoleNoteTone, string> = {
  success: 'text-emerald-300',
  info: 'text-indigo-300',
  warning: 'text-amber-300',
  error: 'text-red-300'
};

export const RemotePanel: React.FC<RemotePanelProps> = ({
  webEnabled,
  webPort,
  webPassword,
  webShowPassword,
  webStatus,
  webBusy,
  webNote,
  webNoteTone,
  lanEnabled,
  allowShell,
  tlsCertPath,
  tlsKeyPath,
  onPortChange,
  onPasswordChange,
  onToggleShowPassword,
  onLanEnabledChange,
  onAllowShellChange,
  onTlsCertChange,
  onTlsKeyChange,
  onApply,
  onRefresh,
  onCopied
}) => {
  const passwordTooShort = webPassword.length > 0 && webPassword.length < 8;
  const list =
    (webStatus?.listening ? webStatus.urls : null) || webStatus?.candidateUrls || webStatus?.urls || [];

  return (
    <div className="flex-1 p-6 flex flex-col space-y-5 overflow-y-auto">
      <div>
        <h3 className="text-sm font-bold text-zinc-100 flex items-center space-x-2">
          <Globe className="w-4 h-4 text-indigo-400" aria-hidden="true" />
          <span>Web Console</span>
        </h3>
        <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
          While Studio is running, open the console from a browser on this PC. Off by default. Requires a password of
          at least 8 characters. LAN access and remote commands stay off until you turn them on.
        </p>
      </div>

      <div className="bg-[#121215] border border-amber-500/25 rounded-xl p-4 text-[11px] text-amber-100/90 leading-relaxed">
        A password on a shared network is not a private link. Leave LAN access off unless you trust the network, and
        leave remote commands off unless a phone should be able to run shell and edit files on this PC.
      </div>

      <div className="bg-[#121215] border border-[#272730] rounded-xl p-5 space-y-4">
        <label className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs font-semibold text-zinc-200">Enable web console</div>
            <div className="text-[11px] text-zinc-500">
              {webStatus?.listening
                ? `Listening · ${webStatus.clientCount || 0} client(s)`
                : webStatus?.hasPassword
                  ? 'Password set · not listening'
                  : 'Set a password, then enable'}
            </div>
          </div>
          <input
            type="checkbox"
            checked={webEnabled}
            disabled={webBusy}
            aria-label="Enable web console"
            onChange={e => {
              const on = e.target.checked;
              onApply({ enabled: on, port: webPort });
            }}
            className="w-4 h-4 accent-indigo-500"
          />
        </label>

        <label className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs font-semibold text-zinc-200">Allow LAN access</div>
            <div className="text-[11px] text-zinc-500">
              {lanEnabled
                ? 'Other devices on your network can open the console.'
                : 'Off — this PC only (127.0.0.1).'}
            </div>
          </div>
          <input
            type="checkbox"
            checked={lanEnabled}
            disabled={webBusy}
            aria-label="Allow LAN access"
            onChange={e => onLanEnabledChange(e.target.checked)}
            className="w-4 h-4 accent-indigo-500"
          />
        </label>

        <label className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-semibold text-zinc-200">Allow remote clients to run commands</div>
            <p className="text-[11px] text-amber-300 mt-1 leading-relaxed">
              Warning: phones and other PCs can run terminal commands, agent shell, and MCP tools on this computer.
            </p>
          </div>
          <input
            type="checkbox"
            checked={allowShell}
            disabled={webBusy}
            aria-label="Allow remote clients to run commands"
            onChange={e => onAllowShellChange(e.target.checked)}
            className="w-4 h-4 accent-amber-500 mt-0.5"
          />
        </label>

        <label className="block space-y-1.5">
          <span className="text-[11px] text-zinc-400">Port</span>
          <div className="flex gap-2">
            <input
              type="number"
              min={1024}
              max={65535}
              value={webPort}
              aria-label="Web console port"
              onChange={e => onPortChange(parseInt(e.target.value, 10) || 3847)}
              className="flex-1 bg-[#1a1a20] border border-[#2a2a36] rounded px-2.5 py-1.5 text-sm font-mono outline-none focus:border-indigo-500"
            />
            <button
              type="button"
              disabled={webBusy}
              onClick={() => onApply({ enabled: webEnabled, port: webPort })}
              className="px-3 py-1.5 text-xs rounded bg-[#1e1e24] border border-[#2c2c36] hover:bg-[#282830] text-zinc-200"
            >
              Apply port
            </button>
          </div>
        </label>

        <div className="block space-y-1.5">
          <label className="text-[11px] text-zinc-400" htmlFor="web-console-password">
            {webStatus?.hasPassword ? 'Change password' : 'Set password'} (min 8 characters)
          </label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                id="web-console-password"
                type={webShowPassword ? 'text' : 'password'}
                value={webPassword}
                onChange={e => onPasswordChange(e.target.value)}
                placeholder={webStatus?.hasPassword ? '••••••••' : 'Choose a password'}
                aria-invalid={passwordTooShort}
                aria-describedby={passwordTooShort ? 'web-password-hint' : undefined}
                className={`w-full bg-[#1a1a20] border rounded px-2.5 py-1.5 pr-9 text-sm outline-none focus:border-indigo-500 ${
                  passwordTooShort ? 'border-amber-500/70' : 'border-[#2a2a36]'
                }`}
              />
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
                onClick={onToggleShowPassword}
                aria-label={webShowPassword ? 'Hide password' : 'Show password'}
              >
                {webShowPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>
            <button
              type="button"
              disabled={webBusy || webPassword.length < 8}
              onClick={() =>
                onApply({
                  enabled: webEnabled,
                  port: webPort,
                  password: webPassword
                })
              }
              className="px-3 py-1.5 text-xs rounded bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white"
              title={webPassword.length < 8 ? 'Enter at least 8 characters' : 'Save password'}
            >
              Save
            </button>
          </div>
          {passwordTooShort && (
            <p id="web-password-hint" className="text-[11px] text-amber-300">
              Use at least 8 characters ({webPassword.length}/8).
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block space-y-1.5">
            <span className="text-[11px] text-zinc-400">TLS certificate path</span>
            <input
              type="text"
              value={tlsCertPath}
              onChange={e => onTlsCertChange(e.target.value)}
              placeholder="C:\\path\\to\\cert.pem"
              spellCheck={false}
              className="w-full bg-[#1a1a20] border border-[#2a2a36] rounded px-2.5 py-1.5 text-[11px] font-mono outline-none focus:border-indigo-500"
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-[11px] text-zinc-400">TLS private key path</span>
            <input
              type="text"
              value={tlsKeyPath}
              onChange={e => onTlsKeyChange(e.target.value)}
              placeholder="C:\\path\\to\\key.pem"
              spellCheck={false}
              className="w-full bg-[#1a1a20] border border-[#2a2a36] rounded px-2.5 py-1.5 text-[11px] font-mono outline-none focus:border-indigo-500"
            />
          </label>
        </div>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <p className="text-[11px] text-zinc-500 leading-relaxed">
            Optional. When both paths are set, the console can serve HTTPS. Leave blank for HTTP on this PC.
            {webStatus?.tls ? ' HTTPS is active.' : ''}
          </p>
          <button
            type="button"
            disabled={webBusy || (!tlsCertPath.trim() && !tlsKeyPath.trim())}
            onClick={() => onApply({ tlsCertPath: tlsCertPath.trim(), tlsKeyPath: tlsKeyPath.trim() })}
            className="px-3 py-1.5 text-xs rounded bg-[#1e1e24] border border-[#2c2c36] hover:bg-[#282830] text-zinc-200 shrink-0"
          >
            Save TLS paths
          </button>
        </div>

        {webNote && (
          <p
            className={`text-[11px] ${noteClass[webNoteTone]}`}
            role={webNoteTone === 'error' || webNoteTone === 'warning' ? 'alert' : 'status'}
          >
            {webNote}
          </p>
        )}
      </div>

      <div className="bg-[#121215] border border-[#272730] rounded-xl p-4 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-zinc-200">
            {webStatus?.listening ? 'Listening on' : 'Addresses (after Enable)'}
          </span>
          <button
            type="button"
            onClick={onRefresh}
            className="text-[11px] text-zinc-400 hover:text-white inline-flex items-center gap-1"
          >
            <RefreshCw className="w-3 h-3" aria-hidden="true" /> Refresh
          </button>
        </div>
        {!webStatus?.listening && (
          <p className="text-[11px] text-amber-200/80">
            Turn <span className="font-semibold">Enable web console</span> on (and keep it on). Studio must stay
            running — the browser talks to this PC, not a separate server.
          </p>
        )}
        {list.length === 0 ? (
          <p className="text-[11px] text-zinc-500">Set a port to preview addresses.</p>
        ) : (
          <ul className="space-y-1.5">
            {list.map(url => (
              <li
                key={url}
                className="flex items-center justify-between gap-2 bg-[#0e0e11] border border-[#2a2a34] rounded px-2.5 py-1.5"
              >
                <code
                  className={`text-[11px] font-mono break-all ${
                    webStatus?.listening ? 'text-indigo-300' : 'text-zinc-500'
                  }`}
                >
                  {url}
                </code>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    aria-label={`Copy ${url}`}
                    title="Copy"
                    onClick={() => {
                      void navigator.clipboard.writeText(url);
                      onCopied(url);
                    }}
                    className="p-1 text-zinc-400 hover:text-white"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="p-1 text-zinc-400 hover:text-white"
                    aria-label={`Open ${url}`}
                    title="Open"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};
