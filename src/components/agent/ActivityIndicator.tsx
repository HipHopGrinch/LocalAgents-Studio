import React from 'react';
import type { ChatMessage, PipelineStep } from '../../types';

const BLINK_DELAYS = ['0ms', '180ms', '360ms'];

export interface ActivityIndicatorProps {
  label: string;
  /** Optional structured status. When any of these is set, they replace `label`. */
  persona?: string;
  node?: string;
  model?: string;
  file?: string;
}

const GENERIC_FILES = new Set(['workspace', 'review', 'step verdict']);

function titleWord(value: string): string {
  const text = value.trim();
  if (!text) return '';
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "Coder on 1080 Ti · qwen2.5-coder:14b · writing src/App.tsx" */
export function formatWorkerStatus(parts: {
  persona?: string;
  /** Used when `persona` was stored as a model tag rather than a role. */
  agentHandle?: string;
  node?: string;
  model?: string;
  file?: string;
}): string {
  const model = (parts.model || '').trim();
  const role = (parts.persona || '').trim();
  const handle = (parts.agentHandle || '').trim();
  const roleIsModel =
    !role || role.includes('·') || /\(local\)/i.test(role) || (!!model && role.includes(model));
  const persona = titleWord(roleIsModel ? handle || role : role);
  const node = (parts.node || '').trim();
  const who = persona && node ? `${persona} on ${node}` : persona || node;
  const fileRaw = (parts.file || '').trim();
  const file =
    fileRaw && !GENERIC_FILES.has(fileRaw.toLowerCase()) ? `writing ${fileRaw}` : '';
  return [who, model, file].filter(Boolean).join(' · ');
}

const GENERIC_STATUS = /^(working|generating)$/i;

function usefulStatus(text?: string | null): string {
  const cleaned = (text || '').replace(/\s+/g, ' ').trim();
  if (!cleaned || GENERIC_STATUS.test(cleaned)) return '';
  return cleaned;
}

export interface RunStatus {
  text: string;
  persona?: string;
  node?: string;
  model?: string;
  file?: string;
}

function statusFromStep(step: PipelineStep | undefined, fallback?: ChatMessage): RunStatus | null {
  if (!step && !fallback) return null;
  const persona = step?.role || fallback?.personaHandle;
  const agentHandle = step?.agentHandle || fallback?.personaHandle;
  const node = step?.nodeName || fallback?.endpointName;
  const model = step?.modelName || fallback?.model;
  const file = step?.targetFile;
  const text = formatWorkerStatus({ persona, agentHandle, node, model, file });
  if (!text) return null;
  return { text, persona: titleWord(agentHandle || persona || ''), node, model, file };
}

/**
 * Prefer a live Node Work step, then the activity stack, then the plan notice.
 * Generic "Working" / "Generating" labels are only the last resort.
 */
export function describeRunStatus(input: {
  steps?: PipelineStep[];
  activityLabel?: string | null;
  notice?: string | null;
  message?: ChatMessage;
  peerLabel?: string | null;
}): RunStatus {
  const running =
    input.steps?.find(step => step.status === 'running') ||
    input.message?.pipelineSteps?.find(step => step.status === 'running');
  const fromStep = running ? statusFromStep(running, input.message) : null;
  if (fromStep) return fromStep;

  const activity = usefulStatus(input.activityLabel);
  if (activity) return { text: activity };

  const notice = usefulStatus(input.notice);
  if (notice) return { text: notice };

  const fromMessage = input.message ? statusFromStep(undefined, input.message) : null;
  if (fromMessage) return fromMessage;

  const peer = usefulStatus(input.peerLabel);
  if (peer) return { text: peer };
  return { text: 'Working' };
}

function shortText(text: string, max = 48): string {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max - 1).trimEnd()}…`;
}

/** First readable line, without a leading emoji or markdown fence. */
function displayTail(display: string): string {
  const lines = display
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('```'));
  const last = lines[lines.length - 1] || '';
  const cleaned = last.replace(/^[^A-Za-z0-9]+/, '').replace(/`/g, '');
  return shortText(cleaned);
}

/**
 * Status next to the activity squares. Uses only the latest assistant message:
 * persona, node, model, and file when the running step has them.
 */
export function streamingActivityLabel(message: ChatMessage | undefined): string {
  if (!message) return 'Working';

  const steps = message.pipelineSteps;
  if (steps && steps.length > 0) {
    const running = steps.find(step => step.status === 'running');
    if (running) {
      const line = formatWorkerStatus({
        persona: running.role,
        agentHandle: running.agentHandle,
        node: running.nodeName || message.endpointName,
        model: running.modelName || message.model,
        file: running.targetFile
      });
      return line || 'Working';
    }
    const pending = steps.filter(step => step.status === 'pending').length;
    if (pending > 0) {
      return `Queued · ${pending} file${pending === 1 ? '' : 's'}`;
    }
    const display = message.display || '';
    if (/\btsc\b/i.test(display)) return 'Checking types';
    return displayTail(display) || 'Working';
  }

  if (steps === undefined) return 'Generating';

  const display = (message.display || '').trim();
  const withoutMark = display.replace(/^[^A-Za-z0-9]+/, '');
  if (/^pass 1\b/i.test(withoutMark)) {
    const beforeDetail = withoutMark.split('(')[0].replace(/[—–-]\s*$/, '').trim();
    return shortText(beforeDetail || withoutMark);
  }
  return 'Working';
}

/** Three staggered squares plus a short status. Hidden by the parent when idle. */
export const ActivityIndicator: React.FC<ActivityIndicatorProps> = ({
  label,
  persona,
  node,
  model,
  file
}) => {
  const detail = formatWorkerStatus({ persona, node, model, file });
  const text = detail || label;
  return (
    <div className="flex items-center gap-2 min-w-0 mb-2 px-0.5" role="status" aria-live="polite">
      <span className="flex items-center gap-1 shrink-0" aria-hidden="true">
        {BLINK_DELAYS.map(delay => (
          <span
            key={delay}
            className="block h-1.5 w-1.5 rounded-[2px] bg-amber-400 animate-activity-square motion-reduce:animate-none"
            style={{ animationDelay: delay }}
          />
        ))}
      </span>
      <span className="truncate text-[11px] font-medium text-amber-200/90">{text}</span>
    </div>
  );
};
