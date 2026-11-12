import React from 'react';
import { Lock, RefreshCw, X } from 'lucide-react';

interface AddNodeDialogProps {
  open: boolean;
  name: string;
  url: string;
  nodeType: 'ollama' | 'openai';
  apiKey: string;
  onName: (value: string) => void;
  onUrl: (value: string) => void;
  onType: (value: 'ollama' | 'openai') => void;
  onApiKey: (value: string) => void;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
}

const PRESETS = [
  { label: 'Google Gemini', type: 'openai' as const, name: 'Google Gemini', url: 'https://generativelanguage.googleapis.com/v1beta/openai/' },
  { label: 'xAI Grok', type: 'openai' as const, name: 'xAI Grok', url: 'https://api.x.ai/v1' },
  { label: 'OpenAI', type: 'openai' as const, name: 'OpenAI', url: 'https://api.openai.com/v1' },
  { label: 'OpenRouter', type: 'openai' as const, name: 'OpenRouter', url: 'https://openrouter.ai/api/v1' },
  { label: 'Local Ollama', type: 'ollama' as const, name: 'Local Ollama', url: 'http://localhost:11434' }
];

export const AddNodeDialog: React.FC<AddNodeDialogProps> = ({
  open,
  name,
  url,
  nodeType,
  apiKey,
  onName,
  onUrl,
  onType,
  onApiKey,
  onClose,
  onSubmit
}) => {
  if (!open) return null;
  return (
    <div
      className="absolute inset-0 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4 z-50"
      onMouseDown={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        onSubmit={onSubmit}
        role="dialog"
        aria-modal="true"
        aria-label="Register endpoint node"
        className="bg-[#18181d] border border-[#30303e] rounded-xl p-5 w-full max-w-md space-y-4 shadow-2xl"
      >
        <div className="flex items-center justify-between">
          <span className="text-sm font-bold text-zinc-100">Register Endpoint Node</span>
          <button type="button" onClick={onClose} className="p-1 text-zinc-400 hover:text-white" aria-label="Close add endpoint">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-3 text-xs">
          <div>
            <span className="text-[11px] text-zinc-400 block mb-1.5 font-medium">Quick Presets / Templates</span>
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map(preset => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => {
                    onType(preset.type);
                    onName(preset.name);
                    onUrl(preset.url);
                  }}
                  className="px-2 py-1 rounded bg-[#1f1f28] hover:bg-[#2c2c3b] border border-[#2e2e3e] text-[11px] text-zinc-300 hover:text-white font-medium transition-colors"
                >
                  + {preset.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-[11px] text-zinc-400" htmlFor="new-node-type">
              Endpoint Type
            </label>
            <select
              id="new-node-type"
              value={nodeType}
              onChange={e => onType(e.target.value as 'ollama' | 'openai')}
              className="w-full mt-1 bg-[#121215] border border-[#2a2a36] text-zinc-200 rounded px-2.5 py-1.5 outline-none"
            >
              <option value="ollama">Local / LAN Ollama Node</option>
              <option value="openai">Frontier API (Google Gemini, xAI Grok, OpenAI, OpenRouter)</option>
            </select>
          </div>

          <div>
            <label className="text-[11px] text-zinc-400" htmlFor="new-node-name">
              Node Name
            </label>
            <input
              id="new-node-name"
              type="text"
              autoFocus
              placeholder="e.g. Google Gemini, xAI Grok, or Linux Box 2"
              value={name}
              onChange={e => onName(e.target.value)}
              required
              className="w-full mt-1 bg-[#121215] border border-[#2a2a36] text-zinc-200 rounded px-2.5 py-1.5 outline-none"
            />
          </div>

          <div>
            <label className="text-[11px] text-zinc-400" htmlFor="new-node-url">
              URL
            </label>
            <input
              id="new-node-url"
              type="text"
              placeholder={
                nodeType === 'openai'
                  ? 'https://generativelanguage.googleapis.com/v1beta/openai/ or https://api.x.ai/v1'
                  : 'http://192.168.1.xxx:11434'
              }
              value={url}
              onChange={e => onUrl(e.target.value)}
              required
              className="w-full mt-1 bg-[#121215] border border-[#2a2a36] text-zinc-200 rounded px-2.5 py-1.5 outline-none font-mono text-[11px]"
            />
          </div>

          {nodeType === 'openai' && (
            <div>
              <label className="text-[11px] text-zinc-400" htmlFor="new-node-key">
                API Key
              </label>
              <input
                id="new-node-key"
                type="password"
                placeholder={url.includes('googleapis.com') ? 'AIzaSy... (Gemini API Key)' : 'xai-... or sk-...'}
                value={apiKey}
                onChange={e => onApiKey(e.target.value)}
                className="w-full mt-1 bg-[#121215] border border-[#2a2a36] text-zinc-200 rounded px-2.5 py-1.5 outline-none font-mono text-[11px]"
              />
            </div>
          )}
        </div>

        <div className="flex items-center justify-end space-x-2 pt-2">
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-zinc-400 hover:text-white text-xs">
            Cancel
          </button>
          <button type="submit" className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-xs font-medium">
            Save Node
          </button>
        </div>
      </form>
    </div>
  );
};

interface NodesTransferDialogProps {
  mode: 'export' | 'import' | null;
  passphrase: string;
  confirm: string;
  mergeMode: 'replace' | 'merge';
  busy: boolean;
  error: string | null;
  onPassphrase: (value: string) => void;
  onConfirm: (value: string) => void;
  onMergeMode: (mode: 'replace' | 'merge') => void;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
}

export const NodesTransferDialog: React.FC<NodesTransferDialogProps> = ({
  mode,
  passphrase,
  confirm,
  mergeMode,
  busy,
  error,
  onPassphrase,
  onConfirm,
  onMergeMode,
  onClose,
  onSubmit
}) => {
  if (!mode) return null;
  return (
    <div
      className="absolute inset-0 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4 z-50"
      onMouseDown={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        onSubmit={onSubmit}
        role="dialog"
        aria-modal="true"
        aria-label={mode === 'export' ? 'Export nodes' : 'Import nodes'}
        className="bg-[#18181d] border border-[#30303e] rounded-xl p-5 w-full max-w-sm space-y-3.5 shadow-2xl"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2 text-sm font-bold text-zinc-100">
            <Lock className="w-4 h-4 text-amber-400" aria-hidden="true" />
            <span>{mode === 'export' ? 'Export nodes (encrypted)' : 'Import nodes (encrypted)'}</span>
          </div>
          <button type="button" onClick={onClose} className="p-1 text-zinc-400 hover:text-white" aria-label="Close node transfer">
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-[11px] text-zinc-400 leading-relaxed">
          {mode === 'export'
            ? 'Saves node names, URLs, API keys, model prefs, roles, and benchmarks into a passphrase-locked .enc file. Layout and workspace path are not included.'
            : 'Decrypt a .enc backup and restore cluster nodes. Choose replace (typical after a new EXE) or merge by id/url.'}
        </p>

        <div>
          <label className="text-[11px] text-zinc-400 font-medium" htmlFor="nodes-io-pass">
            Passphrase
          </label>
          <input
            id="nodes-io-pass"
            type="password"
            autoFocus
            autoComplete="new-password"
            value={passphrase}
            onChange={e => onPassphrase(e.target.value)}
            className="w-full mt-1 bg-[#121215] border border-[#2a2a36] text-zinc-200 rounded px-2.5 py-1.5 outline-none text-xs"
            placeholder="Min. 8 characters"
          />
        </div>

        {mode === 'export' && (
          <div>
            <label className="text-[11px] text-zinc-400 font-medium" htmlFor="nodes-io-confirm">
              Confirm passphrase
            </label>
            <input
              id="nodes-io-confirm"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={e => onConfirm(e.target.value)}
              className="w-full mt-1 bg-[#121215] border border-[#2a2a36] text-zinc-200 rounded px-2.5 py-1.5 outline-none text-xs"
            />
          </div>
        )}

        {mode === 'import' && (
          <div className="space-y-1.5">
            <span className="text-[11px] text-zinc-400 font-medium">On import</span>
            <label className="flex items-start space-x-2 text-[11px] text-zinc-300 cursor-pointer">
              <input
                type="radio"
                name="nodes-io-merge"
                checked={mergeMode === 'replace'}
                onChange={() => onMergeMode('replace')}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium text-zinc-200">Replace all nodes</span>
                <span className="block text-zinc-500">Best for restore after a new build</span>
              </span>
            </label>
            <label className="flex items-start space-x-2 text-[11px] text-zinc-300 cursor-pointer">
              <input
                type="radio"
                name="nodes-io-merge"
                checked={mergeMode === 'merge'}
                onChange={() => onMergeMode('merge')}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium text-zinc-200">Merge by id / URL</span>
                <span className="block text-zinc-500">Keep existing nodes; overwrite matches</span>
              </span>
            </label>
          </div>
        )}

        {error && (
          <p className="text-[11px] text-red-400 bg-red-950/30 border border-red-500/30 rounded px-2.5 py-1.5" role="alert">
            {error}
          </p>
        )}

        <div className="flex items-center justify-end space-x-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="px-3 py-1.5 text-zinc-400 hover:text-white text-xs disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !passphrase}
            className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded text-xs font-medium flex items-center space-x-1.5"
          >
            {busy ? <RefreshCw className="w-3 h-3 animate-spin" aria-hidden="true" /> : null}
            <span>{mode === 'export' ? 'Choose save location…' : 'Choose file…'}</span>
          </button>
        </div>
      </form>
    </div>
  );
};
