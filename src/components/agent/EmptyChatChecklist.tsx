import React from 'react';
import { Check, Cpu, MessageSquarePlus } from 'lucide-react';

export interface EmptyChatChecklistProps {
  agentName: string;
  agentRole: string;
  folderOpen: boolean;
  nodeOnline: boolean;
  modelReady: boolean;
  onOpenFolder?: () => void;
  onOpenHardware?: () => void;
  onTrySample?: () => void;
}

function Row({
  done,
  title,
  detail,
  actionLabel,
  onAction
}: {
  done: boolean;
  title: string;
  detail: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <li className="flex items-start gap-2">
      <span
        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
          done ? 'border-emerald-500/50 bg-emerald-500/20 text-emerald-300' : 'border-[#3a3a48] text-transparent'
        }`}
        aria-hidden="true"
      >
        <Check className="w-2.5 h-2.5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-medium text-zinc-200">{title}</div>
        <p className="text-[11px] text-zinc-500 leading-snug">{detail}</p>
        {!done && actionLabel && onAction && (
          <button
            type="button"
            onClick={onAction}
            className="mt-1 px-2 py-0.5 rounded border border-indigo-500/40 bg-indigo-600/20 text-[11px] font-medium text-indigo-100 hover:bg-indigo-600/40"
          >
            {actionLabel}
          </button>
        )}
      </div>
    </li>
  );
}

/** First-run path shown when the transcript is empty. */
export const EmptyChatChecklist: React.FC<EmptyChatChecklistProps> = ({
  agentName,
  agentRole,
  folderOpen,
  nodeOnline,
  modelReady,
  onOpenFolder,
  onOpenHardware,
  onTrySample
}) => {
  return (
    <div className="h-full flex flex-col items-center justify-center text-center p-4 text-zinc-500 select-none">
      <MessageSquarePlus className="w-8 h-8 text-indigo-400/60 mb-2" />
      <p className="text-xs font-semibold text-zinc-200">{agentName}</p>
      <p className="text-[11px] text-zinc-500 mt-1">{agentRole}</p>
      <p className="text-[11px] text-zinc-400 mt-2 max-w-sm">
        Four steps, then send a task. Automation stays off until you turn it on.
      </p>
      <ol className="mt-4 w-full max-w-sm text-left space-y-2.5 rounded-xl border border-[#272732] bg-[#18181d] p-3">
        <Row
          done={folderOpen}
          title="Open a folder"
          detail="The agent edits files inside the folder you open."
          actionLabel="Open folder"
          onAction={onOpenFolder}
        />
        <Row
          done={nodeOnline}
          title="Connect a computer"
          detail="Studio talks to Ollama on this PC or another machine on your network."
          actionLabel="Open Hardware"
          onAction={onOpenHardware}
        />
        <Row
          done={modelReady}
          title="Pick a model"
          detail="Enable at least one installed model. A 7B model is enough to try a task."
          actionLabel="Choose models"
          onAction={onOpenHardware}
        />
        <li className="flex items-start gap-2">
          <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-[#3a3a48] text-zinc-500">
            <Cpu className="w-2.5 h-2.5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-medium text-zinc-200">Send one task</div>
            <p className="text-[11px] text-zinc-500 leading-snug">
              A short prompt is filled in so you can read it before sending.
            </p>
            {onTrySample && (
              <button
                type="button"
                onClick={onTrySample}
                className="mt-1 px-2 py-0.5 rounded border border-emerald-500/40 bg-emerald-600/15 text-[11px] font-medium text-emerald-100 hover:bg-emerald-600/30"
              >
                Try a sample prompt
              </button>
            )}
          </div>
        </li>
      </ol>
    </div>
  );
};
