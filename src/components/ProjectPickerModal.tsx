import React, { useEffect, useState } from 'react';
import { Folder, FolderPlus, X, RefreshCw } from 'lucide-react';

interface ProjectPickerModalProps {
  open: boolean;
  title?: string;
  onClose: () => void;
  /** Called with absolute path on the Studio host. */
  onPick: (projectPath: string) => void;
}

export const ProjectPickerModal: React.FC<ProjectPickerModalProps> = ({
  open,
  title = 'Projects',
  onClose,
  onPick
}) => {
  const [root, setRoot] = useState('');
  const [projects, setProjects] = useState<{ name: string; path: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  const reload = async () => {
    if (!window.electronAPI?.listProjects) return;
    setBusy(true);
    setError('');
    try {
      const r = (await window.electronAPI.projectsRoot?.()) || '';
      setRoot(r);
      const list = await window.electronAPI.listProjects();
      if (Array.isArray(list)) setProjects(list);
      else setError((list as { error?: string }).error || 'Could not list projects');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load projects');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (open) void reload();
  }, [open]);

  if (!open) return null;

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!window.electronAPI?.createProject || !newName.trim()) return;
    setCreating(true);
    setError('');
    try {
      const res = await window.electronAPI.createProject(newName.trim());
      if (res.error || !res.path) {
        setError(res.error || 'Create failed');
        return;
      }
      setNewName('');
      onPick(res.path);
      onClose();
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] bg-black/70 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-[#161619] border border-[#2e2e38] w-full sm:max-w-md sm:rounded-xl rounded-t-xl shadow-2xl flex flex-col max-h-[85dvh]">
        <div className="h-11 px-3 border-b border-[#27272a] flex items-center justify-between shrink-0">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-zinc-100">{title}</div>
            {root && (
              <div className="text-[10px] font-mono text-zinc-500 truncate" title={root}>
                {root}
              </div>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => void reload()}
              className="p-1.5 text-zinc-400 hover:text-white rounded"
              title="Refresh"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} />
            </button>
            <button type="button" onClick={onClose} className="p-1.5 text-zinc-400 hover:text-white rounded">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1 min-h-0">
          {error && <p className="px-2 py-1 text-[11px] text-red-400">{error}</p>}
          {!busy && projects.length === 0 && !error && (
            <p className="px-2 py-6 text-center text-[11px] text-zinc-500">
              No projects yet. Create a folder below.
            </p>
          )}
          {projects.map(p => (
            <button
              key={p.path}
              type="button"
              onClick={() => {
                onPick(p.path);
                onClose();
              }}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left bg-[#18181d] hover:bg-[#22222c] border border-transparent hover:border-[#2e2e3a] transition"
            >
              <Folder className="w-4 h-4 text-amber-400 shrink-0" />
              <span className="text-sm text-zinc-100 truncate">{p.name}</span>
            </button>
          ))}
        </div>

        <form onSubmit={create} className="p-3 border-t border-[#27272a] space-y-2 shrink-0">
          <div className="text-[10px] uppercase tracking-wide text-zinc-500 font-semibold">New project folder</div>
          <div className="flex gap-2">
            <input
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="MyApp"
              className="flex-1 bg-[#121218] border border-[#2a2a36] rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-500"
            />
            <button
              type="submit"
              disabled={creating || !newName.trim()}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-sm font-medium"
            >
              <FolderPlus className="w-4 h-4" />
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
