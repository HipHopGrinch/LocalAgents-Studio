import React, { useMemo, useRef, useState } from 'react';
import { WorkspaceFile } from '../types';
import {
  ChevronRight,
  ChevronDown,
  FileCode,
  FileText,
  FilePlus,
  FolderPlus,
  RefreshCw,
  Trash2,
  File
} from 'lucide-react';

interface FileTreeProps {
  files: WorkspaceFile[];
  activeFilePath?: string;
  onFileSelect: (filePath: string) => void;
  onRefresh: () => void;
  onCreateFile: (dirPath: string) => void;
  onCreateFolder: (dirPath: string) => void;
  onDelete: (path: string) => void;
  rootPath: string;
  width?: number | string;
  /** When true, tree fills the parent instead of a fixed sidebar width. */
  fill?: boolean;
  /** Empty workspace. App can wire this to the folder picker next wave. */
  onOpenFolder?: () => void;
}

interface FlatNode {
  file: WorkspaceFile;
  depth: number;
  parentPath: string | null;
}

function visibleNodes(
  items: WorkspaceFile[],
  depth: number,
  parentPath: string | null,
  expanded: Record<string, boolean>,
  sub: Record<string, WorkspaceFile[]>
): FlatNode[] {
  const out: FlatNode[] = [];
  for (const file of items) {
    out.push({ file, depth, parentPath });
    if (file.isDirectory && expanded[file.path]) {
      out.push(...visibleNodes(sub[file.path] || [], depth + 1, file.path, expanded, sub));
    }
  }
  return out;
}

export const FileTree: React.FC<FileTreeProps> = ({
  files,
  activeFilePath,
  onFileSelect,
  onRefresh,
  onCreateFile,
  onCreateFolder,
  onDelete,
  rootPath,
  width = 240,
  fill = false,
  onOpenFolder
}) => {
  const [expandedDirs, setExpandedDirs] = useState<Record<string, boolean>>({});
  const [subDirFiles, setSubDirFiles] = useState<Record<string, WorkspaceFile[]>>({});
  const [loadingDirs, setLoadingDirs] = useState<Record<string, boolean>>({});
  const [dirErrors, setDirErrors] = useState<Record<string, boolean>>({});
  const [focusedPath, setFocusedPath] = useState<string | null>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());

  const visible = useMemo(
    () => visibleNodes(files, 0, null, expandedDirs, subDirFiles),
    [files, expandedDirs, subDirFiles]
  );
  const tabPath = visible.some(node => node.file.path === focusedPath)
    ? focusedPath
    : visible[0]?.file.path ?? null;

  const loadDir = async (dirPath: string) => {
    setDirErrors(prev => {
      if (!prev[dirPath]) return prev;
      const next = { ...prev };
      delete next[dirPath];
      return next;
    });
    if (!window.electronAPI) {
      setDirErrors(prev => ({ ...prev, [dirPath]: true }));
      return;
    }
    setLoadingDirs(prev => ({ ...prev, [dirPath]: true }));
    try {
      const res = await window.electronAPI.readDir(dirPath);
      if (Array.isArray(res)) {
        setSubDirFiles(prev => ({ ...prev, [dirPath]: res }));
      } else {
        setSubDirFiles(prev => ({ ...prev, [dirPath]: [] }));
        setDirErrors(prev => ({ ...prev, [dirPath]: true }));
      }
    } catch {
      setSubDirFiles(prev => ({ ...prev, [dirPath]: [] }));
      setDirErrors(prev => ({ ...prev, [dirPath]: true }));
    } finally {
      setLoadingDirs(prev => ({ ...prev, [dirPath]: false }));
    }
  };

  const toggleDir = async (dirPath: string) => {
    let expanding = false;
    setExpandedDirs(prev => {
      expanding = !prev[dirPath];
      return { ...prev, [dirPath]: expanding };
    });
    if (expanding) await loadDir(dirPath);
  };

  const focusPath = (path: string) => {
    setFocusedPath(path);
    const row = rowRefs.current.get(path);
    row?.focus();
    row?.scrollIntoView({ block: 'nearest' });
  };

  const activate = (file: WorkspaceFile) => {
    setFocusedPath(file.path);
    if (file.isDirectory) void toggleDir(file.path);
    else onFileSelect(file.path);
  };

  const onTreeKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const fromAction = (e.target as HTMLElement).closest('[data-tree-action]');
    if (fromAction && (e.key === 'Enter' || e.key === ' ')) return;
    if (!visible.length) return;
    const index = Math.max(0, visible.findIndex(node => node.file.path === tabPath));
    const current = visible[index];
    if (!current) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = visible[Math.min(visible.length - 1, index + 1)];
      focusPath(next.file.path);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const next = visible[Math.max(0, index - 1)];
      focusPath(next.file.path);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      if (!current.file.isDirectory) return;
      if (!expandedDirs[current.file.path]) {
        void toggleDir(current.file.path);
        return;
      }
      const child = visible[index + 1];
      if (child && child.depth > current.depth) focusPath(child.file.path);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (current.file.isDirectory && expandedDirs[current.file.path]) {
        void toggleDir(current.file.path);
      } else if (current.parentPath) {
        focusPath(current.parentPath);
      }
    } else if (e.key === 'Home') {
      e.preventDefault();
      focusPath(visible[0].file.path);
    } else if (e.key === 'End') {
      e.preventDefault();
      focusPath(visible[visible.length - 1].file.path);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      activate(current.file);
    }
  };

  const handleRefreshAll = () => {
    setSubDirFiles({});
    setDirErrors({});
    onRefresh();
  };

  const getFileIcon = (fileName: string) => {
    if (fileName.endsWith('.tsx') || fileName.endsWith('.ts') || fileName.endsWith('.jsx') || fileName.endsWith('.js')) {
      return <FileCode className="w-4 h-4 text-sky-400 shrink-0" />;
    }
    if (fileName.endsWith('.py')) {
      return <FileCode className="w-4 h-4 text-amber-400 shrink-0" />;
    }
    if (fileName.endsWith('.json') || fileName.endsWith('.yaml') || fileName.endsWith('.yml')) {
      return <FileText className="w-4 h-4 text-emerald-400 shrink-0" />;
    }
    if (fileName.endsWith('.md')) {
      return <FileText className="w-4 h-4 text-purple-400 shrink-0" />;
    }
    return <File className="w-4 h-4 text-zinc-400 shrink-0" />;
  };

  const renderItem = (file: WorkspaceFile, depth = 0) => {
    const isExpanded = !!expandedDirs[file.path];
    const children = subDirFiles[file.path] || [];
    const isLoading = !!loadingDirs[file.path];
    const failed = !!dirErrors[file.path];
    const rowFocused = tabPath === file.path;

    return (
      <div key={file.path} className="flex flex-col">
        <div
          role="treeitem"
          aria-expanded={file.isDirectory ? isExpanded : undefined}
          aria-selected={activeFilePath === file.path}
          aria-level={depth + 1}
          tabIndex={rowFocused ? 0 : -1}
          ref={node => {
            if (node) rowRefs.current.set(file.path, node);
            else rowRefs.current.delete(file.path);
          }}
          style={{ paddingLeft: `${Math.max(8, depth * 14 + 8)}px` }}
          className={`group flex flex-col rounded text-xs transition focus-visible:outline focus-visible:outline-1 focus-visible:outline-indigo-400 ${
            activeFilePath === file.path
              ? 'bg-indigo-600/20 text-indigo-300 font-medium'
              : 'text-zinc-300 hover:bg-[#222226] hover:text-white'
          }`}
          onClick={() => activate(file)}
          onFocus={() => setFocusedPath(file.path)}
        >
          <div className="flex items-center justify-between pr-2 py-1.5 min-w-0">
            <div className="flex items-center space-x-1.5 truncate">
              {file.isDirectory ? (
                isExpanded ? (
                  <ChevronDown className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                )
              ) : (
                getFileIcon(file.name)
              )}
              <span className="truncate">{file.name}</span>
            </div>

            <div
              className={`items-center space-x-1 shrink-0 ${
                failed || rowFocused
                  ? 'flex'
                  : 'hidden group-hover:flex group-focus-within:flex'
              }`}
            >
              {failed && (
                <button
                  type="button"
                  data-tree-action="true"
                  onClick={e => {
                    e.stopPropagation();
                    void loadDir(file.path);
                  }}
                  className="px-1.5 py-0.5 text-[11px] text-rose-200 hover:text-white rounded"
                  aria-label={`Retry reading ${file.name}`}
                >
                  Retry
                </button>
              )}
              {file.isDirectory && (
                <>
                  <button
                    type="button"
                    data-tree-action="true"
                    onClick={e => {
                      e.stopPropagation();
                      onCreateFile(file.path);
                    }}
                    className="p-1 text-zinc-400 hover:text-white rounded"
                    aria-label={`New file in ${file.name}`}
                    title="New file inside this folder"
                  >
                    <FilePlus className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    data-tree-action="true"
                    onClick={e => {
                      e.stopPropagation();
                      onCreateFolder(file.path);
                    }}
                    className="p-1 text-zinc-400 hover:text-white rounded"
                    aria-label={`New folder in ${file.name}`}
                    title="New folder inside this folder"
                  >
                    <FolderPlus className="w-3 h-3" />
                  </button>
                </>
              )}
              <button
                type="button"
                data-tree-action="true"
                onClick={e => {
                  e.stopPropagation();
                  if (confirm(`Delete ${file.name}?`)) {
                    onDelete(file.path);
                  }
                }}
                className="p-1 text-zinc-400 hover:text-red-400 rounded"
                aria-label={`Delete ${file.name}`}
                title="Delete"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          </div>

          {failed && (
            <div
              className="pr-2 pb-1.5 text-[11px] text-rose-300"
              style={{ paddingLeft: '22px' }}
            >
              Couldn't read this folder
            </div>
          )}
        </div>

        {file.isDirectory && isExpanded && !failed && (
          <div role="group">
            {isLoading ? (
              <div
                style={{ paddingLeft: `${(depth + 1) * 14 + 12}px` }}
                className="py-1 text-[11px] text-zinc-400 italic"
              >
                Loading...
              </div>
            ) : children.length === 0 ? (
              <div
                style={{ paddingLeft: `${(depth + 1) * 14 + 12}px` }}
                className="py-1 text-[11px] text-zinc-400 italic"
              >
                (empty folder)
              </div>
            ) : (
              children.map(child => renderItem(child, depth + 1))
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      style={fill ? undefined : { width }}
      className={`h-full bg-[var(--surface-2)] border-r border-[var(--border)] flex flex-col select-none ${
        fill ? 'w-full min-w-0' : 'shrink-0'
      }`}
    >
      <div className="h-9 px-3 border-b border-[var(--border)] flex items-center justify-between text-xs text-zinc-400 font-semibold tracking-wide uppercase">
        <span>Explorer</span>
        <div className="flex items-center space-x-1">
          <button
            type="button"
            onClick={() => onCreateFile(rootPath)}
            disabled={!rootPath}
            className="p-1 hover:text-white hover:bg-[#27272a] rounded transition disabled:opacity-30"
            aria-label="New file in root"
            title="New file in root"
          >
            <FilePlus className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onCreateFolder(rootPath)}
            disabled={!rootPath}
            className="p-1 hover:text-white hover:bg-[#27272a] rounded transition disabled:opacity-30"
            aria-label="New folder in root"
            title="New folder in root"
          >
            <FolderPlus className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={handleRefreshAll}
            disabled={!rootPath}
            className="p-1 hover:text-white hover:bg-[#27272a] rounded transition disabled:opacity-30"
            aria-label="Refresh files"
            title="Refresh files"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div
        className="flex-1 overflow-y-auto py-1 px-1"
        role="tree"
        aria-label="Files"
        onKeyDown={onTreeKeyDown}
      >
        {!rootPath ? (
          <div className="p-4 text-center space-y-2">
            <p className="text-xs text-zinc-400">Open a project</p>
            {onOpenFolder && (
              <button
                type="button"
                onClick={onOpenFolder}
                className="px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium"
              >
                Open a project
              </button>
            )}
          </div>
        ) : files.length === 0 ? (
          <div className="p-4 text-center text-xs text-zinc-400">This folder is empty</div>
        ) : (
          files.map(file => renderItem(file, 0))
        )}
      </div>
    </div>
  );
};
