import React, { useState } from 'react';
import { Lock, MonitorSmartphone } from 'lucide-react';

interface WebLoginProps {
  onSuccess: (token: string) => void;
  login: (password: string) => Promise<{ token: string } | { error: string }>;
}

export const WebLogin: React.FC<WebLoginProps> = ({ onSuccess, login }) => {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res = await login(password);
      if ('error' in res) {
        setError(res.error);
        return;
      }
      onSuccess(res.token);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen w-screen flex items-center justify-center bg-[#121218] text-zinc-100 px-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-xl border border-[#2a2a36] bg-[#1a1a22] p-6 shadow-xl space-y-4"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center">
            <MonitorSmartphone className="w-5 h-5 text-indigo-300" />
          </div>
          <div>
            <h1 className="text-base font-semibold text-white">LocalAgents Web Console</h1>
            <p className="text-[11px] text-zinc-500">Remote control for the Studio host on this network</p>
          </div>
        </div>

        <p className="text-[11px] text-amber-200/90 leading-relaxed border border-amber-500/20 bg-amber-500/5 rounded-lg px-3 py-2">
          Anyone with this password can run terminal commands and edit project files on the host PC.
        </p>

        <label className="block space-y-1.5">
          <span className="text-[11px] font-medium text-zinc-400 flex items-center gap-1.5">
            <Lock className="w-3 h-3" /> Console password
          </span>
          <input
            type="password"
            autoFocus
            autoComplete="current-password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            className="w-full bg-[#121218] border border-[#2a2a36] focus:border-indigo-500 rounded-lg px-3 py-2.5 text-sm outline-none"
            placeholder="Password set in Hardware Settings"
          />
        </label>

        {error && <p className="text-[12px] text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={busy || !password}
          className="w-full py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-sm font-medium transition"
        >
          {busy ? 'Signing in…' : 'Open console'}
        </button>
      </form>
    </div>
  );
};
