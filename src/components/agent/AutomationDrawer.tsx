import React from 'react';
import { ChevronDown } from 'lucide-react';
import { HelpTip } from './HelpTip';

export interface AutomationDrawerProps {
  swarmOn: boolean;
  onSwarm: (next: boolean) => void;
  localCount: number;
  cloudCount: number;
  cloudOn: boolean;
  onCloud: (next: boolean) => void;
  autoNode: boolean;
  onAutoNode: (next: boolean) => void;
  autoApply: boolean;
  onAutoApply: (next: boolean) => void;
  autoReview: boolean;
  onAutoReview: (next: boolean) => void;
  fullAuto: boolean;
  onFullAuto: (next: boolean) => void;
}

function Toggle({
  checked,
  onChange,
  label,
  helpTitle,
  help,
  disabled = false,
  hint,
  prominent = false
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  helpTitle: string;
  help: string;
  disabled?: boolean;
  hint?: string;
  prominent?: boolean;
}) {
  return (
    <label
      className={
        prominent
          ? `flex items-start gap-1.5 rounded border border-amber-500/50 bg-amber-500/10 px-1.5 py-1 ${
              disabled ? 'cursor-not-allowed text-zinc-400' : 'cursor-pointer text-zinc-100'
            }`
          : `flex items-center gap-1.5 ${
              disabled
                ? 'cursor-not-allowed text-zinc-400'
                : 'cursor-pointer text-zinc-300 hover:text-zinc-100'
            }`
      }
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={e => onChange(e.target.checked)}
        className={`rounded border-[#31313e] bg-[#1e1e24] text-indigo-500 ${prominent ? 'mt-0.5' : ''}`}
      />
      <span className="flex-1 leading-snug">
        {label}
        {hint ? (
          <span className="block text-[10px] font-normal text-zinc-400 leading-snug mt-0.5">{hint}</span>
        ) : null}
      </span>
      <HelpTip title={helpTitle} align="right">
        <p>{help}</p>
      </HelpTip>
    </label>
  );
}

/** Collapsed home for the switches that write files, call a paid API, or fan out. */
export const AutomationDrawer: React.FC<AutomationDrawerProps> = ({
  swarmOn,
  onSwarm,
  localCount,
  cloudCount,
  cloudOn,
  onCloud,
  autoNode,
  onAutoNode,
  autoApply,
  onAutoApply,
  autoReview,
  onAutoReview,
  fullAuto,
  onFullAuto
}) => {
  const cloudNote = cloudCount > 0 ? ` · ${cloudCount} cloud` : '';
  const summary = fullAuto
    ? 'Full auto'
    : swarmOn || autoNode || autoApply || autoReview || cloudOn
      ? 'On'
      : 'Off';
  return (
    <details className="group rounded-md border border-[#2a2a36] bg-[#14141a]">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-2 py-1.5 text-[11px] font-semibold text-zinc-200 [&::-webkit-details-marker]:hidden">
        <span>Automation</span>
        <span className="flex items-center gap-1 text-zinc-500 font-normal">
          {summary}
          <ChevronDown className="w-3 h-3 transition group-open:rotate-180" />
        </span>
      </summary>
      <div className="px-2 pb-2 space-y-1.5 text-[11px]">
        <Toggle
          checked={fullAuto}
          onChange={onFullAuto}
          prominent
          label="Full auto (accept everything)"
          hint="Saves files, accepts verdicts and plan picks, and keeps going past failed steps. Destructive commands and paid API calls still need you."
          helpTitle="Full auto"
          help="Saves files, accepts verdicts and plan picks, and keeps going past failed steps. Destructive commands and paid API calls still need you."
        />
        <Toggle
          checked={swarmOn}
          onChange={onSwarm}
          label={`Split across GPUs (${localCount} local${cloudNote})`}
          helpTitle="Split across GPUs"
          help="Sends different files to different computers at the same time. Leave this off until a computer is online and you want that."
        />
        <Toggle
          checked={cloudOn}
          onChange={onCloud}
          label="Cloud"
          helpTitle="Cloud"
          help="A paid cloud model plans how to split the work. Your local models still write the files."
        />
        <Toggle
          checked={autoNode}
          onChange={onAutoNode}
          label="Choose a computer for me"
          helpTitle="Choose a computer for me"
          help="For roles left on Auto, picks an online computer and model. A Planner, Coder, or Reviewer pick above is used either way."
        />
        <Toggle
          checked={fullAuto || autoApply}
          onChange={onAutoApply}
          disabled={fullAuto}
          label="Save files automatically"
          helpTitle="Save files automatically"
          help="Writes the agent's file edits to disk without an extra click."
        />
        <Toggle
          checked={fullAuto || autoReview}
          onChange={onAutoReview}
          disabled={fullAuto}
          label="Continue after review"
          helpTitle="Continue after review"
          help="After a pass or fail, keeps going. Off waits for you to accept the review."
        />
        <p className="text-[10px] text-zinc-500 leading-snug">
          These write files, call a paid API, or use every GPU. Leave them off until you want that.
        </p>
      </div>
    </details>
  );
};
