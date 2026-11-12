import React, { lazy, Suspense, useEffect, useRef, useState, type ComponentType } from 'react';
import type { EditorProps, OnMount } from '@monaco-editor/react';
import { OpenTab } from '../types';
import { X, Save, FileCode } from 'lucide-react';

interface EditorViewProps {
  tabs: OpenTab[];
  activeTabPath?: string;
  onSelectTab: (path: string) => void;
  onCloseTab: (path: string) => void;
  onContentChange: (path: string, newContent: string) => void;
  onSaveTab: (path: string) => void;
  /**
   * Ask before calling onCloseTab for a dirty buffer. Default true.
   * App still owns the close; pass false if the parent confirms itself.
   */
  confirmCloseDirty?: boolean;
  /** 1-based cursor line, debounced. Lets the agent cap the open file around the caret. */
  onCursorLine?: (path: string, line: number) => void;
  /** Empty editor can offer to open a project folder. */
  onOpenFolder?: () => void;
  workspacePath?: string;
}

const MonacoEditor = lazy(async () => {
  const setup = await import('../monacoSetup');
  void setup.monaco;
  const mod = await import('@monaco-editor/react');
  return { default: mod.default as ComponentType<EditorProps> };
});

class EditorLoadBoundary extends React.Component<
  { children: React.ReactNode },
  { error: boolean }
> {
  override state = { error: false };
  static getDerivedStateFromError(): { error: boolean } {
    return { error: true };
  }
  override render() {
    if (this.state.error) {
      return (
        <div className="h-full flex items-center justify-center text-[11px] text-rose-300">
          Couldn't load the editor.
        </div>
      );
    }
    return this.props.children;
  }
}

function isEditableOutside(target: EventTarget | null, editorRoot: HTMLElement | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (editorRoot?.contains(target)) return false;
  return !!target.closest('input, textarea, select, [contenteditable="true"]');
}

export const EditorView: React.FC<EditorViewProps> = ({
  tabs,
  activeTabPath,
  onSelectTab,
  onCloseTab,
  onContentChange,
  onSaveTab,
  confirmCloseDirty = true,
  onCursorLine,
  onOpenFolder,
  workspacePath = ''
}) => {
  const activeTab = tabs.find(t => t.path === activeTabPath);
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const cursorCb = useRef(onCursorLine);
  cursorCb.current = onCursorLine;
  const pathRef = useRef(activeTabPath);
  pathRef.current = activeTabPath;
  const [selection, setSelection] = useState('');
  const [instruction, setInstruction] = useState('');

  const requestClose = (path: string) => {
    const tab = tabs.find(t => t.path === path);
    if (confirmCloseDirty && tab?.isDirty) {
      const ok = window.confirm(`Close ${tab.name} without saving?`);
      if (!ok) return;
    }
    onCloseTab(path);
  };

  const onMount: OnMount = ed => {
    editorRef.current = ed;
    let cursorTimer = 0;
    ed.onDidChangeCursorSelection(() => {
      const model = ed.getModel();
      const range = ed.getSelection();
      const text = model && range ? model.getValueInRange(range) : '';
      setSelection(text.slice(0, 4000));
      const line = ed.getPosition()?.lineNumber;
      const path = pathRef.current;
      if (!line || !path || !cursorCb.current) return;
      window.clearTimeout(cursorTimer);
      cursorTimer = window.setTimeout(() => cursorCb.current?.(path, line), 200);
    });
  };

  const submitInline = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeTab || !selection.trim() || !instruction.trim()) return;
    window.dispatchEvent(
      new CustomEvent('la-inline-edit', {
        detail: { path: activeTab.path, selection, instruction: instruction.trim() }
      })
    );
    setInstruction('');
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const meta = e.ctrlKey || e.metaKey;
      if (!meta || e.altKey || e.shiftKey) return;
      const key = e.key.toLowerCase();
      if (key === 's') {
        e.preventDefault();
        if (activeTabPath) onSaveTab(activeTabPath);
        return;
      }
      if (key !== 'w') return;
      e.preventDefault();
      e.stopPropagation();
      if (isEditableOutside(e.target, rootRef.current)) return;
      if (!activeTabPath) return;
      const tab = tabs.find(t => t.path === activeTabPath);
      if (confirmCloseDirty && tab?.isDirty) {
        const ok = window.confirm(`Close ${tab.name} without saving?`);
        if (!ok) return;
      }
      onCloseTab(activeTabPath);
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [activeTabPath, onSaveTab, onCloseTab, tabs, confirmCloseDirty]);

  return (
    <div ref={rootRef} className="flex-1 h-full flex flex-col bg-[var(--surface-3)] overflow-hidden">
      <div className="h-9 bg-[#141418] border-b border-[var(--border)] flex items-center select-none">
        <div role="tablist" aria-label="Open files" className="flex h-full flex-1 overflow-x-auto no-scrollbar">
          {tabs.map(tab => {
            const isActive = tab.path === activeTabPath;
            return (
              <div
                key={tab.path}
                className={`h-full flex items-center border-r border-[var(--border)] text-xs ${
                  isActive
                    ? 'bg-[var(--surface-3)] text-zinc-100 border-t-2 border-t-indigo-500 font-medium'
                    : 'bg-[#141418] text-zinc-400 hover:bg-[#18181d] hover:text-zinc-200'
                }`}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => onSelectTab(tab.path)}
                  className="h-full pl-3 pr-1 flex items-center space-x-2 min-w-0"
                >
                  <FileCode className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                  <span className="truncate max-w-[140px]">{tab.name}</span>
                  {tab.isDirty && (
                    <>
                      <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" title="Unsaved changes" />
                      <span className="sr-only">unsaved</span>
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => requestClose(tab.path)}
                  className="mr-1.5 p-0.5 rounded text-zinc-400 hover:bg-[#33333d] hover:text-white"
                  aria-label={`Close ${tab.name}`}
                  title="Close (Ctrl+W)"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            );
          })}
        </div>

        {tabs.length > 0 && activeTab?.isDirty && (
          <button
            type="button"
            onClick={() => activeTabPath && onSaveTab(activeTabPath)}
            className="ml-auto mr-3 flex items-center space-x-1.5 px-2 py-0.5 text-xs bg-indigo-600 hover:bg-indigo-500 text-white rounded transition shadow-sm shrink-0"
          >
            <Save className="w-3 h-3" />
            <span>Save</span>
          </button>
        )}
      </div>

      <div className="flex-1 relative min-h-0">
        {activeTab ? (
          <EditorLoadBoundary>
            <Suspense
              fallback={
                <div className="h-full flex items-center justify-center text-sm text-zinc-400">
                  Loading editor…
                </div>
              }
            >
              <MonacoEditor
                height="100%"
                language={activeTab.language}
                theme="vs-dark"
                value={activeTab.content}
                onMount={onMount}
                onChange={value => onContentChange(activeTab.path, value || '')}
                options={{
                  fontSize: 13,
                  fontFamily: "'Fira Code', 'Cascadia Code', Consolas, monospace",
                  fontLigatures: true,
                  minimap: { enabled: true, maxColumn: 80 },
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                  tabSize: 2,
                  wordWrap: 'on',
                  lineNumbers: 'on',
                  renderWhitespace: 'selection',
                  smoothScrolling: true,
                  cursorBlinking: 'smooth'
                }}
              />
            </Suspense>
          </EditorLoadBoundary>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-zinc-400 select-none px-6 text-center">
            <div className="text-4xl mb-3">⚡</div>
            <p className="text-sm font-medium text-zinc-300">
              {workspacePath ? 'No file open' : 'Open a folder to start'}
            </p>
            <p className="text-xs text-zinc-400 mt-1 max-w-sm">
              {workspacePath
                ? 'Select a file from the explorer, or ask the agent to create one.'
                : 'Open a project folder, connect Ollama, then send one task from the chat.'}
            </p>
            {!workspacePath && onOpenFolder && (
              <button
                type="button"
                onClick={onOpenFolder}
                className="mt-3 px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium"
              >
                Open folder
              </button>
            )}
          </div>
        )}
      </div>

      {activeTab && selection.trim() && (
        <form
          onSubmit={submitInline}
          className="shrink-0 flex items-center gap-2 px-2 py-1.5 border-t border-[var(--border)] bg-[#141418]"
        >
          <span className="text-[11px] text-zinc-400 shrink-0">
            {selection.trim().split('\n').length} lines
          </span>
          <input
            value={instruction}
            onChange={e => setInstruction(e.target.value)}
            placeholder="Edit this selection…"
            className="flex-1 min-w-0 bg-[#18181d] border border-[#2c2c38] text-zinc-200 rounded px-2 py-1 text-[11px]"
          />
          <button
            type="submit"
            disabled={!instruction.trim()}
            className="px-2 py-1 rounded text-[11px] bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-40"
          >
            Inline edit
          </button>
        </form>
      )}
    </div>
  );
};
