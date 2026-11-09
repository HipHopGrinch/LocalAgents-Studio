import React, { useEffect, useRef, useState } from 'react';
import Editor, { OnMount } from '@monaco-editor/react';
import { OpenTab } from '../types';
import { X, Save, FileCode } from 'lucide-react';

interface EditorViewProps {
  tabs: OpenTab[];
  activeTabPath?: string;
  onSelectTab: (path: string) => void;
  onCloseTab: (path: string) => void;
  onContentChange: (path: string, newContent: string) => void;
  onSaveTab: (path: string) => void;
}

export const EditorView: React.FC<EditorViewProps> = ({
  tabs,
  activeTabPath,
  onSelectTab,
  onCloseTab,
  onContentChange,
  onSaveTab
}) => {
  const activeTab = tabs.find(t => t.path === activeTabPath);
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const [selection, setSelection] = useState('');
  const [instruction, setInstruction] = useState('');

  const onMount: OnMount = ed => {
    editorRef.current = ed;
    ed.onDidChangeCursorSelection(() => {
      const model = ed.getModel();
      const range = ed.getSelection();
      const text = model && range ? model.getValueInRange(range) : '';
      setSelection(text.slice(0, 4000));
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

  // Global Ctrl+S handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (activeTabPath) {
          onSaveTab(activeTabPath);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTabPath, onSaveTab]);

  return (
    <div className="flex-1 h-full flex flex-col bg-[#1e1e24] overflow-hidden">
      {/* Tabs Header */}
      <div className="h-9 bg-[#141418] border-b border-[#27272a] flex items-center overflow-x-auto select-none no-scrollbar">
        {tabs.map(tab => {
          const isActive = tab.path === activeTabPath;
          return (
            <div
              key={tab.path}
              onClick={() => onSelectTab(tab.path)}
              className={`group h-full px-3 flex items-center space-x-2 border-r border-[#27272a] text-xs cursor-pointer transition select-none ${
                isActive
                  ? 'bg-[#1e1e24] text-zinc-100 border-t-2 border-t-indigo-500 font-medium'
                  : 'bg-[#141418] text-zinc-400 hover:bg-[#18181d] hover:text-zinc-200'
              }`}
            >
              <FileCode className="w-3.5 h-3.5 text-zinc-400" />
              <span className="truncate max-w-[140px]">{tab.name}</span>
              
              {/* Dirty indicator or Close button */}
              <div className="flex items-center">
                {tab.isDirty && (
                  <span className="w-2 h-2 rounded-full bg-amber-400 group-hover:hidden mr-1" />
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseTab(tab.path);
                  }}
                  className={`p-0.5 rounded hover:bg-[#33333d] hover:text-white ${
                    tab.isDirty ? 'hidden group-hover:block' : ''
                  }`}
                  title="Close (Ctrl+W)"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            </div>
          );
        })}

        {tabs.length > 0 && activeTab?.isDirty && (
          <button
            onClick={() => activeTabPath && onSaveTab(activeTabPath)}
            className="ml-auto mr-3 flex items-center space-x-1.5 px-2 py-0.5 text-xs bg-indigo-600 hover:bg-indigo-500 text-white rounded transition shadow-sm"
          >
            <Save className="w-3 h-3" />
            <span>Save</span>
          </button>
        )}
      </div>

      {/* Editor Body */}
      <div className="flex-1 relative">
        {activeTab ? (
          <Editor
            height="100%"
            language={activeTab.language}
            theme="vs-dark"
            value={activeTab.content}
            onMount={onMount}
            onChange={(value) => onContentChange(activeTab.path, value || '')}
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
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-zinc-500 select-none">
            <div className="text-4xl mb-3">⚡</div>
            <p className="text-sm font-medium text-zinc-400">No file open</p>
            <p className="text-xs text-zinc-600 mt-1">Select a file from the explorer or invoke an agent prompt</p>
          </div>
        )}
      </div>

      {activeTab && selection.trim() && (
        <form
          onSubmit={submitInline}
          className="shrink-0 flex items-center gap-2 px-2 py-1.5 border-t border-[#27272a] bg-[#141418]"
        >
          <span className="text-[10px] text-zinc-500 shrink-0">
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
