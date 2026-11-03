import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import './monacoSetup';
import { App } from './App';
import { WebLogin } from './components/WebLogin';
import {
  createWebHostApi,
  getStoredWebToken,
  loginWebConsole,
  setStoredWebToken
} from './lib/hostApi';
import type { ElectronAPI } from './types';
import './index.css';

function Root() {
  const hasElectron = !!(window as Window & { electronAPI?: ElectronAPI }).electronAPI;
  const [ready, setReady] = useState(hasElectron);
  const [bootError, setBootError] = useState('');
  const [needsLogin, setNeedsLogin] = useState(!hasElectron);

  useEffect(() => {
    if (hasElectron) return;
    let cancelled = false;
    const token = getStoredWebToken();
    if (!token) {
      setNeedsLogin(true);
      return;
    }
    createWebHostApi(token)
      .then(api => {
        if (cancelled) return;
        window.__LA_WEB_CONSOLE__ = true;
        (window as Window & { electronAPI: ElectronAPI }).electronAPI = api;
        setNeedsLogin(false);
        setReady(true);
      })
      .catch(() => {
        if (cancelled) return;
        setStoredWebToken(null);
        setNeedsLogin(true);
        setBootError('');
      });
    return () => {
      cancelled = true;
    };
  }, [hasElectron]);

  const handleLogin = async (password: string) => {
    const res = await loginWebConsole(password);
    if ('error' in res) return res;
    try {
      const api = await createWebHostApi(res.token);
      setStoredWebToken(res.token);
      window.__LA_WEB_CONSOLE__ = true;
      (window as Window & { electronAPI: ElectronAPI }).electronAPI = api;
      setNeedsLogin(false);
      setReady(true);
      setBootError('');
      return res;
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'WebSocket connect failed' };
    }
  };

  if (needsLogin && !hasElectron) {
    return <WebLogin login={handleLogin} onSuccess={() => {}} />;
  }

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#121218] text-zinc-400 text-sm">
        {bootError || 'Connecting to Studio host…'}
      </div>
    );
  }

  return <App />;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
