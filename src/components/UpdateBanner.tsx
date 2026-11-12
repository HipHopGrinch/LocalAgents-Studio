import React, { useEffect, useState } from 'react';
import { Download, RefreshCw, X } from 'lucide-react';
import type { AppUpdateStatus } from '../types';

const IDLE: AppUpdateStatus = {
  supported: false,
  state: 'idle',
  currentVersion: '',
  version: null,
  percent: 0,
  message: '',
  error: null
};

function payloadIsUnsigned(status: AppUpdateStatus): boolean {
  return status.unsigned === true;
}

/** Slim bar under the header when an NSIS install can update from GitHub. */
export const UpdateBanner: React.FC = () => {
  const [status, setStatus] = useState<AppUpdateStatus>(IDLE);
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null);

  useEffect(() => {
    if (!window.electronAPI?.getUpdateStatus) return;
    void window.electronAPI.getUpdateStatus().then(setStatus);
    return window.electronAPI.onUpdateStatus(setStatus);
  }, []);

  const unsigned = payloadIsUnsigned(status);
  if (!status.supported && !unsigned) return null;

  const updateVisible =
    status.state === 'available' ||
    status.state === 'downloading' ||
    status.state === 'downloaded' ||
    status.state === 'waiting-idle' ||
    status.state === 'installing' ||
    status.state === 'error';

  const dismissed =
    (status.state === 'available' && !!status.version && status.version === dismissedVersion) ||
    (status.state === 'error' && dismissedVersion === (status.version || status.state));

  const showUpdate = updateVisible && !dismissed;
  if (!showUpdate && !unsigned) return null;

  const busy =
    status.state === 'downloading' ||
    status.state === 'waiting-idle' ||
    status.state === 'installing';

  const onUpdate = () => {
    void window.electronAPI.installUpdate();
  };

  return (
    <div className="shrink-0 border-b border-[#2e2e38] bg-[#14141a] px-3 py-1.5 flex flex-wrap items-center gap-2 text-[11px] text-zinc-200">
      <RefreshCw className={`w-3.5 h-3.5 text-indigo-400 shrink-0 ${busy ? 'animate-spin' : ''}`} />
      <span className="min-w-0 flex-1">
        {unsigned && (
          <span className="text-amber-200">
            <span className="font-semibold">Unsigned build.</span> Signature verification is off.{' '}
          </span>
        )}
        {showUpdate && status.state === 'available' && (
          <>
            Version <span className="font-mono text-indigo-300">{status.version}</span> is available
            {status.currentVersion ? (
              <span className="text-zinc-400"> (you have {status.currentVersion})</span>
            ) : null}
            .
          </>
        )}
        {showUpdate && status.state === 'downloading' && (
          <>
            Downloading update… <span className="font-mono text-indigo-300">{status.percent}%</span>
          </>
        )}
        {showUpdate && status.state === 'downloaded' && (
          <>Update downloaded. Restart to install.</>
        )}
        {showUpdate && status.state === 'waiting-idle' && (
          <>Update ready. Waiting for model calls to finish, then restarting.</>
        )}
        {showUpdate && status.state === 'installing' && <>Restarting to apply the update…</>}
        {showUpdate && status.state === 'error' && (
          <span className="text-amber-300">{status.message || status.error || 'Update failed.'}</span>
        )}
      </span>

      {showUpdate && status.state === 'available' && (
        <button
          type="button"
          onClick={onUpdate}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white font-medium shrink-0"
        >
          <Download className="w-3 h-3" />
          Update
        </button>
      )}

      {showUpdate && (status.state === 'downloaded' || status.state === 'waiting-idle') && (
        <button
          type="button"
          onClick={onUpdate}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white font-medium shrink-0"
        >
          <RefreshCw className="w-3 h-3" />
          Restart to install
        </button>
      )}

      {showUpdate && status.state === 'error' && (
        <button
          type="button"
          onClick={() => void window.electronAPI.checkForUpdate()}
          className="px-2.5 py-1 rounded border border-[#3a3a48] hover:bg-[#252530] text-zinc-200 shrink-0"
        >
          Retry
        </button>
      )}

      {showUpdate && (status.state === 'available' || status.state === 'error') && (
        <button
          type="button"
          onClick={() => setDismissedVersion(status.version || status.state)}
          className="p-1 text-zinc-400 hover:text-zinc-200 shrink-0"
          aria-label="Dismiss"
          title="Dismiss"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
};
