import React from 'react';
import { Sparkles } from 'lucide-react';
import type { AgentPersona, ChatMessage, PlanOption, ToolCall } from '../../types';
import { ErrorCard, clipErrorCause } from './ErrorCard';
import { PlanOptionsCard } from './PlanOptionsCard';
import { ReviewPlanCard } from './ReviewPlanCard';
import { StepVerdictCard } from './StepVerdictCard';
import { ToolActionCard } from './ToolActionCard';
import { scrubStructuredMarkup } from './messageText';

const WINDOW = 40;

export interface MessageListProps {
  messages: ChatMessage[];
  agents: AgentPersona[];
  currentAgent: AgentPersona;
  busy: boolean;
  planActive: boolean;
  tasksOpen: boolean;
  workspacePath: string;
  onApplyFileWrite: (filePath: string, content: string) => Promise<boolean>;
  onExecuteToolCommand: (command: string, opts?: { timeoutSec?: number }) => Promise<string>;
  onOpenFileInEditor: (filePath: string) => void;
  onRunSingleTool?: (tool: ToolCall) => Promise<ToolCall>;
  onRetry: (messageId: string) => void;
  onOpenHardware?: () => void;
  onSelectPlan: (messageId: string, option: PlanOption) => void;
  onSendReview: (messageId: string) => void;
  onContinueReview: (messageId: string) => void;
  onApplyVerdict: (messageId: string) => void;
  onApplyAll: (messageId: string) => void;
}

interface BubbleProps extends Omit<MessageListProps, 'messages'> {
  message: ChatMessage;
}

function agentLabel(message: ChatMessage, agents: AgentPersona[], current: AgentPersona): string {
  const msgAgent =
    agents.find(agent => agent.id === message.agentId) ||
    agents.find(agent => agent.handle === message.personaHandle) ||
    current;
  return message.endpointName ? `${msgAgent.name} (${message.endpointName})` : msgAgent.name;
}

const MessageBubble = React.memo(function MessageBubble({
  message: msg,
  agents,
  currentAgent,
  busy,
  planActive,
  tasksOpen,
  workspacePath,
  onApplyFileWrite,
  onExecuteToolCommand,
  onOpenFileInEditor,
  onRunSingleTool,
  onRetry,
  onOpenHardware,
  onSelectPlan,
  onSendReview,
  onContinueReview,
  onApplyVerdict,
  onApplyAll
}: BubbleProps) {
  const cleaned = React.useMemo(() => {
    if (!msg.display || msg.stepVerdict || msg.reviewPlan) return '';
    return scrubStructuredMarkup(msg.display);
  }, [msg.display, msg.stepVerdict, msg.reviewPlan]);

  const isReviewerMsg = msg.personaHandle === 'reviewer' || !!msg.reviewPlan || !!msg.stepVerdict;
  const tools = isReviewerMsg
    ? (msg.toolCalls || []).filter(tool =>
        ['read_file', 'list_dir', 'search', 'read_terminal'].includes(tool.name)
      )
    : msg.toolCalls || [];
  const showApply = !isReviewerMsg && tools.some(tool => tool.status !== 'done');

  return (
    <div className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
      <div className="flex items-center space-x-1.5 text-[11px] text-zinc-500 mb-1 px-1">
        <span>{msg.role === 'user' ? 'You' : agentLabel(msg, agents, currentAgent)}</span>
        <span>•</span>
        <span>{msg.timestamp}</span>
        {msg.personaHandle && msg.role === 'assistant' && (
          <span className="text-amber-300/90 font-mono bg-amber-950/30 px-1 rounded">{msg.personaHandle}</span>
        )}
        {msg.model && (
          <span className="text-indigo-400 font-mono bg-indigo-950/40 px-1 rounded">{msg.model}</span>
        )}
        {msg.stats?.tokensPerSec ? (
          <span className="text-amber-400 font-mono">{msg.stats.tokensPerSec} tok/s</span>
        ) : null}
      </div>

      <div
        className={`max-w-[95%] rounded-lg p-3 text-xs leading-relaxed ${
          msg.role === 'user'
            ? 'bg-indigo-600 text-white rounded-br-none shadow'
            : 'bg-[#1e1e24] text-zinc-200 border border-[#2b2b36] rounded-bl-none'
        }`}
      >
        {msg.images && msg.images.length > 0 && (
          <div className={`flex flex-wrap gap-1.5 ${msg.display ? 'mb-2' : ''}`}>
            {msg.images.map((src, index) => (
              <img
                key={`${msg.id}-img-${index}`}
                src={src}
                alt={`Attachment ${index + 1}`}
                className="max-h-36 max-w-full rounded border border-white/20 object-contain bg-black/20"
              />
            ))}
          </div>
        )}

        {cleaned ? <div className="whitespace-pre-wrap">{cleaned}</div> : null}

        {msg.notice && msg.role === 'assistant' && !msg.display?.includes(msg.notice) && (
          <div className="mb-2 text-[11px] text-emerald-300/90 font-medium">{msg.notice}</div>
        )}

        {msg.error && msg.role === 'assistant' && (
          <ErrorCard
            className="mt-2"
            cause={clipErrorCause(msg.error, 'The model request failed.')}
            node={msg.endpointName}
            model={msg.model}
            onRetry={() => onRetry(msg.id)}
            onOpenHardware={onOpenHardware}
          />
        )}

        {msg.planOptions &&
          msg.planOptions.length > 0 &&
          !planActive &&
          !tasksOpen &&
          !msg.selectedPlanOptionId && (
            <PlanOptionsCard
              options={msg.planOptions}
              selectedId={msg.selectedPlanOptionId}
              disabled={busy}
              onSelect={option => onSelectPlan(msg.id, option)}
            />
          )}

        {msg.reviewPlan && !msg.stepVerdict && (
          <ReviewPlanCard
            plan={msg.reviewPlan}
            sent={!!msg.reviewSentToCoder}
            disabled={busy}
            onSendToPlanner={() => onSendReview(msg.id)}
            onContinue={msg.reviewNeedsContinue ? () => onContinueReview(msg.id) : undefined}
          />
        )}

        {msg.stepVerdict && (
          <StepVerdictCard
            stepId={msg.stepVerdict.stepId}
            stepTitle={msg.stepVerdict.stepTitle}
            result={msg.stepVerdict.result}
            notes={msg.stepVerdict.notes}
            sent={!!msg.stepVerdictApplied}
            disabled={busy}
            needsConfirm={!!msg.stepVerdictNeedsConfirm}
            onApply={() => onApplyVerdict(msg.id)}
          />
        )}

        {tools.length > 0 && (
          <div className="mt-3 space-y-2 pt-2 border-t border-[#31313e]">
            <div className="flex items-center justify-between">
              <div className="text-[11px] uppercase font-bold text-indigo-300 tracking-wider">
                {isReviewerMsg ? `Exploration (${tools.length}):` : `Workspace Actions (${tools.length}):`}
              </div>
              {showApply && (
                <button
                  type="button"
                  onClick={() => onApplyAll(msg.id)}
                  className="flex items-center space-x-1 text-[11px] font-sans font-medium px-2 py-0.5 bg-indigo-600/30 hover:bg-indigo-600 text-indigo-200 hover:text-white border border-indigo-500/40 rounded transition"
                  title="Apply all proposed changes to workspace"
                >
                  <Sparkles className="w-2.5 h-2.5 text-indigo-300" />
                  <span>Apply All</span>
                </button>
              )}
            </div>
            {tools.map(tool => (
              <ToolActionCard
                key={tool.id}
                tool={tool}
                workspacePath={workspacePath}
                onApplyFileWrite={onApplyFileWrite}
                onExecuteToolCommand={onExecuteToolCommand}
                onOpenFileInEditor={onOpenFileInEditor}
                onRunSingleTool={onRunSingleTool}
                hideApply={isReviewerMsg}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
});

/**
 * Windowed transcript. Only the streaming message object changes each chunk,
 * so memoized bubbles above it skip rendering.
 */
export const MessageList: React.FC<MessageListProps> = ({ messages, ...rest }) => {
  const firstId = messages[0]?.id;
  const [extra, setExtra] = React.useState(0);

  React.useEffect(() => {
    setExtra(0);
  }, [firstId]);

  const limit = WINDOW + extra;
  const hidden = Math.max(0, messages.length - limit);
  const visible = hidden > 0 ? messages.slice(messages.length - limit) : messages;

  return (
    <>
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setExtra(count => count + WINDOW)}
          className="mx-auto mb-1 block px-2.5 py-1 rounded-full border border-[#3a3a48] bg-[#1a1a22] text-[11px] text-zinc-300 hover:text-white hover:border-indigo-500/50"
        >
          Show earlier ({hidden})
        </button>
      )}
      {visible.map(message => (
        <MessageBubble key={message.id} message={message} {...rest} />
      ))}
    </>
  );
};
