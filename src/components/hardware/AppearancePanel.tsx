import React from 'react';
import { Sliders } from 'lucide-react';

interface AppearancePanelProps {
  uiScale: number;
  onUpdateUiScale: (scale: number) => void;
}

const PRESETS = [
  { label: '80%', short: '80%', val: 0.8 },
  { label: '100% (Default)', short: '100%', val: 1.0 },
  { label: '115%', short: '115%', val: 1.15 },
  { label: '125% (HiDPI)', short: '125%', val: 1.25 },
  { label: '150% (4K)', short: '150%', val: 1.5 },
  { label: '175%', short: '175%', val: 1.75 }
];

export const AppearancePanel: React.FC<AppearancePanelProps> = ({ uiScale, onUpdateUiScale }) => {
  const percent = Math.round(uiScale * 100);
  return (
    <div className="flex-1 p-6 flex flex-col space-y-6 overflow-y-auto">
      <div>
        <h3 className="text-sm font-bold text-zinc-100 flex items-center space-x-2">
          <Sliders className="w-4 h-4 text-indigo-400" aria-hidden="true" />
          <span>UI & Text Scaling</span>
        </h3>
        <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
          Adjust the scaling slider to make text, chat containers, and the code editor comfortable on higher
          resolution screens (1440p, 4K, or high-DPI laptops).
        </p>
      </div>

      <div className="bg-[#121215] border border-[#272730] rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-zinc-200">Scale Factor</span>
          <span className="text-sm font-bold font-mono text-indigo-400 bg-indigo-950/60 px-3 py-0.5 rounded border border-indigo-500/30">
            {percent}%
          </span>
        </div>
        <div className="space-y-2">
          <input
            type="range"
            min="0.75"
            max="1.75"
            step="0.05"
            value={uiScale}
            aria-label="UI scale"
            onChange={e => onUpdateUiScale(parseFloat(e.target.value))}
            className="w-full accent-indigo-500 cursor-pointer h-2 bg-[#25252e] rounded-lg"
          />
          <div className="flex justify-between text-[11px] text-zinc-500 font-mono gap-1">
            <span>75%</span>
            <span>100%</span>
            <span>125%</span>
            <span>150%</span>
            <span>175%</span>
          </div>
        </div>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 pt-1 text-xs">
          {PRESETS.map(item => (
            <button
              key={item.val}
              type="button"
              onClick={() => onUpdateUiScale(item.val)}
              className={`py-2 sm:py-1.5 px-2 rounded font-mono text-center transition border truncate ${
                Math.abs(uiScale - item.val) < 0.02
                  ? 'bg-indigo-600 text-white border-indigo-500 font-bold shadow'
                  : 'bg-[#18181d] text-zinc-400 hover:text-white border-[#272732] hover:bg-[#202026]'
              }`}
              title={item.label}
            >
              <span className="sm:hidden">{item.short}</span>
              <span className="hidden sm:inline">{item.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <span className="text-xs font-semibold text-zinc-300">Live Appearance Preview</span>
        <div className="bg-[#121215] border border-[#272730] rounded-xl p-4 space-y-3">
          <div className="flex items-start space-x-2.5">
            <div className="w-6 h-6 rounded-full bg-indigo-600 flex items-center justify-center text-[11px] font-bold text-white shrink-0">
              AI
            </div>
            <div className="flex-1 bg-[#1e1e24] border border-[#2b2b36] rounded-lg p-3 space-y-2 text-xs leading-relaxed text-zinc-200">
              <p className="font-semibold text-indigo-300">Agent Conductor</p>
              <p>I inspected your project and generated the native application files. Here is the implementation:</p>
              <div className="bg-[#121215] border border-[#2a2a36] rounded p-2 font-mono text-[11px] text-zinc-400">
                <code>&lt;write_file path="src/main.py"&gt;</code>
              </div>
            </div>
          </div>
          <div className="flex items-center justify-between pt-2 border-t border-[#272730] text-[11px] text-zinc-500 gap-2">
            <span>
              Keyboard shortcuts: <kbd className="px-1.5 py-0.5 bg-[#1e1e24] rounded border border-[#30303c] font-mono text-zinc-300">Ctrl +</kbd> to
              zoom in, <kbd className="px-1.5 py-0.5 bg-[#1e1e24] rounded border border-[#30303c] font-mono text-zinc-300">Ctrl -</kbd> to zoom
              out, <kbd className="px-1.5 py-0.5 bg-[#1e1e24] rounded border border-[#30303c] font-mono text-zinc-300">Ctrl 0</kbd> to reset.
            </span>
            {percent !== 100 && (
              <button
                type="button"
                onClick={() => onUpdateUiScale(1)}
                className="text-indigo-400 hover:text-indigo-300 font-medium shrink-0"
              >
                Reset to 100%
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
