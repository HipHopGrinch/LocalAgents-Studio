import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import {
  AgentPersona,
  ApprovedPlan,
  EndpointNode,
  NodeConfig,
  ChatMessage,
  ToolCall,
  OpenTab,
  PipelineStep,
  ChatConversation,
  ExecutionQueue,
  PlannerPlan,
  AppSettings,
  RoleRoutes,
  ConductorRoleId,
  PlannerResumePhase,
  PlanOption,
  WorkspaceFile,
  LiveConductorState
} from '../types';
import {
  Send,
  Square,
  Cpu,
  Sparkles,
  Paperclip,
  Cloud,
  Plus,
  History,
  Trash2,
  Brain,
  ImagePlus,
  X,
  Shrink,
  SlidersHorizontal,
  ScrollText
} from 'lucide-react';
import { SplitHandle } from './ui/SplitHandle';
import { AutoConfigConfirm } from './hardware/AutoConfigConfirm';
import { useStableCallback } from '../hooks/useStableCallback';
import { useStickToBottom } from '../hooks/useStickToBottom';
import { useNodeWorkCollapse } from '../hooks/useNodeWorkCollapse';
import { usePaneDrag } from '../hooks/usePaneDrag';
import { formatConversationTime } from '../lib/conversations';
import {
  CONTROL_DEFAULT,
  CONTROL_MAX,
  CONTROL_MIN,
  NODE_WORK_DEFAULT,
  NODE_WORK_MAX,
  NODE_WORK_MIN,
  NODE_WORK_RAIL,
  TRANSCRIPT_MIN,
  fitInnerColumns
} from '../lib/paneLayout';
import {
  parseResponse,
  buildSystemPrompt,
  buildDevHostPromptSection,
  getEnabledModelsForNode,
  getPreferredModelForNode,
  pickBestModelForComplexity,
  pickFailoverTarget,
  rankModelsForWeight,
  selectBestEndpointForTask,
  isFrontierNode,
  stripThinking,
  looksLikeCreateIntent,
  continuationClosedWrite,
  hasUnclosedWrite,
  truncatedWriteToolCall,
  anchorWritePath,
  safeAssistantDisplay,
  annotateAppliedWrites
} from '../lib/tools';
import {
  assignSwarmTasksToCluster,
  buildContractRepairPrompt,
  buildLeadArchitectPrompt,
  buildRepairWorkerPrompt,
  buildSwarmWorkerPrompt,
  buildSwarmWorkerSystemStub,
  fallbackSwarmManifest,
  findLeadArchitect,
  groupTscErrorsByFile,
  isTypeScriptContractPath,
  endpointQueueKey,
  parseSwarmManifest,
  partitionSwarmTasksIntoWaves,
  queueAssignmentsByGpu,
  shouldRejectPlannerWrite,
  looksLikePlaceholderCode,
  looksLikePlannerProse,
  type SwarmAssignment,
  type SwarmManifest
} from '../lib/swarmContract';
import {
  activityLabelOf,
  popActivity,
  pushActivity,
  removeActivity,
  topActivityHandle,
  type ActivityHandle,
  type StudioActivity
} from '../lib/studioActivity';
import {
  deliveryToStack,
  manifestNeedsWebScaffold,
  mergeEssentialWebPackageJson,
  planWebScaffoldWrites,
  shouldReplaceScaffoldIndexHtml
} from '../lib/projectScaffold';
import { verifyCommandForStack, type DeliveryStack } from '../lib/deliveryIntent';
import {
  emptyProjectBrain,
  extractAtMentions,
  formatProjectBrainForPrompt,
  parseProjectBrain,
  preferredExistingPath,
  projectBrainPath,
  rememberOwnedFile,
  rulesCandidatePaths,
  rulesDir,
  shouldPreserveContract,
  type ProjectBrain
} from '../lib/projectBrain';
import {
  buildRepoMap,
  formatRepoMap,
  invalidateRepoMap,
  listSourceFolderFiles,
  relevantFilesForTask,
  type RepoMap
} from '../lib/repoMap';
import {
  annotateMissingDependencies,
  beginVerify,
  commandOutputFailed,
  DEPENDENCY_RETRY_MESSAGE,
  errorFingerprint,
  filesFromErrors,
  formatErrorsForCoder,
  localTscPowerShellCommand,
  parseCompilerErrors,
  typesCannotResolve,
  typescriptVerifyUsesCompiler,
  verifyOutputFailed
} from '../lib/verifyGate';
import {
  ELECTRON_DIST_TIMEOUT_SEC,
  decideElectronDist,
  distCommandFailed,
  electronOutputDirs,
  endElectronDist,
  summarizeElectronDist,
  terminalLooksLikeRunningDist,
  tryBeginElectronDist,
  type PackageBuildConfig
} from '../lib/electronDist';
import {
  MAX_COMMAND_FIX_ATTEMPTS,
  autoApplyWritableTools,
  buildContinuationUserPrompt,
  collapseDuplicateReadTools,
  collectFeedbackTools,
  executeTool,
  failedCommandSignatures,
  historyForModel,
  isEmptyTerminalResult,
  isReadOnlyToolBatch,
  latestTerminalResult,
  runCommandTools,
  runAuxTools,
  runReadOnlyTools,
  shouldContinueFromTools,
  terminalResultFingerprint,
  toolContinuationLimit
} from '../lib/agentLoop';
import {
  MISSING_REVIEW_VERDICT_NOTICE,
  MISSING_REVIEW_VERDICT_WAIT_NOTICE,
  boundReviewContinuation,
  needsReviewVerdictTurn,
  nonPlanReviewLacksMarkup,
  reviewFollowUpBudget,
  reviewPreloadCaps,
  reviewVerdictNowInstruction
} from '../lib/reviewTurn';
import { streamChat } from '../lib/ollamaClient';
import {
  createRunLog,
  runLogPath,
  shapeToolForRunLog,
  summarizeStats,
  type RunLog,
  type RunLogInput,
  type RunLogSettings,
  type RunLogStats
} from '../lib/runLog';
import { PlannerPlanPanel } from './agent/PlannerPlanPanel';
import { ErrorCard, clipErrorCause } from './agent/ErrorCard';
import { NodeWorkPanel } from './agent/NodeWorkPanel';
import { HelpTip } from './agent/HelpTip';
import { ActivityIndicator, describeRunStatus } from './agent/ActivityIndicator';
import { MessageList } from './agent/MessageList';
import { ContextMeter } from './agent/ContextMeter';
import { EmptyChatChecklist } from './agent/EmptyChatChecklist';
import { AutomationDrawer } from './agent/AutomationDrawer';
import { snapshotNodeConfigs } from './agent/snapshotNodes';
import { scrubStructuredMarkup } from './agent/messageText';
import {
  modelSupportsThinking,
  resolveThinkOption,
  thinkFalseForSidePaths,
  thinkingToggleLabel,
  type ThinkPersona
} from '../lib/thinking';
import {
  capActiveFileForTier,
  clampNumCtx,
  formatCtxLabel,
  modelContextSelect,
  pinnedNumCtx,
  resolveModelMaxContext,
  type DynamicCtxRole
} from '../lib/contextSize';
import {
  conductorRoleForPersona,
  explicitPickStatus,
  explicitRolePick,
  normalizeRoleRoutes,
  resolveRoleRoute,
  roleRouteLabel,
  sameRoleRoutes
} from '../lib/roleRoutes';
import {
  lastContextMeter,
  notePromptSample,
  ollamaOptions,
  pinnedChatOptions,
  prependVolatileContext,
  siblingFile,
  warmModels
} from './agent/modelRequest';
import {
  contextWasExhausted,
  estimatePromptTokens,
  fitPromptToContext,
  shrinkUserPacket
} from '../lib/contextMonitor';
import { webEntryVerifyErrors } from '../lib/webEntryGate';
import { resolveModelFit, type ModelFitTier } from '../lib/clusterInventory';
import {
  ASSIST_MAX_PREDICT,
  FREE_TIER_ASSIST_SYSTEM,
  bumpFreeTierUsage,
  isRateLimitError,
  pickFreeTierAssist,
  rateLimitBackoffMs,
  waitForFreeTierRpm,
  pickPaidFrontier,
  tailForAssist,
  type FreeTierUsage
} from '../lib/freeTierAssist';
import {
  escalationMatchesRoute,
  isRepeatStop,
  latestCoderRoute,
  latestStepWritePaths,
  priorStepWritePaths,
  nextStuckStage,
  resolveStuckStage,
  shouldEscalateStuck,
  stripKeepFixingPrefix,
  stuckKey,
  type StuckStage
} from '../lib/stuckEscalation';
import { compactMessages, historyTokens, shouldCompact } from '../lib/compactChat';
import {
  advanceNext,
  avoidRepeat,
  emptyWorkLog,
  hasWorkLog,
  noteSavedFiles,
  noteUserTurn,
  parseWorkLog,
  rememberAsked,
  renderWorkLog,
  verifyFingerprintChanged,
  workLogPath,
  type WorkLog
} from '../lib/workLog';
import { fileToChatImage, modelSupportsVision, selectImagesForTier, toOllamaBase64 } from '../lib/images';
import {
  buildApprovedPlan,
  buildPlanSummary,
  findPendingPlanMessage,
  findPlanOriginalRequest,
  formatApprovedPlanBrief,
  formatApprovedPlanContext,
  formatApprovedPlanForSwarm,
  coerceDirtyReviewPlan,
  extractFixContractBrief,
  formatReviewPlanForCoder,
  formatReviewPlanForPlanner,
  formatReworkEscalationForPlanner,
  matchPlanOption,
  parseExecutionPlan,
  parsePlanOptions,
  parseReviewDelta,
  parseReviewPlan,
  parseStepVerdict,
  stripFixContractMarkup,
  stripPlanOptionMarkup,
  stripReviewDeltaMarkup,
  stripReviewPlanMarkup,
  stripStepVerdictMarkup
} from '../lib/planOptions';
import {
  chooseFullAutoPlanOption,
  fullAutoPickNotice,
  messagesFromOrigin,
  nayNotesFromReviewerProse,
  nayNotesFromToolErrors,
  newestReviewerMessage,
  canReaskMissingVerdict,
  pendingPlanChoice,
  pickExplicitStepVerdict,
  releaseCoderRedispatch,
  rememberVerdictReask,
  takeCoderRedispatch,
  VERDICT_REASK_PROMPT,
  type FullAutoStepGate
} from '../lib/fullAuto';
import {
  applyReviewDelta,
  createQueueFromReviewPlan,
  formatActiveTaskForPlanner,
  formatQueueForReviewer,
  getActiveTask,
  hasOpenTasks,
  markInProgress,
  markStopped,
  pickNextPending,
  queueToReviewPlan
} from '../lib/executionQueue';
import {
  activateNextStep,
  appendPlannerPlan,
  applyStepVerdict,
  canHealAdvanceOnGreenVerify,
  collectStepFilePaths,
  createPlanFromParsed,
  editStepTask,
  formatPlanForPanel,
  formatStepForCoders,
  formatStepForReviewer,
  getActiveStep,
  pickHealStep,
  continuePastFailedStep,
  insertFixStepsAfter,
  isPlanActive,
  markPlanFinalReview,
  markStepInProgress,
  MAX_HEAL_ATTEMPTS,
  MAX_PLAN_ESCALATIONS,
  MAX_PLAN_STEPS,
  MAX_STEP_REWORKS,
  notesLookLikeVerifyFailure,
  parsePlannerPlanJson,
  planReadyForRelease,
  plannerPlanFromReviewQueue,
  plannerPlanPath,
  retryFailedStep,
  skipStep,
  stepLooksLikeFixStep,
  writePlannerPlan
} from '../lib/plannerPlan';
import { transition, type RunToken } from '../lib/conductor';
import {
  failUnfinishedNodeWork,
  findNodeWorkIndex,
  stopUnfinishedWork,
  upsertNodeWork
} from '../lib/nodeWork';
import { isWebConsoleClient } from '../lib/hostApi';
import {
  awaitConductorChat,
  useConductorSession,
  type ConductorRun
} from '../hooks/useConductorSession';
import { assignSwarmDiagnostics } from './agent/swarmDiagnostics';
import {
  buildContinuationReviewPrompt,
  buildTouchedFilesContext,
  collectWrittenPaths,
  CONTINUATION_REVIEW_SYSTEM,
  filterInspectionContinue,
  MAX_AUTO_CONTINUATIONS,
  parseNextStep,
  liveRoutePin,
  pickCapableReviewTarget,
  pickFinalSourceReviewTarget,
  pickLargestLocalTarget,
  parseFinalReview,
  stripNextStepMarkup,
  taskFixesWrittenFiles,
  tasksTooSimilar
} from '../lib/continuationReview';
import {
  applyClusterAutoConfigPlan,
  buildClusterAutoConfigPlan,
  type ClusterAutoConfigPlan
} from '../lib/clusterAdvisor';
import { normalizeClusterNodes } from '../lib/tools';

interface AgentChatProps {
  agents: AgentPersona[];
  selectedAgentId: string;
  onSelectAgent: (id: string) => void;
  nodes: EndpointNode[];
  activeTab?: OpenTab;
  workspacePath: string;
  workspaceFiles?: WorkspaceFile[];
  /** Ignored. The agent pane flexes; the code column uses editorWidth. */
  width?: number | string;
  /** Fill parent (mobile web console). */
  fill?: boolean;
  /** Right orchestration column width inside the conductor */
  controlWidth?: number;
  onControlWidthChange?: (width: number) => void;
  /** Far-right Node Work column width */
  nodeWorkWidth?: number;
  onNodeWorkWidthChange?: (width: number) => void;
  /** Shown conductor and node-work widths, including the collapsed rail. Not persisted. */
  onChromeWidthsChange?: (control: number, node: number) => void;
  onSelectNodeModel?: (nodeId: string, model: string) => void;
  onApplyFileWrite: (filePath: string, content: string) => Promise<boolean>;
  onExecuteToolCommand: (
    command: string,
    opts?: { timeoutSec?: number }
  ) => Promise<string>;
  onOpenFileInEditor: (filePath: string) => void;
  onRecordTokens: (localTokens: number, frontierTokens: number) => void;
  /** Count one free-tier assist call against that node's daily cap. */
  onNoteFreeTierCall?: (nodeId: string) => void;
  /** Active chat thread (controlled by App) */
  conversation: ChatConversation | null;
  workspaceConversations: ChatConversation[];
  onMessagesChange: (messages: ChatMessage[]) => void;
  onConversationPatch?: (
    patch: Partial<
      Pick<ChatConversation, 'approvedPlan' | 'executionQueue' | 'plannerPlan' | 'agentId'>
    >
  ) => void;
  onNewChat: () => void;
  /** Wipe chat threads only. Project brain and source files stay. */
  onClearProjectChats?: () => void;
  onSelectConversation: (id: string) => void;
  onDeleteConversation: (id: string) => void;
  /** Persist think on/off for a model on a node */
  onToggleModelThinking?: (nodeId: string, modelName: string, enabled: boolean) => void;
  searxngUrl?: string;
  /** Local MCP server JSON from Settings. */
  mcpServersJson?: string;
  /** First-run conductor defaults, then the user's saved toggles. */
  swarmEnabled?: boolean;
  autoNodeEnabled?: boolean;
  autoApplyEnabled?: boolean;
  autoReviewEnabled?: boolean;
  /** Accept verdicts, plan picks, and failed steps. Missing / omitted means off. */
  fullAutoEnabled?: boolean;
  cloudStrategistEnabled?: boolean;
  /** Saved per-role computer and model. A missing role means Auto. */
  roleRoutesEnabled?: RoleRoutes;
  onConductorPrefsChange?: (
    patch: Partial<
      Pick<
        AppSettings,
        | 'swarmEnabled'
        | 'autoSelectEndpoint'
        | 'autoApplyWrites'
        | 'autoReview'
        | 'fullAuto'
        | 'cloudStrategistEnabled'
        | 'roleRoutes'
      >
    >
  ) => void;
  /** Allow Conductor quick Auto-Configure Cluster button to update node configs */
  onUpdateNodes?: (nodes: NodeConfig[]) => void;
  /** Inner tool-loop budget (settings.maxAgentSteps). */
  maxAgentSteps?: number;
  /** True while a local/frontier agent turn (or stuck ladder) is in flight — blocks update restart. */
  onBusyChange?: (busy: boolean) => void;
  /** Open Hardware Settings when a run fails. Omitted until App wires it. */
  onOpenHardware?: () => void;
  /** Open the project folder picker. Used by the empty-chat checklist. */
  onOpenFolder?: () => void;
  /** Peer conductor snapshot (from live session) — toggles + Generating indicator. */
  peerConductor?: LiveConductorState | null;
  /** Live messages from the peer for the active conversation (streaming mirror). */
  peerChatMirror?: { conversationId: string; messages: ChatMessage[] } | null;
  /** Publish local conductor / chat mirror upward for live session. */
  onLiveConductorPublish?: (payload: {
    conductor: LiveConductorState;
    chatMirror: { conversationId: string; messages: ChatMessage[] } | null;
  }) => void;
  /** Desktop palette calls this to copy the in-memory run log. */
  onRunLogApi?: (api: { copy: () => void } | null) => void;
}

function runLogFailureCount(stats: RunLogStats): number {
  return stats.failureTotal;
}

export const AgentChat: React.FC<AgentChatProps> = ({
  agents,
  selectedAgentId,
  onSelectAgent,
  nodes,
  activeTab,
  workspacePath,
  workspaceFiles,
  fill = false,
  controlWidth = 270,
  onControlWidthChange,
  nodeWorkWidth = 280,
  onNodeWorkWidthChange,
  onChromeWidthsChange,
  onApplyFileWrite,
  onExecuteToolCommand,
  onOpenFileInEditor,
  onRecordTokens,
  onNoteFreeTierCall,
  conversation,
  workspaceConversations,
  onMessagesChange,
  onConversationPatch,
  onNewChat,
  onClearProjectChats,
  onSelectConversation,
  onDeleteConversation,
  onToggleModelThinking,
  searxngUrl = '',
  mcpServersJson = '',
  swarmEnabled = false,
  autoNodeEnabled = true,
  autoApplyEnabled = true,
  autoReviewEnabled = true,
  fullAutoEnabled = false,
  cloudStrategistEnabled = true,
  roleRoutesEnabled,
  onConductorPrefsChange,
  onUpdateNodes,
  maxAgentSteps = 12,
  onBusyChange,
  onOpenHardware,
  onOpenFolder,
  peerConductor = null,
  peerChatMirror = null,
  onLiveConductorPublish,
  onRunLogApi
}) => {
  const toolStepLimit = toolContinuationLimit(maxAgentSteps);
  const currentAgent = agents.find(a => a.id === selectedAgentId) || agents[0];
  const coderAgent = agents.find(a => a.handle === 'coder' || a.id === 'coder') || agents[0];
  const plannerAgent = agents.find(a => a.handle === 'planner' || a.id === 'planner') || agents[0];
  const reviewerAgent = agents.find(a => a.handle === 'reviewer' || a.id === 'reviewer') || agents[0];
  const isPlannerSelected =
    currentAgent.handle === 'planner' || currentAgent.id === 'planner';
  const isReviewerSelected =
    currentAgent.handle === 'reviewer' || currentAgent.id === 'reviewer';

  // Per-role computer + model. Empty role means Auto. Never overwritten by a finished turn.
  const [roleRoutes, setRoleRoutes] = useState<RoleRoutes>(() => normalizeRoleRoutes(roleRoutesEnabled));
  const roleRoutesRef = useRef(roleRoutes);
  roleRoutesRef.current = roleRoutes;
  /** Web picker edit: the next conductor publish asks the desktop to save it. */
  const roleRoutesEditRef = useRef(false);
  /** Bumps once per model turn so a fallback is logged again on the next turn. */
  const routeEpochRef = useRef(0);
  const fallbackLogKeyRef = useRef('');
  const [autoSelectEndpoint, setAutoSelectEndpoint] = useState<boolean>(autoNodeEnabled);
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const autoSelectRef = useRef(autoSelectEndpoint);
  autoSelectRef.current = autoSelectEndpoint;
  const [includeActiveFile, setIncludeActiveFile] = useState(true);
  const [isPipelineMode, setIsPipelineMode] = useState(swarmEnabled);
  const pipelineModeRef = useRef(isPipelineMode);
  pipelineModeRef.current = isPipelineMode;
  const [autoApplyWrites, setAutoApplyWrites] = useState<boolean>(autoApplyEnabled);
  const autoApplyWritesRef = useRef(autoApplyEnabled);
  /** After each coding step: Reviewer runs; ON = auto Send to Planner→Coder / continue, OFF = wait for user */
  const [autoReview, setAutoReview] = useState(autoReviewEnabled);
  const autoReviewRef = useRef(autoReviewEnabled);
  /** Saved "accept everything" toggle. Effective apply/review OR this in; the saved boxes stay put. */
  const [fullAuto, setFullAuto] = useState(fullAutoEnabled);
  const fullAutoRef = useRef(fullAutoEnabled);
  const fullAutoGateRef = useRef<FullAutoStepGate | null>(null);
  const runLogsRef = useRef(new Map<string, RunLog>());
  const runLogRef = useRef(createRunLog());
  const logRunImplRef = useRef<(event: RunLogInput) => void>(() => {});
  const logRun = (event: RunLogInput) => {
    logRunImplRef.current(event);
  };
  const activeRunLogIdRef = useRef<number | null>(null);
  const runLogTimerRef = useRef<number | null>(null);
  const runLogFailRef = useRef(0);
  const runLogGenerationRef = useRef(0);
  const runLogWriteChainRef = useRef<Promise<void>>(Promise.resolve());
  const runLogSaveErrorRef = useRef<string | null>(null);
  const runLogMountedRef = useRef(true);
  const copyRunLogRef = useRef<() => void>(() => {});
  const lastNoticeRef = useRef<string | null>(null);
  /** End-of-run tsc heals. Reset when a new owned Conductor run starts. */
  const finalVerifyHealsRef = useRef(0);
  const appVersionRef = useRef('');
  /** Folder that is open right now. */
  const workspacePathRef = useRef(workspacePath);
  workspacePathRef.current = workspacePath;
  /** Folder the in-memory log belongs to. A folder change starts a new buffer. */
  const logWorkspaceRef = useRef(workspacePath);
  const runLogMenuRef = useRef<HTMLDivElement>(null);
  const autoApplyOn = () => fullAutoRef.current || autoApplyWritesRef.current;
  const autoReviewOn = () => fullAutoRef.current || autoReviewRef.current;
  const verdictReaskAllowed = (stepId: string) =>
    canReaskMissingVerdict(fullAutoGateRef.current, stepId);
  const markVerdictReasked = (stepId: string) => {
    fullAutoGateRef.current = rememberVerdictReask(fullAutoGateRef.current, stepId);
    logRun({
      kind: 'user',
      action: 'auto',
      stepId,
      text: `Re-ask verdict for step #${stepId}`
    });
  };
  /** Spends the step's one coder retry before the nested dispatch awaits. False when it is already spent. */
  const takeCoderRedispatchOnce = (stepId: string): boolean => {
    const taken = takeCoderRedispatch(fullAutoGateRef.current, stepId);
    if (!taken.allowed) return false;
    fullAutoGateRef.current = taken.gate;
    logRun({
      kind: 'user',
      action: 'auto',
      stepId,
      text: `Coder re-dispatch for step #${stepId}`
    });
    return true;
  };
  const giveBackCoderRedispatch = (stepId: string) => {
    fullAutoGateRef.current = releaseCoderRedispatch(fullAutoGateRef.current, stepId);
  };
  const [cloudStrategist, setCloudStrategist] = useState<boolean>(cloudStrategistEnabled);
  const cloudStrategistRef = useRef(cloudStrategistEnabled);
  cloudStrategistRef.current = cloudStrategist;
  /** Resume depth when user approval is required after a post-step review */
  const pendingReviewResumeRef = useRef<{ depth: number; previousTask: string } | null>(null);
  /**
   * When true, Coder/Reviewer model calls get a cleared context (system + task packet only).
   * Planner keeps durable state via plan/work log; workers do not inherit the full chat.
   */
  const ephemeralWorkerRef = useRef(false);

  const [input, setInput] = useState('');
  const [pendingImages, setPendingImages] = useState<string[]>([]);
  /**
   * Switching chats on the desktop stops our run, so nothing in the chat being opened is live.
   * A mirror of another client's run is left as saved. App does the same for chats loaded from disk.
   */
  const ownsReopenedChat = () => !isWebConsoleClient() && !peerConductor?.isStreaming;
  const reopenMessages = (saved: ChatMessage[]) =>
    ownsReopenedChat() ? stopUnfinishedWork(saved) : saved;
  const [messages, setMessages] = useState<ChatMessage[]>(conversation?.messages || []);
  const [isStreaming, setIsStreaming] = useState(false);
  useEffect(() => {
    onBusyChange?.(isStreaming);
    return () => onBusyChange?.(false);
  }, [isStreaming, onBusyChange]);
  const conductorRevisionRef = useRef(0);
  const applyingPeerConductorRef = useRef(false);
  /** A publish skipped during the peer-apply window. It runs again when the window ends. */
  const pendingPublishRef = useRef(false);
  const peerConductorRef = useRef(peerConductor);
  peerConductorRef.current = peerConductor;
  const [publishRetry, setPublishRetry] = useState(0);
  const peerConductorRevAppliedRef = useRef(0);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [runLogOpen, setRunLogOpen] = useState(false);
  const [runLogCopyState, setRunLogCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [runLogSaveError, setRunLogSaveError] = useState<string | null>(null);
  const [runLogFailures, setRunLogFailures] = useState(0);
  const [assistError, setAssistError] = useState<{ cause: string; node?: string; model?: string } | null>(null);
  const [autoConfigPlan, setAutoConfigPlan] = useState<ClusterAutoConfigPlan | null>(null);
  const [autoConfigMode, setAutoConfigMode] = useState<'confirm' | 'applied'>('confirm');
  const [autoConfigUndo, setAutoConfigUndo] = useState<NodeConfig[] | null>(null);
  /** Mobile fill mode: full-screen Conductor sheet */
  const [mobileControlsOpen, setMobileControlsOpen] = useState(false);
  /** Banner after user picks a plan option — Coder is running the locked plan */
  const [executingPlanNotice, setExecutingPlanNotice] = useState<string | null>(null);
  /** Nested activity so Generating chrome stays up during install/tsc/Pass gaps. */
  const [activityStack, setActivityStack] = useState<StudioActivity[]>([]);
  const activityStackRef = useRef<StudioActivity[]>([]);
  const beginActivity = (
    phase: StudioActivity['phase'],
    label: string,
    detail?: string
  ) => {
    const next = pushActivity(activityStackRef.current, phase, label, detail);
    activityStackRef.current = next;
    setActivityStack(next);
    setExecutingPlanNotice(activityLabelOf(next));
    return topActivityHandle(next) as ActivityHandle;
  };
  /** With a handle, removes exactly that frame (no-op if a Stop already cleared it). No argument pops the top. */
  const endActivity = (handle?: ActivityHandle) => {
    const next =
      handle === undefined
        ? popActivity(activityStackRef.current)
        : removeActivity(activityStackRef.current, handle);
    if (next === activityStackRef.current && handle !== undefined) return;
    activityStackRef.current = next;
    setActivityStack(next);
    setExecutingPlanNotice(activityLabelOf(next));
  };
  const [projectBrain, setProjectBrain] = useState<ProjectBrain>(emptyProjectBrain());
  const projectBrainRef = useRef<ProjectBrain>(emptyProjectBrain());
  const projectRulesRef = useRef('');
  const repoMapRef = useRef<RepoMap | null>(null);
  const repoMapGenRef = useRef(0);
  /** Fit tier for tool-result caps. Updated when a turn's route is known. */
  const toolResultTierRef = useRef<ModelFitTier>('standard');
  const finalReviewPlanIdRef = useRef<string | null>(null);
  /** Set after finishVerifiedPlan is created — heal completion runs before that const. */
  const finishVerifiedPlanRef = useRef<
    (plan: PlannerPlan, parent?: ConductorRun | null) => Promise<void>
  >(async () => {});
  const rulesCapFor = (tier: 'tight' | 'standard' | 'wide') =>
    tier === 'wide' ? 16000 : tier === 'tight' ? 4000 : 6000;
  const [pinnedFiles, setPinnedFiles] = useState<string[]>([]);
  const commitProjectBrain = (next: ProjectBrain) => {
    const stamped = { ...next, updatedAt: Date.now() };
    projectBrainRef.current = stamped;
    setProjectBrain(stamped);
    if (!workspacePath || !window.electronAPI?.writeFile) return;
    void window.electronAPI.writeFile(projectBrainPath(workspacePath), JSON.stringify(stamped, null, 2));
  };
  const projectContextForPrompt = (maxRules = 6000) =>
    formatProjectBrainForPrompt(projectBrainRef.current, projectRulesRef.current, maxRules);
  const noteOwnedPath = (rel: string | undefined) => {
    if (!rel) return;
    const next = rememberOwnedFile(projectBrainRef.current, rel);
    if (next !== projectBrainRef.current && next.ownedFiles.length !== projectBrainRef.current.ownedFiles.length) {
      commitProjectBrain(next);
    }
  };
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const newChatRef = useRef<() => void>(() => {});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const conductor = useConductorSession();
  const {
    stopRequestedRef,
    runRef,
    heldRef,
    editProgressRef,
    isCurrent: runIsCurrent,
    live: runLive,
    registerAbort,
    enter: enterConductorRun,
    leave: leaveConductorSession,
    stop: stopConductorSession
  } = conductor;
  const messagesRef = useRef<ChatMessage[]>([]);
  /** Plan option clicked while a planner turn still holds the conductor run. */
  const stashedPlanChoiceRef = useRef<{
    messageId: string;
    option: PlanOption;
    confirmation: string;
  } | null>(null);
  const abandonedPlanPicksRef = useRef<Set<string>>(new Set());
  /** Write/edit tools from the coder turn just dispatched, keyed by step id. */
  const coderTurnWritesRef = useRef<{ stepId: string; tools: ToolCall[] } | null>(null);
  const continuationDepthRef = useRef(0);
  const commandFixAttemptsRef = useRef(0);
  const writeFixAttemptsRef = useRef(0);
  const prevFailedCmdSigsRef = useRef<string[]>([]);
  const conversationIdRef = useRef<string | null>(conversation?.id ?? null);
  const approvedPlanRef = useRef<ApprovedPlan | null>(conversation?.approvedPlan ?? null);
  const executionQueueRef = useRef<ExecutionQueue | null>(conversation?.executionQueue ?? null);
  const plannerPlanRef = useRef<PlannerPlan | null>(conversation?.plannerPlan ?? null);
  const [plannerPlanView, setPlannerPlanView] = useState<PlannerPlan | null>(
    conversation?.plannerPlan ?? null
  );
  /** Auto-review Nay reworks per step id — caps infinite Coder↔Reviewer loops. */
  const stepReworkCountRef = useRef<Record<string, number>>({});
  /** Pre-coder file bytes keyed by step id. Capped at 2 MB across the map. */
  const stepSnapshotsRef = useRef<Map<string, { path: string; content: string }[]>>(new Map());
  const STEP_SNAPSHOT_CAP = 2 * 1024 * 1024;
  /** True after Stop, restart, or disk hydrate while a durable plan is still active. */
  const [planPaused, setPlanPausedState] = useState(() => isPlanActive(conversation?.plannerPlan));
  const planPausedRef = useRef(isPlanActive(conversation?.plannerPlan));
  const setPlanPaused = (next: boolean) => {
    planPausedRef.current = next;
    setPlanPausedState(next);
  };
  /** Live Node Work column (Swarm + single-node workers). */
  const [nodeWorkSteps, setNodeWorkSteps] = useState<PipelineStep[]>([]);
  const nodeWorkStepsRef = useRef<PipelineStep[]>([]);
  /** False when these cards were mirrored from the other window, so we do not publish an empty list over them. */
  const nodeWorkOwnedRef = useRef(false);
  const syncNodeWork = (next: PipelineStep[], owned = true) => {
    nodeWorkStepsRef.current = next;
    setNodeWorkSteps(next);
    nodeWorkOwnedRef.current = owned;
  };
  const upsertNodeWorkStep = (step: PipelineStep, indexHint?: number) => {
    syncNodeWork(upsertNodeWork(nodeWorkStepsRef.current, step, indexHint));
  };
  const failUnfinishedWork = (content: string) => {
    const prev = nodeWorkStepsRef.current;
    const next = failUnfinishedNodeWork(prev, content);
    if (next !== prev) syncNodeWork(next);
  };
  type RunLogFlushTarget = { root: string; conversationId: string; generation: number };
  const runLogHeader = (root: string): Record<string, string> => {
    const header: Record<string, string> = {};
    if (appVersionRef.current) header.version = appVersionRef.current;
    if (root) header.workspace = root;
    return header;
  };
  const noteRunLogSaveError = (message: string | null) => {
    runLogSaveErrorRef.current = message;
    if (runLogMountedRef.current) setRunLogSaveError(message);
  };
  const logForFlush = (target: RunLogFlushTarget) => {
    if (target.conversationId === conversationIdRef.current) return runLogRef.current;
    return runLogsRef.current.get(target.conversationId) ?? null;
  };
  const flushRunLog = (target: RunLogFlushTarget): Promise<void> => {
    if (isWebConsoleClient()) return Promise.resolve();
    if (!target.root || !target.conversationId || !window.electronAPI?.writeFile) return Promise.resolve();
    if (target.root !== workspacePathRef.current) return Promise.resolve();
    if (target.generation !== runLogGenerationRef.current) return Promise.resolve();
    const source = logForFlush(target);
    if (!source) return Promise.resolve();
    const markdown = source.formatMarkdown({ header: runLogHeader(target.root) });
    const path = runLogPath(target.root, target.conversationId);
    const generation = target.generation;
    const root = target.root;
    const job = runLogWriteChainRef.current.then(async () => {
      if (isWebConsoleClient()) return;
      if (root !== workspacePathRef.current || generation !== runLogGenerationRef.current) return;
      try {
        const res = await window.electronAPI.writeFile(path, markdown);
        if (root !== workspacePathRef.current || generation !== runLogGenerationRef.current) return;
        if (!runLogMountedRef.current) return;
        noteRunLogSaveError(res?.error || null);
      } catch (err) {
        if (root !== workspacePathRef.current || generation !== runLogGenerationRef.current) return;
        if (!runLogMountedRef.current) return;
        noteRunLogSaveError(err instanceof Error ? err.message : String(err));
      }
    });
    runLogWriteChainRef.current = job.then(
      () => undefined,
      () => undefined
    );
    return job;
  };
  const captureFlushTarget = (conversationId?: string | null): RunLogFlushTarget | null => {
    const root = logWorkspaceRef.current;
    const id = conversationId ?? conversationIdRef.current;
    if (!root || !id) return null;
    return { root, conversationId: id, generation: runLogGenerationRef.current };
  };
  const flushRunLogNow = (conversationId?: string | null): Promise<void> => {
    if (runLogTimerRef.current != null) {
      window.clearTimeout(runLogTimerRef.current);
      runLogTimerRef.current = null;
    }
    const target = captureFlushTarget(conversationId);
    if (!target) return Promise.resolve();
    return flushRunLog(target);
  };
  const scheduleRunLog = () => {
    if (isWebConsoleClient()) return;
    const target = captureFlushTarget();
    if (!target) return;
    if (runLogTimerRef.current != null) window.clearTimeout(runLogTimerRef.current);
    runLogTimerRef.current = window.setTimeout(() => {
      runLogTimerRef.current = null;
      void flushRunLog(target);
    }, 1500);
  };
  const syncRunLogBadge = () => {
    const count = runLogFailureCount(runLogRef.current.stats());
    if (count === runLogFailRef.current) return;
    runLogFailRef.current = count;
    setRunLogFailures(count);
  };
  const publishRunLog = (immediate = false) => {
    syncRunLogBadge();
    if (immediate) flushRunLogNow();
    else scheduleRunLog();
  };
  logRunImplRef.current = (event: RunLogInput) => {
    runLogRef.current.add(event);
    publishRunLog(false);
  };
  const runLogSettings = (): RunLogSettings => {
    const live = nodesRef.current;
    const routes = roleRoutesRef.current;
    return {
      fullAuto: fullAutoRef.current,
      autoApply: autoApplyWritesRef.current,
      autoReview: autoReviewRef.current,
      swarm: pipelineModeRef.current,
      autoSelect: autoSelectRef.current,
      cloudStrategist: cloudStrategistRef.current,
      maxAgentSteps,
      planner: roleRouteLabel(routes, 'planner', live),
      coder: roleRouteLabel(routes, 'coder', live),
      reviewer: roleRouteLabel(routes, 'reviewer', live)
    };
  };
  const endLoggedRun = (token: number, reason: string) => {
    if (activeRunLogIdRef.current !== token) return;
    activeRunLogIdRef.current = null;
    runLogRef.current.endRun(token, reason);
    publishRunLog(true);
  };
  const hostLog = (level: string, message: string) => {
    window.electronAPI?.writeLog?.(level, message);
    if (level === 'error' || level === 'warn') logRun({ kind: 'error', text: message });
  };
  const activeStepId = () => {
    const step = getActiveStep(plannerPlanRef.current);
    return step ? String(step.id) : undefined;
  };
  const estimateTurnTokens = (parts: Array<string | undefined>, model?: string) => {
    const kept = parts.filter((part): part is string => typeof part === 'string' && part.length > 0);
    if (!kept.length) return undefined;
    return estimatePromptTokens(kept, model);
  };
  const logToolEvent = (tool: ToolCall) => {
    const stepId = activeStepId();
    const shaped = shapeToolForRunLog({
      name: tool.name,
      status: tool.status,
      result: tool.result
    });
    logRun({
      kind: 'tool',
      name: tool.name,
      path: tool.args?.path,
      status: tool.status,
      ...(shaped.exitCode != null ? { exitCode: shaped.exitCode } : {}),
      ...(shaped.result ? { result: shaped.result } : {}),
      ...(stepId ? { stepId } : {})
    });
  };
  /**
   * Run-scoped log writers for code that logs after an await. They capture the run-log buffer when
   * the run starts and drop late run-log writes once a chat switch swapped it (same rule as
   * takeChat). A Stop alone keeps the buffer, so a stopped run still logs into its own chat.
   * hostLog still reaches the app log either way.
   */
  const scopeRunLog = () => {
    const startLog = runLogRef.current;
    const same = () => runLogRef.current === startLog;
    return {
      logRun: (event: RunLogInput) => {
        if (same()) logRun(event);
      },
      hostLog: (level: string, message: string) => {
        window.electronAPI?.writeLog?.(level, message);
        if ((level === 'error' || level === 'warn') && same()) logRun({ kind: 'error', text: message });
      },
      logToolEvent: (tool: ToolCall) => {
        if (same()) logToolEvent(tool);
      }
    };
  };
  const logRoute = (
    action: 'retry' | 'failover' | 'skip' | 'stream-retry' | 'pin' | 'fallback',
    detail: {
      text?: string;
      stepId?: string;
      nodeId?: string;
      nodeName?: string;
      model?: string;
    } = {}
  ) => {
    const stepId = detail.stepId ?? activeStepId();
    logRun({
      kind: 'route',
      action,
      ...(detail.text ? { text: detail.text } : {}),
      ...(stepId ? { stepId } : {}),
      ...(detail.nodeId ? { nodeId: detail.nodeId } : {}),
      ...(detail.nodeName ? { nodeName: detail.nodeName } : {}),
      ...(detail.model ? { model: detail.model } : {})
    });
  };
  const logContext = (
    action: 'fit' | 'resubmit' | 'compact',
    text: string,
    detail?: { numCtx?: number; promptBudget?: number; estPromptTokens?: number; stepId?: string }
  ) => {
    const stepId = detail?.stepId ?? activeStepId();
    logRun({
      kind: 'context',
      action,
      text,
      ...(detail?.numCtx != null ? { numCtx: detail.numCtx } : {}),
      ...(detail?.promptBudget != null ? { promptBudget: detail.promptBudget } : {}),
      ...(detail?.estPromptTokens != null ? { estPromptTokens: detail.estPromptTokens } : {}),
      ...(stepId ? { stepId } : {})
    });
  };
  type TurnLogMeta = {
    phase?: string;
    role: string;
    nodeId?: string;
    nodeName?: string;
    model: string;
    numCtx?: number;
    promptBudget?: number;
    estPromptTokens?: number;
  };
  const takeChat = async (
    meta: TurnLogMeta,
    open: () => ReturnType<typeof streamChat>,
    live: () => boolean
  ) => {
    const started = Date.now();
    const startLog = runLogRef.current;
    const startRunId = activeRunLogIdRef.current;
    const logTurn = (event: RunLogInput) => {
      if (runLogRef.current !== startLog) return;
      logRun(startRunId != null ? { runId: startRunId, ...event } : event);
    };
    try {
      const taken = await awaitConductorChat(open, {
        registerAbort,
        live,
        onStreamRetry: err => {
          if (runLogRef.current !== startLog) return;
          logRoute('stream-retry', {
            text: err instanceof Error ? err.message : 'stream retry',
            nodeId: meta.nodeId,
            nodeName: meta.nodeName,
            model: meta.model
          });
        }
      });
      const wallMs = Date.now() - started;
      if (taken.aborted) {
        logTurn({ kind: 'turn', ...meta, wallMs, aborted: true });
      } else {
        logTurn({ kind: 'turn', ...meta, wallMs, ...summarizeStats(taken.result.stats) });
      }
      return taken;
    } catch (err) {
      logTurn({
        kind: 'turn',
        ...meta,
        wallMs: Date.now() - started,
        error: err instanceof Error ? err.message : String(err)
      });
      throw err;
    }
  };
  const adoptRunLog = (nextId: string | null) => {
    const prevId = conversationIdRef.current;
    if (prevId) runLogsRef.current.set(prevId, runLogRef.current);
    flushRunLogNow(prevId);
    const nextLog = (nextId && runLogsRef.current.get(nextId)) || createRunLog();
    if (nextId) runLogsRef.current.set(nextId, nextLog);
    runLogRef.current = nextLog;
    activeRunLogIdRef.current = null;
    lastNoticeRef.current = null;
    const count = runLogFailureCount(nextLog.stats());
    runLogFailRef.current = count;
    setRunLogFailures(count);
  };
  useEffect(() => {
    let cancel = false;
    void window.electronAPI?.getAppVersion?.()
      .then(version => {
        if (!cancel && version) appVersionRef.current = String(version);
      })
      .catch(() => {});
    return () => {
      cancel = true;
    };
  }, []);
  useEffect(() => {
    runLogMountedRef.current = true;
    return () => {
      runLogMountedRef.current = false;
      if (runLogTimerRef.current != null) {
        window.clearTimeout(runLogTimerRef.current);
        runLogTimerRef.current = null;
      }
      if (isWebConsoleClient()) return;
      const id = conversationIdRef.current;
      const root = logWorkspaceRef.current;
      if (!id || !root || root !== workspacePathRef.current || !window.electronAPI?.writeFile) return;
      void window.electronAPI.writeFile(
        runLogPath(root, id),
        runLogRef.current.formatMarkdown({
          header: {
            ...(appVersionRef.current ? { version: appVersionRef.current } : {}),
            ...(root ? { workspace: root } : {})
          }
        })
      );
    };
  }, []);
  useEffect(() => {
    if (workspacePath === logWorkspaceRef.current) return;
    if (runLogTimerRef.current != null) {
      window.clearTimeout(runLogTimerRef.current);
      runLogTimerRef.current = null;
    }
    runLogGenerationRef.current += 1;
    runLogsRef.current = new Map();
    const fresh = createRunLog();
    runLogRef.current = fresh;
    const id = conversationIdRef.current;
    if (id) runLogsRef.current.set(id, fresh);
    logWorkspaceRef.current = workspacePath;
    activeRunLogIdRef.current = null;
    lastNoticeRef.current = null;
    runLogFailRef.current = 0;
    setRunLogFailures(0);
    runLogSaveErrorRef.current = null;
    setRunLogSaveError(null);
  }, [workspacePath]);
  useEffect(() => {
    const text = executingPlanNotice;
    if (applyingPeerConductorRef.current) {
      if (text) lastNoticeRef.current = text;
      return;
    }
    if (!text) {
      lastNoticeRef.current = null;
      return;
    }
    if (text === lastNoticeRef.current) return;
    // A notice set as the run ends flushes after leaveConductorRun. Do not file it unscoped.
    if (activeRunLogIdRef.current == null) return;
    lastNoticeRef.current = text;
    const step = getActiveStep(plannerPlanRef.current);
    logRunImplRef.current({
      kind: 'notice',
      text,
      ...(step ? { stepId: String(step.id) } : {})
    });
  }, [executingPlanNotice]);
  useEffect(() => {
    if (!runLogOpen) return;
    const onDown = (event: MouseEvent) => {
      const node = runLogMenuRef.current;
      if (node && event.target instanceof Node && !node.contains(event.target)) setRunLogOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setRunLogOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [runLogOpen]);
  const copyRunLog = () => {
    const root = logWorkspaceRef.current;
    const text = runLogRef.current.formatMarkdown({ header: runLogHeader(root) });
    const write = navigator.clipboard?.writeText?.bind(navigator.clipboard);
    if (!write) {
      setRunLogCopyState('failed');
      window.setTimeout(() => setRunLogCopyState('idle'), 1600);
      return;
    }
    void write(text).then(
      () => {
        setRunLogCopyState('copied');
        window.setTimeout(() => setRunLogCopyState('idle'), 1600);
      },
      () => {
        setRunLogCopyState('failed');
        window.setTimeout(() => setRunLogCopyState('idle'), 1600);
      }
    );
  };
  copyRunLogRef.current = copyRunLog;
  useEffect(() => {
    if (!onRunLogApi) return;
    onRunLogApi({ copy: () => copyRunLogRef.current() });
    return () => onRunLogApi(null);
  }, [onRunLogApi]);
  const openRunLogFile = async () => {
    const target = captureFlushTarget();
    if (!target) return;
    await flushRunLog(target);
    if (runLogSaveErrorRef.current) return;
    if (target.root !== workspacePathRef.current || target.generation !== runLogGenerationRef.current) return;
    await window.electronAPI?.revealInExplorer?.(runLogPath(target.root, target.conversationId));
  };
  const clearRunLog = () => {
    const token = activeRunLogIdRef.current;
    const conversationId = conversationIdRef.current;
    runLogRef.current.clear();
    lastNoticeRef.current = null;
    if (token != null && conversationId) {
      activeRunLogIdRef.current = token;
      runLogRef.current.startRun({
        runId: token,
        conversationId,
        label: 'run',
        settings: runLogSettings()
      });
    } else {
      activeRunLogIdRef.current = null;
    }
    const count = runLogFailureCount(runLogRef.current.stats());
    runLogFailRef.current = count;
    setRunLogFailures(count);
    void flushRunLogNow();
  };

  /** Stop and chat switches: nothing is running any more, so no card or activity may still say it is. */
  const stopConductor = () => {
    const token = activeRunLogIdRef.current;
    stopConductorSession();
    failUnfinishedWork('Stopped');
    activityStackRef.current = [];
    setActivityStack([]);
    if (token != null) {
      logRun({ kind: 'user', action: 'stop' });
      endLoggedRun(token, 'stopped');
    }
  };
  /** An owned run that ends with a card still pending or running never reported back. */
  const leaveConductorRun = (owned: boolean, token: RunToken) => {
    const releasing = owned && runIsCurrent(token);
    leaveConductorSession(owned, token);
    if (releasing && !heldRef.current) failUnfinishedWork('Stopped before finishing');
    if (releasing) endLoggedRun(token, 'finished');
  };

  const syncReworkCountsFromPlan = (plan: PlannerPlan | null | undefined) => {
    const seeded: Record<string, number> = {};
    for (const s of plan?.steps || []) {
      if (s.reworkCount) seeded[String(s.id)] = s.reworkCount;
    }
    stepReworkCountRef.current = seeded;
  };

  /**
   * Join `parent` or start a run. Send/Play pass clearStop. Nested calls pass parent
   * so a second tryLock does not drop the work. Plan writes use the id captured here.
   */
  const bindRun = (
    parent: ConductorRun | undefined | null,
    clearStop: boolean,
    label?: string
  ): { run: ConductorRun; owned: boolean } | null => {
    const entered = enterConductorRun(conversationIdRef.current, {
      clearStop,
      parent: parent ?? null
    });
    if (!entered) return null;
    if (entered.owned) {
      finalVerifyHealsRef.current = 0;
      toolDepsRef.current = {
        ...toolDepsRef.current,
        editProgress: editProgressRef.current
      };
      const conversationId = entered.run.conversationId || conversationIdRef.current;
      if (conversationId) {
        activeRunLogIdRef.current = entered.run.token;
        runLogRef.current.startRun({
          runId: entered.run.token,
          conversationId,
          label: label || 'run',
          settings: runLogSettings()
        });
        publishRunLog(false);
      }
    }
    return entered;
  };

  /**
   * A dead run may pause the panel only when it is still the run on screen,
   * or when nothing else holds the lock. A newer Send must not be paused by the old one.
   */
  const runOwnsUi = (run: ConductorRun | null | undefined) =>
    !!run && (runIsCurrent(run.token) || !heldRef.current);

  /** User click after Stop. clearStop is true so the latch does not refuse the click. */
  const runAsUser = async (label: string, work: (run: ConductorRun) => Promise<void>) => {
    const entered = bindRun(null, true, label);
    if (!entered) return;
    try {
      await work(entered.run);
    } finally {
      leaveConductorRun(entered.owned, entered.run.token);
    }
  };

  const savedFileFingerprints = (next?: string | null) => ({
    previous: plannerPlanRef.current?.lastErrorFingerprint,
    next: next ?? plannerPlanRef.current?.lastErrorFingerprint
  });

  const commitPlannerPlan = async (next: PlannerPlan | null, token?: number) => {
    if (typeof token === 'number' && !runIsCurrent(token)) return;
    const run = runRef.current;
    const id =
      typeof token === 'number' && run && run.token === token && run.conversationId
        ? run.conversationId
        : conversationIdRef.current;
    if (!id) return;
    const showing = () =>
      conversationIdRef.current === id && (typeof token !== 'number' || runIsCurrent(token));
    const publish = (plan: PlannerPlan | null) => {
      if (!showing()) return;
      plannerPlanRef.current = plan;
      setPlannerPlanView(plan);
      syncReworkCountsFromPlan(plan);
      onConversationPatch?.({ plannerPlan: plan });
      if (plan?.steps?.length) {
        const todo = plan.steps.map(s => ({
          id: String(s.id),
          title: s.title,
          status: s.status
        }));
        const brain = projectBrainRef.current;
        const stepIds = new Set(todo.map(t => t.id));
        const kept = brain.todo.filter(t => !stepIds.has(t.id));
        const merged = [...todo, ...kept];
        const same =
          brain.todo.length === merged.length &&
          brain.todo.every((t, i) => t.id === merged[i].id && t.status === merged[i].status);
        if (!same) {
          commitProjectBrain({
            ...brain,
            todo: merged,
            ...(plan.delivery ? { delivery: plan.delivery } : {}),
            ...(plan.verifyCommand ? { verifyCommand: plan.verifyCommand } : {})
          });
        }
      }
    };
    publish(next);
    if (!next || !workspacePath || !window.electronAPI?.writeFile) return;
    try {
      const saved = await writePlannerPlan(workspacePath, id, next, (abs, content) =>
        window.electronAPI.writeFile(abs, content)
      );
      publish(saved);
    } catch (err) {
      hostLog(
        'error',
        `planner plan write failed: ${String((err as Error)?.message || err)}`
      );
    }
  };

  const setPlanResumePhase = (phase: PlannerResumePhase | undefined, token?: number) => {
    const plan = plannerPlanRef.current;
    if (!plan) return;
    if (plan.resumePhase === phase) return;
    if (typeof token === 'number' && !runIsCurrent(token)) return;
    void commitPlannerPlan({ ...plan, resumePhase: phase, updatedAt: Date.now() }, token);
  };

  const commitExecutionQueue = (next: ExecutionQueue | null) => {
    executionQueueRef.current = next;
    onConversationPatch?.({ executionQueue: next });
    // Keep Conductor plan panel in sync — Review queues never showed before.
    if (next?.tasks?.length) {
      const existing = plannerPlanRef.current;
      const alreadyReview = existing?.steps?.some(s => s.id === 'review-fixes');
      const canMirror =
        !existing?.steps?.length ||
        !!alreadyReview ||
        existing?.status === 'completed' ||
        existing?.status === 'abandoned';
      if (canMirror) {
        commitPlannerPlan(
          plannerPlanFromReviewQueue(next, {
            conversationId: conversationIdRef.current || undefined,
            existing
          })
        );
      }
    }
  };
  const freeTierUsageRef = useRef<Record<string, FreeTierUsage>>({});
  const stuckRef = useRef<{ key: string; stage: StuckStage }>({ key: '', stage: 'none' });

  type LoopBudget = {
    depth: number;
    commandFixAttempts: number;
    prevFailedCmdSigs: string[];
    writeFixAttempts: number;
    readOnlyContinues: number;
    terminalFingerprint?: string;
  };

  const readOnlyContinuesRef = useRef(0);
  const terminalFingerprintRef = useRef<string | undefined>(undefined);

  const resetAgentLoopBudget = () => {
    continuationDepthRef.current = 0;
    commandFixAttemptsRef.current = 0;
    writeFixAttemptsRef.current = 0;
    prevFailedCmdSigsRef.current = [];
    readOnlyContinuesRef.current = 0;
    terminalFingerprintRef.current = undefined;
  };

  /** Review turns share this counter with coder continues. Zero only the read budget. */
  const resetReadOnlyContinues = (budget?: LoopBudget) => {
    if (budget) budget.readOnlyContinues = 0;
    else readOnlyContinuesRef.current = 0;
  };

  const continueDecisionOpts = (
    budget?: LoopBudget,
    extra?: { maxReadOnlyContinues?: number }
  ) => ({
    commandFixAttempts: budget ? budget.commandFixAttempts : commandFixAttemptsRef.current,
    prevFailedCmdSigs: budget ? budget.prevFailedCmdSigs : prevFailedCmdSigsRef.current,
    writeFixAttempts: budget ? budget.writeFixAttempts : writeFixAttemptsRef.current,
    readOnlyContinues: budget ? budget.readOnlyContinues : readOnlyContinuesRef.current,
    terminalFingerprint: budget
      ? budget.terminalFingerprint
      : terminalFingerprintRef.current,
    ...(extra?.maxReadOnlyContinues != null
      ? { maxReadOnlyContinues: extra.maxReadOnlyContinues }
      : {})
  });

  const rememberTerminalFingerprint = (tools: ToolCall[], budget?: LoopBudget) => {
    const result = latestTerminalResult(tools);
    if (!result) return;
    const fp = terminalResultFingerprint(result);
    if (!fp) return;
    if (budget) budget.terminalFingerprint = fp;
    else terminalFingerprintRef.current = fp;
  };

  const skipPersistRef = useRef(false);
  /** Last message array handed to the persist effect. Local messages that differ from it are not saved yet. */
  const persistedMessagesRef = useRef<ChatMessage[] | null>(null);
  /** The switch commit's React state is still the previous chat. Skip one ref copy. */
  const skipMessagesSyncRef = useRef(false);

  const releaseStashedPlanChoice = () => {
    const stashed = stashedPlanChoiceRef.current;
    stashedPlanChoiceRef.current = null;
    coderTurnWritesRef.current = null;
    if (!stashed) return;
    abandonedPlanPicksRef.current.add(stashed.messageId);
    setMessages(prev => {
      const next = prev.map(m =>
        m.id === stashed.messageId ? { ...m, selectedPlanOptionId: undefined } : m
      );
      messagesRef.current = next;
      return next;
    });
  };

  const withoutAbandonedPicks = (msgs: ChatMessage[]): ChatMessage[] => {
    if (!abandonedPlanPicksRef.current.size) return msgs;
    let changed = false;
    const next = msgs.map(m => {
      if (!abandonedPlanPicksRef.current.has(m.id) || !m.selectedPlanOptionId) return m;
      changed = true;
      return { ...m, selectedPlanOptionId: undefined };
    });
    return changed ? next : msgs;
  };

  // Sync local message buffer when App switches conversations
  useEffect(() => {
    const nextId = conversation?.id ?? null;
    if (nextId !== conversationIdRef.current) {
      stopConductor();
      adoptRunLog(nextId);
      releaseStashedPlanChoice();
      setIsStreaming(false);
      resetAgentLoopBudget();
      fullAutoGateRef.current = null;
      conversationIdRef.current = nextId;
      const savedMsgs = conversation?.messages || [];
      const nextMsgs = withoutAbandonedPicks(reopenMessages(savedMsgs));
      // Persist only when reopening corrected Swarm steps left running.
      skipPersistRef.current = nextMsgs === savedMsgs;
      skipMessagesSyncRef.current = true;
      setMessages(nextMsgs);
      messagesRef.current = nextMsgs;
      persistedMessagesRef.current = nextMsgs;
      approvedPlanRef.current = conversation?.approvedPlan ?? null;
      const savedQueue = conversation?.executionQueue ?? null;
      const activeQueueTask = getActiveTask(savedQueue);
      const nextQueue =
        savedQueue && activeQueueTask && ownsReopenedChat()
          ? markStopped(savedQueue, activeQueueTask.id)
          : savedQueue;
      executionQueueRef.current = nextQueue;
      if (nextQueue !== savedQueue) onConversationPatch?.({ executionQueue: nextQueue });
      plannerPlanRef.current = conversation?.plannerPlan ?? null;
      setPlannerPlanView(conversation?.plannerPlan ?? null);
      // Durable rework counts live on each step — seed the in-memory cache.
      const seeded: Record<string, number> = {};
      for (const s of conversation?.plannerPlan?.steps || []) {
        if (s.reworkCount) seeded[String(s.id)] = s.reworkCount;
      }
      stepReworkCountRef.current = seeded;
      syncNodeWork([]);
      setPlanPaused(isPlanActive(conversation?.plannerPlan));
      setExecutingPlanNotice(null);
      setInput('');
      setPendingImages([]);
      setHistoryOpen(false);
      stuckRef.current = { key: '', stage: 'none' };
      // File-backed plan survives compaction
      const root = workspacePath;
      const cid = nextId;
      if (root && cid && window.electronAPI?.readFile) {
        void window.electronAPI.readFile(plannerPlanPath(root, cid)).then(res => {
          if (conversationIdRef.current !== cid) return;
          const fromDisk = res.content ? parsePlannerPlanJson(res.content) : null;
          const livePlan = plannerPlanRef.current;
          if (
            fromDisk &&
            !heldRef.current &&
            (!livePlan || fromDisk.updatedAt > (livePlan.updatedAt || 0))
          ) {
            plannerPlanRef.current = fromDisk;
            setPlannerPlanView(fromDisk);
            const seeded: Record<string, number> = {};
            for (const s of fromDisk.steps || []) {
              if (s.reworkCount) seeded[String(s.id)] = s.reworkCount;
            }
            stepReworkCountRef.current = seeded;
            onConversationPatch?.({ plannerPlan: fromDisk });
            if (!heldRef.current && isPlanActive(fromDisk)) setPlanPaused(true);
          }
        });
      }
    }
  }, [conversation?.id]);

  // Adopt peer / parent conversation messages when we are not the one streaming.
  useEffect(() => {
    if (!conversation || conversation.id !== conversationIdRef.current) return;
    if (isStreaming || heldRef.current) return;
    const prev = messagesRef.current;
    if (persistedMessagesRef.current && prev !== persistedMessagesRef.current) return;
    const next = withoutAbandonedPicks(conversation.messages || []);
    const lastPrev = prev[prev.length - 1];
    const lastNext = next[next.length - 1];
    const toolSig = (m: ChatMessage | undefined) =>
      (m?.toolCalls || []).map(t => t.status).join(',');
    if (
      prev.length === next.length &&
      lastPrev?.id === lastNext?.id &&
      lastPrev?.raw === lastNext?.raw &&
      lastPrev?.display === lastNext?.display &&
      toolSig(lastPrev) === toolSig(lastNext)
    ) {
      return;
    }
    skipPersistRef.current = true;
    setMessages(next);
    messagesRef.current = next;
  }, [conversation?.messages, conversation?.id, isStreaming, heldRef]);

  // Live chat mirror from peer (faster than disk reload during Generating…).
  useEffect(() => {
    if (!peerChatMirror?.conversationId || !peerChatMirror.messages) return;
    if (peerChatMirror.conversationId !== conversationIdRef.current) return;
    if (isStreaming) return;
    const next = peerChatMirror.messages;
    const prev = messagesRef.current;
    const lastPrev = prev[prev.length - 1];
    const lastNext = next[next.length - 1];
    if (
      prev.length === next.length &&
      lastPrev?.id === lastNext?.id &&
      lastPrev?.raw === lastNext?.raw &&
      lastPrev?.display === lastNext?.display
    ) {
      return;
    }
    skipPersistRef.current = true;
    setMessages(next);
    messagesRef.current = next;
  }, [peerChatMirror, isStreaming]);

  // Apply conductor toggles / busy UI from peer live session.
  useEffect(() => {
    if (!peerConductor) return;
    if (typeof peerConductor.revision !== 'number') return;
    if (peerConductor.revision <= peerConductorRevAppliedRef.current) return;
    peerConductorRevAppliedRef.current = peerConductor.revision;
    applyingPeerConductorRef.current = true;
    setIsPipelineMode(!!peerConductor.isPipelineMode);
    setAutoSelectEndpoint(!!peerConductor.autoSelectEndpoint);
    autoApplyWritesRef.current = !!peerConductor.autoApplyWrites;
    setAutoApplyWrites(!!peerConductor.autoApplyWrites);
    autoReviewRef.current = !!peerConductor.autoReview;
    setAutoReview(!!peerConductor.autoReview);
    fullAutoRef.current = !!peerConductor.fullAuto;
    setFullAuto(!!peerConductor.fullAuto);
    setIncludeActiveFile(!!peerConductor.includeActiveFile);
    // Desktop keeps its own picks. A web mirror is applied only for a deliberate edit,
    // which App persists before this snapshot arrives without the flag.
    if (peerConductor.roleRoutes && (isWebConsoleClient() || peerConductor.roleRoutesEdit)) {
      const nextRoutes = normalizeRoleRoutes(peerConductor.roleRoutes);
      if (!sameRoleRoutes(roleRoutesRef.current, nextRoutes)) {
        roleRoutesRef.current = nextRoutes;
        setRoleRoutes(nextRoutes);
      }
    }
    if (peerConductor.executingPlanNotice !== undefined) {
      setExecutingPlanNotice(peerConductor.executingPlanNotice || null);
    }
    if (Array.isArray(peerConductor.nodeWork) && !isStreaming) {
      syncNodeWork(peerConductor.nodeWork, false);
    }
    window.setTimeout(() => {
      applyingPeerConductorRef.current = false;
      if (pendingPublishRef.current) {
        pendingPublishRef.current = false;
        setPublishRetry(n => n + 1);
      }
    }, 200);
  }, [peerConductor]);

  // Publish local conductor + chat buffer for peers.
  useEffect(() => {
    if (!onLiveConductorPublish) return;
    const skipForPeerApply = () => {
      // Only a local edit that differs from the peer snapshot needs a re-publish. An echo would ping-pong.
      const peerConductor = peerConductorRef.current;
      pendingPublishRef.current =
        !!peerConductor &&
        !(
          !!peerConductor.isPipelineMode === isPipelineMode &&
          !!peerConductor.autoSelectEndpoint === autoSelectEndpoint &&
          !!peerConductor.autoApplyWrites === autoApplyWrites &&
          !!peerConductor.autoReview === autoReview &&
          !!peerConductor.fullAuto === fullAuto &&
          !!peerConductor.includeActiveFile === includeActiveFile &&
          (!peerConductor.roleRoutes ||
            sameRoleRoutes(roleRoutes, normalizeRoleRoutes(peerConductor.roleRoutes)))
        );
    };
    if (applyingPeerConductorRef.current) {
      skipForPeerApply();
      return;
    }
    const timer = window.setTimeout(() => {
      if (applyingPeerConductorRef.current) {
        skipForPeerApply();
        return;
      }
      conductorRevisionRef.current += 1;
      const publishRoleEdit = roleRoutesEditRef.current;
      roleRoutesEditRef.current = false;
      const latestAssistant = [...messagesRef.current].reverse().find(m => m.role === 'assistant');
      onLiveConductorPublish({
        conductor: {
          isPipelineMode,
          autoSelectEndpoint,
          autoApplyWrites,
          autoReview,
          fullAuto,
          includeActiveFile,
          isStreaming,
          activityLabel: describeRunStatus({
            steps: nodeWorkStepsRef.current,
            activityLabel: activityLabelOf(activityStackRef.current),
            notice: executingPlanNotice,
            message: isStreaming ? latestAssistant : undefined
          }).text,
          roleRoutes,
          ...(publishRoleEdit ? { roleRoutesEdit: true } : {}),
          executingPlanNotice,
          ...(nodeWorkOwnedRef.current
            ? {
                nodeWork: nodeWorkSteps.slice(-12).map(step => ({
                  ...step,
                  content: (step.content || '').slice(0, 600),
                  toolCalls: undefined
                }))
              }
            : {}),
          revision: conductorRevisionRef.current
        },
        chatMirror: conversationIdRef.current
          ? { conversationId: conversationIdRef.current, messages: messagesRef.current }
          : null
      });
    }, 80);
    return () => window.clearTimeout(timer);
  }, [
    onLiveConductorPublish,
    isPipelineMode,
    autoSelectEndpoint,
    autoApplyWrites,
    autoReview,
    fullAuto,
    includeActiveFile,
    isStreaming,
    roleRoutes,
    executingPlanNotice,
    activityStack,
    messages,
    nodeWorkSteps,
    publishRetry
  ]);

  useEffect(() => {
    if (conversation?.id === conversationIdRef.current) {
      approvedPlanRef.current = conversation?.approvedPlan ?? null;
    }
  }, [conversation?.approvedPlan, conversation?.id]);

  useEffect(() => {
    if (conversation?.id === conversationIdRef.current) {
      executionQueueRef.current = conversation?.executionQueue ?? null;
    }
  }, [conversation?.executionQueue, conversation?.id]);

  useEffect(() => {
    if (conversation?.id === conversationIdRef.current && conversation?.plannerPlan) {
      plannerPlanRef.current = conversation.plannerPlan;
      setPlannerPlanView(conversation.plannerPlan);
      if (!heldRef.current && isPlanActive(conversation.plannerPlan)) setPlanPaused(true);
    }
  }, [conversation?.plannerPlan, conversation?.id, heldRef]);

  const progressRef = useRef<WorkLog>(emptyWorkLog());
  const progressRev = useRef(0);
  const [progressLog, setProgressLog] = useState<WorkLog>(emptyWorkLog());

  const commitProgress = (next: WorkLog) => {
    progressRev.current += 1;
    progressRef.current = next;
    setProgressLog(next);
    const id = conversationIdRef.current;
    if (!workspacePath || !id || !window.electronAPI?.writeFile) return;
    void window.electronAPI.writeFile(workLogPath(workspacePath, id), renderWorkLog(next));
  };

  const updateProgress = (fn: (log: WorkLog) => WorkLog) => {
    commitProgress(fn(progressRef.current));
  };

  useEffect(() => {
    const id = conversation?.id;
    const root = workspacePath;
    if (!id || !root || !window.electronAPI?.readFile) {
      progressRef.current = emptyWorkLog();
      setProgressLog(emptyWorkLog());
      return;
    }
    const rev = progressRev.current;
    let cancel = false;
    window.electronAPI.readFile(workLogPath(root, id)).then(res => {
      if (cancel || progressRev.current !== rev || conversationIdRef.current !== id) return;
      const log = res.content ? parseWorkLog(res.content) : emptyWorkLog();
      progressRef.current = log;
      setProgressLog(log);
    });
    return () => {
      cancel = true;
    };
  }, [conversation?.id, workspacePath]);

  // Project brain + rules survive New Chat and compaction.
  useEffect(() => {
    if (!workspacePath || !window.electronAPI?.readFile) return;
    let cancel = false;
    (async () => {
      const brainRes = await window.electronAPI.readFile(projectBrainPath(workspacePath));
      const brain = brainRes.content
        ? parseProjectBrain(brainRes.content) || emptyProjectBrain()
        : emptyProjectBrain();
      const ruleChunks: string[] = [];
      for (const p of rulesCandidatePaths(workspacePath)) {
        try {
          const res = await window.electronAPI.readFile(p);
          if (res.content?.trim()) ruleChunks.push(res.content.trim());
        } catch {
          /* optional */
        }
      }
      try {
        const dirEntries = await window.electronAPI.readDir(rulesDir(workspacePath));
        if (Array.isArray(dirEntries)) {
          const files = dirEntries
            .filter(e => !e.isDirectory && /\.(md|txt)$/i.test(e.name))
            .sort((a, b) => a.name.localeCompare(b.name));
          for (const ent of files) {
            const res = await window.electronAPI.readFile(ent.path);
            if (res.content?.trim()) ruleChunks.push(`# ${ent.name}\n${res.content.trim()}`);
          }
        }
      } catch {
        /* optional rules directory */
      }
      if (cancel) return;
      projectRulesRef.current = ruleChunks.join('\n\n').slice(0, 24000);
      projectBrainRef.current = brain;
      void buildRepoMap(workspacePath).then(map => {
        if (!cancel) repoMapRef.current = map;
      });
      setProjectBrain(brain);
    })();
    return () => {
      cancel = true;
    };
  }, [workspacePath]);

  // Persist message edits up to App (skip one tick after conversation switch)
  useEffect(() => {
    if (skipPersistRef.current) {
      skipPersistRef.current = false;
      persistedMessagesRef.current = messages;
      return;
    }
    if (!conversation?.id || conversationIdRef.current !== conversation.id) return;
    persistedMessagesRef.current = messages;
    onMessagesChange(messages);
  }, [messages]);

  // Workspace file tree summary for prompt injection
  const workspaceOverview = (workspaceFiles && workspaceFiles.length > 0)
    ? workspaceFiles.slice(0, 80).map(f => (f.isDirectory ? `📁 ${f.name}/` : `📄 ${f.name}`)).join('\n')
    : '(empty workspace or loading)';

  const executeTrackedCommand = async (command: string, opts?: { timeoutSec?: number }) => {
    const startedRun = runRef.current;
    const startedWorkspace = workspacePathRef.current;
    const frame = beginActivity('tool', 'Terminal', command.slice(0, 90));
    try {
      const out = await onExecuteToolCommand(command, opts);
      if (workspacePathRef.current === startedWorkspace && (!startedRun || runLive(startedRun))) {
        commitProjectBrain({
          ...projectBrainRef.current,
          lastTerminal: {
            command: command.slice(0, 240),
            output: (out || '').slice(-1800),
            at: Date.now()
          }
        });
      }
      return out;
    } finally {
      endActivity(frame);
    }
  };

  const toolDeps = {
    workspacePath,
    onApplyFileWrite,
    onExecuteToolCommand: executeTrackedCommand,
    nodes,
    searxngUrl,
    getOwnedFiles: () => projectBrainRef.current.ownedFiles,
    getRepoMap: () => repoMapRef.current,
    mcpServersJson,
    editProgress: editProgressRef.current,
    toolResultTier: toolResultTierRef.current,
    onTool: logToolEvent
  };
  const toolDepsRef = useRef(toolDeps);
  toolDepsRef.current = toolDeps;
  const applyToolTier = (tier: ModelFitTier) => {
    toolResultTierRef.current = tier;
    toolDepsRef.current = { ...toolDepsRef.current, toolResultTier: tier };
  };
  const rebuildRepoMap = () => {
    repoMapRef.current = invalidateRepoMap(repoMapRef.current);
    if (!workspacePath) return;
    const gen = ++repoMapGenRef.current;
    const root = workspacePath;
    void buildRepoMap(root).then(map => {
      if (gen !== repoMapGenRef.current) return;
      repoMapRef.current = map;
    });
  };
  const noteAppliedWrites = (tools: Array<{ name?: string; status?: string }>) => {
    if (tools.some(t => (t.name === 'write_file' || t.name === 'edit_file') && t.status === 'done')) {
      rebuildRepoMap();
    }
  };

  const inlineEditHandlerRef = useRef<(detail: { path?: string; selection?: string; instruction?: string }) => void>(
    () => {}
  );
  inlineEditHandlerRef.current = detail => {
    const relPath = (detail.path || '').replace(/\\/g, '/');
    const selection = (detail.selection || '').slice(0, 4000);
    const instruction = (detail.instruction || '').trim();
    if (!relPath || !selection || !instruction) return;
    const root = (workspacePath || '').replace(/\\/g, '/').replace(/\/$/, '');
    const short = relPath.toLowerCase().startsWith(root.toLowerCase())
      ? relPath.slice(root.length).replace(/^\//, '')
      : relPath;
    void runSingleNodeTurn({
      userText: `Inline edit ${short}`,
      fullPrompt: `Edit ONLY the selection below in \`${short}\`. One <edit_file path="${short}"> SEARCH/REPLACE. Do not rewrite the rest of the file.

SELECTION:
${selection}

INSTRUCTION:
${instruction}`,
      attachedImages: [],
      agent: coderAgent,
      freshContext: true,
      skipUserAppend: false,
      notice: `Inline edit · ${short}`
    });
  };
  const draftCommitHandlerRef = useRef<(detail: { diff?: string }) => void>(() => {});
  draftCommitHandlerRef.current = detail => {
    const diff = (detail.diff || '').slice(0, 6000);
    if (!diff.trim()) return;
    void (async () => {
      const msg = await runSingleNodeTurn({
        userText: 'Draft a commit subject',
        fullPrompt: `Write ONE git commit subject line, max 72 characters, for this diff. Reply with the subject only. Do not call tools.\n\n${diff}`,
        attachedImages: [],
        agent: coderAgent,
        freshContext: true,
        skipUserAppend: true,
        notice: 'Drafting commit message…'
      });
      const line =
        (msg?.raw || msg?.display || '')
          .split('\n')
          .map(s => s.replace(/^[#*\-\s]+/, '').trim())
          .find(s => s && !s.startsWith('<') && !s.startsWith('```')) || '';
      window.dispatchEvent(new CustomEvent('la-commit-message', { detail: { message: line.slice(0, 120) } }));
    })();
  };
  useEffect(() => {
    const onInline = (ev: Event) =>
      inlineEditHandlerRef.current((ev as CustomEvent).detail || {});
    const onDraft = (ev: Event) =>
      draftCommitHandlerRef.current((ev as CustomEvent).detail || {});
    window.addEventListener('la-inline-edit', onInline);
    window.addEventListener('la-draft-commit', onDraft);
    return () => {
      window.removeEventListener('la-inline-edit', onInline);
      window.removeEventListener('la-draft-commit', onDraft);
    };
  }, []);

  // Saved conductor toggles arrive after settings load. The checkbox is the source of truth,
  // not the persona's autoApproveWrites flag.
  useEffect(() => {
    setIsPipelineMode(swarmEnabled);
  }, [swarmEnabled]);
  useEffect(() => {
    setAutoSelectEndpoint(autoNodeEnabled);
  }, [autoNodeEnabled]);
  useEffect(() => {
    autoApplyWritesRef.current = autoApplyEnabled;
    setAutoApplyWrites(autoApplyEnabled);
  }, [autoApplyEnabled]);
  useEffect(() => {
    autoReviewRef.current = autoReviewEnabled;
    setAutoReview(autoReviewEnabled);
  }, [autoReviewEnabled]);
  useEffect(() => {
    fullAutoRef.current = fullAutoEnabled;
    setFullAuto(fullAutoEnabled);
  }, [fullAutoEnabled]);
  useEffect(() => {
    const next = normalizeRoleRoutes(roleRoutesEnabled);
    setRoleRoutes(prev => (sameRoleRoutes(prev, next) ? prev : next));
  }, [roleRoutesEnabled]);

  const noteRoleFallback = (
    role: ConductorRoleId,
    reason: string,
    used?: { node: EndpointNode; model: string }
  ) => {
    const label = role.charAt(0).toUpperCase() + role.slice(1);
    const where = used ? ` ${used.node.name} / ${used.model}` : '';
    const text = `${label} pick unavailable (${reason}). Using automatic routing${where ? `:${where}` : ''}.`;
    const logKey = `${routeEpochRef.current}|${text}`;
    if (fallbackLogKeyRef.current !== logKey) {
      fallbackLogKeyRef.current = logKey;
      logRoute('fallback', {
        text,
        nodeId: used?.node.id,
        nodeName: used?.node.name,
        model: used?.model
      });
    }
    if (lastNoticeRef.current !== text) {
      lastNoticeRef.current = text;
      setExecutingPlanNotice(text);
    }
  };

  /** Auto routing for a role left on Auto. No single dropdown remains. */
  const automaticRoute = (userText: string, agent: AgentPersona) => {
    const live = nodesRef.current;
    const handle = (agent.handle || agent.id || '').toLowerCase();
    const fitRole =
      handle === 'planner' ? 'planner' : handle === 'reviewer' ? 'reviewer' : handle === 'docs' ? 'docs' : null;
    if (fitRole === 'planner' && cloudStrategistRef.current) {
      const arch = findLeadArchitect(live, { preferCloudStrategist: true });
      if (arch) {
        return {
          routedNode: arch.node,
          routedModel: arch.model,
          routedIsFrontier: isFrontierNode(arch.node)
        };
      }
    }
    if (autoSelectRef.current && (fitRole === 'planner' || fitRole === 'reviewer')) {
      const picked = pickCapableReviewTarget(live, fitRole);
      if (picked) {
        return {
          routedNode: picked.node,
          routedModel: picked.model,
          routedIsFrontier: isFrontierNode(picked.node)
        };
      }
    }
    let routedNode = autoSelectRef.current
      ? selectBestEndpointForTask(userText, agent.handle, live)
      : undefined;
    if (!routedNode || !routedNode.online || getEnabledModelsForNode(routedNode).length === 0) {
      const locals = live.filter(
        n => n.online && !isFrontierNode(n) && getEnabledModelsForNode(n).length > 0
      );
      routedNode =
        rankModelsForWeight(locals, fitRole === 'docs' ? 'medium' : 'heavy', {
          role: fitRole || 'coder'
        })?.node || live.find(n => n.online && getEnabledModelsForNode(n).length > 0);
    }
    if (!routedNode) return null;
    const enabled = getEnabledModelsForNode(routedNode);
    if (!enabled.length) return null;
    const weight = fitRole === 'docs' ? 'medium' : 'heavy';
    const routedModel = pickBestModelForComplexity(routedNode, weight) || enabled[0];
    if (!routedModel || !enabled.includes(routedModel)) return null;
    return {
      routedNode,
      routedModel,
      routedIsFrontier: isFrontierNode(routedNode)
    };
  };

  const roleTarget = (
    role: ConductorRoleId,
    auto: () => { node: EndpointNode; model: string } | undefined
  ): { node: EndpointNode; model: string } | undefined => {
    if (!explicitRolePick(roleRoutesRef.current, role)) return auto();
    const resolved = resolveRoleRoute(nodesRef.current, roleRoutesRef.current, role, auto);
    if (!resolved) return undefined;
    if (resolved.fallbackReason) noteRoleFallback(role, resolved.fallbackReason, resolved);
    return { node: resolved.node, model: resolved.model };
  };

  const resolveRoute = (userText: string, agent: AgentPersona) => {
    const chosen = roleTarget(conductorRoleForPersona(agent), () => {
      const auto = automaticRoute(userText, agent);
      return auto ? { node: auto.routedNode, model: auto.routedModel } : undefined;
    });
    if (!chosen) return null;
    return {
      routedNode: chosen.node,
      routedModel: chosen.model,
      routedIsFrontier: isFrontierNode(chosen.node)
    };
  };

  const leadArchitectNow = () => {
    routeEpochRef.current += 1;
    const live = nodesRef.current;
    const fromAuto = () => {
      const route = automaticRoute('', plannerAgent);
      if (!route) return null;
      const frontier = isFrontierNode(route.routedNode);
      return {
        node: route.routedNode,
        model: route.routedModel,
        tokPerSec: 0,
        usedCloudStrategist: frontier,
        usedFrontierBackup: frontier && !cloudStrategistRef.current
      };
    };
    if (!explicitRolePick(roleRoutesRef.current, 'planner')) return fromAuto();
    let autoHit: ReturnType<typeof fromAuto> = null;
    const resolved = resolveRoleRoute(live, roleRoutesRef.current, 'planner', () => {
      autoHit = fromAuto();
      return autoHit ? { node: autoHit.node, model: autoHit.model } : undefined;
    });
    if (!resolved) return null;
    if (resolved.source === 'auto') {
      noteRoleFallback('planner', resolved.fallbackReason || 'Pick unavailable', resolved);
      return autoHit;
    }
    const frontier = isFrontierNode(resolved.node);
    return {
      node: resolved.node,
      model: resolved.model,
      tokPerSec: 0,
      usedCloudStrategist: frontier,
      usedFrontierBackup: false
    };
  };

  const commitRoleRoutes = (next: RoleRoutes) => {
    const normalized = normalizeRoleRoutes(next);
    roleRoutesRef.current = normalized;
    setRoleRoutes(normalized);
    if (!applyingPeerConductorRef.current) {
      if (isWebConsoleClient()) roleRoutesEditRef.current = true;
      onConductorPrefsChange?.({ roleRoutes: normalized });
    }
  };

  const writeModelNumCtx = (nodeId: string, model: string, raw: number) => {
    if (!onUpdateNodes || isStreaming) return;
    const node = nodesRef.current.find(item => item.id === nodeId);
    if (!node || !model) return;
    const info = node.models?.find(item => item.name === model);
    const numCtx = clampNumCtx(raw, resolveModelMaxContext(model, info));
    onUpdateNodes(
      nodesRef.current.map(item => {
        if (item.id !== nodeId) return item;
        return {
          ...item,
          modelPrefs: {
            ...(item.modelPrefs || {}),
            [model]: { ...(item.modelPrefs?.[model] || {}), numCtx }
          }
        };
      })
    );
  };

  const personaForRole = (role: ConductorRoleId) =>
    role === 'planner' ? plannerAgent : role === 'reviewer' ? reviewerAgent : coderAgent;

  /** Same route resolveRoute would use: a usable pick, otherwise that role's Auto path. */
  const resolvedRole = (role: ConductorRoleId) => {
    const persona = personaForRole(role);
    const auto = () => {
      const route = automaticRoute('', persona);
      return route ? { node: route.routedNode, model: route.routedModel } : undefined;
    };
    const resolved = resolveRoleRoute(nodesRef.current, roleRoutes, role, auto);
    if (resolved) return resolved;
    const fallback = auto();
    return fallback ? { node: fallback.node, model: fallback.model, source: 'auto' as const } : undefined;
  };

  const onlineLocalNodes = nodes.filter(
    n => n.online && n.type !== 'openai' && getEnabledModelsForNode(n).length > 0
  );
  const chatResolved = resolvedRole(conductorRoleForPersona(currentAgent));
  const selectedNode = chatResolved?.node;
  const activeTargetModel = chatResolved?.model || '';
  const activeTargetMaxCtx = activeTargetModel
    ? pinnedNumCtx(selectedNode, activeTargetModel, currentAgent.numCtx)
    : 0;
  const selectedSupportsVision = modelSupportsVision(
    activeTargetModel,
    selectedNode,
    selectedNode?.models?.find(m => m.name === activeTargetModel)
  );

  useEffect(() => {
    if (skipMessagesSyncRef.current) {
      skipMessagesSyncRef.current = false;
      return;
    }
    messagesRef.current = messages;
  }, [messages]);

  const addImageFiles = async (files: FileList | File[] | null) => {
    if (!files) return;
    const list = Array.from(files).filter(f => f.type.startsWith('image/'));
    if (!list.length) return;
    const tier = activeTargetModel
      ? resolveModelFit(selectedNode, activeTargetModel, 'coder', currentAgent.numCtx).tier
      : 'standard';
    const encoded: string[] = [];
    for (const f of selectImagesForTier(list, tier)) {
      try {
        encoded.push(await fileToChatImage(f, { tier }));
      } catch (err) {
        console.warn('Failed to attach image', err);
      }
    }
    if (encoded.length) {
      setPendingImages(prev => selectImagesForTier([...prev, ...encoded], tier));
    }
  };

  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const imageFiles: File[] = [];
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) imageFiles.push(file);
      }
    }
    if (!imageFiles.length) return;
    e.preventDefault();
    await addImageFiles(imageFiles);
  };

  /**
   * Attach top-level Ollama `think`. Persona picks a level when the model advertises them.
   * Side paths (assist briefs) send `think: false` instead of this helper.
   */
  const withThink = (
    body: Record<string, unknown>,
    node: EndpointNode | undefined,
    model: string,
    persona?: ThinkPersona
  ) => {
    const live = node?.models?.find(m => m.name === model);
    const meta = node?.modelMeta?.[model];
    const modelInfo = live || (meta
      ? { name: model, capabilities: meta.capabilities, thinking: meta.thinking }
      : undefined);
    const think = resolveThinkOption(modelInfo, node?.modelPrefs?.[model]?.think, { persona });
    if (think === undefined) return body;
    return { ...body, think };
  };

  /** Pinned num_ctx ceiling for this model. Do not vary it per payload. */
  const modelMaxCtx = (node: EndpointNode | undefined, model: string) =>
    pinnedNumCtx(node, model, currentAgent.numCtx);

  const roleForDynamicCtx = (handle?: string): DynamicCtxRole => {
    const h = (handle || '').toLowerCase();
    if (h === 'planner') return 'planner';
    if (h === 'reviewer') return 'reviewer';
    if (h === 'docs') return 'docs';
    if (h === 'coder') return 'coder';
    return 'generic';
  };

  const chatOptions = (
    node: EndpointNode | undefined,
    model: string,
    role: DynamicCtxRole,
    extra?: { createIntent?: boolean; tier?: ModelFitTier; temperature?: number; fallbackNumCtx?: number }
  ) =>
    ollamaOptions(
      pinnedChatOptions({
        node,
        model,
        role,
        createIntent: extra?.createIntent,
        tier: extra?.tier,
        temperature: extra?.temperature,
        fallbackNumCtx: extra?.fallbackNumCtx ?? currentAgent.numCtx
      })
    );

  const freeTierUsageFor = (node: EndpointNode): FreeTierUsage | undefined => {
    const saved = node.freeTierUsage;
    const local = freeTierUsageRef.current[node.id];
    if (!saved) return local;
    if (!local) return saved;
    if (saved.day !== local.day) return saved.day > local.day ? saved : local;
    return (saved.count || 0) >= (local.count || 0) ? saved : local;
  };

  /** One short frontier reply. Free-tier calls pace to RPM and count against the daily cap. */
  const requestAssistBrief = async (
    target: { node: EndpointNode; model: string },
    purpose: string,
    payload: string,
    countFreeTier: boolean,
    parent?: ConductorRun
  ): Promise<string | null> => {
    const entered = bindRun(parent ?? null, false, 'assist');
    if (!entered) return null;
    const run = entered.run;
    const { hostLog } = scopeRunLog();
    try {
    if (!runLive(run)) return null;

    const runOnce = async (): Promise<{ content: string; aborted: boolean; stats?: { evalCount?: number; promptEvalCount?: number }; error?: string }> => {
      if (countFreeTier) {
        const waited = await waitForFreeTierRpm(target.node, {
          signal: {
            get aborted() {
              return !runLive(run);
            }
          },
          onWait: ms => {
            if (!runLive(run)) return;
            setExecutingPlanNotice(
              `Free-tier RPM limit — waiting ${Math.ceil(ms / 1000)}s before assist on ${target.node.name}…`
            );
          }
        });
        if (!runLive(run)) return { content: '', aborted: true };
        if (waited > 0) {
          hostLog(
            'info',
            `free-tier RPM wait ${waited}ms on ${target.node.name}`
          );
        }
      }
      const assistMessages = [
        { role: 'system', content: FREE_TIER_ASSIST_SYSTEM },
        { role: 'user', content: `${purpose}\n\n${tailForAssist(payload)}` }
      ];
      const assistCtx = pinnedNumCtx(target.node, target.model, currentAgent.numCtx);
      const body = {
        model: target.model,
        messages: assistMessages,
        think: thinkFalseForSidePaths(),
        options: {
          temperature: 0.1,
          num_predict: ASSIST_MAX_PREDICT,
          num_ctx: assistCtx
        }
      };
      try {
        const taken = await takeChat(
          {
            phase: 'assist',
            role: 'assist',
            nodeId: target.node.id,
            nodeName: target.node.name,
            model: target.model,
            numCtx: assistCtx,
            estPromptTokens: estimateTurnTokens(
              [FREE_TIER_ASSIST_SYSTEM, `${purpose}\n\n${tailForAssist(payload)}`],
              target.model
            )
          },
          () => streamChat(target.node.url, body, () => {}, target.node.type, target.node.apiKey),
          () => runLive(run)
        );
        if (taken.aborted) return { content: '', aborted: true };
        return {
          content: taken.result.content || '',
          aborted: false,
          stats: taken.result.stats
        };
      } catch (err: any) {
        return { content: '', aborted: false, error: err?.message || String(err) };
      }
    };

    let result = await runOnce();
    // If the stream layer still surfaces a rate-limit error, wait and retry once more.
    for (let attempt = 0; attempt < 2; attempt++) {
      if (result.aborted || !runLive(run)) return null;
      if (!isRateLimitError(result.error) && result.content.trim()) break;
      if (!isRateLimitError(result.error) && !result.error) break;
      if (!isRateLimitError(result.error)) break;
      const backoff = rateLimitBackoffMs(result.error, attempt);
      setExecutingPlanNotice(
        `Free-tier rate limit — waiting ${Math.ceil(backoff / 1000)}s then retrying assist…`
      );
      hostLog(
        'warn',
        `free-tier rate limit retry in ${backoff}ms: ${result.error}`
      );
      logRoute('retry', {
        text: `free-tier rate limit retry in ${backoff}ms`,
        nodeId: target.node.id,
        nodeName: target.node.name,
        model: target.model
      });
      await new Promise<void>(r => setTimeout(r, backoff));
      if (!runLive(run)) return null;
      result = await runOnce();
    }

    if (result.aborted || !runLive(run)) return null;
    if (result.error && !result.content.trim()) {
      hostLog('warn', `free-tier assist failed: ${result.error}`);
      setAssistError({
        cause: clipErrorCause(result.error, 'Cloud assist failed.'),
        node: target.node.name,
        model: target.model
      });
      return null;
    }
    const brief = (result.content || '').replace(/\s+/g, ' ').trim().slice(0, 1800);
    if (!brief) return null;
    if (countFreeTier) {
      freeTierUsageRef.current[target.node.id] = bumpFreeTierUsage(freeTierUsageFor(target.node));
      onNoteFreeTierCall?.(target.node.id);
    }
    if (result.stats?.evalCount) {
      onRecordTokens(0, result.stats.evalCount + (result.stats.promptEvalCount || 0));
    }
    notePromptSample(
      target.model,
      [
        { content: FREE_TIER_ASSIST_SYSTEM },
        { content: `${purpose}\n\n${tailForAssist(payload)}` }
      ],
      result.stats
    );
    return brief;
    } finally {
      leaveConductorRun(entered.owned, entered.run.token);
    }
  };

  /** One short frontier reply when the local window cannot hold the job. Null when no free-tier quota is left. */
  const requestFreeTierBrief = async (
    purpose: string,
    payload: string,
    parent?: ConductorRun
  ): Promise<string | null> => {
    const assist = pickFreeTierAssist(nodesRef.current, freeTierUsageFor);
    if (!assist) return null;
    return requestAssistBrief(assist, purpose, payload, true, parent);
  };

  const progressForPrompt = () => (hasWorkLog(progressRef.current) ? renderWorkLog(progressRef.current) : '');

  /** Log a status notice while this run is still live. A stopped run does not touch the status line. */
  const logNoticeNow = (text: string | null, run: ConductorRun) => {
    if (!runLive(run)) return;
    if (!text) {
      lastNoticeRef.current = null;
      setExecutingPlanNotice(null);
      return;
    }
    if (text === lastNoticeRef.current) {
      setExecutingPlanNotice(text);
      return;
    }
    if (activeRunLogIdRef.current == null) return;
    lastNoticeRef.current = text;
    const stepId = activeStepId();
    logRun({
      kind: 'notice',
      text,
      ...(stepId ? { stepId } : {})
    });
    setExecutingPlanNotice(text);
  };

  /** Hand control back to Planner after an ephemeral Coder/Reviewer worker finishes. */
  const restorePlannerControl = (notice?: string) => {
    ephemeralWorkerRef.current = false;
    onSelectAgent(plannerAgent.id);
    onConversationPatch?.({ agentId: plannerAgent.id });
    if (!notice) return;
    if (notice === lastNoticeRef.current) {
      setExecutingPlanNotice(notice);
      return;
    }
    lastNoticeRef.current = notice;
    const stepId = activeStepId();
    logRun({
      kind: planPausedRef.current ? 'pause' : 'notice',
      text: notice,
      ...(stepId ? { stepId } : {})
    });
    setExecutingPlanNotice(notice);
  };

  const fitContext = (numCtx: number, forceOrModel?: boolean | string, modelKey?: string) => {
    const force = forceOrModel === true;
    const key = typeof forceOrModel === 'string' ? forceOrModel : modelKey;
    const current = messagesRef.current;
    if (current.length < 6) return;
    if (!force && !shouldCompact(current, numCtx, key)) return;
    const planSummary = plannerPlanRef.current?.summary
      ? `${plannerPlanRef.current.status}: ${plannerPlanRef.current.summary}`
      : approvedPlanRef.current
        ? formatApprovedPlanBrief(approvedPlanRef.current)
        : undefined;
    const next = compactMessages(current, {
      planSummary,
      contractPath: projectBrainRef.current.contractFile,
      workLog: progressForPrompt()
    });
    if (next.length >= current.length && historyTokens(next, key) >= historyTokens(current, key) * 0.9) return;
    logContext('compact', `${current.length} messages to ${next.length}`, { numCtx });
    messagesRef.current = next;
    setMessages(next);
  };

  /** One extra request when a model stops inside an open write tag, then the file can be saved. */
  const finishTruncatedWrites = async (
    node: EndpointNode,
    model: string,
    content: string,
    doneReason: string | undefined,
    expectedFilePath: string | undefined,
    token: number
  ): Promise<string> => {
    const { hostLog } = scopeRunLog();
    const open = hasUnclosedWrite(content);
    if (!open || !runIsCurrent(token) || stopRequestedRef.current) return content;
    // Local models often report "stop" while forgetting </write_file>. Still continue once
    // when we know the path (assigned swarm file or tagged path).
    const pathKnown = !!(open.path && open.path !== 'file') || !!expectedFilePath;
    const cleanStop = /^(stop|end_turn|end)$/i.test(doneReason || '');
    if (cleanStop && !pathKnown) return content;
    const writePath = (open.path && open.path !== 'file' ? open.path : expectedFilePath) || open.path;
    const continueMsgs = [
      {
        role: 'system',
        content:
          'A file write was cut off. Continue from the exact cutoff. Output only the missing remainder of that file, then a closing </' +
          open.name +
          '> tag. Do not repeat text already written. Do not open a new file tag.'
      },
      { role: 'assistant', content: content.slice(-6000) },
      {
        role: 'user',
        content:
          'Continue the unfinished <' +
          open.name +
          ' path="' +
          writePath +
          '"> from the last characters above. End with </' +
          open.name +
          '>.'
      }
    ];
    const finishOptions = chatOptions(node, model, 'coder', { createIntent: true, temperature: 0.2 });
    const body = withThink(
      {
        model,
        messages: continueMsgs,
        options: finishOptions
      },
      node,
      model,
      'coder'
    );
    try {
      const taken = await takeChat(
        {
          phase: 'truncated-write',
          role: 'coder',
          nodeId: node.id,
          nodeName: node.name,
          model,
          numCtx: finishOptions.num_ctx,
          estPromptTokens: estimateTurnTokens(
            continueMsgs.map(message => message.content),
            model
          )
        },
        () => streamChat(node.url, body, () => {}, node.type, node.apiKey),
        () => runIsCurrent(token) && !stopRequestedRef.current
      );
      if (taken.aborted || !runIsCurrent(token)) return content;
      const extra = (taken.result.content || '').trim();
      if (!extra) return content;
      return content + (content.endsWith('\n') ? '' : '\n') + extra;
    } catch (err: any) {
      hostLog('error', `finish truncated write: ${err?.message || err}`);
      return content;
    }
  };

  // ==========================================
  // UNIFIED TOOL EXECUTION & AGENTIC LOOP
  // ==========================================
  const runSingleTool = async (tool: ToolCall): Promise<ToolCall> => {
    const owner = runRef.current;
    const captured = owner
      ? { token: owner.token, conversationId: owner.conversationId }
      : null;
    const conversationAtStart = conversationIdRef.current;
    const updated = await executeTool(tool, toolDepsRef.current);
    const sameConversation =
      conversationIdRef.current === (captured ? captured.conversationId : conversationAtStart);
    if (!sameConversation) return updated;
    if (captured && !runIsCurrent(captured.token)) return updated;
    updateProgress(log => noteSavedFiles(log, [updated], savedFileFingerprints()));
    let hostMsg: ChatMessage | undefined;
    const toolMessages = messagesRef.current.map(m => {
      if (!m.toolCalls?.some(t => t.id === tool.id)) return m;
      const next = {
        ...m,
        toolCalls: m.toolCalls!.map(t => (t.id === tool.id ? updated : t))
      };
      hostMsg = next;
      return next;
    });
    messagesRef.current = toolMessages;
    setMessages(toolMessages);
    // Manual Run on a failed command → one self-correct attempt
    if (
      updated.name === 'run_command' &&
      updated.status === 'error' &&
      hostMsg &&
      shouldContinueFromTools(hostMsg.toolCalls || [], continueDecisionOpts())
    ) {
      resetAgentLoopBudget();
      const host = hostMsg;
      await runAsUser('tool', async run => {
        await continueWithToolResults(host, { createIntent: true, run });
      });
    }
    return updated;
  };

  const continueWithToolResults = async (
    originMsg: ChatMessage,
    opts?: {
      expectedFilePath?: string;
      createIntent?: boolean;
      node?: EndpointNode;
      model?: string;
      budget?: LoopBudget;
      /** Explicit role for this continue — never infer from stale UI currentAgent. */
      role?: 'planner' | 'reviewer' | 'coder' | 'docs';
      stepVerdictMode?: boolean;
      lockPlanMode?: boolean;
      reviewMode?: boolean;
      /** Cleared-context worker continue (only this turn + tool feedback). */
      freshContext?: boolean;
      /** Final source-folder review. A final_review tag counts as the structured result. */
      finalSourceReview?: boolean;
      /** One last answer turn after the read cap. Tool tags in that reply are not run. */
      verdictNow?: boolean;
      run?: ConductorRun;
    }
  ): Promise<ChatMessage | undefined> => {
    const { logToolEvent, hostLog } = scopeRunLog();
    const budget = opts?.budget;
    const depth = budget ? budget.depth : continuationDepthRef.current;

    const feedbackTools = collectFeedbackTools(originMsg.toolCalls || []);
    if (feedbackTools.length === 0) return;

    // Role from the originating turn only. currentAgent is often still Planner after
    // onSelectAgent(coder) because React state has not re-rendered yet — that wrongly
    // re-opened <plan_options> mid-execution in Webtest.
    const originRole = (
      opts?.role ||
      originMsg.personaHandle ||
      'coder'
    ).toLowerCase();
    const planLocked = isPlanActive(plannerPlanRef.current);
    const reviewModeContinue =
      !!opts?.reviewMode || originRole === 'reviewer' || !!opts?.stepVerdictMode;
    // Architecture <plan_options> only before a plan is locked — never mid-execution.
    const planModeContinue =
      originRole === 'planner' &&
      !planLocked &&
      !opts?.lockPlanMode &&
      !reviewModeContinue;
    const lockPlanContinue = !!opts?.lockPlanMode || (originRole === 'planner' && planLocked);
    const reviewModeGate = reviewModeContinue;
    const continueOpts = continueDecisionOpts(budget, {
      maxReadOnlyContinues: reviewModeGate ? 1 : undefined
    });
    const prevTerminalFp = continueOpts.terminalFingerprint;
    const activeReviewStepId = () => {
      const id = getActiveStep(plannerPlanRef.current)?.id;
      return id != null && String(id) !== '' ? String(id) : undefined;
    };
    const reviewVerdictTurnNeeded = (batch: ToolCall[], raw: string, used: number, max?: number) =>
      needsReviewVerdictTurn({
        reviewMode: reviewModeContinue,
        stepVerdictMode: !!opts?.stepVerdictMode || originMsg.stepVerdict != null,
        finalSourceReview: !!opts?.finalSourceReview,
        tools: batch,
        raw,
        readOnlyContinues: used,
        maxReadOnlyContinues: max ?? 1,
        activeStepId: activeReviewStepId()
      });
    // Cap reached with only reads and no verdict tag: one answer turn, then stop.
    // That single answer turn still runs when the tool-step depth budget is already spent.
    let verdictNow = !!opts?.verdictNow;
    const atDepthLimit = depth >= toolStepLimit;
    if (!verdictNow && !shouldContinueFromTools(originMsg.toolCalls || [], continueOpts)) {
      if (
        reviewVerdictTurnNeeded(
          originMsg.toolCalls || [],
          originMsg.raw || '',
          continueOpts.readOnlyContinues,
          continueOpts.maxReadOnlyContinues
        )
      ) {
        verdictNow = true;
      } else {
        rememberTerminalFingerprint(originMsg.toolCalls || [], budget);
        return;
      }
    } else if (!verdictNow && atDepthLimit) {
      if (
        reviewVerdictTurnNeeded(
          originMsg.toolCalls || [],
          originMsg.raw || '',
          continueOpts.readOnlyContinues,
          continueOpts.maxReadOnlyContinues
        )
      ) {
        verdictNow = true;
      } else {
        return;
      }
    }

    const cmdFailed = feedbackTools.some(t => t.name === 'run_command' && t.status === 'error');
    const writeFailed = feedbackTools.some(
      t => (t.name === 'write_file' || t.name === 'edit_file') && t.status === 'error'
    );
    const priorFixAttempts = budget ? budget.commandFixAttempts : commandFixAttemptsRef.current;
    if (cmdFailed) {
      const sigs = failedCommandSignatures(feedbackTools);
      if (budget) {
        budget.prevFailedCmdSigs = [...new Set([...budget.prevFailedCmdSigs, ...sigs])];
        budget.commandFixAttempts += 1;
      } else {
        prevFailedCmdSigsRef.current = [
          ...new Set([...prevFailedCmdSigsRef.current, ...sigs])
        ];
        commandFixAttemptsRef.current += 1;
      }
    }
    if (writeFailed) {
      if (budget) budget.writeFixAttempts += 1;
      else writeFixAttemptsRef.current += 1;
    }
    if (!verdictNow && isReadOnlyToolBatch(originMsg.toolCalls || [])) {
      if (budget) budget.readOnlyContinues += 1;
      else readOnlyContinuesRef.current += 1;
    }

    if (budget) budget.depth += 1;
    else continuationDepthRef.current += 1;

    const currentTerminalFp = (() => {
      const result = latestTerminalResult(originMsg.toolCalls || []);
      return result ? terminalResultFingerprint(result) : undefined;
    })();
    const sameTerminalFingerprint = Boolean(
      prevTerminalFp && currentTerminalFp && prevTerminalFp === currentTerminalFp
    );
    rememberTerminalFingerprint(originMsg.toolCalls || [], budget);
    const continueAgent = reviewModeContinue
      ? reviewerAgent
      : planModeContinue || lockPlanContinue
        ? plannerAgent
        : coderAgent;
    const continueRoute =
      opts?.node && opts?.model ? undefined : resolveRoute('Continue the current task', continueAgent);
    const routeNode =
      opts?.node ||
      nodesRef.current.find(item => item.id === originMsg.endpointId) ||
      continueRoute?.routedNode;
    if (!routeNode) return;
    const routeModel = opts?.model || originMsg.model || continueRoute?.routedModel || '';
    if (!routeModel) return;
    const followUpId = `followup-${Date.now()}`;
    const followUpMsg: ChatMessage = {
      id: followUpId,
      role: 'assistant',
      raw: '',
      display: cmdFailed
        ? 'Command failed — one fix attempt from terminal output...'
        : planModeContinue
          ? 'Explored the workspace. Drafting the plan and options...'
          : lockPlanContinue
            ? 'Explored the workspace. Locking execution steps...'
          : reviewModeContinue
            ? verdictNow
              ? 'Read budget used — writing the verdict...'
              : 'Explored the workspace. Drafting the review fix plan...'
            : 'Analyzed project files. Now generating implementation...',
      agentId: continueAgent.id,
      personaHandle: continueAgent.handle || originRole,
      endpointId: routeNode.id,
      endpointName: routeNode.name,
      model: routeModel,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      toolCalls: []
    };

    let homeConversationId: string | null = null;
    const writeMessages = (next: ChatMessage[]) => {
      if (conversationIdRef.current !== homeConversationId) return;
      messagesRef.current = next;
      setMessages(next);
    };
    const writeFollowUp = (message: ChatMessage) => {
      if (conversationIdRef.current !== homeConversationId) return;
      const prev = messagesRef.current;
      const next = prev.some(item => item.id === message.id)
        ? prev.map(item => (item.id === message.id ? message : item))
        : [...prev, message];
      writeMessages(next);
    };

    const entered = bindRun(opts?.run ?? null, false, 'follow-up');
    if (!entered) return;
    const run = entered.run;
    homeConversationId = run.conversationId;
    if (!runLive(run)) {
      leaveConductorRun(entered.owned, entered.run.token);
      return;
    }
    writeFollowUp(followUpMsg);
    setIsStreaming(true);

    try {
      const continueTier = resolveModelFit(
        routeNode,
        routeModel,
        roleForDynamicCtx(continueAgent.handle),
        continueAgent.numCtx
      ).tier;
      applyToolTier(continueTier);
      let continuationPrompt = buildContinuationUserPrompt(feedbackTools, {
        // True only on a 2nd+ command-fix continue (when MAX_COMMAND_FIX_ATTEMPTS > 1)
        finalCommandAttempt: priorFixAttempts > 0,
        tier: continueTier
      });
      const emptyTerminalNoFail =
        feedbackTools.some(
          t => t.name === 'read_terminal' && t.status === 'done' && isEmptyTerminalResult(t.result)
        ) && !feedbackTools.some(t => t.name === 'run_command' && t.status === 'error');
      if (emptyTerminalNoFail) {
        continuationPrompt +=
          '\n\n[DIRECTIVE: Terminal buffer is empty. Do NOT call <read_terminal> again.]';
      } else if (sameTerminalFingerprint) {
        continuationPrompt +=
          '\n\n[DIRECTIVE: Do NOT call read_terminal again; terminal output is unchanged.]';
      }
      const readOnlyContinue =
        planModeContinue || reviewModeContinue || lockPlanContinue;
      const stepVerdictContinue = !!opts?.stepVerdictMode || originMsg.stepVerdict != null;
      const freshContinue = !!(opts?.freshContext || ephemeralWorkerRef.current);
      if (!freshContinue) fitContext(modelMaxCtx(routeNode, routeModel), routeModel);
      const continueRole = roleForDynamicCtx(continueAgent.handle);
      const systemPrompt = buildSystemPrompt(continueAgent, workspacePath, workspaceOverview, {
        stablePrefix: true,
        planMode: planModeContinue,
        reviewMode: reviewModeContinue,
        lockPlanMode: lockPlanContinue && !reviewModeContinue,
        stepVerdictMode: opts?.finalSourceReview
          ? false
          : stepVerdictContinue || (planLocked && reviewModeContinue),
        projectContext: projectContextForPrompt(rulesCapFor(continueTier)),
        inferenceModel: routeModel
      });
      const followBudget = reviewFollowUpBudget(modelMaxCtx(routeNode, routeModel), continueRole);
      if (verdictNow) {
        continuationPrompt += `\n\n${reviewVerdictNowInstruction({
          stepVerdictMode: stepVerdictContinue && !opts?.finalSourceReview,
          finalSourceReview: !!opts?.finalSourceReview
        })}`;
      }
      if (verdictNow || reviewModeContinue) {
        continuationPrompt = boundReviewContinuation(continuationPrompt, followBudget.toolChars);
      }
      // Ephemeral workers: only this turn + tool feedback. Planner keeps full chat memory.
      const historySlice = freshContinue
        ? []
        : historyForModel(
            messagesRef.current.filter(m => m.id !== followUpId),
            stripThinking
          );
      let userContent = prependVolatileContext(
        planModeContinue
          ? `${continuationPrompt}\n\n[PLANNER DIRECTIVE: After using exploration results, produce the plan and end with a <plan_options> block. Do NOT write deliverable files.]`
          : lockPlanContinue && !reviewModeContinue
            ? `${continuationPrompt}\n\n[PLANNER DIRECTIVE: Finish the <execution_plan> steps/tasks for the chosen option. Do NOT emit <plan_options>. Do NOT write deliverable files.]`
            : reviewModeContinue
              ? opts?.finalSourceReview
                ? `${continuationPrompt}\n\n[REVIEWER DIRECTIVE: STOP reading. Do not call any tools. Reply with <final_review><result>pass|issues</result><notes>...</notes></final_review>. Do NOT emit <review_plan>, <review_delta>, or <step_verdict>. Do NOT write files.]`
                : stepVerdictContinue || planLocked
                  ? `${continuationPrompt}\n\n[REVIEWER DIRECTIVE: STOP reading. Emit <step_verdict> yay or nay for the active step only. Do NOT emit <plan_options> or <review_plan>. Do NOT write files.]`
                  : `${continuationPrompt}\n\n[REVIEWER DIRECTIVE: STOP reading more files. Report findings and end with a <review_plan> that has <task> items for Planner→Coder. Do NOT write/edit/Apply files yourself.]`
              : continuationPrompt,
        {
          nodes: nodesRef.current,
          inferenceNodeId: routeNode.id,
          includeInventory: planModeContinue || lockPlanContinue,
          fallbackNumCtx: modelMaxCtx(routeNode, routeModel),
          progressLog: progressForPrompt(),
          overview: workspaceOverview,
          approvedPlan:
            planModeContinue || reviewModeContinue || lockPlanContinue
              ? null
              : approvedPlanRef.current
        }
      );
      const fittedContinue = fitPromptToContext({
        system: systemPrompt,
        userContent,
        history: historySlice.map(message => ({
          role: message.role,
          content: message.content,
          ...(message.images?.length ? { images: message.images } : {})
        })),
        maxCtx: followBudget.pinnedCtx,
        frontier: routeNode.type === 'openai' || !!routeNode.apiKey,
        modelKey: routeModel,
        promptBudget: followBudget.promptBudget
      });
      userContent = fittedContinue.userContent;
      if (fittedContinue.note) {
        logContext('fit', fittedContinue.note, {
          numCtx: followBudget.pinnedCtx,
          promptBudget: followBudget.promptBudget
        });
      }
      const conversationPayload = [
        { role: 'system', content: systemPrompt },
        ...fittedContinue.history,
        {
          role: 'assistant',
          content: stripThinking(originMsg.raw || 'I inspected the project / terminal.')
        },
        { role: 'user', content: userContent }
      ];

      const continueOptions = chatOptions(routeNode, routeModel, continueRole, {
        createIntent: !readOnlyContinue,
        tier: continueTier,
        temperature: continueAgent.temperature,
        fallbackNumCtx: continueAgent.numCtx
      });
      const body = withThink({
        model: routeModel,
        messages: conversationPayload,
        options: continueOptions
      }, routeNode, routeModel, continueRole);

      const openContinue = () => streamChat(
        routeNode.url,
        body,
        (content, thinking) => {
          const parsed = parseResponse(content, followUpId, true, {
            expectedFilePath: opts?.expectedFilePath,
            createIntent: opts?.createIntent
          });
          const liveOptions =
            planModeContinue && !isPlanActive(plannerPlanRef.current)
              ? parsePlanOptions(content)
              : [];
          const liveReview = reviewModeContinue ? parseReviewPlan(content) : null;
          const liveVerdict = stepVerdictContinue ? parseStepVerdict(content) : null;
          let displayLive = safeAssistantDisplay(parsed, {
            structured: !!(liveReview || liveVerdict || liveOptions.length >= 2)
          });
          displayLive = scrubStructuredMarkup(displayLive);
          if (liveVerdict || liveReview || parseExecutionPlan(content)) displayLive = '';
          if (!runLive(run)) return;
          const streaming = messagesRef.current.find(item => item.id === followUpId) || followUpMsg;
          writeFollowUp({
            ...streaming,
            raw: content,
            display: displayLive,
            thinking: parsed.thinking || thinking,
            toolCalls: verdictNow
              ? []
              : collapseDuplicateReadTools(
                  readOnlyContinue
                    ? parsed.toolCalls.filter(t =>
                        ['read_file', 'list_dir', 'search', 'read_terminal'].includes(t.name)
                      )
                    : parsed.toolCalls
                ),
            ...(liveOptions.length >= 2
              ? {
                  planOptions: liveOptions,
                  planSummary: buildPlanSummary(content, liveOptions)
                }
              : {}),
            ...(liveReview ? { reviewPlan: liveReview } : {}),
            ...(liveVerdict
              ? {
                  stepVerdict: {
                    stepId: liveVerdict.stepId || getActiveStep(plannerPlanRef.current)?.id || '',
                    stepTitle: getActiveStep(plannerPlanRef.current)?.title || 'Step',
                    result: liveVerdict.result,
                    notes: liveVerdict.notes
                  }
                }
              : {})
          });
        },
        routeNode.type,
        routeNode.apiKey
      );
      const taken = await takeChat(
        {
          phase: 'follow-up',
          role: continueAgent.handle || originRole,
          nodeId: routeNode.id,
          nodeName: routeNode.name,
          model: routeModel,
          numCtx: continueOptions.num_ctx,
          estPromptTokens: estimateTurnTokens(
            conversationPayload.map(message => message.content),
            routeModel
          )
        },
        openContinue,
        () => runLive(run)
      );
      if (taken.aborted || !runLive(run)) return;
      const result = taken.result;
      notePromptSample(routeModel, conversationPayload, result.stats);
      const finished = readOnlyContinue
        ? result.content
        : await finishTruncatedWrites(
            routeNode,
            routeModel,
            result.content,
            result.stats?.doneReason,
            opts?.expectedFilePath,
            run.token
          );
      if (!runLive(run)) return;
      const finalParsed = parseResponse(finished, followUpId, false, {
        expectedFilePath: opts?.expectedFilePath,
        createIntent: readOnlyContinue ? false : (opts?.createIntent ?? true),
        allowUnclosedSalvage: false
      });

      let tools = collapseDuplicateReadTools(finalParsed.toolCalls);
      if (
        !readOnlyContinue &&
        !continuationClosedWrite(result.content, finished) &&
        hasUnclosedWrite(finished)
      ) {
        const truncated = truncatedWriteToolCall(finished, followUpId, opts?.expectedFilePath);
        if (truncated) {
          tools = [...tools, truncated];
          logToolEvent(truncated);
        }
      }
      if (verdictNow) {
        // The answer turn may still emit tool tags. Do not run them.
        tools = [];
      } else {
        if (readOnlyContinue) {
          tools = tools.filter(t =>
            ['read_file', 'list_dir', 'search', 'read_terminal'].includes(t.name)
          );
        }
        if (!runLive(run)) return;
        const readPass = await runReadOnlyTools(tools, toolDepsRef.current);
        tools = readPass.tools;
        if (!runLive(run)) return;

        if (!readOnlyContinue && autoApplyOn()) {
          tools = await autoApplyWritableTools(tools, toolDepsRef.current);
          if (!runLive(run)) return;
          tools = await runAuxTools(tools, toolDepsRef.current);
          const cmdPass = await runCommandTools(tools, toolDepsRef.current);
          tools = cmdPass.tools;
          updateProgress(log => noteSavedFiles(log, tools, savedFileFingerprints()));
          noteAppliedWrites(tools);
        }
      }

      const stillFailing =
        failedCommandSignatures(tools).length > 0 &&
        !shouldContinueFromTools(tools, continueDecisionOpts(budget));
      const planOptions =
        planModeContinue && !isPlanActive(plannerPlanRef.current)
          ? parsePlanOptions(finished)
          : [];
      const reviewPlan = reviewModeContinue ? parseReviewPlan(finished) : null;
      const contVerdict = stepVerdictContinue ? parseStepVerdict(finished) : null;
      let displayBase = safeAssistantDisplay(
        { ...finalParsed, toolCalls: tools },
        { structured: !!(reviewPlan || contVerdict || planOptions.length >= 2) }
      );
      displayBase = scrubStructuredMarkup(displayBase);
      if (contVerdict || reviewPlan || parseExecutionPlan(finished)) displayBase = '';
      const writeAnnot = annotateAppliedWrites(tools);
      if (writeAnnot && !displayBase.includes('Wrote') && !displayBase.includes('Edited')) {
        displayBase = displayBase ? `${displayBase}\n${writeAnnot}` : writeAnnot;
      }
      const followUpMsgFinal: ChatMessage = {
        ...followUpMsg,
        raw: finished,
        display: stillFailing
          ? `${displayBase}\n\n⚠️ Still failing after one auto-fix attempt — check the terminal, or ask to try again.`
          : displayBase,
        thinking: finalParsed.thinking || result.thinking,
        toolCalls: tools,
        ...(planOptions.length > 0
          ? {
              planOptions,
              planSummary: buildPlanSummary(finished, planOptions)
            }
          : {}),
        ...(reviewPlan ? { reviewPlan } : {}),
        ...(contVerdict
          ? {
              stepVerdict: {
                stepId: contVerdict.stepId || getActiveStep(plannerPlanRef.current)?.id || '',
                stepTitle: getActiveStep(plannerPlanRef.current)?.title || 'Step',
                result: contVerdict.result,
                notes: contVerdict.notes
              }
            }
          : {})
      };

      let produced: ChatMessage = followUpMsgFinal;
      writeFollowUp(produced);

      if (!runLive(run)) return produced;
      if (!verdictNow && runLive(run)) {
        const afterOpts = continueDecisionOpts(budget, {
          maxReadOnlyContinues: reviewModeGate ? 1 : undefined
        });
        let deeper: ChatMessage | undefined;
        if (shouldContinueFromTools(tools, afterOpts)) {
          deeper = await continueWithToolResults(followUpMsgFinal, { ...opts, run });
        } else if (
          reviewVerdictTurnNeeded(
            tools,
            finished,
            afterOpts.readOnlyContinues,
            afterOpts.maxReadOnlyContinues
          )
        ) {
          deeper = await continueWithToolResults(followUpMsgFinal, { ...opts, run, verdictNow: true });
        }
        if (deeper) produced = deeper;
      }
      return produced;
    } catch (err: any) {
      hostLog('error', `code generation: ${err?.message || err}`);
      if (runLive(run)) {
        const current = messagesRef.current.find(item => item.id === followUpId) || followUpMsg;
        writeFollowUp({
          ...current,
          error: err?.message || String(err),
          endpointName: current.endpointName || routeNode.name,
          model: current.model || routeModel
        });
      }
    } finally {
      if (!runLive(run)) {
        const current = messagesRef.current.find(item => item.id === followUpId);
        if (current && current.display === followUpMsg.display) {
          writeFollowUp({ ...current, display: 'Stopped.' });
        }
      }
      if (entered.owned && (runIsCurrent(run.token) || !heldRef.current)) setIsStreaming(false);
      leaveConductorRun(entered.owned, entered.run.token);
    }
  };

  // ==========================================
  // CONDUCTOR SWARM — CONTRACT-FIRST TWO-PASS
  // ==========================================
  const handleSendPipelineMessage = async (
    userText: string,
    fullPrompt: string,
    opts?: {
      approvedPlan?: ApprovedPlan | null;
      skipUserAppend?: boolean;
      run?: ConductorRun;
      /** Active plan step: skip Pass-1 and fan one worker per file. */
      stepDispatch?: { files: string[]; brief: string };
    }
  ) => {
    const entered = bindRun(opts?.run ?? null, false, 'swarm');
    if (!entered) return;
    const run = entered.run;
    const { logRun, hostLog, logToolEvent } = scopeRunLog();
    try {
    void fullPrompt;
    resetAgentLoopBudget();
    const swarmPlanner = leadArchitectNow();
    fitContext(
      modelMaxCtx(swarmPlanner?.node, swarmPlanner?.model || ''),
      swarmPlanner?.model || ''
    );
    const lockedPlan = opts?.approvedPlan ?? approvedPlanRef.current;
    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: 'user',
      raw: userText,
      display: userText,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      personaHandle: 'coder'
    };

    const agentMsgId = `pipeline-${Date.now()}`;
    let architect = swarmPlanner;
    let pass1Frame: ActivityHandle | undefined;

    const patchPipelineMsg = (
      patch: Partial<ChatMessage> | ((m: ChatMessage) => ChatMessage)
    ) => {
      if (!runLive(run)) return;
      setMessages(prev => {
        const next = prev.map(m => {
          if (m.id !== agentMsgId) return m;
          return typeof patch === 'function' ? patch(m) : { ...m, ...patch };
        });
        messagesRef.current = next;
        return next;
      });
    };

    const readWorkspaceRel = async (rel: string): Promise<string | undefined> => {
      if (!window.electronAPI || !workspacePath) return undefined;
      const abs = `${workspacePath}\\${rel.replace(/^[\\/]+/, '').replace(/\//g, '\\')}`;
      try {
        const res = await window.electronAPI.readFile(abs);
        return res.content;
      } catch {
        return undefined;
      }
    };

    const loadExistingSnippets = async (): Promise<string> => {
      if (!window.electronAPI || !workspacePath) return '';
      const sep = workspacePath.includes('\\') ? '\\' : '/';
      const ranked = relevantFilesForTask(repoMapRef.current, userText, 8);
      const rels = new Set<string>(ranked.map(rel => rel.replace(/\\/g, '/')));
      const contract = projectBrainRef.current.contractFile;
      if (contract && rels.size < 8) rels.add(contract.replace(/\\/g, '/'));
      if (rels.size < 4) {
        for (const owned of projectBrainRef.current.ownedFiles) {
          rels.add(owned.replace(/\\/g, '/'));
          if (rels.size >= 8) break;
        }
      }
      const chunks: string[] = [];
      for (const rel of [...rels].slice(0, 8)) {
        try {
          const abs = `${workspacePath.replace(/[\\/]+$/, '')}${sep}${rel.replace(/\//g, sep)}`;
          const res = await window.electronAPI.readFile(abs);
          if (res.content != null) {
            chunks.push(`### ${rel}\n\`\`\`\n${res.content.slice(0, 1200)}\n\`\`\``);
          }
        } catch {
          /* skip */
        }
      }
      return chunks.join('\n\n');
    };

    const recordTok = (
      node: EndpointNode,
      stats?: { evalCount?: number; promptEvalCount?: number },
      sample?: { model: string; messages: Array<{ content?: unknown }> }
    ) => {
      if (sample) notePromptSample(sample.model, sample.messages, stats);
      if (!stats?.evalCount) return;
      const tok = stats.evalCount + (stats.promptEvalCount || 0);
      if (isFrontierNode(node)) onRecordTokens(0, tok);
      else onRecordTokens(tok, 0);
    };

    const runWorkerTurn = async (opts: {
      idx: number;
      assignment: SwarmAssignment;
      userPrompt: string;
      expectedFilePath: string;
      stepLabel?: string;
      stack?: string;
      retriedFrom?: string;
      retargeted?: boolean;
      /** Same-node retry already used. The next failure failsover. */
      retriedSame?: boolean;
    }): Promise<boolean> => {
      if (!runLive(run)) return false;
      const { idx, assignment, userPrompt, expectedFilePath } = opts;
      let { node, model, skippedReason } = assignment;
      // Card indexes are only valid while this run's Swarm column is on screen.
      const failWorkerCard = (content: string) =>
        runLive(run) &&
        upsertNodeWorkStep(
          {
            nodeId: node.id,
            nodeName: node.name,
            modelName: model,
            targetFile: expectedFilePath,
            agentHandle: 'coder',
            role: `${model} (local)`,
            status: 'failed',
            content
          },
          idx
        );
      const failRepeatedOutput = () => {
        const reason = 'Model output repeated itself; aborted';
        patchPipelineMsg(m => {
          if (!m.pipelineSteps) return m;
          const updatedSteps = [...m.pipelineSteps];
          if (updatedSteps[idx]) {
            updatedSteps[idx] = { ...updatedSteps[idx], status: 'failed', content: reason };
          }
          return { ...m, pipelineSteps: updatedSteps };
        });
        failWorkerCard(reason);
        return false;
      };
      if (!opts.retargeted) {
        const liveNode = nodesRef.current.find(n => n.id === node.id);
        const stillLive = !!liveNode?.online && getEnabledModelsForNode(liveNode).includes(model);
        if (!stillLive) {
          const fail = opts.retriedFrom
            ? undefined
            : pickFailoverTarget(nodesRef.current, node.id, model, { role: 'coder' });
          if (
            fail &&
            fail.node.online &&
            getEnabledModelsForNode(fail.node).includes(fail.model)
          ) {
            logRoute('failover', {
              text: `${node.name}/${model} -> ${fail.node.name}/${fail.model}`,
              nodeId: fail.node.id,
              nodeName: fail.node.name,
              model: fail.model
            });
            return runWorkerTurn({
              ...opts,
              assignment: { ...assignment, node: fail.node, model: fail.model },
              retargeted: true,
              retriedFrom: node.id
            });
          }
          patchPipelineMsg(m => {
            if (!m.pipelineSteps) return m;
            const updatedSteps = [...m.pipelineSteps];
            if (updatedSteps[idx]) {
              updatedSteps[idx] = {
                ...updatedSteps[idx],
                status: 'failed',
                content: `Skipped: ${node.name} is offline or ${model} is disabled`
              };
            }
            return { ...m, pipelineSteps: updatedSteps };
          });
          failWorkerCard(`Skipped: ${node.name} is offline or ${model} is disabled`);
          logRoute('skip', {
            text: `${node.name} is offline or ${model} is disabled`,
            nodeId: node.id,
            nodeName: node.name,
            model
          });
          return false;
        }
        node = liveNode!;
      }
      if (skippedReason && !node.online) {
        patchPipelineMsg(m => {
          if (!m.pipelineSteps) return m;
          const updatedSteps = [...m.pipelineSteps];
          if (updatedSteps[idx]) {
            updatedSteps[idx] = {
              ...updatedSteps[idx],
              status: 'failed',
              content: `Skipped: ${skippedReason}`
            };
          }
          return { ...m, pipelineSteps: updatedSteps };
        });
        failWorkerCard(`Skipped: ${skippedReason}`);
        logRoute('skip', {
          text: skippedReason,
          nodeId: node.id,
          nodeName: node.name,
          model
        });
        return false;
      }

      if (!runLive(run)) return false;
      const workerFit = resolveModelFit(node, model, 'coder', coderAgent.numCtx);
      applyToolTier(workerFit.tier);
      const workerSystemPrompt = buildSwarmWorkerSystemStub(
        expectedFilePath,
        opts.stack || projectBrainRef.current.stack
      );
      const workerReq = pinnedChatOptions({
        node,
        model,
        role: 'coder',
        createIntent: true,
        tier: workerFit.tier,
        temperature: coderAgent.temperature,
        fallbackNumCtx: coderAgent.numCtx
      });
      const workerFitPrompt = fitPromptToContext({
        system: workerSystemPrompt,
        userContent: userPrompt,
        history: [],
        maxCtx: workerReq.pinnedCtx,
        frontier: isFrontierNode(node),
        modelKey: model,
        promptBudget: workerReq.promptBudget
      });
      if (workerFitPrompt.note) {
        setExecutingPlanNotice(workerFitPrompt.note);
        logContext('fit', workerFitPrompt.note, {
          numCtx: workerReq.pinnedCtx,
          promptBudget: workerReq.promptBudget,
          estPromptTokens: estimateTurnTokens(
            [workerSystemPrompt, workerFitPrompt.userContent],
            model
          )
        });
      }
      const workerOptions = ollamaOptions(workerReq);
      let sentWorkerMsgs: Array<{ role: string; content: string }> = [
        { role: 'system', content: workerSystemPrompt },
        { role: 'user', content: workerFitPrompt.userContent }
      ];
      const body = withThink(
        {
          model,
          messages: sentWorkerMsgs,
          options: workerOptions
        },
        node,
        model,
        'coder'
      );

      try {
        upsertNodeWorkStep(
          {
            nodeId: node.id,
            nodeName: node.name,
            modelName: model,
            targetFile: expectedFilePath,
            agentHandle: 'coder',
            role: `${model} (local)`,
            status: 'running',
            content: `Writing \`${expectedFilePath}\`…`,
            toolCalls: []
          },
          idx
        );
        const openWorker = (payload: Record<string, unknown>) =>
          streamChat(
            node.url,
            payload,
            () => {
              if (!runLive(run)) return;
              const statusLine = `Writing \`${expectedFilePath}\`…`;
              patchPipelineMsg(m => {
                if (!m.pipelineSteps) return m;
                const updatedSteps = [...m.pipelineSteps];
                if (updatedSteps[idx]) {
                  updatedSteps[idx] = {
                    ...updatedSteps[idx],
                    status: 'running',
                    content: statusLine
                  };
                }
                return { ...m, pipelineSteps: updatedSteps };
              });
              upsertNodeWorkStep(
                {
                  nodeId: node.id,
                  nodeName: node.name,
                  modelName: model,
                  targetFile: expectedFilePath,
                  agentHandle: 'coder',
                  role: `${model} (local)`,
                  status: 'running',
                  content: statusLine,
                  toolCalls: []
                },
                idx
              );
            },
            node.type,
            node.apiKey
          );
        const taken = await takeChat(
          {
            phase: 'swarm-worker',
            role: 'coder',
            nodeId: node.id,
            nodeName: node.name,
            model,
            numCtx: workerOptions.num_ctx,
            promptBudget: workerReq.promptBudget,
            estPromptTokens: estimateTurnTokens(
              sentWorkerMsgs.map(message => message.content),
              model
            )
          },
          () => openWorker(body),
          () => runLive(run)
        );
        if (taken.aborted && runLive(run)) return failRepeatedOutput();
        if (taken.aborted || !runLive(run)) return false;
        let res = taken.result;
        if (
          !isFrontierNode(node) &&
          workerFitPrompt.shrinks < 2 &&
          contextWasExhausted(res.stats, workerReq.pinnedCtx, workerOptions.num_ctx)
        ) {
          const smaller = shrinkUserPacket(workerFitPrompt.userContent, 2);
          sentWorkerMsgs = [
            { role: 'system', content: workerSystemPrompt },
            { role: 'user', content: smaller }
          ];
          logContext(
            'resubmit',
            `Context monitor: ${model} filled its window. Resent ${expectedFilePath} with a smaller packet.`,
            {
              numCtx: workerOptions.num_ctx,
              promptBudget: workerReq.promptBudget,
              estPromptTokens: estimateTurnTokens(
                sentWorkerMsgs.map(message => message.content),
                model
              )
            }
          );
          const retryBody = withThink(
            {
              model,
              messages: sentWorkerMsgs,
              options: workerOptions
            },
            node,
            model,
            'coder'
          );
          const retried = await takeChat(
            {
              phase: 'swarm-worker-resubmit',
              role: 'coder',
              nodeId: node.id,
              nodeName: node.name,
              model,
              numCtx: workerOptions.num_ctx,
              promptBudget: workerReq.promptBudget,
              estPromptTokens: estimateTurnTokens(
                sentWorkerMsgs.map(message => message.content),
                model
              )
            },
            () => streamChat(node.url, retryBody, () => {}, node.type, node.apiKey),
            () => runLive(run)
          );
          if (retried.aborted && runLive(run)) return failRepeatedOutput();
          if (retried.aborted || !runLive(run)) return false;
          res = retried.result;
          setExecutingPlanNotice(
            `Context monitor: ${model} filled its window. Resent \`${expectedFilePath}\` with a smaller packet.`
          );
        }
        if (!runLive(run)) return false;
        recordTok(node, res.stats, { model, messages: sentWorkerMsgs });
        const finished = await finishTruncatedWrites(
          node,
          model,
          res.content,
          res.stats?.doneReason,
          expectedFilePath,
          run.token
        );
        if (!runLive(run)) return false;

        let tools = parseResponse(finished, `${agentMsgId}-${idx}`, false, {
          expectedFilePath,
          createIntent: true,
          allowUnclosedSalvage: false
        }).toolCalls.map(t => anchorWritePath(t, expectedFilePath));
        if (!continuationClosedWrite(res.content, finished) && hasUnclosedWrite(finished)) {
          const truncated = truncatedWriteToolCall(finished, `${agentMsgId}-${idx}`, expectedFilePath);
          if (truncated) {
            const anchored = anchorWritePath(truncated, expectedFilePath);
            tools = [...tools, anchored];
            logToolEvent(anchored);
          }
        }

        tools = tools.map(t => {
          if (
            (t.name === 'write_file' || t.name === 'edit_file') &&
            shouldRejectPlannerWrite(t.args?.path || expectedFilePath || '', t.body || '')
          ) {
            return {
              ...t,
              status: 'error' as const,
              result:
                'Rejected: body looks like planner/option prose, not source for this path. Rewrite with real file contents only.'
            };
          }
          if (t.name === 'write_file') {
            const candidate = t.args?.path || expectedFilePath || '';
            const existing = preferredExistingPath(projectBrainRef.current.ownedFiles, candidate);
            if (existing) {
              return {
                ...t,
                status: 'error' as const,
                result: `Rejected parallel module \`${candidate}\`. Edit the owned file \`${existing}\` instead of creating a second copy.`
              };
            }
          }
          noteOwnedPath(t.args?.path || expectedFilePath);
          return t;
        });

        if (!runLive(run)) return false;
        const readPass = await runReadOnlyTools(tools, toolDepsRef.current);
        tools = readPass.tools;
        if (!runLive(run)) return false;

        // Node results are the files. Always save them, including when this turn
        // started under the planner (Auto-apply still off in that closure).
        tools = await autoApplyWritableTools(tools, toolDepsRef.current);
        if (!runLive(run)) return false;
        updateProgress(log => noteSavedFiles(log, tools, savedFileFingerprints()));
        noteAppliedWrites(tools);
        if (autoApplyOn()) {
          tools = await runAuxTools(tools, toolDepsRef.current);
          const cmdPass = await runCommandTools(tools, toolDepsRef.current);
          tools = cmdPass.tools;
        }

        const workerBudget: LoopBudget = {
          depth: 0,
          commandFixAttempts: 0,
          prevFailedCmdSigs: [],
          writeFixAttempts: 0,
          readOnlyContinues: 0,
          terminalFingerprint: undefined
        };
        let continuedWork: ChatMessage | undefined;
        if (shouldContinueFromTools(tools, continueDecisionOpts(workerBudget))) {
          const origin: ChatMessage = {
            id: `${agentMsgId}-worker-${idx}`,
            role: 'assistant',
            raw: finished,
            display: '',
            toolCalls: tools,
            personaHandle: 'coder',
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          };
          continuedWork = await continueWithToolResults(origin, {
            expectedFilePath,
            createIntent: true,
            node,
            model,
            budget: workerBudget,
            role: 'coder',
            run
          });
        }

        const isWriteTool = (tool: ToolCall) =>
          tool.name === 'write_file' || tool.name === 'edit_file';
        const followWrites = (continuedWork?.toolCalls || []).filter(isWriteTool);
        let cardTools = tools;
        let writeErrors = tools.filter(tool => isWriteTool(tool) && tool.status === 'error');
        if (followWrites.length) {
          const latest = new Map<string, ToolCall>();
          for (const tool of [...tools.filter(isWriteTool), ...followWrites]) {
            const key = (tool.args?.path || expectedFilePath || tool.id).replace(/\\/g, '/').toLowerCase();
            latest.set(key, tool);
          }
          const judged = [...latest.values()];
          writeErrors = judged.filter(tool => tool.status !== 'done');
          cardTools = [...tools.filter(tool => !isWriteTool(tool)), ...judged];
        }
        const workspaceRoot = (workspacePathRef.current || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
        const normWritePath = (p: string) => {
          let rel = p.replace(/\\/g, '/').toLowerCase();
          if (workspaceRoot && rel.startsWith(workspaceRoot + '/')) rel = rel.slice(workspaceRoot.length + 1);
          return rel.replace(/^(?:\.\/|\/)+/, '');
        };
        const wroteExpected = cardTools.some(
          tool =>
            isWriteTool(tool) &&
            tool.status === 'done' &&
            normWritePath(tool.args?.path || expectedFilePath || '') === normWritePath(expectedFilePath || '')
        );
        const noWrite = !writeErrors.length && !wroteExpected;
        const workerFailed = writeErrors.length > 0 || noWrite;

        const doneStats =
          res.stats?.evalCount && res.stats?.evalDuration
            ? {
                evalCount: res.stats.evalCount,
                tokensPerSec: Math.round(res.stats.evalCount / (res.stats.evalDuration / 1e9))
              }
            : undefined;
        const doneContent = writeErrors.length
          ? writeErrors
              .map(t => t.result || `Failed to write ${t.args?.path || expectedFilePath}`)
              .join('\n')
          : noWrite
            ? `No write for ${expectedFilePath}`
            : `Completed ${expectedFilePath}`;
        patchPipelineMsg(m => {
          if (!m.pipelineSteps) return m;
          const updatedSteps = [...m.pipelineSteps];
          if (updatedSteps[idx]) {
            updatedSteps[idx] = {
              ...updatedSteps[idx],
              status: workerFailed ? 'failed' : 'completed',
              content: doneContent,
              toolCalls: cardTools,
              stats: doneStats
            };
          }
          const allTools = updatedSteps.flatMap(s => s.toolCalls || []);
          const annot = annotateAppliedWrites(cardTools);
          return {
            ...m,
            pipelineSteps: updatedSteps,
            toolCalls: allTools,
            display: annot
              ? `Swarm: ${annot}`
              : m.display || `Swarm worker finished \`${expectedFilePath}\``
          };
        });
        if (runLive(run)) upsertNodeWorkStep(
          {
            nodeId: node.id,
            nodeName: node.name,
            modelName: model,
            targetFile: expectedFilePath,
            agentHandle: 'coder',
            role: `${model} (local)`,
            status: workerFailed ? 'failed' : 'completed',
            content: doneContent,
            toolCalls: cardTools,
            stats: doneStats
          },
          idx
        );
        return !workerFailed;
      } catch (workerErr: any) {
        const errText = String(workerErr?.message || workerErr || '');
        if (!runLive(run)) return false;
        if (!opts.retriedSame) {
          hostLog(
            'warn',
            `swarm: ${node.name} failed (${errText.slice(0, 120)}); retrying ${expectedFilePath} once`
          );
          logRoute('retry', {
            text: errText.slice(0, 300),
            nodeId: node.id,
            nodeName: node.name,
            model
          });
          patchPipelineMsg(m => {
            if (!m.pipelineSteps) return m;
            const updatedSteps = [...m.pipelineSteps];
            if (updatedSteps[idx]) {
              updatedSteps[idx] = {
                ...updatedSteps[idx],
                status: 'running',
                content: `Retrying ${expectedFilePath} on ${node.name}…`
              };
            }
            return { ...m, pipelineSteps: updatedSteps };
          });
          await new Promise(r => setTimeout(r, 400));
          if (!runLive(run)) return false;
          return runWorkerTurn({ ...opts, retriedSame: true });
        }
        const fallback = opts.retriedFrom
          ? undefined
          : pickFailoverTarget(nodesRef.current, node.id, model, { role: 'coder' });
        if (
          fallback &&
          fallback.node.online &&
          getEnabledModelsForNode(fallback.node).includes(fallback.model) &&
          (fallback.node.id !== node.id || fallback.model !== model)
        ) {
          hostLog(
            'warn',
            `swarm: ${node.name} failed (${errText.slice(0, 120)}); rerouting ${expectedFilePath} to ${fallback.node.name}`
          );
          logRoute('failover', {
            text: `${node.name} -> ${fallback.node.name}`,
            nodeId: fallback.node.id,
            nodeName: fallback.node.name,
            model: fallback.model
          });
          patchPipelineMsg(m => {
            if (!m.pipelineSteps) return m;
            const updatedSteps = [...m.pipelineSteps];
            if (updatedSteps[idx]) {
              updatedSteps[idx] = {
                ...updatedSteps[idx],
                nodeId: fallback.node.id,
                nodeName: fallback.node.name,
                modelName: fallback.model,
                status: 'running',
                content: `Rerouted from ${node.name}: ${errText.slice(0, 160)}`
              };
            }
            return { ...m, pipelineSteps: updatedSteps };
          });
          return runWorkerTurn({
            ...opts,
            assignment: { ...assignment, node: fallback.node, model: fallback.model },
            retriedFrom: node.id,
            retriedSame: true
          });
        }
        patchPipelineMsg(m => {
          if (!m.pipelineSteps) return m;
          const updatedSteps = [...m.pipelineSteps];
          if (updatedSteps[idx]) {
            updatedSteps[idx] = {
              ...updatedSteps[idx],
              status: 'failed',
              content: `Failed on ${node.name}`
            };
          }
          return {
            ...m,
            pipelineSteps: updatedSteps,
            error: errText,
            endpointName: node.name,
            model
          };
        });
        failWorkerCard(`Failed on ${node.name}: ${errText.slice(0, 160)}`);
        return false;
      }
    };

    const initialAgentMsg: ChatMessage = {
      id: agentMsgId,
      role: 'assistant',
      raw: '',
      display: architect
        ? `⚡ Pass 1 — ${isFrontierNode(architect.node) ? 'Cloud' : 'Lead Architect'} (${architect.node.name} • ${architect.model}, largest model for this contract${
            isFrontierNode(architect.node) ? ' · frontier' : ''
          }) is locking the shared TypeScript contract...`
        : '',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      pipelineSteps: [],
      toolCalls: [],
      ...(architect
        ? {}
        : { error: 'No endpoints configured. Add an Ollama node in Hardware.' })
    };

    if (!runLive(run)) return;
    setMessages(prev =>
      opts?.skipUserAppend ? [...prev, initialAgentMsg] : [...prev, userMsg, initialAgentMsg]
    );
    setIsStreaming(true);

    try {
      const stepFiles = (opts?.stepDispatch?.files || [])
        .map(file => file.replace(/\\/g, '/').trim())
        .filter(file => !!file && !file.includes('..'));
      const skipPass1 = stepFiles.length > 0;
      const anyOnline = nodesRef.current.some(
        n => n.online && getEnabledModelsForNode(n).length > 0
      );
      if (skipPass1 ? !anyOnline : !architect || !architect.node?.online) {
        patchPipelineMsg({
          display: 'No online computers with a model enabled.',
          error: 'No online computers with a model enabled. Open Hardware and enable a model.'
        });
        return;
      }

      // Scaffold writes wait until after Pass 1, when worker ownership is known.
      // Contract typecheck uses isolated tsc flags and does not need tsconfig.json.
      let mergeOwnedPackageJson = false;
      let scaffoldWrotePackageJson = false;
      const writeMissingScaffoldFiles = async (
        files: { path: string; content: string }[]
      ): Promise<string[]> => {
        const written: string[] = [];
        if (!workspacePath || !window.electronAPI?.writeFile) return written;
        const root = workspacePath.replace(/[\\/]+$/, '');
        const sep = workspacePath.includes('\\') ? '\\' : '/';
        for (const f of files) {
          if (!runLive(run)) break;
          const abs = `${root}${sep}${f.path.replace(/\//g, sep)}`;
          let shouldWrite = true;
          try {
            const existing = await window.electronAPI.readFile?.(abs);
            if (existing && !existing.error && existing.content != null) {
              const rel = f.path.replace(/\\/g, '/').toLowerCase();
              if (rel === 'index.html' || rel.endsWith('/index.html')) {
                shouldWrite = shouldReplaceScaffoldIndexHtml(existing.content);
              } else if (String(existing.content).trim()) {
                shouldWrite = false;
              }
            }
          } catch {
            /* missing — write */
          }
          if (!shouldWrite) continue;
          if (!runLive(run)) break;
          const saved = await window.electronAPI.writeFile(abs, f.content);
          if (saved?.error || saved?.success === false) continue;
          written.push(f.path);
        }
        return written;
      };
      const installSwarmPackageDeps = async (reason: string) => {
        if (!runLive(run) || !workspacePath || !window.electronAPI?.installWorkspaceDeps) return;
        const tool: ToolCall = {
          id: `auto-npm-install-${Date.now()}`,
          name: 'run_command',
          args: { command: 'npm install' },
          body: 'npm install',
          status: 'running'
        };
        try {
          const res = await window.electronAPI.installWorkspaceDeps(workspacePath, { timeoutMs: 300000 });
          // Stop may have released this run while npm install was in flight.
          if (!runLive(run)) return;
          const rewrite = res.rewritten?.length ? `\nRewrote: ${res.rewritten.join('; ')}` : '';
          const tail = (res.output || res.error || '').slice(-4000);
          logToolEvent({
            ...tool,
            status: res.ok ? 'done' : 'error',
            result: res.ok
              ? `Exit code: 0\n(auto) npm install after ${reason}${rewrite}\n${tail}`
              : `Exit code: ${res.code ?? 1}\n(auto) npm install failed${rewrite}\n${tail}`
          });
        } catch (err) {
          if (!runLive(run)) return;
          logToolEvent({
            ...tool,
            status: 'error',
            result: `(auto) npm install error: ${err instanceof Error ? err.message : String(err)}`
          });
        }
      };
      const lockedDelivery =
        lockedPlan?.delivery || plannerPlanRef.current?.delivery || undefined;

      // ── Pass 1: Generate Shared Contract & Manifest (skipped for an active plan step) ──
      const swarmTaskText = lockedPlan
        ? `${userText}\n\n${formatApprovedPlanForSwarm(lockedPlan)}`
        : userText;
      let manifest: SwarmManifest = fallbackSwarmManifest(swarmTaskText);
      if (skipPass1) {
        const contractRel = projectBrainRef.current.contractFile || 'SWARM.md';
        const existingContract = await readWorkspaceRel(contractRel);
        const stack =
          projectBrainRef.current.stack ||
          deliveryToStack(lockedDelivery) ||
          'typescript';
        manifest = {
          contractFile: contractRel,
          contractCode: existingContract || '',
          stack,
          verifyCommand:
            projectBrainRef.current.verifyCommand || verifyCommandForStack(stack) || null,
          tasks: stepFiles.map(filePath => ({
            filePath,
            complexity: 'medium' as const,
            preferredRole: '@coder' as const,
            requiredExports: [],
            requiredImports: [],
            instructions: (opts?.stepDispatch?.brief || swarmTaskText).slice(0, 4000),
            role: 'Coder'
          }))
        };
        patchPipelineMsg({
          display: `Swarm step — ${manifest.tasks.length} file${
            manifest.tasks.length === 1 ? '' : 's'
          } (Pass 1 skipped).`
        });
      } else {
      architect = swarmPlanner;
      if (!architect?.node?.online || !getEnabledModelsForNode(architect.node).includes(architect.model)) {
        patchPipelineMsg({
          display: 'No online computers with a model enabled.',
          error: 'No online computers with a model enabled. Open Hardware and enable a model.'
        });
        return;
      }
      pass1Frame = beginActivity(
        'pass1',
        architect.usedCloudStrategist ? 'Pass 1 — Cloud Strategist' : 'Pass 1 — Lead Architect',
        architect.node.name
      );
      try {
        const snippets = await loadExistingSnippets();
        const swarmDevHost = buildDevHostPromptSection(nodesRef.current, architect.node.id);
        const lockedContractRel = projectBrainRef.current.contractFile;
        const existingContractBody = lockedContractRel
          ? await readWorkspaceRel(lockedContractRel)
          : undefined;
        const contractLockNote =
          projectBrainRef.current.contractLocked && existingContractBody
            ? `\n\nEXISTING LOCKED CONTRACT (${lockedContractRel}) — extend these exports; do not delete domain types or replace the file with a smaller unrelated schema:\n\`\`\`\n${existingContractBody.slice(0, 6000)}\n\`\`\`\n`
            : '';
        const architectPrompt = buildLeadArchitectPrompt(
          swarmTaskText,
          workspaceOverview,
          snippets,
          lockedPlan ? formatApprovedPlanForSwarm(lockedPlan) : null,
          progressForPrompt() || null,
          swarmDevHost,
          nodesRef.current,
          { cloudStrategist: !!architect.usedCloudStrategist }
        );
        const passTier = resolveModelFit(
          architect.node,
          architect.model,
          'planner',
          plannerAgent.numCtx
        ).tier;
        const architectSystem =
          'You are the Lead Architect (@coder). Respond ONLY with a valid JSON object for the Swarm manifest. No markdown outside JSON. Workspace/installs/run_command target the Dev PC where Studio is open — not necessarily this inference host.';
        let architectUser = `${architectPrompt}\n${projectContextForPrompt()}${contractLockNote}`;
        const passOpts = pinnedChatOptions({
          node: architect.node,
          model: architect.model,
          role: 'pass1',
          createIntent: false,
          tier: passTier,
          temperature: 0.1,
          fallbackNumCtx: plannerAgent.numCtx
        });
        if (!isFrontierNode(architect.node)) {
          const fittedPass = fitPromptToContext({
            system: architectSystem,
            userContent: architectUser,
            history: [],
            maxCtx: passOpts.pinnedCtx,
            frontier: false,
            modelKey: architect.model,
            promptBudget: passOpts.promptBudget
          });
          architectUser = fittedPass.userContent;
          if (fittedPass.note) {
            setExecutingPlanNotice(fittedPass.note);
            logContext('fit', fittedPass.note, {
              numCtx: passOpts.pinnedCtx,
              promptBudget: passOpts.promptBudget,
              estPromptTokens: estimateTurnTokens(
                [architectSystem, fittedPass.userContent],
                architect.model
              )
            });
          }
        }
        const architectMsgs = [
          { role: 'system', content: architectSystem },
          { role: 'user', content: architectUser }
        ];
        const architectBody: Record<string, unknown> = {
          model: architect.model,
          messages: architectMsgs,
          format: 'json',
          options: ollamaOptions(passOpts)
        };
        if (!architect || !runLive(run)) return;
        const lead = architect;
        await warmModels([{ node: lead.node, model: lead.model }], plannerAgent.numCtx);
        if (!runLive(run)) return;
        const passOptions = ollamaOptions(passOpts);
        const decompTaken = await takeChat(
          {
            phase: 'pass1',
            role: 'planner',
            nodeId: lead.node.id,
            nodeName: lead.node.name,
            model: lead.model,
            numCtx: passOptions.num_ctx,
            promptBudget: passOpts.promptBudget,
            estPromptTokens: estimateTurnTokens(
              architectMsgs.map(message => message.content),
              lead.model
            )
          },
          () =>
            streamChat(
              lead.node.url,
              withThink(architectBody, lead.node, lead.model, 'planner'),
              () => {},
              lead.node.type,
              lead.node.apiKey
            ),
          () => runLive(run)
        );
        if (decompTaken.aborted && runLive(run)) {
          patchPipelineMsg({
            display: 'Pass 1 stopped: model output repeated itself; aborted.',
            error: 'Model output repeated itself; aborted'
          });
          return;
        }
        if (decompTaken.aborted || !runLive(run)) return;
        const decompRes = decompTaken.result;
        recordTok(architect.node, decompRes.stats, { model: architect.model, messages: architectMsgs });
        const parsed = parseSwarmManifest(decompRes.content, swarmTaskText);
        if (parsed) manifest = parsed;
        else hostLog('warn', `Swarm Pass 1: ${architect.model} did not return a usable manifest; using the fallback task list.`);
      } catch (decompErr) {
        hostLog('warn', `Swarm Pass 1 failed; using the fallback task list: ${decompErr instanceof Error ? decompErr.message : String(decompErr)}`);
      }
      }

      if (!skipPass1) {
      if (!architect) {
        hostLog('error', 'Swarm stopped: no Lead Architect model is online.');
        return;
      }
      // ── Stage 2: Write Contract & Verify Syntax ──
      patchPipelineMsg({
        display: `📝 Writing shared contract \`${manifest.contractFile}\` (${manifest.tasks.length} worker file${
          manifest.tasks.length === 1 ? '' : 's'
        })…`
      });

      const priorContract = await readWorkspaceRel(manifest.contractFile);
      if (!runLive(run)) return;
      if (priorContract && shouldPreserveContract(priorContract, manifest.contractCode)) {
        manifest = { ...manifest, contractCode: priorContract };
        patchPipelineMsg({
          display: `🔒 Kept existing contract \`${manifest.contractFile}\` — incoming rewrite would drop domain types. Workers will extend owned files.`
        });
      }
      const writeOk = await onApplyFileWrite(manifest.contractFile, manifest.contractCode);
      if (!runLive(run)) return;
      noteOwnedPath(manifest.contractFile);
      // Do not lock until typecheck passes (or the stack has no checker).
      commitProjectBrain({
        ...projectBrainRef.current,
        contractFile: manifest.contractFile,
        contractLocked: false,
        stack: (manifest.stack as DeliveryStack) || projectBrainRef.current.stack,
        verifyCommand:
          manifest.verifyCommand ||
          verifyCommandForStack((manifest.stack as DeliveryStack) || 'typescript') ||
          projectBrainRef.current.verifyCommand
      });
      if (writeOk) {
        updateProgress(log =>
          noteSavedFiles(
            log,
            [{ name: 'write_file', status: 'done', args: { path: manifest.contractFile } }],
            savedFileFingerprints()
          )
        );
        rebuildRepoMap();
      }
      if (!writeOk) {
        hostLog('error', `Swarm stopped: couldn't write the contract file ${manifest.contractFile}.`);
        patchPipelineMsg({
          display: `Couldn't write the contract file \`${manifest.contractFile}\`.`,
          error: `Couldn't write ${manifest.contractFile}.`
        });
        return;
      }

      let contractVerified = true;
      if (
        manifest.stack === 'typescript' &&
        isTypeScriptContractPath(manifest.contractFile) &&
        window.electronAPI?.typecheckWorkspace &&
        workspacePath
      ) {
        contractVerified = false;
        let check = await window.electronAPI.typecheckWorkspace(workspacePath, {
          mode: 'contract',
          file: manifest.contractFile,
          timeoutMs: 45000
        });
        if (!runLive(run)) return;
        const checkText = `${check.output || ''}\n${check.error || ''}`;
        if (!check.ok && typesCannotResolve(checkText)) {
          const failText = annotateMissingDependencies(checkText);
          logRun({
            kind: 'verify',
            ok: false,
            output: failText,
            fingerprint: errorFingerprint(parseCompilerErrors(failText))
          });
          patchPipelineMsg({
            display: `Contract typecheck failed. ${DEPENDENCY_RETRY_MESSAGE}\n\`\`\`\n${failText.slice(0, 1500)}\n\`\`\``,
            error: DEPENDENCY_RETRY_MESSAGE,
            endpointName: architect.node.name,
            model: architect.model
          });
        } else if (!check.ok) {
          patchPipelineMsg({
            display: `🔧 Contract failed tsc — Lead Architect self-correcting before waking workers…\n\`\`\`\n${(
              check.output ||
              check.error ||
              ''
            ).slice(0, 1200)}\n\`\`\``
          });
          try {
            const repairTier = resolveModelFit(
              architect.node,
              architect.model,
              'planner',
              plannerAgent.numCtx
            ).tier;
            const repairPrompt = buildContractRepairPrompt(
              swarmTaskText,
              manifest,
              check.output || check.error || 'unknown tsc error',
              { tier: repairTier }
            );
            const repairMsgs = [
              {
                role: 'system',
                content: 'Fix the Swarm JSON manifest so contractCode typechecks. JSON only.'
              },
              { role: 'user', content: repairPrompt }
            ];
            const repairOptions = chatOptions(architect.node, architect.model, 'pass1', {
              createIntent: false,
              tier: repairTier,
              temperature: 0.1,
              fallbackNumCtx: plannerAgent.numCtx
            });
            const repairBody: Record<string, unknown> = {
              model: architect.model,
              messages: repairMsgs,
              format: 'json',
              options: repairOptions
            };
            if (!architect || !runLive(run)) return;
            const repairLead = architect;
            const repairTaken = await takeChat(
              {
                phase: 'contract-repair',
                role: 'planner',
                nodeId: repairLead.node.id,
                nodeName: repairLead.node.name,
                model: repairLead.model,
                numCtx: repairOptions.num_ctx,
                estPromptTokens: estimateTurnTokens(
                  repairMsgs.map(message => message.content),
                  repairLead.model
                )
              },
              () =>
                streamChat(
                  repairLead.node.url,
                  withThink(repairBody, repairLead.node, repairLead.model, 'planner'),
                  () => {},
                  repairLead.node.type,
                  repairLead.node.apiKey
                ),
              () => runLive(run)
            );
            if (repairTaken.aborted && runLive(run)) {
              patchPipelineMsg({
                display: 'Pass 1 stopped: model output repeated itself during contract repair; aborted.',
                error: 'Model output repeated itself; aborted'
              });
              return;
            }
            if (repairTaken.aborted || !runLive(run)) return;
            const repairRes = repairTaken.result;
            recordTok(architect.node, repairRes.stats, {
              model: architect.model,
              messages: repairMsgs
            });
            const repaired = parseSwarmManifest(repairRes.content, swarmTaskText);
            if (repaired) {
              const keep = await readWorkspaceRel(repaired.contractFile || manifest.contractFile);
              if (!runLive(run)) return;
              if (keep && shouldPreserveContract(keep, repaired.contractCode)) {
                repaired.contractCode = keep;
              }
              manifest = repaired;
              const repairedOk = await onApplyFileWrite(manifest.contractFile, manifest.contractCode);
              if (!runLive(run)) return;
              if (repairedOk) {
                updateProgress(log =>
                  noteSavedFiles(
                    log,
                    [{ name: 'write_file', status: 'done', args: { path: manifest.contractFile } }],
                    savedFileFingerprints()
                  )
                );
                rebuildRepoMap();
              }
              check = await window.electronAPI.typecheckWorkspace(workspacePath, {
                mode: 'contract',
                file: manifest.contractFile,
                timeoutMs: 45000
              });
              if (!runLive(run)) return;
            }
          } catch (repairErr) {
            hostLog('warn', `Swarm contract repair failed: ${repairErr instanceof Error ? repairErr.message : String(repairErr)}`);
          }

          if (!check.ok) {
            const failText = check.output || check.error || 'Contract typecheck failed.';
            logRun({
              kind: 'verify',
              ok: false,
              output: failText,
              fingerprint: errorFingerprint(parseCompilerErrors(failText))
            });
            patchPipelineMsg({
              display: `Contract typecheck failed. Stopped in Pass 1 — workers were not started.\n\`\`\`\n${failText.slice(0, 1500)}\n\`\`\``,
              error: failText.slice(0, 500),
              endpointName: architect.node.name,
              model: architect.model
            });
          } else {
            contractVerified = true;
            patchPipelineMsg({
              display: `✅ Contract \`${manifest.contractFile}\` typechecks. Fan-out Pass 2…`
            });
          }
        } else {
          contractVerified = true;
          patchPipelineMsg({
            display: `✅ Contract \`${manifest.contractFile}\` locked & typechecked. Fan-out Pass 2…`
          });
        }
      }

      if (!runLive(run)) return;
      if (contractVerified) {
        commitProjectBrain({
          ...projectBrainRef.current,
          contractFile: manifest.contractFile,
          contractLocked: true
        });
      } else {
        endActivity(pass1Frame);
        return;
      }

      endActivity(pass1Frame); // Pass 1 done
      }
      if (!runLive(run)) return;
      if (
        manifestNeedsWebScaffold(manifest, swarmTaskText) &&
        workspacePath &&
        typeof window.electronAPI.writeFile === 'function'
      ) {
        const scaffoldPlan = planWebScaffoldWrites(manifest.tasks);
        const written = await writeMissingScaffoldFiles(scaffoldPlan.toWrite);
        if (!runLive(run)) return;
        if (scaffoldPlan.notes.length) {
          const byPath = new Map(
            scaffoldPlan.notes.map(note => [note.path.replace(/\\/g, '/').toLowerCase(), note.note])
          );
          manifest = {
            ...manifest,
            tasks: manifest.tasks.map(task => {
              const note = byPath.get(task.filePath.replace(/\\/g, '/').toLowerCase());
              if (!note || task.instructions.includes(note)) return task;
              return { ...task, instructions: `${task.instructions.trim()}\n${note}` };
            })
          };
        }
        if (scaffoldPlan.ownedSkips.some(path => path.replace(/\\/g, '/').toLowerCase() === 'package.json')) {
          mergeOwnedPackageJson = true;
        }
        scaffoldWrotePackageJson = written.some(path => path.replace(/\\/g, '/').toLowerCase() === 'package.json');
        const ownedNote = scaffoldPlan.ownedSkips.length
          ? ` Worker-owned files left for their tasks: ${scaffoldPlan.ownedSkips.join(', ')}.`
          : '';
        if (written.length || ownedNote) {
          const scaffoldNote = written.length
            ? `Scaffolded typescript before Pass 2: ${written.join(', ')}.${ownedNote}`
            : `Scaffold skipped worker-owned files before Pass 2.${ownedNote}`;
          logNoticeNow(scaffoldNote, run);
          patchPipelineMsg({
            display: written.length
              ? `🧱 Ensured typescript scaffold before Pass 2 (${written.join(', ')})…`
              : `🧱 Scaffold files are worker-owned or already on disk.`
          });
        }
      }
      beginActivity('pass2', skipPass1 ? 'Step workers' : 'Pass 2 — file workers');

      // ── Pass 2: Fan out by dependency waves (parallel within a wave) ──
      const taskWaves = partitionSwarmTasksIntoWaves(manifest.tasks);
      const assignments: SwarmAssignment[] = [];
      const assignmentWaveIndex: number[] = [];
      taskWaves.forEach((wave, wi) => {
        const waveAssign = assignSwarmTasksToCluster(wave, nodesRef.current);
        for (const a of waveAssign) {
          assignments.push(a);
          assignmentWaveIndex.push(wi);
        }
      });
      logRun({
        kind: 'swarm-assign',
        assignments: assignments.map((item, index) => ({
          file: item.task.filePath,
          node: item.node.name,
          model: item.model,
          wave: assignmentWaveIndex[index],
          ...(item.skippedReason ? { skippedReason: item.skippedReason } : {}),
          ...(item.usedFrontierBackup ? { frontierBackup: true } : {})
        }))
      });
      if (!assignments.length) {
        hostLog('error', 'Swarm stopped: no workers were assigned.');
        patchPipelineMsg({
          display: 'No workers were assigned.',
          error: 'No workers were assigned. Open Hardware and check that a computer is online.'
        });
        return;
      }

      const localCount = assignments.filter(a => !isFrontierNode(a.node)).length;
      const frontierCount = assignments.length - localCount;
      const waveLabel =
        taskWaves.length > 1
          ? ` · ${taskWaves.length} dependency waves (foundation files first)`
          : '';

      const leadLabel = architect?.node;
      const initialSteps: PipelineStep[] = [
        {
          nodeId: leadLabel?.id || assignments[0]?.node.id || 'swarm',
          nodeName: `${leadLabel?.name || 'Swarm'} → ${manifest.contractFile}`,
          modelName: architect?.model || assignments[0]?.model || '',
          targetFile: manifest.contractFile,
          agentHandle: 'coder',
          role: skipPass1
            ? 'Step dispatch'
            : `Lead Architect · contract${leadLabel && isFrontierNode(leadLabel) ? ' (frontier)' : ' (local)'}`,
          status: 'completed',
          content: skipPass1
            ? `Pass 1 skipped (${manifest.tasks.length} files${waveLabel})`
            : `Locked shared contract (${manifest.tasks.length} tasks${waveLabel})`,
          toolCalls: []
        },
        ...assignments.map(({ task, node, model, skippedReason }, i) => {
          const offline = !!(skippedReason && !node.online);
          const wave = assignmentWaveIndex[i] ?? 0;
          const deps =
            task.dependsOn && task.dependsOn.length
              ? ` after ${task.dependsOn.join(', ')}`
              : '';
          return {
            nodeId: node.id,
            nodeName: `${node.name} → ${task.filePath}`,
            modelName: model,
            targetFile: task.filePath,
            agentHandle: 'coder' as const,
            role: `${task.role || task.preferredRole} · ${model}${
              isFrontierNode(node) ? ' (frontier)' : ' (local)'
            }${skippedReason ? ` — ${skippedReason}` : ''}`,
            status: (offline ? 'failed' : 'pending') as PipelineStep['status'],
            content: offline
              ? `Skipped: ${skippedReason}`
              : `Wave ${wave + 1}/${taskWaves.length}${deps} — waiting…`,
            toolCalls: [] as PipelineStep['toolCalls']
          };
        })
      ];

      const swarmNotice = `Swarm: ${assignments.length} file${
        assignments.length === 1 ? '' : 's'
      } on ${[
        ...new Set(assignments.map(a => a.node.name).filter(Boolean))
      ].join(' / ') || 'cluster'}${waveLabel}`;
      patchPipelineMsg({
        display: swarmNotice,
        pipelineSteps: initialSteps
      });
      syncNodeWork(initialSteps);

      const completedPaths: string[] = [];
      let flatOffset = 0;
      for (let wi = 0; wi < taskWaves.length; wi++) {
        if (!runLive(run)) return;
        const waveAssign = assignments.slice(flatOffset, flatOffset + taskWaves[wi].length);
        flatOffset += taskWaves[wi].length;
        const waveItems = waveAssign.map((assignment, j) => {
          // pipelineSteps[0] is contract; worker steps are 1..n in assignment order
          const stepIdx = assignments.indexOf(assignment) + 1;
          return { assignment, stepIdx, j };
        });

        for (const { assignment, stepIdx } of waveItems) {
          patchPipelineMsg(m => {
            if (!m.pipelineSteps?.[stepIdx]) return m;
            const updatedSteps = [...m.pipelineSteps];
            updatedSteps[stepIdx] = {
              ...updatedSteps[stepIdx],
              status: assignment.skippedReason && !assignment.node.online ? 'failed' : 'running',
              modelName: assignment.model,
              content: `Wave ${wi + 1}: generating ${assignment.task.filePath} on ${assignment.node.name}…`
            };
            return { ...m, pipelineSteps: updatedSteps };
          });
        }

        // Parallel across GPUs within the wave; serialize per GPU URL.
        const gpuQueues = queueAssignmentsByGpu(waveAssign);
        // Fix stepIdx on work items to match global pipeline indices
        const queuesWithIdx = gpuQueues.map(queue =>
          queue.map(item => {
            const globalIdx = assignments.findIndex(
              a => a.task.filePath === item.assignment.task.filePath && a.node.id === item.assignment.node.id
            );
            return {
              assignment: item.assignment,
              stepIdx: globalIdx >= 0 ? globalIdx + 1 : item.stepIdx
            };
          })
        );

        await warmModels(
          waveAssign.map(a => ({ node: a.node, model: a.model })),
          coderAgent.numCtx
        );
        if (!runLive(run)) return;

        const waveDone: string[] = [];
        await Promise.allSettled(
          queuesWithIdx.map(async queue => {
            for (let n = 0; n < queue.length; n++) {
              if (!runLive(run)) return;
              const { assignment, stepIdx } = queue[n];
              if (n > 0) {
                patchPipelineMsg(m => {
                  if (!m.pipelineSteps?.[stepIdx]) return m;
                  const updatedSteps = [...m.pipelineSteps];
                  updatedSteps[stepIdx] = {
                    ...updatedSteps[stepIdx],
                    status: 'running',
                    modelName: assignment.model,
                    content: `Wave ${wi + 1}: generating ${assignment.task.filePath} on ${assignment.node.name}…`
                  };
                  return { ...m, pipelineSteps: updatedSteps };
                });
              }
              const norm = (p: string) => p.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
              const current = await readWorkspaceRel(assignment.task.filePath);
              const workerTier = resolveModelFit(
                assignment.node,
                assignment.model,
                'coder',
                coderAgent.numCtx
              ).tier;
              const siblings = [];
              for (const p of completedPaths.slice(-8)) {
                if (norm(p) === norm(assignment.task.filePath)) continue;
                const body = await readWorkspaceRel(p);
                const inline = (assignment.task.dependsOn || []).some(d => norm(d) === norm(p));
                siblings.push(siblingFile(p, { content: body, inline }));
              }
              for (const other of manifest.tasks) {
                if (norm(other.filePath) === norm(assignment.task.filePath)) continue;
                if (siblings.some(s => norm(s.path) === norm(other.filePath))) continue;
                const inline = (assignment.task.dependsOn || []).some(
                  d => norm(d) === norm(other.filePath)
                );
                const body = inline ? await readWorkspaceRel(other.filePath) : undefined;
                siblings.push(
                  siblingFile(other.filePath, {
                    content: body,
                    exports: other.requiredExports,
                    inline
                  })
                );
              }
              const workerOverall = lockedPlan ? formatApprovedPlanBrief(lockedPlan) : userText;
              const workerPrompt = buildSwarmWorkerPrompt({
                task: assignment.task,
                contractFile: manifest.contractFile,
                contractCode: manifest.contractCode,
                siblingSummary: '',
                siblingFiles: siblings,
                currentFileContent: current,
                userPrompt: workerOverall,
                stack: manifest.stack,
                tier: workerTier
              });
              const wrote = await runWorkerTurn({
                idx: stepIdx,
                assignment,
                userPrompt: workerPrompt,
                expectedFilePath: assignment.task.filePath,
                stack: manifest.stack
              });
              if (wrote) waveDone.push(assignment.task.filePath);
            }
          })
        );

        completedPaths.push(...waveDone);
      }

      let packageMerged = false;
      if (mergeOwnedPackageJson && runLive(run)) {
        const currentPkg = await readWorkspaceRel('package.json');
        if (currentPkg) {
          const packageHint = `${swarmTaskText}\n${manifest.contractCode || ''}\n${manifest.tasks
            .map(task => task.instructions)
            .join('\n')}`;
          const mergedPkg = mergeEssentialWebPackageJson(currentPkg, packageHint);
          if (mergedPkg.changed) {
            const wrotePkg = await onApplyFileWrite('package.json', mergedPkg.content);
            if (wrotePkg) {
              packageMerged = true;
              logNoticeNow(
                'Merged essential Vite devDependencies and dev/build scripts into package.json.',
                run
              );
            }
          }
        }
      }
      const workerWrotePackageJson = completedPaths.some(path => {
        const norm = path.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
        return norm === 'package.json' || norm.endsWith('/package.json');
      });
      // A Swarm worker write goes through autoApplyWritableTools, which already npm-installs.
      // Install again only when this run changed package.json after that, or the scaffold wrote it directly.
      const workerAlreadyInstalled = workerWrotePackageJson && !packageMerged;
      if (
        runLive(run) &&
        !workerAlreadyInstalled &&
        (packageMerged || scaffoldWrotePackageJson || workerWrotePackageJson)
      ) {
        await installSwarmPackageDeps(
          packageMerged ? 'package.json merge' : scaffoldWrotePackageJson ? 'scaffold package.json' : 'worker package.json'
        );
      }
      if (!runLive(run)) return;

      // ── Stage 4: Verify (tsc only for TypeScript stacks) ──
      if (manifest.stack !== 'typescript' && manifest.verifyCommand) {
        patchPipelineMsg(m => ({
          ...m,
          display: `${m.display || ''}\n\n🔍 Verifying ${manifest.stack}: \`${manifest.verifyCommand}\``
        }));
        const output = await executeTrackedCommand(manifest.verifyCommand);
        const failed = commandOutputFailed(output);
        patchPipelineMsg(m => ({
          ...m,
          display: failed
            ? `Swarm finished ${assignments.length} file(s). The project check failed:\n\`\`\`\n${output.slice(0, 2000)}\n\`\`\``
            : `✅ Conductor Swarm finished ${assignments.length} file(s). ${manifest.stack} check passed.`,
          ...(failed ? { error: clipErrorCause(output, 'The project check failed.') } : {})
        }));
      } else if (manifest.stack === 'typescript' && window.electronAPI?.typecheckWorkspace && workspacePath) {
        patchPipelineMsg(m => ({
          ...m,
          display: `${m.display || ''}\n\n🔍 Running workspace \`tsc --noEmit\`…`
        }));

        const wsCheck = await window.electronAPI.typecheckWorkspace(workspacePath, {
          mode: 'workspace',
          timeoutMs: 90000
        });

        if (wsCheck.skipped) {
          // Missing tsconfig must fail — never treat skip as green.
          const skippedOutput = wsCheck.output || 'no tsconfig.json — project typecheck skipped';
          logRun({
            kind: 'verify',
            ok: false,
            output: `skipped: ${skippedOutput}`,
            fingerprint: 'skipped'
          });
          patchPipelineMsg(m => ({
            ...m,
            display: `⚠️ Conductor Swarm finished ${assignments.length} worker file(s), but project typecheck was skipped (${wsCheck.output || 'no tsconfig'}). Scaffold a tsconfig and re-run verify — this is NOT a pass.`,
            error: skippedOutput.slice(0, 500)
          }));
        } else if (wsCheck.ok) {
          patchPipelineMsg(m => ({
            ...m,
            display: `✅ Conductor Swarm finished ${assignments.length} worker file(s). Workspace typecheck passed.`
          }));
        } else if (
          wsCheck.timedOut ||
          wsCheck.missingTsc ||
          typesCannotResolve(`${wsCheck.output || ''}\n${wsCheck.error || ''}`)
        ) {
          const raw = `${wsCheck.output || ''}\n${wsCheck.error || ''}`.trim();
          const shown = typesCannotResolve(raw)
            ? annotateMissingDependencies(raw)
            : raw ||
              (wsCheck.timedOut ? 'Workspace typecheck timed out.' : 'TypeScript compiler is missing.');
          logRun({
            kind: 'verify',
            ok: false,
            output: shown,
            fingerprint: errorFingerprint(parseCompilerErrors(shown))
          });
          patchPipelineMsg(m => ({
            ...m,
            display: `Workspace typecheck could not be repaired from source.\n\`\`\`\n${shown.slice(0, 2000)}\n\`\`\``,
            error: shown.slice(0, 500)
          }));
        } else {
          const fpBefore = errorFingerprint(parseCompilerErrors(wsCheck.output || ''));
          const jobsForOutput = async (output: string) => {
            const byFile = groupTscErrorsByFile(output, workspacePath);
            const bodies = new Map<string, string>();
            for (const assignment of assignments) {
              const body = await readWorkspaceRel(assignment.task.filePath);
              if (body != null) bodies.set(assignment.task.filePath, body);
            }
            const mapped = assignSwarmDiagnostics(
              byFile,
              assignments.map(a => a.task.filePath),
              bodies
            );
            const repairJobs: { idx: number; assignment: SwarmAssignment; errors: string }[] = [];
            assignments.forEach((assignment, i) => {
              const errors = mapped.owned.get(assignment.task.filePath);
              if (errors) repairJobs.push({ idx: i + 1, assignment, errors });
            });
            return { repairJobs, unmatched: mapped.unmatched };
          };
          const runRepairPass = async (
            repairJobs: { idx: number; assignment: SwarmAssignment; errors: string }[]
          ) => {
            const repairQueues = new Map<string, typeof repairJobs>();
            for (const job of repairJobs) {
              const key = endpointQueueKey(job.assignment.node);
              const queue = repairQueues.get(key) ?? [];
              queue.push(job);
              repairQueues.set(key, queue);
            }
            await Promise.allSettled(
              [...repairQueues.values()].map(async queue => {
                for (const { idx, assignment, errors } of queue) {
                  if (!runLive(run)) return;
                  patchPipelineMsg(m => {
                    if (!m.pipelineSteps?.[idx]) return m;
                    const updatedSteps = [...m.pipelineSteps];
                    updatedSteps[idx] = {
                      ...updatedSteps[idx],
                      status: 'running',
                      content: `Repairing ${assignment.task.filePath} from tsc errors…`
                    };
                    return { ...m, pipelineSteps: updatedSteps };
                  });
                  const current =
                    (await readWorkspaceRel(assignment.task.filePath)) ||
                    '(file missing after Pass 2)';
                  const repairTier = resolveModelFit(
                    assignment.node,
                    assignment.model,
                    'coder',
                    coderAgent.numCtx
                  ).tier;
                  const repairPrompt = buildRepairWorkerPrompt({
                    task: assignment.task,
                    contractFile: manifest.contractFile,
                    contractCode: manifest.contractCode,
                    currentFileContent: current,
                    tscErrors: errors,
                    tier: repairTier
                  });
                  await warmModels(
                    [{ node: assignment.node, model: assignment.model }],
                    coderAgent.numCtx
                  );
                  await runWorkerTurn({
                    idx,
                    assignment,
                    userPrompt: repairPrompt,
                    expectedFilePath: assignment.task.filePath,
                    stepLabel: `Repaired ${assignment.task.filePath}`,
                    stack: manifest.stack
                  });
                }
              })
            );
          };

          const first = await jobsForOutput(wsCheck.output || '');
          if (!first.repairJobs.length) {
            patchPipelineMsg(m => ({
              ...m,
              display: `Workspace tsc reported errors, and none mapped to swarm-owned files or their importers.\n\`\`\`\n${(
                wsCheck.output || ''
              ).slice(0, 2000)}\n\`\`\``,
              error: (wsCheck.output || 'Workspace typecheck failed.').slice(0, 500)
            }));
          } else {
            patchPipelineMsg(m => ({
              ...m,
              display: `Targeted repair — re-prompting ${first.repairJobs.length} file owner(s) with tsc stderr…`
            }));
            await runRepairPass(first.repairJobs);
            if (!runLive(run)) return;
            const recheck = await window.electronAPI.typecheckWorkspace(workspacePath, {
              mode: 'workspace',
              timeoutMs: 90000
            });
            if (recheck.ok) {
              patchPipelineMsg(m => ({
                ...m,
                display: `Conductor Swarm finished — workspace typecheck passed after targeted repair.`
              }));
            } else if (
              runLive(run) &&
              (recheck.timedOut ||
                recheck.missingTsc ||
                typesCannotResolve(`${recheck.output || ''}\n${recheck.error || ''}`))
            ) {
              const raw = `${recheck.output || ''}\n${recheck.error || ''}`.trim();
              const shown = typesCannotResolve(raw)
                ? annotateMissingDependencies(raw)
                : raw ||
                  (recheck.timedOut ? 'Workspace typecheck timed out.' : 'TypeScript compiler is missing.');
              logRun({
                kind: 'verify',
                ok: false,
                output: shown,
                fingerprint: errorFingerprint(parseCompilerErrors(shown))
              });
              patchPipelineMsg(m => ({
                ...m,
                display: `Workspace typecheck could not be repaired from source.\n\`\`\`\n${shown.slice(0, 2000)}\n\`\`\``,
                error: shown.slice(0, 500)
              }));
            } else if (runLive(run)) {
              const fpAfter = errorFingerprint(parseCompilerErrors(recheck.output || ''));
              if (verifyFingerprintChanged(fpBefore, fpAfter)) {
                const second = await jobsForOutput(recheck.output || '');
                if (second.repairJobs.length && runLive(run)) {
                  patchPipelineMsg(m => ({
                    ...m,
                    display: `Error fingerprint changed — one more repair on ${second.repairJobs.length} file(s)…`
                  }));
                  await runRepairPass(second.repairJobs);
                  if (!runLive(run)) return;
                  const recheck2 = await window.electronAPI.typecheckWorkspace(workspacePath, {
                    mode: 'workspace',
                    timeoutMs: 90000
                  });
                  patchPipelineMsg(m => ({
                    ...m,
                    display: recheck2.ok
                      ? `Conductor Swarm finished — workspace typecheck passed after the second repair.`
                      : `Conductor Swarm finished with remaining type errors after two repairs.\n\`\`\`\n${(
                          recheck2.output || ''
                          ).slice(0, 2000)}\n\`\`\``,
                    ...(recheck2.ok
                      ? {}
                      : { error: (recheck2.output || 'Typecheck still failing.').slice(0, 500) })
                  }));
                } else if (runLive(run)) {
                  patchPipelineMsg(m => ({
                    ...m,
                    display: `Conductor Swarm finished with type errors after repair that map to no swarm-owned file, so no second repair was run.\n\`\`\`\n${(
                      recheck.output || ''
                    ).slice(0, 2000)}\n\`\`\``,
                    error: (recheck.output || 'Typecheck still failing.').slice(0, 500)
                  }));
                }
              } else {
                patchPipelineMsg(m => ({
                  ...m,
                  display: `Conductor Swarm finished with the same type errors after repair. A second repair was skipped because the fingerprint did not change.\n\`\`\`\n${(
                    recheck.output || ''
                  ).slice(0, 2000)}\n\`\`\``,
                  error: (recheck.output || 'Typecheck still failing.').slice(0, 500)
                }));
              }
            }
          }
        }
      } else {
        patchPipelineMsg(m => ({
          ...m,
          display: `✅ Conductor Swarm completed parallel generation of ${assignments.length} files (contract: \`${manifest.contractFile}\`).`
        }));
      }
    } catch (err: any) {
      console.error('Pipeline error:', err);
      hostLog('error', `swarm: ${err?.message || err}`);
      patchPipelineMsg({
        display: 'Conductor Swarm stopped because of an error.',
        error: err?.message || String(err),
        endpointName: architect?.node?.name,
        model: architect?.model
      });
    } finally {
      // After Stop, a newer run may own the activity stack and the streaming flag.
      if (runIsCurrent(run.token) || !heldRef.current) {
        activityStackRef.current = [];
        setActivityStack([]);
        setIsStreaming(false);
      }
      if (!runLive(run)) {
        // patchPipelineMsg ignores dead runs, so the stopped state is written directly.
        setMessages(prev =>
          prev.map(m =>
            m.id === agentMsgId
              ? {
                  ...m,
                  display: m.error ? m.display : 'Conductor Swarm stopped.',
                  pipelineSteps: m.pipelineSteps && failUnfinishedNodeWork(m.pipelineSteps, 'Stopped')
                }
              : m
          )
        );
      }
    }
    return agentMsgId;
    } finally {
      leaveConductorRun(entered.owned, entered.run.token);
    }
  };

  // ==========================================
  // STANDARD SINGLE-TASK EXECUTION (+ Planner → Coder)
  // resolveRoute is defined with the other role-route helpers.
  // ==========================================

  /** Single-node chat turn with optional plan/review/contract mode or locked approved plan. */
  const runSingleNodeTurn = async (opts: {
    userText: string;
    fullPrompt: string;
    attachedImages?: string[];
    agent: AgentPersona;
    planMode?: boolean;
    reviewMode?: boolean;
    /** Planner locks fix contract after review (writes OK; no plan_options) */
    contractMode?: boolean;
    /** Planner emits <execution_plan> after option pick */
    lockPlanMode?: boolean;
    /** Reviewer Yay/Nay on active Planner step */
    stepVerdictMode?: boolean;
    /** Checklist is done: review the source folder, do not emit a step verdict. */
    finalSourceReview?: boolean;
    approvedPlan?: ApprovedPlan | null;
    userMsgExtra?: Partial<ChatMessage>;
    skipUserAppend?: boolean;
    notice?: string;
    /** Keep a fix on the review model instead of the worker that wrote the files. */
    pinRoute?: { node: EndpointNode; model: string };
    /**
     * Use pinRoute even when this role has a usable explicit pick.
     * The stuck ladder sets this when it must leave the picked model.
     */
    forceRoute?: boolean;
    /**
     * Cleared model context: system + this task packet only (no prior chat).
     * Use for Coder/Reviewer workers under Planner control.
     */
    freshContext?: boolean;
    /** One file for a fresh coder step. Uses the short swarm worker stub. */
    primaryFile?: string;
    /** Same-node retry already used. */
    retriedSame?: boolean;
    /** Failover to another node already used. */
    failedOver?: boolean;
    /** Run-log phase when this turn is a Full auto re-ask or similar. */
    logPhase?: string;
    run?: ConductorRun;
  }): Promise<ChatMessage | undefined> => {
    const {
      userText,
      fullPrompt,
      attachedImages = [],
      agent,
      planMode,
      reviewMode,
      contractMode,
      lockPlanMode,
      stepVerdictMode,
      finalSourceReview,
      approvedPlan,
      userMsgExtra,
      skipUserAppend,
      notice,
      pinRoute,
      forceRoute,
      freshContext
    } = opts;
    const { hostLog, logToolEvent } = scopeRunLog();
    const readOnlyMode = !!planMode || !!reviewMode || !!lockPlanMode || !!stepVerdictMode;
    // Each review starts with a fresh read budget. Depth and command-fix counters stay put.
    if (reviewMode || stepVerdictMode) resetReadOnlyContinues();
    const useFreshContext = !!(freshContext || ephemeralWorkerRef.current);

    const pinRole =
      agent.handle === 'planner' || agent.id === 'planner'
        ? 'planner'
        : agent.handle === 'reviewer' || agent.id === 'reviewer'
          ? 'reviewer'
          : agent.handle === 'docs' || agent.id === 'docs'
            ? 'docs'
            : 'coder';
    routeEpochRef.current += 1;
    const role = conductorRoleForPersona(agent);
    const pickStatus = explicitPickStatus(nodesRef.current, roleRoutesRef.current, role);
    const explicitUsable = pickStatus?.ok === true;
    // forceRoute means this pin, not a larger model liveRoutePin might swap in.
    let forcedExact: { node: EndpointNode; model: string } | undefined;
    if (forceRoute && pinRoute) {
      const live = nodesRef.current.find(n => n.id === pinRoute.node.id);
      const pinOk = !!live?.online && getEnabledModelsForNode(live).includes(pinRoute.model);
      if (pinOk && live) {
        forcedExact = { node: live, model: pinRoute.model };
      } else {
        logRoute('fallback', {
          text: `Forced route ${pinRoute.node.name} / ${pinRoute.model} is not usable.`,
          nodeId: pinRoute.node.id,
          nodeName: pinRoute.node.name,
          model: pinRoute.model
        });
      }
    }
    const honorPin = !!pinRoute && !forceRoute && !explicitUsable;
    const livePin = honorPin && pinRoute ? liveRoutePin(nodesRef.current, pinRoute, pinRole) : undefined;
    if (
      honorPin &&
      pinRoute &&
      livePin &&
      (livePin.node.id !== pinRoute.node.id || livePin.model !== pinRoute.model)
    ) {
      logRoute('pin', {
        text: `${pinRoute.node.name}/${pinRoute.model} -> ${livePin.node.name}/${livePin.model}`,
        nodeId: livePin.node.id,
        nodeName: livePin.node.name,
        model: livePin.model
      });
    }
    if (pickStatus && !pickStatus.ok && livePin) {
      noteRoleFallback(role, pickStatus.reason, { node: livePin.node, model: livePin.model });
    }
    const route = forcedExact
      ? {
          routedNode: forcedExact.node,
          routedModel: forcedExact.model,
          routedIsFrontier: isFrontierNode(forcedExact.node)
        }
      : explicitUsable && !forceRoute && pickStatus?.ok
      ? {
          routedNode: pickStatus.node,
          routedModel: pickStatus.model,
          routedIsFrontier: isFrontierNode(pickStatus.node)
        }
      : livePin
        ? {
            routedNode: livePin.node,
            routedModel: livePin.model,
            routedIsFrontier: isFrontierNode(livePin.node)
          }
        : resolveRoute(userText, agent);
    if (!route) {
      setMessages(prev => [
        ...prev,
        ...(skipUserAppend
          ? []
          : [
              {
                id: `msg-${Date.now()}`,
                role: 'user' as const,
                raw: userText,
                display: userText,
                timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                ...(attachedImages.length ? { images: attachedImages } : {}),
                ...userMsgExtra
              }
            ]),
        {
          id: `agent-${Date.now()}`,
          role: 'assistant' as const,
          raw: '',
          display: '',
          error: 'No endpoints configured. Add an Ollama node in Hardware.',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          toolCalls: []
        }
      ]);
      return;
    }

    const { routedNode, routedModel, routedIsFrontier } = route;

    const createIntent = !readOnlyMode && looksLikeCreateIntent(userText);
    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: 'user',
      raw: userText,
      display: userText,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      ...(attachedImages.length ? { images: attachedImages } : {}),
      ...userMsgExtra
    };

    const agentMsgId = `agent-${Date.now()}`;
    const initialAgentMsg: ChatMessage = {
      id: agentMsgId,
      role: 'assistant',
      raw: '',
      display: notice || '',
      agentId: agent.id,
      personaHandle: agent.handle,
      endpointId: routedNode.id,
      endpointName: routedNode.name,
      model: routedModel,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      toolCalls: [],
      ...(notice ? { notice } : {})
    };

    const turnPhase =
      opts.logPhase ||
      (finalSourceReview
        ? 'final-review'
        : stepVerdictMode
          ? 'verdict'
          : reviewMode
            ? 'review'
            : lockPlanMode
              ? 'lock-plan'
              : contractMode
                ? 'contract'
                : planMode
                  ? 'plan'
                  : 'coder');
    const entered = bindRun(opts.run ?? null, false, turnPhase);
    if (!entered) return;
    const run = entered.run;
    if (!runLive(run)) {
      leaveConductorRun(entered.owned, entered.run.token);
      return;
    }
    setMessages(prev => (skipUserAppend ? [...prev, initialAgentMsg] : [...prev, userMsg, initialAgentMsg]));
    setIsStreaming(true);

    /** This turn's Node Work card. Finish and failure update it in place, even when the target changes. */
    let workCard: { nodeId: string; targetFile: string } | null = null;
    let workCardSettled = false;
    let turnError = '';
    let handedOff = '';
    let retryBubble = '';
    /** The stream was aborted for repeating itself while the run was still live (not a Stop). */
    let repeatAborted = false;
    const workCardIndex = () =>
      workCard ? findNodeWorkIndex(nodeWorkStepsRef.current, { ...workCard, role: '' }) : -1;
    const settleWorkCard = (status: 'completed' | 'failed', content: string) => {
      if (workCardSettled) return;
      workCardSettled = true;
      const idx = workCardIndex();
      const card = idx >= 0 ? nodeWorkStepsRef.current[idx] : undefined;
      // A same-node retry reuses this card and may already have finished it.
      if (card?.status === 'running') upsertNodeWorkStep({ ...card, status, content }, idx);
    };
    if (useFreshContext || agent.handle === 'coder' || agent.handle === 'reviewer') {
      workCard = {
        nodeId: routedNode.id,
        targetFile: stepVerdictMode ? 'step verdict' : reviewMode ? 'review' : 'workspace'
      };
      upsertNodeWorkStep({
        nodeId: routedNode.id,
        nodeName: routedNode.name,
        modelName: routedModel,
        targetFile: workCard.targetFile,
        agentHandle: agent.handle || 'coder',
        role: `${agent.name || agent.handle} · ${routedModel}`,
        status: 'running',
        content: notice || 'Working…',
        toolCalls: []
      });
    }

    let originOut: ChatMessage | undefined;
    try {
      const routedMaxCtx = modelMaxCtx(routedNode, routedModel);
      if (!useFreshContext) fitContext(routedMaxCtx, routedModel);
      const fitRole = stepVerdictMode || reviewMode
        ? 'reviewer'
        : planMode || lockPlanMode || contractMode
          ? 'planner'
          : 'coder';
      const turnFit = resolveModelFit(routedNode, routedModel, fitRole, agent.numCtx);
      applyToolTier(turnFit.tier);
      const coderStep = useFreshContext && !readOnlyMode && !contractMode && !lockPlanMode;
      const turnMap = useFreshContext ? '' : formatRepoMap(repoMapRef.current, turnFit.tier, fullPrompt);
      const systemPrompt =
        coderStep && opts.primaryFile
          ? buildSwarmWorkerSystemStub(opts.primaryFile, projectBrainRef.current.stack)
          : buildSystemPrompt(agent, workspacePath, workspaceOverview, {
              stablePrefix: true,
              planMode: !!planMode,
              reviewMode: !!reviewMode,
              contractMode: !!contractMode,
              lockPlanMode: !!lockPlanMode,
              stepVerdictMode: !!stepVerdictMode,
              projectContext: projectContextForPrompt(rulesCapFor(turnFit.tier)),
              inferenceModel: routedModel
            });
      const withModelFit = (body: string) => {
        const packing =
          !planMode && !lockPlanMode && !contractMode && turnFit.packingLine
            ? `\n\n${turnFit.packingLine}`
            : '';
        const map = turnMap ? `${turnMap}\n\n` : '';
        return `${turnFit.section}\n\n${map}${body}${packing}`;
      };
      const directiveBody = useFreshContext
        ? fullPrompt
        : withModelFit(
            lockPlanMode
              ? `${fullPrompt}\n\n[PLANNER LOCK DIRECTIVE: Break the chosen option into ordered steps with coder tasks. End with <execution_plan>. Do NOT write deliverable files. Do NOT emit <plan_options>.]`
              : stepVerdictMode
                ? `${fullPrompt}\n\n[REVIEWER STEP DIRECTIVE: Verify ONLY the active plan step. End with <step_verdict> yay or nay. Do NOT write files or invent a new plan.]`
                : planMode
                  ? `${fullPrompt}\n\n[PLANNER DIRECTIVE: Analyze intent, propose a concrete plan, and end with 2–4 options in a <plan_options> block. Do NOT write deliverable files yet.]`
                  : reviewMode
                    ? finalSourceReview
                      ? `${fullPrompt}\n\n[FINAL SOURCE REVIEW: Compare the source folder to the finished plan. A compile that succeeds is not a pass. Use issues when index.html would open as a blank white page, when Tailwind classes are not in the CSS, or when the app is unwired. Do NOT write or edit files. End with <final_review><result>pass</result> or <result>issues</result> and <notes>.</final_review>.]`
                      : `${fullPrompt}\n\n[REVIEWER DIRECTIVE: Report findings and end with a <review_plan> block (tasks if fixes are needed, summary-only if clean). Do NOT write or edit files.]`
                    : contractMode
                      ? `${fullPrompt}\n\n[PLANNER CONTRACT DIRECTIVE: Lock a fix contract for the review tasks. You may write a shared contract file. End with <fix_contract>. Do NOT emit <plan_options>. Do not implement the full fix list — Coder runs next.]`
                      : pinRoute
                        ? `${fullPrompt}\n\n[EXECUTION DIRECTIVE: Fix the existing files with <edit_file path="..."> search/replace blocks. Do not rewrite a whole file when a search/replace will do. Do not add a new feature.]`
                        : `${fullPrompt}\n\n[EXECUTION DIRECTIVE: If this request asks to create, build, or modify an application, script, or file, you MUST emit <write_file path="filename.ext">...complete code...</write_file> tags so the files are written directly to the user's computer. Do NOT just reply with conversational instructions.]`
          );
      const actionableUserPrompt = prependVolatileContext(directiveBody, {
        nodes: nodesRef.current,
        inferenceNodeId: routedNode.id,
        includeInventory: !!(planMode || lockPlanMode || contractMode),
        fallbackNumCtx: routedMaxCtx,
        progressLog: progressForPrompt(),
        overview: useFreshContext ? undefined : workspaceOverview,
        approvedPlan:
          readOnlyMode || contractMode || lockPlanMode || useFreshContext ? null : approvedPlan
      });
      const tierImages = selectImagesForTier(attachedImages, turnFit.tier);

      // Cleared worker context: do not send the Planner brainstorm / prior turns.
      const history = useFreshContext ? [] : historyForModel(messagesRef.current, stripThinking);
      const turnReq = pinnedChatOptions({
        node: routedNode,
        model: routedModel,
        role: roleForDynamicCtx(
          stepVerdictMode || reviewMode
            ? 'reviewer'
            : planMode || lockPlanMode || contractMode
              ? 'planner'
              : agent.handle
        ),
        createIntent: !readOnlyMode,
        tier: turnFit.tier,
        temperature: agent.temperature,
        fallbackNumCtx: agent.numCtx
      });
      const fittedPrompt = fitPromptToContext({
        system: systemPrompt,
        userContent: actionableUserPrompt,
        history: history.map(m => ({
          role: m.role,
          content: m.content,
          ...(m.images?.length ? { images: selectImagesForTier(m.images, turnFit.tier) } : {})
        })),
        maxCtx: turnReq.pinnedCtx,
        frontier: routedIsFrontier,
        modelKey: routedModel,
        images: tierImages,
        promptBudget: turnReq.promptBudget
      });
      let userContent = fittedPrompt.userContent;
      let historySent = fittedPrompt.history;
      if (fittedPrompt.note) {
        setExecutingPlanNotice(fittedPrompt.note);
        hostLog('info', fittedPrompt.note);
        logContext('fit', fittedPrompt.note, {
          numCtx: turnReq.pinnedCtx,
          promptBudget: turnReq.promptBudget,
          estPromptTokens: estimateTurnTokens(
            [systemPrompt, fittedPrompt.userContent],
            routedModel
          )
        });
      }
      if (stopRequestedRef.current) return undefined;

      const turnRole = roleForDynamicCtx(
        stepVerdictMode || reviewMode
          ? 'reviewer'
          : planMode || lockPlanMode || contractMode
            ? 'planner'
            : agent.handle
      );
      const sentImages = (fittedPrompt.images || [])
        .map(img => (typeof img === 'string' ? toOllamaBase64(img) : ''))
        .filter(Boolean);
      let conversationPayload: Array<{ role: string; content: string; images?: string[] }> = [
        { role: 'system', content: systemPrompt },
        ...historySent.map(h => ({
          role: h.role,
          content: h.content,
          ...(h.images?.length
            ? {
                images: h.images
                  .map(img => (typeof img === 'string' ? toOllamaBase64(img) : ''))
                  .filter(Boolean)
              }
            : {})
        })),
        {
          role: 'user',
          content: userContent,
          ...(sentImages.length ? { images: sentImages } : {})
        }
      ];
      const turnOptions = ollamaOptions(turnReq);
      const body = withThink(
        {
          model: routedModel,
          messages: conversationPayload,
          options: turnOptions
        },
        routedNode,
        routedModel,
        turnRole
      );

      const openTurn = () => streamChat(
        routedNode.url,
        body,
        (content, thinking) => {
          const parsed = parseResponse(content, agentMsgId, true, { createIntent });
          // Never surface architecture options once an execution plan is locked/running.
          const liveOptions =
            planMode && !lockPlanMode && !isPlanActive(plannerPlanRef.current)
              ? parsePlanOptions(content)
              : [];
          const liveReview = reviewMode && !stepVerdictMode ? parseReviewPlan(content) : null;
          const liveVerdict = stepVerdictMode ? parseStepVerdict(content) : null;
          const liveTools = collapseDuplicateReadTools(
            readOnlyMode
              ? parsed.toolCalls.filter(t =>
                  ['read_file', 'list_dir', 'search', 'read_terminal'].includes(t.name)
                )
              : parsed.toolCalls
          );
          let displayBase = safeAssistantDisplay(
            { ...parsed, toolCalls: liveTools },
            { structured: !!(liveReview || liveVerdict || liveOptions.length >= 2) }
          );
          displayBase = stripPlanOptionMarkup(displayBase);
          if (reviewMode || stepVerdictMode) {
            displayBase = stripStepVerdictMarkup(
              stripReviewDeltaMarkup(stripReviewPlanMarkup(displayBase))
            );
          }
          displayBase = scrubStructuredMarkup(displayBase);
          if (contractMode) displayBase = stripFixContractMarkup(displayBase);
          // Structured cards / Conductor own these — never leave raw XML in the bubble.
          if (liveVerdict || liveReview || lockPlanMode || parseExecutionPlan(content)) {
            displayBase = '';
          }
          if (!runLive(run)) return;
          setMessages(prev =>
            prev.map(m => {
              if (m.id !== agentMsgId) return m;
              return {
                ...m,
                raw: content,
                display: displayBase,
                thinking: parsed.thinking || thinking,
                toolCalls: liveTools,
                ...(liveOptions.length >= 2
                  ? { planOptions: liveOptions, planSummary: buildPlanSummary(content, liveOptions) }
                  : {}),
                ...(liveReview ? { reviewPlan: liveReview } : {}),
                ...(liveVerdict
                  ? {
                      stepVerdict: {
                        stepId: liveVerdict.stepId || getActiveStep(plannerPlanRef.current)?.id || '',
                        stepTitle: getActiveStep(plannerPlanRef.current)?.title || 'Step',
                        result: liveVerdict.result,
                        notes: liveVerdict.notes
                      }
                    }
                  : {})
              };
            })
          );
        },
        routedNode.type,
        routedNode.apiKey
      );
      const taken = await takeChat(
        {
          phase: turnPhase,
          role: turnRole,
          nodeId: routedNode.id,
          nodeName: routedNode.name,
          model: routedModel,
          numCtx: turnOptions.num_ctx,
          promptBudget: turnReq.promptBudget,
          estPromptTokens: estimateTurnTokens(
            conversationPayload.map(message => message.content),
            routedModel
          )
        },
        openTurn,
        () => runLive(run)
      );
      if (taken.aborted || !runLive(run)) {
        if (runLive(run)) {
          turnError = 'Model output repeated itself; aborted';
          repeatAborted = true;
        }
        return;
      }
      let result = taken.result;
      if (
        !routedIsFrontier &&
        fittedPrompt.shrinks < 2 &&
        contextWasExhausted(result.stats, turnReq.pinnedCtx, turnOptions.num_ctx)
      ) {
        const note = `Context monitor: ${routedModel} filled ${turnOptions.num_ctx} tokens. Resubmitting a smaller packet.`;
        setExecutingPlanNotice(note);
        hostLog('info', note);
        userContent = shrinkUserPacket(userContent, 2);
        historySent = [];
        conversationPayload = [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent }
        ];
        logContext('resubmit', note, {
          numCtx: turnOptions.num_ctx,
          promptBudget: turnReq.promptBudget,
          estPromptTokens: estimateTurnTokens(
            conversationPayload.map(message => message.content),
            routedModel
          )
        });
        const retryBody = withThink(
          {
            model: routedModel,
            messages: conversationPayload,
            options: turnOptions
          },
          routedNode,
          routedModel,
          turnRole
        );
        const retried = await takeChat(
          {
            phase: 'context-resubmit',
            role: turnRole,
            nodeId: routedNode.id,
            nodeName: routedNode.name,
            model: routedModel,
            numCtx: turnOptions.num_ctx,
            promptBudget: turnReq.promptBudget,
            estPromptTokens: estimateTurnTokens(
              conversationPayload.map(message => message.content),
              routedModel
            )
          },
          () =>
            streamChat(
              routedNode.url,
              retryBody,
              () => {},
              routedNode.type,
              routedNode.apiKey
            ),
          () => runLive(run)
        );
        if (retried.aborted || !runLive(run)) {
          if (runLive(run)) {
            turnError = 'Model output repeated itself; aborted';
            repeatAborted = true;
          }
          return;
        }
        result = retried.result;
      }
      if (!runLive(run)) return;
      notePromptSample(routedModel, conversationPayload, result.stats);
      const finished = readOnlyMode
        ? result.content
        : await finishTruncatedWrites(
            routedNode,
            routedModel,
            result.content,
            result.stats?.doneReason,
            undefined,
            run.token
          );
      if (!runLive(run)) return;
      const finalParsed = parseResponse(finished, agentMsgId, false, {
        createIntent,
        allowUnclosedSalvage: false
      });

      let tools = collapseDuplicateReadTools(finalParsed.toolCalls);
      if (!readOnlyMode && !continuationClosedWrite(result.content, finished) && hasUnclosedWrite(finished)) {
        const truncated = truncatedWriteToolCall(finished, agentMsgId);
        if (truncated) {
          tools = [...tools, truncated];
          logToolEvent(truncated);
        }
      }
      if (readOnlyMode) {
        // Planner / Reviewer: explore only — drop accidental write/edit/run tools
        tools = tools.filter(t =>
          ['read_file', 'list_dir', 'search', 'read_terminal'].includes(t.name)
        );
      }

      if (!runLive(run)) return;
      const readPass = await runReadOnlyTools(tools, toolDepsRef.current);
      tools = readPass.tools;
      if (!runLive(run)) return;

      if (!readOnlyMode && autoApplyOn()) {
        tools = await autoApplyWritableTools(tools, toolDepsRef.current);
        if (!runLive(run)) return;
        tools = await runAuxTools(tools, toolDepsRef.current);
        const cmdPass = await runCommandTools(tools, toolDepsRef.current);
        tools = cmdPass.tools;
        updateProgress(log => noteSavedFiles(log, tools, savedFileFingerprints()));
        noteAppliedWrites(tools);
      }

      let stats = undefined;
      if (result.stats?.evalCount && result.stats?.evalDuration) {
        const tps = Math.round(result.stats.evalCount / (result.stats.evalDuration / 1e9));
        stats = {
          evalCount: result.stats.evalCount,
          tokensPerSec: tps,
          promptTokens: result.stats.promptEvalCount,
          loadMs: result.stats.loadDuration ? Math.round(result.stats.loadDuration / 1e6) : undefined
        };
        if (routedIsFrontier) {
          onRecordTokens(0, result.stats.evalCount + (result.stats.promptEvalCount || 0));
        } else {
          onRecordTokens(result.stats.evalCount + (result.stats.promptEvalCount || 0), 0);
        }
      }

      const options =
        planMode && !lockPlanMode && !isPlanActive(plannerPlanRef.current)
          ? parsePlanOptions(finished)
          : [];
      const reviewPlan =
        reviewMode && !stepVerdictMode ? parseReviewPlan(finished) : null;
      const parsedVerdict = stepVerdictMode ? parseStepVerdict(finished) : null;
      let displayText = safeAssistantDisplay(
        { ...finalParsed, toolCalls: tools },
        { structured: !!(reviewPlan || parsedVerdict || options.length >= 2) }
      );
      displayText = scrubStructuredMarkup(displayText);
      if (contractMode) displayText = stripFixContractMarkup(displayText);
      // Structured cards / Conductor own these — never leave raw XML in the bubble.
      if (parsedVerdict || reviewPlan || lockPlanMode || parseExecutionPlan(finished)) {
        displayText = '';
      }
      const writeAnnot = annotateAppliedWrites(tools);
      if (
        writeAnnot &&
        !displayText.includes('Wrote') &&
        !displayText.includes('Edited')
      ) {
        displayText = displayText ? `${displayText}\n${writeAnnot}` : writeAnnot;
      }

      const origin: ChatMessage = {
        id: agentMsgId,
        role: 'assistant',
        raw: finished,
        display: displayText,
        thinking: finalParsed.thinking || result.thinking,
        toolCalls: tools,
        stats,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        agentId: agent.id,
        personaHandle: agent.handle,
        endpointId: routedNode.id,
        endpointName: routedNode.name,
        model: routedModel,
        ...(options.length > 0
          ? {
              planOptions: options,
              planSummary: buildPlanSummary(finished, options)
            }
          : {}),
        ...(reviewPlan ? { reviewPlan } : {}),
        ...(parsedVerdict
          ? {
              stepVerdict: {
                stepId: parsedVerdict.stepId || getActiveStep(plannerPlanRef.current)?.id || '',
                stepTitle: getActiveStep(plannerPlanRef.current)?.title || 'Step',
                result: parsedVerdict.result,
                notes: parsedVerdict.notes
              }
            }
          : {}),
        ...(notice ? { notice } : {})
      };

      const originMessages = messagesRef.current.map(m => (m.id === agentMsgId ? origin : m));
      messagesRef.current = originMessages;
      setMessages(originMessages);
      originOut = origin;

      // Surface Reviewer fix tasks under Conductor immediately (not only after Send).
      if (
        reviewMode &&
        !stepVerdictMode &&
        reviewPlan &&
        reviewPlan.tasks.length > 0 &&
        !hasOpenTasks(executionQueueRef.current)
      ) {
        commitExecutionQueue(createQueueFromReviewPlan(reviewPlan, agentMsgId));
      }

      // Track ephemeral Coder/Reviewer on the Node Work column.
      if (!runIsCurrent(run.token)) {
        // Stopped: Stop already failed this card, and the column may now belong to another chat.
        workCardSettled = true;
      } else if (!readOnlyMode && (useFreshContext || agent.handle === 'coder')) {
        const writePaths = tools
          .filter(t => t.name === 'write_file' || t.name === 'edit_file')
          .map(t => t.args?.path)
          .filter(Boolean) as string[];
        const labelPath = writePaths[0] || 'workspace';
        upsertNodeWorkStep(
          {
            nodeId: routedNode.id,
            nodeName: routedNode.name,
            modelName: routedModel,
            targetFile: labelPath,
            agentHandle: agent.handle || 'coder',
            role: `${agent.name || agent.handle} · ${routedModel}`,
            status: 'completed',
            content:
              annotateAppliedWrites(tools) ||
              (writePaths.length ? `Completed ${writePaths.join(', ')}` : displayText.slice(0, 120) || 'Done'),
            toolCalls: tools,
            stats
          },
          workCardIndex()
        );
        workCardSettled = true;
      } else if (reviewMode || stepVerdictMode) {
        const reviewSummary = parsedVerdict
          ? `${parsedVerdict.result === 'yay' ? 'Yay' : 'Nay'}: ${(parsedVerdict.notes || '').slice(0, 160)}`
          : reviewPlan?.summary || 'Review complete';
        upsertNodeWorkStep({
          nodeId: routedNode.id,
          nodeName: routedNode.name,
          modelName: routedModel,
          targetFile: stepVerdictMode ? 'step verdict' : 'review',
          agentHandle: 'reviewer',
          role: `Reviewer · ${routedModel}`,
          status: 'completed',
          content: stripStepVerdictMarkup(reviewSummary),
          toolCalls: tools,
          stats
        }, workCardIndex());
        workCardSettled = true;
      } else if (workCard) {
        upsertNodeWorkStep(
          {
            nodeId: routedNode.id,
            nodeName: routedNode.name,
            modelName: routedModel,
            targetFile: workCard.targetFile,
            agentHandle: agent.handle || 'coder',
            role: `${agent.name || agent.handle} · ${routedModel}`,
            status: 'completed',
            content: displayText.slice(0, 120) || 'Done',
            toolCalls: tools,
            stats
          },
          workCardIndex()
        );
        workCardSettled = true;
      }

      const reviewReadCap =
        reviewMode || stepVerdictMode ? 1 : planMode || lockPlanMode ? 2 : undefined;
      const turnContinueOpts = continueDecisionOpts(undefined, {
        maxReadOnlyContinues: reviewReadCap
      });
      const continueRole =
        (agent.handle as 'planner' | 'reviewer' | 'coder' | 'docs') ||
        (planMode || lockPlanMode
          ? 'planner'
          : reviewMode || stepVerdictMode
            ? 'reviewer'
            : 'coder');
      const activeReviewStepId = getActiveStep(plannerPlanRef.current)?.id;
      const reviewNeedsVerdictNow =
        (!!reviewMode || !!stepVerdictMode) &&
        needsReviewVerdictTurn({
          reviewMode: !!reviewMode || !!stepVerdictMode,
          stepVerdictMode: !!stepVerdictMode,
          finalSourceReview: !!finalSourceReview,
          tools,
          raw: finished,
          readOnlyContinues: turnContinueOpts.readOnlyContinues,
          maxReadOnlyContinues: reviewReadCap ?? 1,
          activeStepId: activeReviewStepId != null ? String(activeReviewStepId) : undefined
        });
      if (!runLive(run)) return;
      if (!readOnlyMode && shouldContinueFromTools(tools, turnContinueOpts)) {
        await continueWithToolResults(origin, {
          createIntent,
          node: routedNode,
          model: routedModel,
          role: continueRole,
          lockPlanMode: !!lockPlanMode,
          reviewMode: !!reviewMode || !!stepVerdictMode,
          stepVerdictMode: !!stepVerdictMode,
          freshContext: useFreshContext,
          run
        });
      } else if (
        readOnlyMode &&
        (shouldContinueFromTools(tools, turnContinueOpts) || reviewNeedsVerdictNow)
      ) {
        // Planner/Reviewer: bounded explore continues, then they must emit the plan.
        // A spent read cap with no verdict tag gets one answer turn and no tool execution.
        const continued = await continueWithToolResults(origin, {
          createIntent: false,
          node: routedNode,
          model: routedModel,
          role: continueRole,
          lockPlanMode: !!lockPlanMode,
          reviewMode: !!reviewMode || !!stepVerdictMode,
          stepVerdictMode: !!stepVerdictMode,
          finalSourceReview: !!finalSourceReview,
          freshContext: useFreshContext,
          verdictNow: reviewNeedsVerdictNow && !shouldContinueFromTools(tools, turnContinueOpts),
          run
        });
        if (continued) originOut = continued;
        // Parse the returned follow-up. messagesRef can still be behind a React updater.
        if (reviewMode && !stepVerdictMode && continued) {
          const fromRaw = parseReviewPlan(continued.raw || '');
          const rp = coerceDirtyReviewPlan(
            fromRaw,
            `${continued.display || ''}\n${continued.raw || ''}`
          );
          const stamped = fromRaw || rp.tasks.length > 0 ? rp : null;
          if (stamped) {
            const patched = { ...continued, reviewPlan: stamped };
            originOut = patched;
            if (conversationIdRef.current === run.conversationId) {
              const next = messagesRef.current.some(m => m.id === patched.id)
                ? messagesRef.current.map(m => (m.id === patched.id ? patched : m))
                : [...messagesRef.current, patched];
              messagesRef.current = next;
              setMessages(next);
            }
            if (stamped.tasks.length > 0 && !hasOpenTasks(executionQueueRef.current)) {
              commitExecutionQueue(createQueueFromReviewPlan(stamped, continued.id));
            }
          }
        }
        if (stepVerdictMode) {
          const fromRef = messagesFromOrigin(messagesRef.current, agentMsgId);
          const pool =
            continued && !fromRef.some(m => m.id === continued.id)
              ? [...fromRef, continued]
              : fromRef.length
                ? fromRef
                : continued
                  ? [continued]
                  : [];
          const active = getActiveStep(plannerPlanRef.current);
          const picked = pickExplicitStepVerdict(pool, active?.id);
          if (picked) {
            const packedVerdict = {
              stepId: String(active?.id || picked.parsed.stepId || ''),
              stepTitle: active?.title || 'Step',
              result: picked.parsed.result,
              notes: picked.parsed.notes
            };
            originOut = { ...picked.message, stepVerdict: packedVerdict };
            if (conversationIdRef.current === run.conversationId) {
              const next = messagesRef.current.some(m => m.id === picked.message.id)
                ? messagesRef.current.map(m =>
                    m.id === picked.message.id ? { ...m, stepVerdict: packedVerdict } : m
                  )
                : [...messagesRef.current, originOut];
              messagesRef.current = next;
              setMessages(next);
            }
          }
        }
      }
      if (planMode && !lockPlanMode && runLive(run)) {
        await maybeFullAutoPickPlan(run, originOut);
      }
    } catch (err: any) {
      const errText = String(err?.message || err || '');
      turnError = errText;
      hostLog('error', `single-node ${routedNode?.name || ''}: ${errText}`);
      const willRetryHere = runLive(run) && !opts.retriedSame;
      const willFailover =
        runLive(run) &&
        !opts.failedOver &&
        !!pickFailoverTarget(nodesRef.current, routedNode.id, routedModel, { role: pinRole });
      if (planMode && !lockPlanMode && !willRetryHere && !willFailover) {
        releaseStashedPlanChoice();
      }
      if (willRetryHere) {
        logRoute('retry', {
          text: errText.slice(0, 300),
          nodeId: routedNode.id,
          nodeName: routedNode.name,
          model: routedModel
        });
        retryBubble = `Retrying ${routedNode.name}…`;
        setMessages(prev =>
          prev.map(m =>
            m.id === agentMsgId ? { ...m, display: retryBubble, error: undefined } : m
          )
        );
        await new Promise(r => setTimeout(r, 400));
        if (!runLive(run)) {
          if (planMode && !lockPlanMode) releaseStashedPlanChoice();
          return originOut;
        }
        handedOff = `retried on ${routedNode.name}`;
        return await runSingleNodeTurn({
          ...opts,
          run,
          skipUserAppend: true,
          retriedSame: true,
          pinRoute: { node: routedNode, model: routedModel }
        });
      }
      if (runLive(run) && !opts.failedOver) {
        const fail = pickFailoverTarget(nodesRef.current, routedNode.id, routedModel, { role: pinRole });
        if (
          fail &&
          fail.node.online &&
          getEnabledModelsForNode(fail.node).includes(fail.model) &&
          (fail.node.id !== routedNode.id || fail.model !== routedModel)
        ) {
          logRoute('failover', {
            text: `${routedNode.name} -> ${fail.node.name}`,
            nodeId: fail.node.id,
            nodeName: fail.node.name,
            model: fail.model
          });
          const leavingPick = explicitRolePick(roleRoutesRef.current, role);
          if (
            leavingPick &&
            leavingPick.nodeId === routedNode.id &&
            leavingPick.model === routedModel
          ) {
            logRoute('fallback', {
              text: `${role} pick failed on ${routedNode.name} / ${routedModel}. Using ${fail.node.name} / ${fail.model}.`,
              nodeId: fail.node.id,
              nodeName: fail.node.name,
              model: fail.model
            });
          }
          retryBubble = `Rerouting to ${fail.node.name}…`;
          setMessages(prev =>
            prev.map(m =>
              m.id === agentMsgId ? { ...m, display: retryBubble, error: undefined } : m
            )
          );
          settleWorkCard('failed', `${errText.slice(0, 120)} · rerouted to ${fail.node.name}`);
          handedOff = `rerouted to ${fail.node.name}`;
          return await runSingleNodeTurn({
            ...opts,
            run,
            skipUserAppend: true,
            retriedSame: true,
            failedOver: true,
            pinRoute: { node: fail.node, model: fail.model },
            forceRoute: true,
            notice: `Rerouted to ${fail.node.name}`
          });
        }
      }
      if (runLive(run)) {
        setMessages(prev =>
          prev.map(m => {
            if (m.id === agentMsgId) {
              return {
                ...m,
                error: errText,
                endpointName: routedNode.name,
                model: routedModel
              };
            }
            return m;
          })
        );
      }
    } finally {
      // After Stop or a chat switch the column and streaming flag may belong to a newer turn;
      // Stop already failed this turn's card.
      const current = runIsCurrent(run.token);
      if (current && !handedOff) {
        if (!runLive(run)) settleWorkCard('failed', 'Stopped');
        else if (turnError) settleWorkCard('failed', turnError.slice(0, 160));
        else settleWorkCard('completed', 'Done');
      }
      if (retryBubble) {
        // The retry or reroute answers in its own bubble; this one must not keep saying it is retrying.
        const outcome = handedOff
          ? `${routedNode.name} failed (${turnError.slice(0, 160)}) — ${handedOff}.`
          : repeatAborted
            ? 'Model output repeated itself; aborted'
            : 'Stopped.';
        setMessages(prev =>
          prev.map(m => (m.id === agentMsgId && m.display === retryBubble ? { ...m, display: outcome } : m))
        );
      }
      if (current || !heldRef.current) setIsStreaming(false);
      leaveConductorRun(entered.owned, entered.run.token);
    }
    return originOut;
  };

  /**
   * Planner orchestrates ONE active queue task → fix contract → Coder, then Reviewer verifies that task.
   * Seeds the durable queue from planMsg when needed; never drops the list.
   */
  const sendReviewPlanToPlanner = async (
    planMsg?: ChatMessage | null,
    resumeDepth?: number,
    reviewNotes?: string,
    parent?: ConductorRun | null
  ): Promise<void> => {
    if (planMsg?.reviewSentToCoder && !executionQueueRef.current) return;
    const entered = bindRun(parent ?? null, !parent, 'review');
    if (!entered) return;
    const run = entered.run;
    try {
    if (!runLive(run)) return;

    const depth =
      resumeDepth ?? pendingReviewResumeRef.current?.depth ?? 0;
    pendingReviewResumeRef.current = null;

    let queue = executionQueueRef.current;
    if ((!queue || !queue.tasks.length) && planMsg?.reviewPlan?.tasks.length) {
      queue = createQueueFromReviewPlan(planMsg.reviewPlan, planMsg.id);
      commitExecutionQueue(queue);
    }
    if (!queue?.tasks.length) return;

    let task = getActiveTask(queue);
    if (!task || task.status === 'completed') {
      const next = pickNextPending(queue);
      if (!next) {
        if (autoReviewOn()) await decideNextStepAndAdvance(depth, '', run);
        return;
      }
      queue = markInProgress(queue, next.id);
      commitExecutionQueue(queue);
      task = getActiveTask(queue)!;
    } else if (task.status === 'pending' || task.status === 'failed') {
      queue = markInProgress(queue, task.id);
      commitExecutionQueue(queue);
      task = getActiveTask(queue)!;
    }

    if (planMsg) {
      setMessages(prev => {
        const snap = queueToReviewPlan(queue!);
        const next = prev.map(m =>
          m.id === planMsg.id
            ? { ...m, reviewSentToCoder: true, reviewPlan: snap }
            : m
        );
        messagesRef.current = next;
        return next;
      });
    }

    const activeTaskId = task.id;
    const taskConversationId = conversationIdRef.current;
    const stoppedMidTask = () => {
      if (runLive(run)) return false;
      // After a chat switch the queue ref holds the other chat's tasks.
      if (conversationIdRef.current !== taskConversationId) return true;
      const q = executionQueueRef.current;
      const next = q ? markStopped(q, activeTaskId) : q;
      if (next && next !== q) {
        commitExecutionQueue(next);
        if (planMsg) {
          const snap = queueToReviewPlan(next);
          setMessages(prev => prev.map(m => (m.id === planMsg.id ? { ...m, reviewPlan: snap } : m)));
        }
      }
      return true;
    };

    const singlePlan = formatActiveTaskForPlanner(queue, task, reviewNotes);
    const openLeft = queue.tasks.filter(
      t => t.status === 'pending' || t.status === 'failed'
    ).length;

    onSelectAgent(plannerAgent.id);
    resetAgentLoopBudget();

    const plannerPrompt = formatReviewPlanForPlanner(
      singlePlan,
      reviewNotes || planMsg?.display
    );
    setExecutingPlanNotice(
      `Planner contract for task #${task.id}${openLeft ? ` (${openLeft} remaining after)` : ''}…`
    );

    if (isPipelineMode) {
      const syntheticPlan: ApprovedPlan = {
        summary: singlePlan.summary,
        chosenOptionId: 'review-fix',
        chosenOptionTitle: `Fix task #${task.id}: ${task.title}`,
        chosenOptionDescription: task.description,
        allOptions: [],
        originalUserRequest: `Review fix task #${task.id}: ${task.title}`,
        approvedAt: Date.now(),
        planMarkdown: plannerPrompt
      };
      approvedPlanRef.current = syntheticPlan;
      onConversationPatch?.({ approvedPlan: syntheticPlan, agentId: plannerAgent.id });
      await handleSendPipelineMessage(
        `Review fix task #${task.id}: ${task.title}`,
        plannerPrompt,
        { approvedPlan: syntheticPlan, skipUserAppend: true, run }
      );
      if (!stoppedMidTask()) {
        await reviewAndAdvance(depth + 1, `Task #${task.id}: ${task.title}`, run);
      }
      return;
    }

    const plannerMsg = await runSingleNodeTurn({
      userText: `Planner: fix contract for task #${task.id}`,
      fullPrompt: plannerPrompt,
      agent: plannerAgent,
      planMode: false,
      reviewMode: false,
      contractMode: true,
      skipUserAppend: true,
      notice: `Planner locking fix contract — task #${task.id}`,
      run
    });

    if (stoppedMidTask()) return;

    const plannerBrief = extractFixContractBrief(
      plannerMsg?.raw || '',
      plannerMsg?.display || ''
    );

    ephemeralWorkerRef.current = true;
    onSelectAgent(coderAgent.id);
    onConversationPatch?.({ agentId: coderAgent.id });

    const coderPrompt = formatReviewPlanForCoder(
      singlePlan,
      reviewNotes || planMsg?.display,
      plannerBrief
    );
    setExecutingPlanNotice(`Coder applying task #${task.id}: ${task.title}…`);

    await runSingleNodeTurn({
      userText: `Implement review task #${task.id}: ${task.title}`,
      fullPrompt: coderPrompt,
      agent: coderAgent,
      planMode: false,
      reviewMode: false,
      contractMode: false,
      approvedPlan: approvedPlanRef.current,
      notice: `Coder implementing task #${task.id}`,
      freshContext: true,
      run
    });
    if (!stoppedMidTask()) {
      await reviewAndAdvance(depth + 1, `Task #${task.id}: ${task.title}`, run);
    }
    if (runIsCurrent(run.token) || !heldRef.current) restorePlannerControl();
    } finally {
      leaveConductorRun(entered.owned, run.token);
    }
  };

  /** User approved a clean review — resume next-step continuation. */
  const continueAfterCleanReview = async (planMsg: ChatMessage) => {
    if (!planMsg.reviewNeedsContinue) return;
    const resume = pendingReviewResumeRef.current;
    const entered = bindRun(null, true, 'continue');
    if (!entered) return;
    const restoreCard = () => {
      pendingReviewResumeRef.current = resume;
      setMessages(prev => {
        const next = prev.map(m =>
          m.id === planMsg.id
            ? { ...m, reviewSentToCoder: false, reviewNeedsContinue: true }
            : m
        );
        messagesRef.current = next;
        return next;
      });
    };
    pendingReviewResumeRef.current = null;
    setMessages(prev => {
      const next = prev.map(m =>
        m.id === planMsg.id
          ? { ...m, reviewSentToCoder: true, reviewNeedsContinue: false }
          : m
      );
      messagesRef.current = next;
      return next;
    });
    try {
      setExecutingPlanNotice('Continuing after clean review…');
      await decideNextStepAndAdvance(
        resume?.depth ?? 0,
        resume?.previousTask ?? '',
        entered.run
      );
      if (!runLive(entered.run)) restoreCard();
    } catch (err) {
      restoreCard();
      throw err;
    } finally {
      leaveConductorRun(entered.owned, entered.run.token);
    }
  };

  /**
   * After the non-plan continuation stops, typecheck a workspace that has tsconfig.json.
   * Full auto may spend up to two coder heals, then the errors stay on the chat card.
   * Returns a notice when the check failed or was skipped. Null when it passed or did not apply.
   */
  const verifyTypescriptBeforeFinish = async (run: ConductorRun): Promise<string | null> => {
    const { logRun } = scopeRunLog();
    if (!runLive(run) || isPlanActive(plannerPlanRef.current)) return null;
    if (!workspacePath || !window.electronAPI?.typecheckWorkspace || !window.electronAPI.readFile) return null;
    const root = workspacePath.replace(/[\\/]+$/, '');
    const sep = root.includes('\\') ? '\\' : '/';
    let tsconfig = '';
    try {
      const res = await window.electronAPI.readFile(`${root}${sep}tsconfig.json`);
      tsconfig = res?.content || '';
    } catch {
      tsconfig = '';
    }
    if (!String(tsconfig).trim()) {
      if (projectBrainRef.current.stack === 'typescript') {
        logRun({
          kind: 'verify',
          ok: false,
          output: 'skipped: no tsconfig.json',
          fingerprint: 'skipped'
        });
        return 'Workspace typecheck skipped — no tsconfig.json';
      }
      return null;
    }

    const runCheck = async () => {
      if (!runLive(run) || !window.electronAPI?.typecheckWorkspace || !workspacePath) return null;
      const check = await window.electronAPI.typecheckWorkspace(workspacePath, {
        mode: 'workspace',
        timeoutMs: 90000
      });
      if (!runLive(run)) return null;
      const output = `${check.output || ''}\n${check.error || ''}`.trim();
      const blocked = !!check.timedOut || !!check.missingTsc;
      logRun({
        kind: 'verify',
        ok: check.ok === true && !check.skipped && !blocked,
        output: check.skipped ? `skipped: ${output || 'no tsconfig.json'}` : output,
        fingerprint: check.skipped ? 'skipped' : errorFingerprint(parseCompilerErrors(output))
      });
      return check;
    };

    const showFailure = (output: string) => {
      const clipped = output.slice(0, 2000);
      const cause = (output || 'Workspace typecheck failed.').slice(0, 500);
      setMessages(prev => {
        let target = -1;
        for (let i = prev.length - 1; i >= 0; i--) {
          if (prev[i]?.role === 'assistant') {
            target = i;
            break;
          }
        }
        if (target < 0) return prev;
        const next = prev.map((message, index) =>
          index === target
            ? {
                ...message,
                display: `${message.display || ''}\n\nWorkspace typecheck failed.\n\`\`\`\n${clipped}\n\`\`\``,
                error: cause
              }
            : message
        );
        messagesRef.current = next;
        return next;
      });
    };

    let check = await runCheck();
    if (!check || !runLive(run)) return null;
    if (check.skipped) return 'Workspace typecheck skipped';
    const maxHeals = 2;
    let heals = 0;
    while (
      !check.ok &&
      !check.skipped &&
      autoReviewOn() &&
      runLive(run) &&
      finalVerifyHealsRef.current < maxHeals
    ) {
      const output = `${check.output || ''}\n${check.error || ''}`.trim();
      // Timeouts, a missing compiler, and missing modules are not source rewrites.
      if (check.timedOut || check.missingTsc || typesCannotResolve(output)) break;
      finalVerifyHealsRef.current += 1;
      heals += 1;
      const errors = parseCompilerErrors(output);
      const task = `Fix these TypeScript errors. Do not add features.\n\n${formatErrorsForCoder(errors, output)}`;
      logRun({
        kind: 'heal',
        attempt: finalVerifyHealsRef.current,
        max: maxHeals,
        fingerprint: errorFingerprint(errors),
        note: 'end-of-run workspace typecheck'
      });
      logNoticeNow(`Continuing — fix TypeScript errors (${finalVerifyHealsRef.current}/${maxHeals})`, run);
      ephemeralWorkerRef.current = true;
      await runSingleNodeTurn({
        userText: `Continue: ${task}`,
        fullPrompt: `NEXT STEP — fix the existing files with <edit_file>. Do not rewrite a file from scratch when a search/replace will do. Do not add a new feature.\n\n${task}`,
        agent: coderAgent,
        planMode: false,
        approvedPlan: approvedPlanRef.current,
        notice: `Continuing automatically — fix TypeScript errors (${finalVerifyHealsRef.current}/${maxHeals})`,
        freshContext: true,
        run
      });
      if (!runLive(run)) return null;
      const again = await runCheck();
      if (!again) return null;
      check = again;
    }
    if (heals > 0) restorePlannerControl();
    if (!runLive(run)) return null;
    if (check.skipped) return 'Workspace typecheck skipped';
    if (!check.ok) {
      const output = `${check.output || ''}\n${check.error || ''}`.trim() || 'Workspace typecheck failed.';
      if (check.timedOut || check.missingTsc) {
        const note = check.timedOut
          ? 'Workspace typecheck timed out.'
          : 'TypeScript compiler is missing.';
        showFailure(output || note);
        return note;
      }
      showFailure(typesCannotResolve(output) ? annotateMissingDependencies(output) : output);
      return 'Workspace typecheck failed';
    }
    return null;
  };

  /**
   * After a clean Reviewer pass (or user Continue), decide continue / ask / done.
   * The checker does not write files. A finished run may typecheck and heal.
   */
  const decideNextStepAndAdvance = async (
    depth: number,
    previousTask = '',
    parent?: ConductorRun | null
  ): Promise<void> => {
    const entered = bindRun(parent ?? null, false, 'continue');
    if (!entered) return;
    const run = entered.run;
    const { logRun, hostLog } = scopeRunLog();
    try {
    if (!runLive(run)) return;

    // Planner-owned plan is the sole controller — never invent next steps while active.
    if (isPlanActive(plannerPlanRef.current)) {
      const step = getActiveStep(plannerPlanRef.current);
      if (step && (step.status === 'in_progress' || step.status === 'pending')) {
        await dispatchActiveStep(run);
      } else if (plannerPlanRef.current?.status === 'completed') {
        setExecutingPlanNotice('Planner plan complete — ask Planner for the next feature if needed.');
      }
      return;
    }

    // Legacy flat queue still has work — Planner dispatches; do not invent a new feature step.
    if (hasOpenTasks(executionQueueRef.current)) {
      await sendReviewPlanToPlanner(null, depth, undefined, run);
      return;
    }

    const recent = messagesRef.current;
    const target = roleTarget('reviewer', () => pickCapableReviewTarget(nodesRef.current));
    if (!target) return;
    const { node, model } = target;
    const touchedPaths = collectWrittenPaths(recent);
    const capped = depth >= MAX_AUTO_CONTINUATIONS;
    const transcript = recent
      .slice(-8)
      .map(m => {
        const who = m.role === 'user' ? 'User' : m.personaHandle || 'Assistant';
        const text = (m.display || '').replace(/\s+/g, ' ').trim().slice(0, 600);
        return text ? `${who}: ${text}` : '';
      })
      .filter(Boolean)
      .join('\n');
    const planText = approvedPlanRef.current
      ? formatApprovedPlanContext(approvedPlanRef.current)
      : '';
    const contTier = resolveModelFit(node, model, 'reviewer', reviewerAgent.numCtx).tier;
    setIsStreaming(true);
    const preloadedFiles: { path: string; content: string }[] = [];
    if (workspacePath && window.electronAPI?.readFile) {
      const sep = workspacePath.includes('\\') ? '\\' : '/';
      const root = workspacePath.replace(/[\\/]+$/, '');
      for (const rel of touchedPaths) {
        if (preloadedFiles.length >= 8) break;
        const norm = (rel || '').replace(/\\/g, '/').trim();
        if (!norm) continue;
        try {
          const abs =
            /^[a-zA-Z]:[\\/]/.test(norm) || norm.startsWith('/')
              ? norm
              : `${root}${sep}${norm.replace(/\//g, sep)}`;
          const res = await window.electronAPI.readFile(abs);
          if (typeof res?.content === 'string') preloadedFiles.push({ path: norm, content: res.content });
        } catch {
          /* file already gone */
        }
      }
    }
    if (!runLive(run)) {
      if (runOwnsUi(run)) setIsStreaming(false);
      return;
    }
    const userContent = buildContinuationReviewPrompt({
      approvedPlanText: planText,
      recentTranscript: transcript,
      workspaceOverview,
      workLog: progressForPrompt(),
      writtenPaths: preloadedFiles.length ? undefined : touchedPaths,
      preloadedFiles,
      tier: contTier,
      capped
    });

    const agentMsgId = `next-${Date.now()}`;
    const stamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    setExecutingPlanNotice(capped ? 'Out of automatic steps — asking what to do next' : 'Checking what is left…');
    setMessages(prev => [
      ...prev,
      {
        id: agentMsgId,
        role: 'assistant',
        raw: '',
        display: '',
        agentId: coderAgent.id,
        personaHandle: coderAgent.handle,
        endpointId: node.id,
        endpointName: node.name,
        model,
        timestamp: stamp,
        notice: `Planning next step on ${node.name}`,
        toolCalls: []
      }
    ]);
    setIsStreaming(true);

    let handoff = false;
    let nextTask = '';
    let pinFix = false;
    let pinStuck: { node: EndpointNode; model: string } | undefined;
    let stuckForceRoute = false;
    let handledLoop = false;
    try {
      const askModel = async (content: string, prior: { role: string; content: string }[]) => {
        const askMsgs = [
          {
            role: 'system',
            content:
              CONTINUATION_REVIEW_SYSTEM +
              '\n\nDo NOT use <edit_file> or <write_file>. Reviewer already checked the files; only emit <next_step>.'
          },
          ...prior,
          { role: 'user', content }
        ];
        const askOptions = chatOptions(node, model, 'reviewer', {
          createIntent: false,
          tier: contTier,
          temperature: 0.2,
          fallbackNumCtx: reviewerAgent.numCtx
        });
        const body = withThink(
          {
            model,
            messages: askMsgs,
            options: askOptions
          },
          node,
          model,
          'reviewer'
        );
        const taken = await takeChat(
          {
            phase: 'next-step',
            role: 'reviewer',
            nodeId: node.id,
            nodeName: node.name,
            model,
            numCtx: askOptions.num_ctx,
            estPromptTokens: estimateTurnTokens(
              askMsgs.map(message => message.content),
              model
            )
          },
          () =>
            streamChat(
              node.url,
              body,
              (chunk, thinking) => {
                if (!runLive(run)) return;
                const shown = stripNextStepMarkup(stripPlanOptionMarkup(stripThinking(chunk)));
                setMessages(prev =>
                  prev.map(m =>
                    m.id === agentMsgId
                      ? { ...m, raw: chunk, display: shown, thinking: thinking || m.thinking }
                      : m
                  )
                );
              },
              node.type,
              node.apiKey
            ),
          () => runLive(run)
        );
        if (taken.aborted) {
          return { content: '', thinking: '', aborted: true, stats: {} };
        }
        return taken.result;
      };

      const first = await askModel(
        `${userContent}\n\nReviewer already cleared this step (no open fix tasks). Decide <next_step> only — do not edit files.`,
        []
      );
      if (first.aborted || !runLive(run)) return;
      if (first.stats?.evalCount) {
        const tokens = first.stats.evalCount + (first.stats.promptEvalCount || 0);
        if (node.type === 'openai' || node.apiKey) onRecordTokens(0, tokens);
        else onRecordTokens(tokens, 0);
      }
      notePromptSample(
        model,
        [
          { content: CONTINUATION_REVIEW_SYSTEM },
          { content: userContent }
        ],
        first.stats
      );

      const content = first.content;
      const reviewTools: ToolCall[] = [];
      const parsedDecision = parseNextStep(content);
      const durableFallback = (progressRef.current.bug || progressRef.current.next || '').trim();
      const filteredDecision = parsedDecision
        ? filterInspectionContinue(parsedDecision, durableFallback)
        : null;
      const steered = filteredDecision
        ? avoidRepeat(
            progressRef.current,
            filteredDecision.decision,
            filteredDecision.task,
            filteredDecision.options
          )
        : null;
      const decision = filteredDecision
        ? { ...filteredDecision, decision: steered!.decision, task: steered!.task, options: steered!.options }
        : null;
      const visible = parseResponse(content, agentMsgId, false).display || stripThinking(content);
      const prose = stripNextStepMarkup(stripPlanOptionMarkup(visible));
      let options = decision?.options || [];
      let display = steered?.note || prose || decision?.reason || '';
      let runTask = '';

      const repeatTask =
        (steered && isRepeatStop(steered.note) && (parsedDecision?.task || previousTask || '').trim()) || '';
      const similarTask =
        !repeatTask &&
        decision?.decision === 'continue' &&
        !!previousTask &&
        tasksTooSimilar(previousTask, decision.task)
          ? decision.task
          : '';
      const loopTask = stripKeepFixingPrefix(repeatTask || similarTask).trim();
      const recentWrites = latestStepWritePaths(messagesRef.current, [agentMsgId]);
      const stuckNow =
        !!loopTask &&
        shouldEscalateStuck({
          previousTask,
          nextTask: loopTask,
          recentWritePaths: recentWrites,
          priorWritePaths: priorStepWritePaths(messagesRef.current, [agentMsgId])
        });
      if (stuckNow) {
        handledLoop = true;
        const key = stuckKey(loopTask);
        const stage: StuckStage = resolveStuckStage(stuckRef.current, key);
        let step = nextStuckStage(stage);
        stuckRef.current = { key, stage };
        const stuckPayload = `${progressForPrompt()}\n\nStuck step:\n${loopTask}`;
        const coderRoute = latestCoderRoute(messagesRef.current, [agentMsgId]) || {
          nodeId: node.id,
          model
        };
        const sameRoute = (target?: { node: { id: string }; model: string } | null) =>
          !!target && escalationMatchesRoute(coderRoute, { nodeId: target.node.id, model: target.model });
        const coderPick = explicitRolePick(roleRoutesRef.current, 'coder');
        const coderNode = coderPick ? nodesRef.current.find(item => item.id === coderPick.nodeId) : undefined;
        const coderPickUsable = !!(
          coderPick &&
          coderNode?.online &&
          getEnabledModelsForNode(coderNode).includes(coderPick.model)
        );
        const coderPickRoute =
          coderPickUsable && coderNode && coderPick
            ? { node: coderNode, model: coderPick.model }
            : undefined;
        if (step === 'big') {
          const big = pickLargestLocalTarget(nodesRef.current);
          const bigIsPicked =
            !!coderPickRoute &&
            !!big &&
            escalationMatchesRoute(
              { nodeId: coderPickRoute.node.id, model: coderPickRoute.model },
              { nodeId: big.node.id, model: big.model }
            );
          if ((coderPickUsable && !bigIsPicked) || (big && sameRoute(big))) {
            // Same node+model, or a different model than the Coder pick, is not a silent jump.
            step = 'free';
          } else if (big) {
            stuckRef.current.stage = 'big';
            logRun({
              kind: 'escalate',
              text: `stuck big ${big.node.name} ${big.model}`,
              stepId: activeStepId()
            });
            handoff = true;
            nextTask = loopTask;
            pinFix = true;
            pinStuck = big;
            stuckForceRoute = true;
            runTask = loopTask;
            options = [];
            display = `Stuck repeating. Retrying on ${big.node.name} · ${big.model} (${big.node.hardware?.vramGB || 0} GB) with a different approach.`;
          } else {
            step = 'free';
          }
        }
        if (step === 'free') {
          const freeNode = pickFreeTierAssist(nodesRef.current, freeTierUsageFor);
          if (freeNode && sameRoute(freeNode)) {
            step = 'paid';
          } else {
          stuckRef.current.stage = 'free';
          logRun({
            kind: 'escalate',
            text: freeNode
              ? `stuck free ${freeNode.node.name} ${freeNode.model}`
              : 'stuck free',
            stepId: activeStepId()
          });
          let brief: string | null = null;
          try {
            brief = await requestFreeTierBrief(
              'The local models are repeating this step and not fixing it. Give one short solution. Do not rewrite the file.',
              stuckPayload
            );
          } catch (err: any) {
            hostLog('warn', `free-tier stuck: ${err?.message || err}`);
          }
          if (brief) {
            const big = pickLargestLocalTarget(nodesRef.current);
            display = `Free-tier solution:\n\n${brief}`;
            options = [{ id: 'copy-solution', title: 'Copy solution', description: brief, action: 'copy' }];
            const applyOn = coderPickRoute || big;
            if (applyOn && !sameRoute(applyOn)) {
              handoff = true;
              nextTask = `Apply this solution. Do not repeat the failed approach.\n\n${brief}`;
              pinFix = true;
              runTask = nextTask;
              if (coderPickRoute) {
                // Keep the explicit Coder pick instead of jumping to a larger local model.
                pinStuck = coderPickRoute;
                stuckForceRoute = true;
              } else if (big) {
                pinStuck = big;
                stuckForceRoute = true;
              }
            }
          } else {
            step = 'paid';
          }
          }
        }
        if (step === 'paid') {
          const paid = pickPaidFrontier(nodesRef.current);
          stuckRef.current.stage = 'paid';
          if (!(paid && sameRoute(paid))) {
          logRun({
            kind: 'escalate',
            text: paid ? `stuck paid ${paid.node.name} ${paid.model}` : 'stuck paid',
            stepId: activeStepId()
          });
          }
          const big = pickLargestLocalTarget(nodesRef.current);
          handoff = false;
          runTask = '';
          nextTask = '';
          pinStuck = undefined;
          pinFix = false;
          if (paid) {
            display = `Still stuck after the largest local model and the free tier. Confirm before a paid call to ${paid.node.name} · ${paid.model}, or retry locally with a different approach.`;
            options = [
              ...(big
                ? [
                    {
                      id: 'retry-local',
                      title: `Retry differently · ${big.model}`,
                      description: loopTask,
                      action: 'retry-local' as const
                    }
                  ]
                : []),
              {
                id: 'use-paid-api',
                title: `Use paid API · ${paid.model}`,
                description: loopTask,
                action: 'paid' as const
              },
              {
                id: 'stop-stuck',
                title: 'Stop — I will give a new instruction',
                description: loopTask,
                action: 'stop' as const
              }
            ];
          } else {
            // No paid node: do not dead-end — offer local retry + stop. Local planning never required frontier.
            display = big
              ? `Still stuck after local retries (free-tier assist unavailable or empty). No paid API is required — retry on ${big.node.name} · ${big.model} with a different approach, or send a concrete new instruction.`
              : 'Still stuck after local retries. No paid API is required. Send a concrete new instruction (file + what to change).';
            options = big
              ? [
                  {
                    id: 'retry-local',
                    title: `Retry differently · ${big.model}`,
                    description: loopTask,
                    action: 'retry-local' as const
                  },
                  {
                    id: 'stop-stuck',
                    title: 'Stop — I will give a new instruction',
                    description: loopTask,
                    action: 'stop' as const
                  }
                ]
              : [
                  {
                    id: 'stop-stuck',
                    title: 'Stop — I will give a new instruction',
                    description: loopTask,
                    action: 'stop' as const
                  }
                ];
          }
        }
      }

      if (!handledLoop && decision?.decision === 'continue' && !capped && !tasksTooSimilar(previousTask, decision.task)) {
        runTask = decision.task;
        display = display || `Continuing automatically.\n\n${decision.reason}`;
        options = [];
      } else if (!handledLoop && decision?.decision === 'continue') {
        display =
          display ||
          `${decision.reason}\n\nI can keep going with: ${decision.task}`;
        if (!options.length) {
          options = [
            {
              id: '1',
              title: 'Keep going',
              description: decision.task
            }
          ];
        }
      } else if (!handledLoop && decision?.decision === 'done') {
        display = display || decision.reason || 'The requested work looks complete.';
      } else if (!handledLoop && decision?.decision === 'ask') {
        display = display || decision.reason || 'Need a choice before continuing.';
      }

      if (runTask && !handledLoop) display = `Continuing — ${runTask}`;

      setMessages(prev =>
        prev.map(m =>
          m.id === agentMsgId
            ? {
                ...m,
                raw: content,
                display,
                toolCalls: reviewTools,
                ...(options.length
                  ? { planOptions: options, planSummary: buildPlanSummary(content, options) }
                  : {})
              }
            : m
        )
      );

      if (runTask && !handledLoop) {
        handoff = true;
        nextTask = runTask;
        pinFix = taskFixesWrittenFiles(runTask, touchedPaths);
        updateProgress(log => advanceNext(log, runTask));
      } else if (runTask && handledLoop) {
        updateProgress(log => advanceNext(log, runTask));
      } else if (options.length) {
        updateProgress(log => options.reduce((acc, option) => rememberAsked(acc, `${option.title}: ${option.description}`), log));
      }
      if (runLive(run)) {
      let finishNotice: string | null = null;
      if (!handledLoop && !runTask && (decision?.decision === 'done' || decision?.decision === 'ask' || options.length)) {
        finishNotice =
          decision?.decision === 'done' ? 'Work looks complete — optional next steps below' : 'Waiting for a choice';
      } else if (handledLoop && options.some(o => o.action === 'paid')) {
        finishNotice = 'Waiting for confirmation before a paid API call';
      }
      const autoFinished =
        !handoff &&
        !handledLoop &&
        !runTask &&
        !isPlanActive(plannerPlanRef.current) &&
        (decision?.decision === 'done' || capped);
      if (autoFinished) {
        const verifyNotice = await verifyTypescriptBeforeFinish(run);
        if (!runLive(run)) finishNotice = null;
        else if (verifyNotice) finishNotice = verifyNotice;
      }
      if (!runLive(run)) {
        /* Stopped during verify — leave the status line alone. */
      } else if (finishNotice) {
        logNoticeNow(finishNotice, run);
      } else if (!handoff) {
        setExecutingPlanNotice(null);
      }
      }
    } catch (err: any) {
      if (!runLive(run)) return;
      hostLog('error', `continuation check: ${err?.message || err}`);
      setMessages(prev =>
        prev.map(m =>
          m.id === agentMsgId
            ? {
                ...m,
                display: (m.display || '') + `\n\nCouldn't check the next step.`,
                error: err?.message || 'Could not check the next step.'
              }
            : m
        )
      );
      setExecutingPlanNotice(null);
    } finally {
      if (!handoff && runOwnsUi(run)) {
        setIsStreaming(false);
      }
    }

    if (!handoff || !runLive(run)) return;

    const stuckTarget = pinStuck;
    const running = stuckTarget;
    setExecutingPlanNotice(
      running
        ? `Retrying on ${running.node.name} · ${running.model} — ${nextTask.slice(0, 90)}`
        : `Continuing — ${nextTask.slice(0, 110)}`
    );
    const planPrefix = approvedPlanRef.current
      ? `${formatApprovedPlanContext(approvedPlanRef.current)}\n\n`
      : '';
    ephemeralWorkerRef.current = true;
    await runSingleNodeTurn({
      userText: `Continue: ${nextTask}`,
      fullPrompt: stuckTarget
        ? `${planPrefix}STUCK RETRY — you already repeated this step. Do NOT repeat the same approach. Use a different concrete <edit_file>/<write_file> fix, or stop and state the blocker in one sentence.\n\n${nextTask}`
        : pinFix
          ? `${planPrefix}NEXT STEP — fix the existing files with <edit_file>. Do not rewrite a file from scratch when a search/replace will do. Do not add a new feature.\n\n${nextTask}`
          : `${planPrefix}NEXT STEP — do this now, then stop. Do not expand into unrelated features.\n\n${nextTask}`,
      agent: coderAgent,
      planMode: false,
      approvedPlan: approvedPlanRef.current,
      notice: running
        ? `Stuck-loop retry on ${running.node.name} · ${running.model}`
        : pinFix
          ? `Fixing — ${nextTask.slice(0, 120)}`
          : `Continuing automatically — ${nextTask.slice(0, 140)}`,
      freshContext: true,
      run,
      ...(stuckTarget ? { pinRoute: stuckTarget, forceRoute: stuckForceRoute } : {})
    });
    if (!runLive(run)) {
      restorePlannerControl('Stopped — talk to Planner about what to do next.');
      return;
    }
    await reviewAndAdvance(depth + 1, nextTask, run);
    restorePlannerControl();
    } finally {
      leaveConductorRun(entered.owned, run.token);
    }
  };

  /**
   * After a coding step: Reviewer checks work.
   * - Active PlannerPlan → step Yay/Nay (reviewActiveStep).
   * - Legacy flat queue → review_delta / seed review_plan.
   */
  const reviewAndAdvance = async (
    depth: number,
    previousTask = '',
    parent?: ConductorRun | null
  ): Promise<void> => {
    const entered = bindRun(parent ?? null, false, 'review');
    if (!entered) return;
    const run = entered.run;
    const { logRun } = scopeRunLog();
    try {
    if (!runLive(run)) return;

    const livePlan = plannerPlanRef.current;
    // The review queue is mirrored into the plan panel. Its fix task is closed by the review_delta path.
    const reviewQueueMirror =
      !!executionQueueRef.current?.tasks.length &&
      (livePlan?.activeStepId === 'review-fixes' || !!livePlan?.id?.startsWith('plan-review-'));
    if (isPlanActive(livePlan) && !reviewQueueMirror) {
      await reviewActiveStep(run);
      return;
    }

    const recent = messagesRef.current;
    let userIdx = recent.length - 1;
    while (userIdx >= 0 && recent[userIdx].role !== 'user') userIdx -= 1;
    const sinceUser = recent.slice(Math.max(0, userIdx));
    const didWork =
      !!approvedPlanRef.current ||
      !!executionQueueRef.current ||
      sinceUser.some(m =>
        (m.pipelineSteps && m.pipelineSteps.length > 0) ||
        (m.toolCalls || []).some(t =>
          t.name === 'write_file' ||
          t.name === 'edit_file' ||
          t.name === 'run_command' ||
          t.name === 'generate_image'
        )
      );
    if (depth === 0 && !didWork) return;

    const target = roleTarget('reviewer', () => pickCapableReviewTarget(nodesRef.current));
    if (!target) {
      if (autoReviewOn()) await decideNextStepAndAdvance(depth, previousTask, run);
      return;
    }

    const touchedPaths = collectWrittenPaths(recent);
    const planText = approvedPlanRef.current
      ? formatApprovedPlanContext(approvedPlanRef.current)
      : '';
    const transcript = recent
      .slice(-6)
      .map(m => {
        const who = m.role === 'user' ? 'User' : m.personaHandle || 'Assistant';
        const text = (m.display || '').replace(/\s+/g, ' ').trim().slice(0, 500);
        return text ? `${who}: ${text}` : '';
      })
      .filter(Boolean)
      .join('\n');
    const filesHint = touchedPaths.length
      ? `Files just written/edited:\n${touchedPaths.slice(0, 12).join('\n')}`
      : 'No write/edit paths recorded — review the latest coding step from chat context.';
    setIsStreaming(true);
    const filesBody = await buildTouchedFilesContext(
      workspacePath,
      touchedPaths,
      reviewPreloadCaps(
        resolveModelFit(target.node, target.model, 'reviewer', reviewerAgent.numCtx).maxCtx
      )
    );
    if (!runLive(run)) {
      if (runOwnsUi(run)) setIsStreaming(false);
      return;
    }

    const existingQueue = executionQueueRef.current;
    const activeTask = getActiveTask(existingQueue);
    const deltaMode =
      !!existingQueue &&
      !!activeTask &&
      (activeTask.status === 'in_progress' || activeTask.status === 'failed');

    const reviewPrompt = deltaMode
      ? `${planText ? `${planText}\n\n` : ''}${formatQueueForReviewer(existingQueue!, activeTask!)}

${filesHint}

${filesBody || '(No file bodies loaded — at most two read_file calls, then verdict.)'}

Recent chat:
${transcript || '(none)'}

Work log:
${progressForPrompt() || '(empty)'}

Verify ONLY active task #${activeTask!.id}. End with <review_delta task_id="${activeTask!.id}">.
Do NOT emit a new <review_plan>. Do NOT write or edit files. Do not re-read files already shown above.`
      : `${planText ? `${planText}\n\n` : ''}## Post-step review (seed durable task list)
Check the work that just finished for bugs, broken wiring, and missing behavior.
${filesHint}

${filesBody || '(No file bodies loaded — at most two read_file calls, then emit <review_plan>.)'}

Recent chat:
${transcript || '(none)'}

Work log:
${progressForPrompt() || '(empty)'}

Prefer the file contents above. At most two extra reads, then end with a <review_plan> (tasks if fixes needed; summary-only if clean).
This list will be kept by Planner — do not expect to replace it later. Do NOT write or edit files.`;

    setExecutingPlanNotice(
      autoReviewOn()
        ? deltaMode
          ? `Reviewer verifying task #${activeTask!.id}…`
          : 'Reviewer checking the work…'
        : 'Reviewer checking — waiting for your approval after'
    );

    ephemeralWorkerRef.current = true;
    const reviewMsg = await runSingleNodeTurn({
      userText: deltaMode
        ? `Verify task #${activeTask!.id}: ${activeTask!.title}`
        : 'Review the latest coding step',
      fullPrompt: reviewPrompt,
      agent: reviewerAgent,
      reviewMode: true,
      skipUserAppend: true,
      notice: `Reviewer checking on ${target.node.name}`,
      pinRoute: target,
      freshContext: true,
      run
    });

    if (!runLive(run)) {
      restorePlannerControl('Stopped — talk to Planner about what to do next.');
      return;
    }

    const latestReview =
      reviewMsg ||
      [...messagesRef.current].reverse().find(
        m => m.role === 'assistant' && (m.personaHandle === 'reviewer' || m.reviewPlan)
      );
    const rawBlob = `${latestReview?.display || ''}\n${latestReview?.raw || ''}`;
    let missingReviewNoted = false;
    const noteMissingReviewVerdict = (waiting = false) => {
      if (missingReviewNoted) return;
      missingReviewNoted = true;
      logRun({
        kind: 'verdict',
        result: 'missing',
        text: 'Reviewer gave no verdict'
      });
      setExecutingPlanNotice(
        waiting ? MISSING_REVIEW_VERDICT_WAIT_NOTICE : MISSING_REVIEW_VERDICT_NOTICE
      );
    };

    // —— Delta path: update durable queue status; never reseed from a new full plan ——
    if (deltaMode && existingQueue && activeTask) {
      let delta = parseReviewDelta(latestReview?.raw || '');
      if (!delta) {
        const parsedPlan = latestReview ? parseReviewPlan(latestReview.raw || '') : null;
        const coerced = coerceDirtyReviewPlan(parsedPlan, rawBlob);
        const missingClean =
          nonPlanReviewLacksMarkup(latestReview?.raw || '') && coerced.tasks.length === 0;
        if (missingClean) noteMissingReviewVerdict(!autoReviewOn());
        if (coerced.tasks.length === 0) {
          delta = {
            taskId: activeTask.id,
            verdict: 'completed',
            notes: missingClean ? 'Reviewer gave no verdict.' : coerced.summary || 'Looks good.'
          };
        } else {
          delta = {
            taskId: activeTask.id,
            verdict: 'failed',
            notes:
              coerced.tasks.map(t => t.description).join(' ') ||
              coerced.summary ||
              'Active task not completed correctly.'
          };
        }
      }

      const updated = applyReviewDelta(existingQueue, {
        ...delta,
        taskId: delta.taskId || activeTask.id
      });
      commitExecutionQueue(updated);
      const snap = queueToReviewPlan(updated);

      if (latestReview) {
        setMessages(prev => {
          const next = prev.map(m =>
            m.id === latestReview.id
              ? {
                  ...m,
                  reviewPlan: snap,
                  reviewSentToCoder: false,
                  reviewNeedsContinue: !autoReviewOn()
                }
              : m
          );
          messagesRef.current = next;
          return next;
        });
      }

      const after = getActiveTask(updated) || updated.tasks.find(t => t.id === activeTask.id);
      const failed = after?.status === 'failed';
      const completed = after?.status === 'completed';

      if (failed) {
        if (autoReviewOn()) {
          await sendReviewPlanToPlanner(
            latestReview ? { ...latestReview, reviewPlan: snap } : null,
            depth,
            after?.failureNote,
            run
          );
          return;
        }
        pendingReviewResumeRef.current = { depth, previousTask };
        setExecutingPlanNotice(
          `Task #${activeTask.id} failed review — Send to Planner when ready`
        );
        return;
      }

      if (completed) {
        if (hasOpenTasks(updated)) {
          if (autoReviewOn()) {
            await sendReviewPlanToPlanner(null, depth, undefined, run);
            return;
          }
          pendingReviewResumeRef.current = { depth, previousTask };
          if (!missingReviewNoted) {
            setExecutingPlanNotice('Task done — Send to Planner for the next queued task');
          }
          return;
        }
        // Queue finished
        if (!autoReviewOn()) {
          if (latestReview) {
            setMessages(prev => {
              const next = prev.map(m =>
                m.id === latestReview.id
                  ? { ...m, reviewPlan: snap, reviewNeedsContinue: true }
                  : m
              );
              messagesRef.current = next;
              return next;
            });
          }
          pendingReviewResumeRef.current = { depth, previousTask };
          if (!missingReviewNoted) {
            setExecutingPlanNotice('All review tasks done — click Looks good / Continue');
          }
          return;
        }
        await decideNextStepAndAdvance(depth, previousTask, run);
        return;
      }
    }

    // —— Seed path: first review creates the durable list once ——
    const parsedPlan = latestReview ? parseReviewPlan(latestReview.raw || '') : null;
    let plan = coerceDirtyReviewPlan(parsedPlan, rawBlob);
    if (nonPlanReviewLacksMarkup(latestReview?.raw || '') && plan.tasks.length === 0) {
      noteMissingReviewVerdict(!autoReviewOn());
      plan = { summary: 'Reviewer gave no verdict.', tasks: [] };
    }

    if (plan.tasks.length > 0) {
      // Keep an existing unfinished queue; only seed when empty
      if (!hasOpenTasks(executionQueueRef.current)) {
        const seeded = createQueueFromReviewPlan(plan, latestReview?.id);
        commitExecutionQueue(seeded);
      }
      const snap = queueToReviewPlan(executionQueueRef.current!);
      if (latestReview) {
        setMessages(prev => {
          const next = prev.map(m =>
            m.id === latestReview.id ? { ...m, reviewPlan: snap } : m
          );
          messagesRef.current = next;
          return next;
        });
      }
      const planMsg = latestReview
        ? { ...latestReview, reviewPlan: snap }
        : null;

      if (autoReviewOn()) {
        await sendReviewPlanToPlanner(planMsg, depth, undefined, run);
        return;
      }
      pendingReviewResumeRef.current = { depth, previousTask };
      setExecutingPlanNotice('Review found issues — Send to Planner when ready');
      return;
    }

    if (
      latestReview &&
      (!latestReview.reviewPlan ||
        latestReview.reviewPlan.tasks.length !== plan.tasks.length ||
        latestReview.reviewPlan.summary !== plan.summary)
    ) {
      setMessages(prev => {
        const next = prev.map(m => (m.id === latestReview.id ? { ...m, reviewPlan: plan } : m));
        messagesRef.current = next;
        return next;
      });
    }

    const planMsg = latestReview ? { ...latestReview, reviewPlan: plan } : null;

    if (!autoReviewOn()) {
      if (planMsg) {
        setMessages(prev => {
          const next = prev.map(m =>
            m.id === planMsg.id
              ? { ...m, reviewPlan: plan, reviewNeedsContinue: true }
              : m
          );
          messagesRef.current = next;
          return next;
        });
      }
      pendingReviewResumeRef.current = { depth, previousTask };
      if (!missingReviewNoted) {
        setExecutingPlanNotice('Review looks clean — click Looks good / Continue');
      }
      return;
    }

    await decideNextStepAndAdvance(depth, previousTask, run);
    } finally {
      leaveConductorRun(entered.owned, run.token);
    }
  };

  const coderWriteTools = (): ToolCall[] => {
    const msg = [...messagesRef.current].reverse().find(
      m =>
        m.role === 'assistant' &&
        (m.toolCalls || []).some(t => t.name === 'write_file' || t.name === 'edit_file')
    );
    return (msg?.toolCalls || []).filter(t => t.name === 'write_file' || t.name === 'edit_file');
  };

  const writesUnresolved = (tools: ToolCall[]) =>
    tools.length > 0 && tools.every(t => t.status !== 'done');

  const isWriteTool = (name: string) => name === 'write_file' || name === 'edit_file';

  const unresolvedWriteNotes = (tools: ToolCall[]) =>
    nayNotesFromToolErrors(
      tools.map(tool => {
        const path = tool.args?.path ? ` ${tool.args.path}` : '';
        const detail = String(tool.result || tool.status || 'pending').replace(/\s+/g, ' ').trim();
        return `${tool.name}${path}: ${detail}`;
      })
    );

  /** Writes from this coder turn, including tool-continuation follow-ups after the origin id. */
  const writeToolsFromCoderOrigin = (origin: ChatMessage | undefined): ToolCall[] => {
    if (!origin) return [];
    const slice = messagesFromOrigin(messagesRef.current, origin.id);
    const pool = slice.length ? slice : [origin];
    const withOrigin = pool.some(message => message.id === origin.id) ? pool : [origin, ...pool];
    return withOrigin.flatMap(message => (message.toolCalls || []).filter(tool => isWriteTool(tool.name)));
  };

  /** Swarm step cards carry the file result. A card that did not complete counts as an unresolved write. */
  const writeToolsFromPipeline = (message: ChatMessage | undefined): ToolCall[] => {
    const tools: ToolCall[] = [];
    for (const step of message?.pipelineSteps || []) {
      const writes = (step.toolCalls || []).filter(tool => isWriteTool(tool.name));
      if (writes.length) {
        tools.push(...writes);
        continue;
      }
      if (step.status === 'completed') continue;
      tools.push({
        id: `swarm-${step.targetFile || step.nodeId}`,
        name: 'write_file',
        args: { path: step.targetFile || '' },
        status: step.status === 'failed' ? 'error' : 'pending',
        result: step.content || 'Swarm worker did not finish the file'
      });
    }
    return tools;
  };

  const snapshotStepFiles = async (stepId: string, rels: string[]) => {
    if (!workspacePath || !window.electronAPI?.readFile) return;
    const sep = workspacePath.includes('\\') ? '\\' : '/';
    const root = workspacePath.replace(/[\\/]+$/, '');
    let used = 0;
    for (const [id, files] of stepSnapshotsRef.current) {
      if (id === String(stepId)) continue;
      for (const file of files) used += file.content.length;
    }
    const next: { path: string; content: string }[] = [];
    for (const rel of rels) {
      const norm = rel.replace(/\\/g, '/').replace(/^\.\//, '');
      if (!norm || norm.split('/').includes('..')) continue;
      const room = STEP_SNAPSHOT_CAP - used;
      if (room <= 0) break;
      try {
        const abs = `${root}${sep}${norm.replace(/\//g, sep)}`;
        const res = await window.electronAPI.readFile(abs);
        if (typeof res?.content !== 'string') continue;
        if (res.content.length > room) break;
        next.push({ path: norm, content: res.content });
        used += res.content.length;
      } catch {
        /* missing file — nothing to restore */
      }
    }
    stepSnapshotsRef.current.set(String(stepId), next);
  };

  /** Dispatch the active Planner step to Coders (sequential single-node or Swarm for the step). */
  const dispatchActiveStep = async (
    parent?: ConductorRun | null,
    opts?: { coderRetry?: boolean }
  ): Promise<void> => {
    const entered = bindRun(parent ?? null, false, 'coder');
    if (!entered) {
      if (parent && runOwnsUi(parent)) setPlanPaused(true);
      return;
    }
    const run = entered.run;
    const { logRun } = scopeRunLog();
    try {
    if (!runLive(run)) {
      if (runOwnsUi(run)) setPlanPaused(true);
      return;
    }
    let plan = plannerPlanRef.current;
    if (!plan || plan.status !== 'active') return;

    let step = getActiveStep(plan);
    if (!step || step.status === 'completed' || step.status === 'failed' || step.status === 'abandoned') {
      plan = activateNextStep(plan);
      await commitPlannerPlan(plan, run.token);
      if (!runLive(run)) return;
      if (plan.status === 'completed') {
        setExecutingPlanNotice('Planner plan complete.');
        return;
      }
      step = getActiveStep(plan);
    }
    if (!step || step.status === 'failed' || step.status === 'abandoned') return;

    plan = markStepInProgress(plan, step.id);
    await commitPlannerPlan({ ...plan, resumePhase: 'coder', updatedAt: Date.now() }, run.token);
    if (!runLive(run)) return;
    step = getActiveStep(plannerPlanRef.current)!;
    if (!step) return;

    ephemeralWorkerRef.current = true;
    onSelectAgent(coderAgent.id);
    onConversationPatch?.({ agentId: coderAgent.id });

    resetAgentLoopBudget();

    // Cleared-context Coders need the named file bodies (e.g. app.js) in the packet —
    // titles alone caused incomplete edits → Reviewer Nay → infinite rework loops.
    const stepFiles = collectStepFilePaths(step);
    await snapshotStepFiles(String(step.id), stepFiles);
    if (!runLive(run)) return;
    const recentWrites = collectWrittenPaths(messagesRef.current);
    const coderRoute = resolveRoute(`Implement plan step #${step.id}: ${step.title}`, coderAgent);
    const coderFit = coderRoute
      ? resolveModelFit(
          coderRoute.routedNode,
          coderRoute.routedModel,
          'coder',
          coderAgent.numCtx
        )
      : null;
    const filesBody = await buildTouchedFilesContext(
      workspacePath,
      [...stepFiles, ...recentWrites],
      coderFit?.caps || {
        maxFiles: 10,
        maxCharsPerFile: 12000,
        maxTotalChars: 48000
      }
    );
    if (!runLive(run)) return;
    const packing = coderFit?.packingLine ? `\n\n${coderFit.packingLine}` : '';
    const coderPrompt = `${formatStepForCoders(plan, step)}${packing}

${
  filesBody ||
  '(No file bodies preloaded — call read_file once for each path you must change, then edit_file/write_file.)'
}

Work log:
${progressForPrompt() || '(empty)'}`;
    setExecutingPlanNotice(
      coderFit
        ? `Coder(s) on step #${step.id}: ${step.title} · ${coderFit.tier} · ${coderFit.maxCtx} ctx…`
        : `Coder(s) on step #${step.id}: ${step.title}…`
    );

    try {
      let turnWrites: ToolCall[] = [];
      if (isPipelineMode && stepFiles.length > 0) {
        const pipelineId = await handleSendPipelineMessage(`Plan step #${step.id}: ${step.title}`, coderPrompt, {
          approvedPlan: approvedPlanRef.current,
          skipUserAppend: true,
          run,
          stepDispatch: {
            files: stepFiles,
            brief: formatStepForCoders(plan, step)
          }
        });
        const pipelineMsg = pipelineId
          ? messagesRef.current.find(message => message.id === pipelineId)
          : undefined;
        turnWrites = writeToolsFromPipeline(pipelineMsg);
      } else {
        const coderMsg = await runSingleNodeTurn({
          userText: `Implement plan step #${step.id}: ${step.title}`,
          fullPrompt: coderPrompt,
          agent: coderAgent,
          planMode: false,
          approvedPlan: approvedPlanRef.current,
          skipUserAppend: true,
          notice: `Coder implementing step #${step.id}`,
          freshContext: true,
          primaryFile: stepFiles.length === 1 ? stepFiles[0] : undefined,
          run
        });
        turnWrites = coderMsg
          ? writeToolsFromCoderOrigin(coderMsg)
          : [
              {
                id: `coder-unfinished-${step.id}`,
                name: 'write_file',
                args: { path: stepFiles[0] || '' },
                status: 'error',
                result: 'Coder turn did not finish'
              }
            ];
      }
      coderTurnWritesRef.current = { stepId: String(step.id), tools: turnWrites };

      if (!runLive(run)) {
        if (runOwnsUi(run)) {
          setPlanPaused(true);
          setPlanResumePhase('coder', run.token);
          restorePlannerControl(
            `Paused during Coder on step #${step.id} — press Play to resume.`
          );
        }
        return;
      }

      const activeNow = getActiveStep(plannerPlanRef.current);
      if (!activeNow || String(activeNow.id) !== String(step.id)) {
        if (runOwnsUi(run)) {
          setPlanPaused(true);
          restorePlannerControl(
            `Step #${step.id} was skipped or replaced while its Coder ran. Press Play for the active step.`
          );
        }
        return;
      }

      if (writesUnresolved(turnWrites)) {
        if (fullAutoRef.current && runLive(run)) {
          if (!opts?.coderRetry && takeCoderRedispatchOnce(String(step.id))) {
            setPlanPaused(false);
            setExecutingPlanNotice(`Full auto: retrying Coder on step #${step.id}…`);
            await dispatchActiveStep(run, { coderRetry: true });
            if (!runLive(run)) {
              giveBackCoderRedispatch(String(step.id));
              if (runOwnsUi(run)) setPlanPaused(true);
            }
            return;
          }
          setPlanPaused(false);
          logRun({
            kind: 'info',
            stepId: String(step.id),
            text: 'Full auto: Nay because coder writes failed'
          });
          await applyStepVerdictAndContinue(
            null,
            {
              stepId: String(step.id),
              stepTitle: step.title,
              result: 'nay',
              notes: unresolvedWriteNotes(turnWrites)
            },
            run
          );
          return;
        }
        setPlanResumePhase('coder', run.token);
        setPlanPaused(true);
        restorePlannerControl(
          `Coder writes failed or are still pending on step #${step.id}. Press Play to run the Coder again.`
        );
        return;
      }

      // Tasks stay pending until a parsed Yay. Review is the gate.
      plan = plannerPlanRef.current;
      if (plan && step) {
        await commitPlannerPlan({ ...plan, resumePhase: 'review', updatedAt: Date.now() }, run.token);
      } else {
        setPlanResumePhase('review', run.token);
      }
      if (!runLive(run)) return;
      await reviewActiveStep(run);
    } catch (err: any) {
      if (runOwnsUi(run)) {
        setPlanPaused(true);
        setPlanResumePhase('coder', run.token);
        restorePlannerControl(`Coder step failed: ${err?.message || err}`);
      }
      throw err;
    }
    } finally {
      leaveConductorRun(entered.owned, entered.run.token);
    }
  };

  /** Reviewer Yay/Nay on the active Planner step. `parent` is the conductor run that owns this review. */
  const reviewActiveStep = async (parent?: ConductorRun | null): Promise<void> => {
    const { logRun } = scopeRunLog();
    if (parent && !runLive(parent)) return;
    if (!parent && stopRequestedRef.current) return;
    const plan = plannerPlanRef.current;
    const step = getActiveStep(plan);
    if (!plan || !step) {
      if (plan?.status === 'completed') {
        setExecutingPlanNotice('Planner plan complete.');
      }
      return;
    }
    setPlanResumePhase('review');

    const target = roleTarget('reviewer', () => pickCapableReviewTarget(nodesRef.current));
    if (!target) {
      setExecutingPlanNotice('No reviewer-capable node online for step verdict.');
      return;
    }

    const stepFiles = collectStepFilePaths(step);
    const touchedPaths = collectWrittenPaths(messagesRef.current);
    const reviewPaths = [...touchedPaths, ...stepFiles];
    const filesHint = reviewPaths.length
      ? `Files to verify:\n${reviewPaths.slice(0, 24).join('\n')}`
      : 'Review from chat context and the step task list.';
    const reviewFrame = beginActivity('review', `Reviewer on step #${step.id}`, step.title);
    const reviewFit = resolveModelFit(target.node, target.model, 'reviewer', reviewerAgent.numCtx);
    setIsStreaming(true);
    const filesBody = await buildTouchedFilesContext(
      workspacePath,
      reviewPaths,
      reviewPreloadCaps(
        reviewFit.maxCtx,
        reviewFit.tier === 'tight' ? reviewFit.caps.maxFiles : 16
      )
    );
    if ((parent && !runLive(parent)) || (!parent && stopRequestedRef.current)) {
      if (!parent || runOwnsUi(parent)) {
        setIsStreaming(false);
        endActivity(reviewFrame);
      }
      return;
    }

    // Soft pre-check: placeholder / planner prose in touched files → force Nay notes
    const placeholderHits: string[] = [];
    for (const block of (filesBody || '').split(/---+\s*/)) {
      if (looksLikePlaceholderCode(block) || looksLikePlannerProse(block)) {
        const pathLine = block.match(/`([^`]+)`/)?.[1] || 'file';
        placeholderHits.push(pathLine);
      }
    }

    const reviewPrompt = `${formatStepForReviewer(plan, step)}

${filesHint}

${filesBody || '(No file bodies loaded — use at most two read_file calls, then verdict.)'}

Work log:
${progressForPrompt() || '(empty)'}

Compatibility rules for this step:
- Nay if files contain planner/reviewer prose, Intent Analysis, or obvious stubs (Placeholder for actual, empty TODOs).
- Nay if imports/types disagree across the files above (duplicate parallel modules for the same concern).
- Yay only if the step's tasks are concretely implemented — not sketched.
${placeholderHits.length ? `\nStudio pre-scan found likely stubs/prose in: ${placeholderHits.slice(0, 8).join(', ')}. Prefer Nay unless those are false positives.\n` : ''}
After reviewing the files above, emit <step_verdict> immediately. Do not re-read the same paths.`;

    ephemeralWorkerRef.current = true;
    onSelectAgent(reviewerAgent.id);
    onConversationPatch?.({ agentId: reviewerAgent.id });
    setExecutingPlanNotice(
      autoReviewOn()
        ? `Reviewer Yay/Nay on step #${step.id}…`
        : `Reviewer checking step #${step.id} — waiting for your approval`
    );

    const reviewMsg = await runSingleNodeTurn({
      userText: `Verify plan step #${step.id}: ${step.title}`,
      fullPrompt: reviewPrompt,
      agent: reviewerAgent,
      reviewMode: true,
      stepVerdictMode: true,
      skipUserAppend: true,
      notice: `Reviewer on ${target.node.name} — step #${step.id}`,
      pinRoute: target,
      freshContext: true,
      ...(parent ? { run: parent } : {})
    });

    if (parent ? !runLive(parent) : stopRequestedRef.current) {
      if (!parent || runOwnsUi(parent)) endActivity(reviewFrame);
      if (!parent || runOwnsUi(parent)) {
        setPlanPaused(true);
        setPlanResumePhase('review');
        restorePlannerControl(
          `Paused during Review on step #${step.id} — press Play to resume.`
        );
      }
      return;
    }
    endActivity(reviewFrame);

    const located = reviewMsg ? messagesFromOrigin(messagesRef.current, reviewMsg.id) : [];
    const pool =
      reviewMsg && !located.some(message => message.id === reviewMsg.id)
        ? [...located, reviewMsg]
        : located.length
          ? located
          : reviewMsg
            ? [reviewMsg]
            : [];
    const explicit = pickExplicitStepVerdict(pool, step.id);
    const host = explicit?.message || newestReviewerMessage(pool) || reviewMsg;
    const loose = explicit ? null : parseStepVerdict(host?.raw || '', { allowMissing: true });
    const looseFits =
      !!loose &&
      (loose.result === 'yay' || loose.result === 'nay') &&
      (!loose.stepId || String(loose.stepId) === String(step.id));
    const parsedVerdict = explicit
      ? explicit.parsed
      : looseFits && loose
        ? { stepId: String(step.id), result: loose.result, notes: loose.notes }
        : {
            stepId: String(step.id),
            result: 'missing' as const,
            notes: loose?.notes || 'Missing <step_verdict> markup. Ask for an explicit yay or nay.'
          };

    const acceptVerdict = async (
      message: ChatMessage | undefined,
      verdict: { stepId: string; result: 'yay' | 'nay'; notes: string }
    ) => {
      const packed = {
        stepId: String(step.id),
        stepTitle: step.title,
        result: verdict.result,
        notes: verdict.notes
      };
      const withVerdict = message
        ? {
            ...message,
            stepVerdict: packed,
            stepVerdictNeedsConfirm: !autoReviewOn(),
            stepVerdictApplied: false
          }
        : null;
      if (message && withVerdict) {
        setMessages(prev => {
          const next = prev.map(m => (m.id === message.id ? withVerdict : m));
          messagesRef.current = next;
          return next;
        });
      }
      if (!autoReviewOn()) {
        setPlanResumePhase('verdict');
        setPlanPaused(true);
        restorePlannerControl(
          packed.result === 'yay'
            ? `Step #${step.id} Yay — Accept on the card or press Play to continue`
            : `Step #${step.id} Nay — Accept on the card or press Play to send fixes to Coder`
        );
        return;
      }
      if (!parent || !runLive(parent)) {
        if (!parent || runOwnsUi(parent)) setPlanPaused(true);
        return;
      }
      setPlanPaused(false);
      await applyStepVerdictAndContinue(withVerdict, packed, parent);
      if (!runLive(parent)) {
        if (runOwnsUi(parent)) setPlanPaused(true);
        return;
      }
      restorePlannerControl();
    };

    const nayFromReviewer = async (message: ChatMessage | undefined) => {
      logRun({
        kind: 'info',
        stepId: String(step.id),
        text: 'Full auto: Nay from reviewer prose'
      });
      await acceptVerdict(message, {
        stepId: String(step.id),
        result: 'nay',
        notes: nayNotesFromReviewerProse(`${message?.display || ''}\n${message?.raw || ''}`)
      });
    };

    if (!parsedVerdict || parsedVerdict.result === 'missing') {
      if (fullAutoRef.current && parent && runLive(parent)) {
        if (verdictReaskAllowed(String(step.id))) {
          setPlanPaused(false);
          setExecutingPlanNotice(
            `Full auto: asking the reviewer again for a Pass or Fail on step #${step.id}…`
          );
          const again = await runSingleNodeTurn({
            userText: VERDICT_REASK_PROMPT,
            fullPrompt: VERDICT_REASK_PROMPT,
            agent: reviewerAgent,
            reviewMode: true,
            stepVerdictMode: true,
            skipUserAppend: true,
            notice: `Reviewer re-ask — step #${step.id}`,
            logPhase: 'verdict-reask',
            pinRoute: target,
            freshContext: true,
            run: parent
          });
          if (!runLive(parent)) {
            if (runOwnsUi(parent)) {
              setPlanPaused(true);
              setPlanResumePhase('review');
              restorePlannerControl(
                `Paused during Review on step #${step.id} — press Play to resume.`
              );
            }
            return;
          }
          markVerdictReasked(String(step.id));
          const againLocated = again ? messagesFromOrigin(messagesRef.current, again.id) : [];
          const againPool =
            again && !againLocated.some(message => message.id === again.id)
              ? [...againLocated, again]
              : againLocated.length
                ? againLocated
                : again
                  ? [again]
                  : pool;
          const againExplicit = pickExplicitStepVerdict(againPool, step.id);
          if (againExplicit) {
            await acceptVerdict(againExplicit.message, againExplicit.parsed);
            return;
          }
          await nayFromReviewer(newestReviewerMessage(againPool) || again || host);
          return;
        }
        await nayFromReviewer(host);
        return;
      }

      logRun({
        kind: 'verdict',
        result: 'missing',
        text: parsedVerdict?.notes || '',
        stepId: String(step.id)
      });
      const planNow = plannerPlanRef.current;
      if (planNow) {
        const held = transition(planNow, {
          type: 'VERDICT',
          result: 'missing',
          stepId: step.id,
          notes: parsedVerdict?.notes
        });
        await commitPlannerPlan(held.plan, parent?.token);
      }
      if ((parent && !runLive(parent)) || (!parent && stopRequestedRef.current)) return;
      if (host) {
        setMessages(prev => {
          const next = prev.map(m =>
            m.id === host.id
              ? {
                  ...m,
                  display:
                    'The reviewer did not give an explicit Pass or Fail. Send a yay or nay, or press Play to ask again. Accept applies a verdict card once one is shown; otherwise send fixes.',
                  notice: 'Explicit Pass/Fail required'
                }
              : m
          );
          messagesRef.current = next;
          return next;
        });
      }
      setPlanPaused(true);
      restorePlannerControl(
        `Step #${step.id} needs an explicit Pass or Fail. Accept the verdict card, or send fixes.`
      );
      return;
    }

    if (parsedVerdict.result !== 'yay' && parsedVerdict.result !== 'nay') {
      return;
    }
    await acceptVerdict(explicit?.message || host, {
      stepId: String(step.id),
      result: parsedVerdict.result,
      notes: parsedVerdict.notes
    });
  };

  /** Collect distinct Reviewer Nay notes for a step from chat history. */
  const collectStepNayNotes = (stepId: string): string[] => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const m of messagesRef.current) {
      const v = m.stepVerdict;
      if (!v || v.result !== 'nay') continue;
      if (v.stepId && String(v.stepId) !== String(stepId)) continue;
      const note = (v.notes || '').replace(/\s+/g, ' ').trim();
      if (!note || note.toLowerCase() === 'nay') continue;
      const key = note.slice(0, 160).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(note.slice(0, 600));
    }
    return out;
  };

  /** Durable step.reworkCount, plus chat history for plans saved before reworkCount existed. */
  const effectiveStepReworkCount = (
    stepId: string,
    stepRework?: number
  ): number => {
    const fromChat = messagesRef.current.filter(
      m =>
        m.stepVerdict?.result === 'nay' &&
        !!m.stepVerdict.stepId &&
        String(m.stepVerdict.stepId) === String(stepId)
    ).length;
    return Math.max(
      stepRework || 0,
      stepReworkCountRef.current[String(stepId)] || 0,
      fromChat
    );
  };

  /**
   * After Nay rework cap: Planner appends focused fix steps, then Coder continues.
   * Preserves later pending steps (does not use appendPlannerPlan).
   */
  const escalateStepToPlannerFixes = async (
    stepId: string,
    parent?: ConductorRun | null
  ): Promise<void> => {
    if (parent && !runLive(parent)) {
      if (runOwnsUi(parent)) setPlanPaused(true);
      return;
    }
    if (!parent && stopRequestedRef.current) return;
    let plan = plannerPlanRef.current;
    if (!plan) return;
    const stuck =
      plan.steps.find(s => String(s.id) === String(stepId)) || getActiveStep(plan);
    if (!stuck) {
      restorePlannerControl(`No step #${stepId} to escalate.`);
      return;
    }

    const nayNotes = collectStepNayNotes(String(stuck.id));
    if (stuck.reviewNote) {
      const last = stuck.reviewNote.replace(/\s+/g, ' ').trim();
      if (last && !nayNotes.some(n => n.slice(0, 80) === last.slice(0, 80))) {
        nayNotes.unshift(last.slice(0, 600));
      }
    }
    const reworkCount = effectiveStepReworkCount(String(stuck.id), stuck.reworkCount);
    const escalations = plan.escalationCount || 0;
    // Cap, or step is already a Fix pass → compiler heal (no redundant Fix: steps).
    if (stuck.blockerKind === 'review' && plan.lastVerifyOk) {
      if (fullAutoRef.current && parent && runLive(parent)) {
        await deferFailedStepAndContinue(
          String(stuck.id),
          `Step #${stuck.id} failed review. Verify is green, so the step stays failed and is kept as debt.`,
          parent
        );
        return;
      }
      setPlanPaused(true);
      restorePlannerControl(
        `Step #${stuck.id} failed review. Verify is green, so the step stays failed — Retry it or send fixes.`
      );
      return;
    }
    if (
      escalations >= MAX_PLAN_ESCALATIONS ||
      plan.steps.length >= MAX_PLAN_STEPS ||
      stepLooksLikeFixStep(stuck.title) ||
      notesLookLikeVerifyFailure(stuck.reviewNote || nayNotes[0] || '')
    ) {
      setExecutingPlanNotice(
        `Step #${stuck.id} needs a compiler heal (no new Fix steps)…`
      );
      commitPlannerPlan({
        ...plan,
        blockedReason:
          plan.blockedReason ||
          `Heal needed on step #${stuck.id} — fix steps would be redundant.`,
        resumePhase: 'coder',
        activeStepId: stuck.id,
        updatedAt: Date.now()
      });
      logRun({
        kind: 'info',
        stepId: String(stuck.id),
        text: 'Escalate redirected to compiler heal'
      });
      await healBlockedPlan();
      return;
    }

    setPlanPaused(false);
    logRun({
      kind: 'escalate',
      stepId: String(stuck.id),
      text: `Step #${stuck.id} after ${reworkCount} Nays — Planner fix steps`
    });
    const escalationFrame = beginActivity(
      'escalate',
      `Escalating step #${stuck.id}`,
      `${reworkCount} Nays → Planner fix steps`
    );
    const escalationConversationId = conversationIdRef.current;
    const escalationRun = runRef.current;
    /** A Send after Stop clears the stop flag; that newer run now owns the plan controls. */
    const newerRunHolds = () => heldRef.current && runRef.current !== escalationRun;
    /** Stop clears the stack, and a newer run may have pushed its own frame since. */
    const endEscalationActivity = () => endActivity(escalationFrame);
    setExecutingPlanNotice(
      `Step #${stuck.id} hit ${reworkCount} Nays — Planner appending fix steps…`
    );

    const prompt = formatReworkEscalationForPlanner({
      planPanel: formatPlanForPanel(plan),
      stepId: String(stuck.id),
      stepTitle: stuck.title,
      stepDescription: stuck.description,
      reworkCount,
      nayNotes
    });

    ephemeralWorkerRef.current = true;
    onSelectAgent(plannerAgent.id);
    onConversationPatch?.({ agentId: plannerAgent.id });

    const lockMsg = await runSingleNodeTurn({
      userText: `Escalate step #${stuck.id} — append fix steps`,
      fullPrompt: prompt,
      agent: plannerAgent,
      lockPlanMode: true,
      skipUserAppend: true,
      notice: `Planner escalating step #${stuck.id} after ${reworkCount} Nays`,
      freshContext: true,
      ...(parent ? { run: parent } : {})
    });

    if (
      stopRequestedRef.current ||
      (escalationRun && !runIsCurrent(escalationRun.token)) ||
      newerRunHolds() ||
      conversationIdRef.current !== escalationConversationId
    ) {
      endEscalationActivity();
      if (conversationIdRef.current !== escalationConversationId || newerRunHolds()) return;
      setPlanPaused(true);
      setPlanResumePhase('coder');
      restorePlannerControl(
        `Paused during Planner escalation on step #${stuck.id} — press Play to resume.`
      );
      return;
    }

    const raw = lockMsg?.raw || '';
    let parsed = parseExecutionPlan(raw);
    if (!parsed?.steps.length) {
      const focus =
        nayNotes[0]?.slice(0, 200) ||
        stuck.reviewNote?.slice(0, 200) ||
        stuck.title;
      parsed = {
        summary: `Fixes for step #${stuck.id}`,
        steps: [
          {
            id: `fix-${stuck.id}`,
            title: `Fix: ${stuck.title}`,
            description: focus,
            tasks: [
              {
                id: `fix-${stuck.id}a`,
                title: `Address Reviewer Nays on step #${stuck.id}`,
                description: nayNotes.join('\n\n').slice(0, 1500) || focus
              }
            ]
          }
        ]
      };
    }

    plan = plannerPlanRef.current;
    if (!plan) {
      endEscalationActivity();
      return;
    }
    const before = plan.steps.length;
    plan = insertFixStepsAfter(
      plan,
      String(stuck.id),
      { summary: parsed.summary, steps: parsed.steps },
      { reworkNays: reworkCount }
    );
    if (plan.steps.length === before) {
      // Title already on the plan (e.g. "Core game logic … fix") — heal in place.
      endEscalationActivity();
      commitPlannerPlan({
        ...plannerPlanRef.current!,
        blockedReason: `Heal needed on step #${stuck.id} — a new Fix step would duplicate work already on the plan.`,
        resumePhase: 'coder',
        activeStepId: stuck.id,
        updatedAt: Date.now()
      });
      setExecutingPlanNotice(
        `Step #${stuck.id}: Fix step would duplicate — running compiler heal…`
      );
      await healBlockedPlan();
      return;
    }
    commitPlannerPlan(plan);
    endEscalationActivity();

    const next = getActiveStep(plan);
    setExecutingPlanNotice(
      next
        ? `Planner appended fix steps — starting #${next.id}: ${next.title}…`
        : 'Planner appended fix steps — continuing…'
    );
    await dispatchActiveStep(parent);
    if (parent && !runLive(parent) && runOwnsUi(parent)) setPlanPaused(true);
  };

  /** Blank index.html or unwired Tailwind is a failed web build even when tsc exits 0. */
  const readWebEntryBlocker = async (): Promise<string> => {
    const delivery = projectBrainRef.current.delivery || plannerPlanRef.current?.delivery;
    if (delivery && delivery !== 'web') return '';
    if (!workspacePath || !window.electronAPI?.readFile) return '';
    const root = workspacePath.replace(/[\\/]+$/, '');
    const sep = root.includes('\\') ? '\\' : '/';
    const read = async (rel: string) => {
      try {
        const res = await window.electronAPI.readFile(`${root}${sep}${rel.replace(/\//g, sep)}`);
        return res?.content || '';
      } catch {
        return '';
      }
    };
    const indexHtml = await read('index.html');
    if (!indexHtml) return '';
    const css = `${await read('src/index.css')}\n${await read('index.css')}`;
    let sourceSample = '';
    const files = await listSourceFolderFiles(workspacePath);
    for (const rel of files.filter(f => /\.(tsx|jsx)$/i.test(f)).slice(0, 8)) {
      sourceSample += `\n${await read(rel)}`;
      if (sourceSample.length > 80000) break;
    }
    return webEntryVerifyErrors({
      delivery: delivery || 'web',
      indexHtml,
      css,
      sourceSample
    });
  };

  /**
   * Project tsc without `npx`. Use the workspace compiler when it is installed,
   * otherwise Studio's bundled tsc. Missing modules fail with an install hint.
   */
  const runTypescriptVerify = async (): Promise<string> => {
    const bins = ['node_modules/.bin/tsc.cmd', 'node_modules/.bin/tsc', 'node_modules/typescript/bin/tsc'];
    let bin = '';
    if (workspacePath && window.electronAPI?.execTool) {
      for (const rel of bins) {
        try {
          const probe = await window.electronAPI.execTool(workspacePath, 'exists', { path: rel });
          if (probe?.exists) {
            bin = rel;
            break;
          }
        } catch {
          /* try the next shim */
        }
      }
    }
    if (bin) return executeTrackedCommand(localTscPowerShellCommand(bin));
    if (!workspacePath || !window.electronAPI?.typecheckWorkspace) {
      return `Exit code: 1\n${DEPENDENCY_RETRY_MESSAGE}`;
    }
    const check = await window.electronAPI.typecheckWorkspace(workspacePath, {
      mode: 'workspace',
      timeoutMs: 90000
    });
    const body = annotateMissingDependencies(check.output || check.error || '');
    if (check.skipped) return body || 'No tsconfig.json in workspace — skipped full project typecheck';
    if (check.ok) return body ? `Exit code: 0\n${body}` : 'Exit code: 0';
    const withCode = /Exit code:/i.test(body) ? body : `Exit code: ${check.code ?? 1}\n${body}`;
    return annotateMissingDependencies(withCode);
  };

  /** One stack verify command. Missing workspace or command is a failure, not a pass. */
  const runProjectVerify = async (
    token?: number
  ): Promise<{
    ok: boolean;
    output: string;
    fingerprint: string;
  }> => {
    const finishVerify = (result: { ok: boolean; output: string; fingerprint: string }) => {
      if (result.fingerprint !== 'aborted' && result.output !== 'Stopped.') {
        const stepId = activeStepId();
        logRun({
          kind: 'verify',
          ok: result.ok,
          fingerprint: result.fingerprint,
          output: result.output,
          ...(stepId ? { stepId } : {})
        });
      }
      return result;
    };
    if (typeof token === 'number' && !runIsCurrent(token)) {
      return finishVerify({ ok: false, output: 'Stopped.', fingerprint: 'aborted' });
    }
    const brain = projectBrainRef.current;
    const stack =
      brain.stack ||
      deliveryToStack(brain.delivery || plannerPlanRef.current?.delivery) ||
      'typescript';
    const begun = beginVerify({
      workspacePath,
      stack,
      preferred: brain.verifyCommand || plannerPlanRef.current?.verifyCommand
    });
    if ('failure' in begun) {
      const failure = begun.failure;
      commitProjectBrain({
        ...projectBrainRef.current,
        lastVerifyOk: false,
        lastVerifyNote: failure.output.slice(0, 800)
      });
      if (plannerPlanRef.current) {
        await commitPlannerPlan(
          {
            ...plannerPlanRef.current,
            lastVerifyOk: false,
            lastErrorFingerprint: failure.fingerprint,
            updatedAt: Date.now()
          },
          token
        );
      }
      return finishVerify({ ok: false, output: failure.output, fingerprint: failure.fingerprint });
    }
    const verifyFrame = beginActivity('verify', 'Project verify');
    try {
      const out = typescriptVerifyUsesCompiler(begun.command)
        ? await runTypescriptVerify()
        : await executeTrackedCommand(begun.command);
      if (typeof token === 'number' && !runIsCurrent(token)) {
        return finishVerify({ ok: false, output: 'Stopped.', fingerprint: 'aborted' });
      }
      const visual = verifyOutputFailed(out) ? '' : await readWebEntryBlocker();
      const combined = visual ? `${out || ''}\n${visual}` : out || '';
      const failed = verifyOutputFailed(combined);
      const errors = parseCompilerErrors(combined);
      const fingerprint = errorFingerprint(errors);
      commitProjectBrain({
        ...projectBrainRef.current,
        verifyCommand: begun.command,
        lastVerifyOk: !failed,
        lastVerifyNote: combined.slice(-800)
      });
      if (plannerPlanRef.current) {
        await commitPlannerPlan(
          {
            ...plannerPlanRef.current,
            verifyCommand: begun.command,
            lastVerifyOk: !failed,
            lastErrorFingerprint: fingerprint,
            updatedAt: Date.now()
          },
          token
        );
      }
      return finishVerify({ ok: !failed, output: combined, fingerprint });
    } catch (err: any) {
      const msg = err?.message || String(err);
      commitProjectBrain({
        ...projectBrainRef.current,
        lastVerifyOk: false,
        lastVerifyNote: msg.slice(0, 800)
      });
      return finishVerify({ ok: false, output: msg, fingerprint: 'err' });
    } finally {
      endActivity(verifyFrame);
    }
  };

  /** Compiler/build must pass before a step can Yay. */
  const verifyBeforeYay = async (
    parent?: ConductorRun | null
  ): Promise<{ ok: boolean; output: string }> => {
    const entered = bindRun(parent ?? null, false, 'verify');
    if (!entered) return { ok: false, output: 'Stopped.' };
    const run = entered.run;
    try {
      if (!runLive(run)) return { ok: false, output: 'Stopped.' };
      const checked = await runProjectVerify(run.token);
      if (!runLive(run)) return { ok: false, output: 'Stopped.' };
      return { ok: checked.ok, output: checked.output };
    } finally {
      leaveConductorRun(entered.owned, run.token);
    }
  };

  /** Advance the stuck step after heal verify passes (no Reviewer round-trip). */
  const advanceAfterHealVerify = async (
    stepId: string,
    fingerprint: string,
    note: string,
    parent?: ConductorRun | null
  ) => {
    const entered = bindRun(parent ?? null, false, 'heal');
    if (!entered) {
      if (parent && runOwnsUi(parent)) setPlanPaused(true);
      return;
    }
    const run = entered.run;
    try {
    if (!runLive(run)) {
      if (runOwnsUi(run)) setPlanPaused(true);
      return;
    }
    let plan = plannerPlanRef.current;
    if (!plan) return;
    if (!canHealAdvanceOnGreenVerify(plan, stepId)) {
      const held = transition(plan, {
        type: 'VERIFY',
        ok: true,
        fingerprint,
        stepId,
        note
      });
      await commitPlannerPlan(held.plan, run.token);
      if (!runLive(run)) {
        if (runOwnsUi(run)) setPlanPaused(true);
        return;
      }
      if (fullAutoRef.current) {
        await deferFailedStepAndContinue(
          stepId,
          'Verify passed, but this step failed review. Kept as debt and continued.',
          run
        );
        return;
      }
      setPlanPaused(true);
      restorePlannerControl(
        'Verify passed, but this step failed review. It stays failed — Retry the step or send fixes.'
      );
      return;
    }
    const moved = transition(plan, {
      type: 'VERIFY',
      ok: true,
      fingerprint,
      stepId,
      note
    });
    await commitPlannerPlan(moved.plan, run.token);
    if (!runLive(run)) {
      if (runOwnsUi(run)) setPlanPaused(true);
      return;
    }
    if (moved.effect !== 'verify-advanced') {
      if (fullAutoRef.current) {
        await deferFailedStepAndContinue(
          stepId,
          'Verify passed, but this step was not advanced. Kept as debt and continued.',
          run
        );
        return;
      }
      setPlanPaused(true);
      restorePlannerControl('Verify passed, but this step was not advanced.');
      return;
    }
    plan = moved.plan;
    if (plan.resumePhase === 'final-review' || plan.status === 'completed') {
      setPlanPaused(false);
      await finishVerifiedPlanRef.current(plan, run);
      if (!runLive(run) && runOwnsUi(run)) setPlanPaused(true);
      return;
    }
    const next = getActiveStep(plan);
    if (next) {
      setExecutingPlanNotice(`Heal: verify OK — starting step #${next.id}: ${next.title}`);
      await dispatchActiveStep(run);
      if (!runLive(run) && runOwnsUi(run)) setPlanPaused(true);
    } else {
      restorePlannerControl('Heal: verify passed — plan complete.');
    }
    } finally {
      leaveConductorRun(entered.owned, run.token);
    }
  };

  /**
   * Heal budget spent: record compiler debt and keep going on the next pending step.
   * Does not set blockedReason. User Stop is the halt.
   */
  const deferFailedStepAndContinue = async (
    stepId: string,
    note: string,
    parent?: ConductorRun | null
  ) => {
    const entered = bindRun(parent ?? null, false, 'defer');
    if (!entered) {
      if (parent && runOwnsUi(parent)) setPlanPaused(true);
      return;
    }
    const run = entered.run;
    try {
    if (!runLive(run)) {
      if (runOwnsUi(run)) setPlanPaused(true);
      return;
    }
    logRun({
      kind: 'info',
      stepId: String(stepId),
      text: `Deferred step: ${note}`
    });
    let plan = plannerPlanRef.current;
    if (!plan) return;
    plan = continuePastFailedStep(plan, stepId, note);
    await commitPlannerPlan(plan, run.token);
    if (!runLive(run)) {
      if (runOwnsUi(run)) setPlanPaused(true);
      return;
    }
    const debtTitle = note.replace(/\s+/g, ' ').slice(0, 280);
    const todo = [
      ...projectBrainRef.current.todo.filter(t => t.id !== `debt-${stepId}`),
      { id: `debt-${stepId}`, title: debtTitle, status: 'debt' }
    ].slice(-40);
    commitProjectBrain({ ...projectBrainRef.current, todo, updatedAt: Date.now() });
    setPlanPaused(false);
    const next = getActiveStep(plan);
    if (plan.status === 'completed' || !next) {
      restorePlannerControl(
        'Plan finished. Steps left with compiler debt are marked failed — see project todo.'
      );
      return;
    }
    setExecutingPlanNotice(
      `Step #${stepId} kept as debt — continuing step #${next.id}: ${next.title}`
    );
    await dispatchActiveStep(run);
    if (!runLive(run) && runOwnsUi(run)) setPlanPaused(true);
    } finally {
      leaveConductorRun(entered.owned, run.token);
    }
  };

  /**
   * Compiler-driven heal when blocked / escalation would no-op.
   * Does not append steps or bump escalationCount. Max MAX_HEAL_ATTEMPTS per plan.
   */
  const frontierBriefUsed = (plan: PlannerPlan | null | undefined) =>
    !!(plan as (PlannerPlan & { frontierHealBriefUsed?: boolean }) | null | undefined)
      ?.frontierHealBriefUsed;

  const healBlockedPlan = async (): Promise<void> => {
    const entered = bindRun(null, false, 'heal');
    if (!entered) return;
    const run = entered.run;
    const { logRun, hostLog } = scopeRunLog();
    const noteHeal = (note: string, stepId: string, attempt?: number, fingerprint?: string) => {
      logRun({
        kind: 'heal',
        stepId,
        ...(attempt != null ? { attempt } : {}),
        max: MAX_HEAL_ATTEMPTS,
        ...(fingerprint ? { fingerprint } : {}),
        note
      });
    };
    try {
    if (!runLive(run)) return;
    let plan = plannerPlanRef.current;
    if (!plan || !isPlanActive(plan)) {
      setExecutingPlanNotice('No active plan to heal.');
      return;
    }

    const stuck = pickHealStep(plan);
    if (!stuck) {
      restorePlannerControl('Nothing to heal — no stuck step.');
      return;
    }

    const attempts = plan.healAttempts || 0;
    if (attempts >= MAX_HEAL_ATTEMPTS) {
      noteHeal(
        `budget spent — deferred`,
        String(stuck.id),
        attempts,
        plan.lastErrorFingerprint
      );
      await deferFailedStepAndContinue(
        String(stuck.id),
        `Heal budget used (${attempts}) on step #${stuck.id}. ${(stuck.reviewNote || plan.blockedReason || '').slice(0, 500)}`,
        run
      );
      return;
    }

    setPlanPaused(false);
    resetAgentLoopBudget();
    await commitPlannerPlan(
      {
        ...plan,
        blockedReason: undefined,
        healAttempts: attempts + 1,
        resumePhase: 'coder',
        activeStepId: stuck.id,
        updatedAt: Date.now()
      },
      run.token
    );
    if (!runLive(run)) return;
    const healFrame = beginActivity(
      'heal',
      `Heal step #${stuck.id}`,
      `attempt ${attempts + 1}/${MAX_HEAL_ATTEMPTS}`
    );
    setExecutingPlanNotice(
      `Heal and continue — verifying project (attempt ${attempts + 1}/${MAX_HEAL_ATTEMPTS})…`
    );

    try {
      let verify = await runProjectVerify(run.token);
      if (!runLive(run)) {
        endActivity(healFrame);
        if (runOwnsUi(run)) {
          setPlanPaused(true);
          restorePlannerControl('Paused during Heal verify — press Heal and continue to retry.');
        }
        return;
      }
      if (verify.ok) {
        endActivity(healFrame);
        noteHeal('verify passed — advancing', String(stuck.id), attempts + 1, verify.fingerprint);
        await advanceAfterHealVerify(
          String(stuck.id),
          verify.fingerprint,
          'Heal: stack verify passed — advancing.',
          run
        );
        return;
      }

      let errors = parseCompilerErrors(verify.output);
      let fingerprint = verify.fingerprint || errorFingerprint(errors);
      const prevFp = plannerPlanRef.current?.lastErrorFingerprint;
      const errorBlock = formatErrorsForCoder(errors, verify.output);
      const errorFiles = filesFromErrors(errors);
      const stepFiles = collectStepFilePaths(stuck);
      const allowedFiles = [...new Set([...errorFiles, ...stepFiles])].slice(0, 14);

      const runHealCoder = async (promptExtra: string, notice: string, pin?: { node: EndpointNode; model: string }) => {
        const healRoute =
          pin ||
          (() => {
            const r = resolveRoute(`Heal step #${stuck.id}`, coderAgent);
            return r ? { node: r.routedNode, model: r.routedModel } : undefined;
          })();
        const healFit = healRoute
          ? resolveModelFit(healRoute.node, healRoute.model, 'coder', coderAgent.numCtx)
          : null;
        const filesBody = await buildTouchedFilesContext(
          workspacePath,
          allowedFiles,
          healFit?.caps || {
            maxFiles: 10,
            maxCharsPerFile: 12000,
            maxTotalChars: 48000
          }
        );
        if (!runLive(run)) return;
        const healPrompt = `### Heal pass (compiler-driven)
You are fixing compile/verify errors for plan step #${stuck.id}: ${stuck.title}.
${stuck.reviewNote ? `Reviewer note: ${stuck.reviewNote}` : ''}
${healFit?.packingLine ? `\n${healFit.packingLine}` : ''}

Rules:
- Edit ONLY these files (prefer edit_file): ${allowedFiles.map(f => `\`${f}\``).join(', ') || '(paths named in the errors)'}
- Do not invent new architecture or append plan steps.
- No prose-as-file. Emit real code edits only.
- Stop when the listed errors are addressed.

${errorBlock}

${promptExtra}

${filesBody || '(No file bodies preloaded — call read_file for each path, then edit_file.)'}

Work log:
${progressForPrompt() || '(empty)'}`;

        ephemeralWorkerRef.current = true;
        onSelectAgent(coderAgent.id);
        onConversationPatch?.({ agentId: coderAgent.id });
        setExecutingPlanNotice(notice);
        await runSingleNodeTurn({
          userText: `Heal step #${stuck.id}: fix compiler errors`,
          fullPrompt: healPrompt,
          agent: coderAgent,
          planMode: false,
          approvedPlan: approvedPlanRef.current,
          skipUserAppend: true,
          notice,
          freshContext: true,
          run,
          ...(pin ? { pinRoute: pin } : {})
        });
      };

      const fingerprintBeforeLocal = fingerprint;
      await snapshotStepFiles(String(stuck.id), allowedFiles);
      if (!runLive(run)) {
        endActivity(healFrame);
        if (runOwnsUi(run)) {
          setPlanPaused(true);
          restorePlannerControl('Paused during Heal — press Play to resume.');
        }
        return;
      }
      // Skip another local coder if this fingerprint already survived a prior heal attempt.
      const skipLocal = !!prevFp && prevFp === fingerprint && attempts >= 1;

      if (!skipLocal) {
        const blankPage = /TS9001|TS9002/.test(verify.output || '');
        const coderLocked = !!explicitRolePick(roleRoutesRef.current, 'coder');
        const frontierFix =
          coderLocked || !blankPage ? undefined : pickFinalSourceReviewTarget(nodesRef.current);
        const frontierPin =
          frontierFix && isFrontierNode(frontierFix.node) ? frontierFix : undefined;
        await runHealCoder(
          blankPage
            ? 'The project compiles, but the page is still a blank or unstyled document. Fix index.html so the file itself has a background and a visible title, and wire Tailwind (@tailwind base; @tailwind components; @tailwind utilities, plus postcss.config.js and tailwind.config.js) or replace className utilities with real CSS in src/index.css.'
            : '',
          frontierPin
            ? `Heal: frontier coder fixing the blank page on ${frontierPin.node.name} · ${frontierPin.model}…`
            : `Heal: local Coder on ${errorFiles.length || allowedFiles.length || '?'} error file(s)…`,
          frontierPin
        );
        if (!runLive(run)) {
          endActivity(healFrame);
          if (runOwnsUi(run)) {
            setPlanPaused(true);
            restorePlannerControl('Paused during Heal Coder — press Heal and continue to retry.');
          }
          return;
        }
        verify = await runProjectVerify(run.token);
        if (verify.ok) {
          endActivity(healFrame);
          noteHeal('local coder fixed verify', String(stuck.id), attempts + 1, verify.fingerprint);
          await advanceAfterHealVerify(
            String(stuck.id),
            verify.fingerprint,
            'Heal: local Coder fixed verify — advancing.',
            run
          );
          return;
        }
        errors = parseCompilerErrors(verify.output);
        const afterLocalFp = verify.fingerprint || errorFingerprint(errors);
        fingerprint = afterLocalFp;
        if (!verifyFingerprintChanged(fingerprintBeforeLocal, afterLocalFp)) {
          setExecutingPlanNotice('Heal: error fingerprint unchanged after the local Coder.');
        }
      } else {
        setExecutingPlanNotice('Heal: same error fingerprint as the last attempt — skipping another local Coder.');
      }

      const unchanged = !verifyFingerprintChanged(fingerprintBeforeLocal, fingerprint);
      const briefAlreadyUsed = frontierBriefUsed(plannerPlanRef.current);
      if (unchanged && !briefAlreadyUsed && runLive(run)) {
        const stuckPayload = `${errorBlock}\n\nFingerprint: ${fingerprint}\nStep: #${stuck.id} ${stuck.title}`;
        let brief: string | null = null;
        try {
          brief = await requestFreeTierBrief(
            'Local heal did not clear these compile errors. Give one short concrete fix plan naming files and edits. Do not rewrite whole files.',
            stuckPayload,
            run
          );
        } catch (err: any) {
          hostLog('warn', `heal frontier: ${err?.message || err}`);
        }
        if (!runLive(run)) {
          endActivity(healFrame);
          if (runOwnsUi(run)) {
            setPlanPaused(true);
            restorePlannerControl('Paused during Heal — press Heal and continue to retry.');
          }
          return;
        }
        const big = roleTarget('coder', () => pickLargestLocalTarget(nodesRef.current));
        let briefApplied = false;
        if (brief?.trim() && big) {
          briefApplied = true;
          await commitPlannerPlan(
            {
              ...(plannerPlanRef.current || plan),
              frontierHealBriefUsed: true
            } as PlannerPlan,
            run.token
          );
          if (!runLive(run)) {
            endActivity(healFrame);
            if (runOwnsUi(run)) setPlanPaused(true);
            return;
          }
          await runHealCoder(
            `### Frontier heal brief\nApply this solution. Do not repeat the failed approach.\n\n${brief}`,
            `Heal: applying the one frontier brief on ${big.node.name} · ${big.model}…`,
            big
          );
          if (!runLive(run)) {
            endActivity(healFrame);
            if (runOwnsUi(run)) setPlanPaused(true);
            return;
          }
          verify = await runProjectVerify(run.token);
          if (verify.ok) {
            endActivity(healFrame);
            noteHeal('frontier brief cleared verify', String(stuck.id), attempts + 1, verify.fingerprint);
            await advanceAfterHealVerify(
              String(stuck.id),
              verify.fingerprint,
              'Heal: frontier brief cleared verify — advancing.',
              run
            );
            return;
          }
          if (!runLive(run)) {
            endActivity(healFrame);
            if (runOwnsUi(run)) setPlanPaused(true);
            return;
          }
        }
        endActivity(healFrame);
        const unchangedAfterBrief = briefApplied
          ? 'Heal stopped: the error fingerprint did not change. This plan already used its frontier brief.'
          : brief?.trim()
            ? 'Heal stopped: a frontier brief arrived, but no local coder is available to apply it. The brief is still unused.'
            : 'Heal stopped: the error fingerprint did not change and no frontier brief was available. The brief is still unused.';
        noteHeal(unchangedAfterBrief, String(stuck.id), attempts + 1, fingerprint);
        if (fullAutoRef.current && runLive(run)) {
          await deferFailedStepAndContinue(String(stuck.id), unchangedAfterBrief, run);
          return;
        }
        if (runOwnsUi(run)) {
          setPlanPaused(true);
          restorePlannerControl(unchangedAfterBrief);
        }
        return;
      }
      if (unchanged) {
        endActivity(healFrame);
        const unchangedNote = briefAlreadyUsed
          ? 'Heal stopped: the error fingerprint is unchanged and the frontier brief was already used.'
          : 'Heal stopped: the error fingerprint did not change after the local Coder.';
        noteHeal(unchangedNote, String(stuck.id), attempts + 1, fingerprint);
        if (fullAutoRef.current && runLive(run)) {
          await deferFailedStepAndContinue(String(stuck.id), unchangedNote, run);
          return;
        }
        if (runOwnsUi(run)) {
          setPlanPaused(true);
          restorePlannerControl(unchangedNote);
        }
        return;
      }

      const snippet = (verify.output || '').slice(-700);
      const used = plannerPlanRef.current?.healAttempts || attempts + 1;
      endActivity(healFrame);
      if (used >= MAX_HEAL_ATTEMPTS || !runLive(run)) {
        if (!runLive(run)) {
          if (runOwnsUi(run)) setPlanPaused(true);
          return;
        }
        noteHeal(
          `failed after ${used} attempts`,
          String(stuck.id),
          used,
          verify.fingerprint
        );
        await deferFailedStepAndContinue(
          String(stuck.id),
          `Heal failed on step #${stuck.id} after ${used} attempts.\n${snippet}`,
          run
        );
        return;
      }
      setExecutingPlanNotice(
        `Heal attempt ${used}/${MAX_HEAL_ATTEMPTS} changed the errors on step #${stuck.id} — retrying…`
      );
      noteHeal('errors changed — retrying heal', String(stuck.id), used, fingerprint);
      await healBlockedPlan();
    } catch (err: any) {
      endActivity(healFrame);
      const msg = String(err?.message || err);
      if (/no workspace|workspace (path|required)|no local model|no model online/i.test(msg)) {
        const reason = `Heal paused: ${msg}`;
        noteHeal(reason, String(stuck.id), attempts + 1);
        commitPlannerPlan({
          ...(plannerPlanRef.current || plan),
          blockedReason: reason,
          updatedAt: Date.now()
        });
        if (runOwnsUi(run)) {
          setPlanPaused(true);
          restorePlannerControl(reason);
        }
        return;
      }
      noteHeal(`error: ${msg.slice(0, 300)}`, String(stuck.id), attempts + 1);
      await deferFailedStepAndContinue(
        String(stuck.id),
        `Heal error on step #${stuck.id}: ${msg.slice(0, 500)}`,
        run
      );
    }
    } finally {
      leaveConductorRun(entered.owned, entered.run.token);
    }
  };

  /**
   * After every checklist step is Yay, send the source tree to review.
   * Frontier when one is online; otherwise the largest local reviewer.
   * Electron packaging runs after this returns (finishVerifiedPlan).
   */
  const reviewFinishedSource = async (
    plan: PlannerPlan,
    parent?: ConductorRun | null
  ): Promise<{ ran: boolean; passed: boolean; notes: string }> => {
    const skipped = { ran: false, passed: false, notes: '' };
    if (!plan.steps.length || plan.steps.some(s => s.status !== 'completed')) return skipped;
    if (finalReviewPlanIdRef.current === plan.id) return skipped;
    if (parent && !runLive(parent)) return skipped;
    finalReviewPlanIdRef.current = plan.id;

    const target = roleTarget('reviewer', () => pickFinalSourceReviewTarget(nodesRef.current));
    if (!target || !workspacePath) {
      const notes = 'All plan steps complete — no model online for the final source review.';
      restorePlannerControl(notes);
      return { ran: false, passed: false, notes };
    }
    const frontier = isFrontierNode(target.node);
    const caps = frontier
      ? { maxFiles: 80, maxCharsPerFile: 14000, maxTotalChars: 180000 }
      : { maxFiles: 24, maxCharsPerFile: 8000, maxTotalChars: 48000 };
    const reviewSourceFrame = beginActivity('project-review', 'Final source review', `${target.node.name} · ${target.model}`);
    setExecutingPlanNotice(
      frontier
        ? `Checklist done — reviewing the source folder on ${target.node.name} · ${target.model}…`
        : `Checklist done — reviewing the source folder on ${target.node.name} · ${target.model} (no frontier online)…`
    );
    try {
      const files = await listSourceFolderFiles(workspacePath);
      if (parent && !runLive(parent)) {
        finalReviewPlanIdRef.current = null;
        return skipped;
      }
      const filesBody = await buildTouchedFilesContext(workspacePath, files, caps);
      if (parent && !runLive(parent)) {
        finalReviewPlanIdRef.current = null;
        return skipped;
      }
      const rest = files.slice(caps.maxFiles);
      const steps = plan.steps.map(s => `- #${s.id} ${s.title}`).join('\n');
      const prompt = `The planner checklist is finished. Review the source folder against what the plan asked for. Do not edit files.

Plan: ${plan.summary}
${steps}

${projectContextForPrompt(frontier ? 16000 : 6000)}

Source files (${files.length}):
${files.join('\n') || '(none found)'}

${filesBody || '(No file bodies could be loaded.)'}
${rest.length ? `\nNot inlined (${rest.length}):\n${rest.join('\n')}` : ''}

Check that the files match the plan: delivery, wiring, no stubs, no planner prose saved as code, no second copy of the same module.
A successful tsc or vite build is not enough. If index.html has no visible content, or components use Tailwind classes that are not in the stylesheet, the result is issues.
End with <final_review><result>pass</result> or <result>issues</result> and <notes>. Use pass only when opening the page would show the product.</final_review>`;

      const msg = await runSingleNodeTurn({
        userText: 'Final source review',
        fullPrompt: prompt,
        agent: reviewerAgent,
        reviewMode: true,
        finalSourceReview: true,
        skipUserAppend: true,
        notice: `Final source review · ${target.model}`,
        pinRoute: target,
        freshContext: true,
        ...(parent ? { run: parent } : {})
      });
      if (parent && !runLive(parent)) {
        endActivity(reviewSourceFrame);
        finalReviewPlanIdRef.current = null;
        if (runOwnsUi(parent)) restorePlannerControl('Paused during the final source review.');
        return { ran: false, passed: false, notes: 'Paused during the final source review.' };
      }
      const parsed = parseFinalReview(`${msg?.raw || ''}\n${msg?.display || ''}`);
      const notes = (parsed?.notes || msg?.display || msg?.raw || '').replace(/\s+/g, ' ').trim();
      const passed = parsed ? parsed.result === 'pass' : notes.length > 0 && !/\b(missing|stub|mismatch|does not match|not implemented)\b/i.test(notes);
      const todo = projectBrainRef.current.todo.filter(t => t.id !== 'final-source-review');
      if (!passed && notes) {
        todo.push({
          id: 'final-source-review',
          title: `Final source review: ${notes.slice(0, 240)}`,
          status: 'debt'
        });
      }
      commitProjectBrain({
        ...projectBrainRef.current,
        todo: todo.slice(-40),
        lastVerifyNote: notes.slice(0, 800) || projectBrainRef.current.lastVerifyNote,
        lastVerifyOk: passed
      });
      endActivity(reviewSourceFrame);
      const notice = passed
        ? `Final source review passed on ${target.node.name} · ${target.model}.`
        : `Final source review found gaps on ${target.node.name}. ${notes.slice(0, 280)}`;
      restorePlannerControl(notice);
      return { ran: true, passed, notes: notice };
    } catch (err: any) {
      endActivity(reviewSourceFrame);
      const notice = `Final source review failed: ${err?.message || err}`;
      if (!parent || runOwnsUi(parent)) restorePlannerControl(notice);
      return { ran: true, passed: false, notes: notice };
    }
  };

  const listPackagedExes = async (dirs: string[]): Promise<string[]> => {
    if (!workspacePath || !window.electronAPI?.readDir) return [];
    const root = workspacePath.replace(/[\\/]+$/, '');
    const sep = root.includes('\\') ? '\\' : '/';
    const found: string[] = [];
    for (const rel of dirs) {
      if (!rel || rel.includes('..') || /node_modules/i.test(rel)) continue;
      const abs = `${root}${sep}${rel.replace(/\//g, sep)}`;
      let res: WorkspaceFile[] | { error: string };
      try {
        res = await window.electronAPI.readDir(abs);
      } catch {
        continue;
      }
      if (!Array.isArray(res)) continue;
      for (const ent of res) {
        if (ent.isDirectory || !ent.name || !/\.exe$/i.test(ent.name)) continue;
        if (/node_modules/i.test(`${ent.path || ''}${ent.name}`)) continue;
        found.push(`${rel.replace(/\\/g, '/')}/${ent.name}`);
      }
    }
    return found;
  };

  const readWorkspacePackage = async (): Promise<PackageBuildConfig | null> => {
    if (!workspacePath || !window.electronAPI?.readFile) return null;
    const root = workspacePath.replace(/[\\/]+$/, '');
    const sep = root.includes('\\') ? '\\' : '/';
    try {
      const res = await window.electronAPI.readFile(`${root}${sep}package.json`);
      if (!res?.content) return null;
      const pkg = JSON.parse(res.content.replace(/^\uFEFF/, '')) as PackageBuildConfig;
      if (!pkg || typeof pkg !== 'object') return null;
      return pkg;
    } catch {
      return null;
    }
  };

  const rememberDistNote = (summary: string) => {
    const note = summary.replace(/\s+/g, ' ').trim().slice(0, 800);
    if (!note) return;
    commitProjectBrain({
      ...projectBrainRef.current,
      lastDistNote: note
    });
  };

  /**
   * After every step is Yay (verify already passed), run the workspace dist/pack
   * script when delivery is Electron or package.json packs with electron-builder.
   * Does not run Studio's release script, and does not claim an exe on failure.
   */
  const packageElectronDist = async (
    plan: PlannerPlan,
    parent?: ConductorRun | null
  ): Promise<string | null> => {
    if (!workspacePath) return null;
    if (parent ? !runLive(parent) : stopRequestedRef.current) return null;
    if (!plan.steps.length || plan.steps.some(s => s.status !== 'completed')) return null;
    const delivery = plan.delivery || projectBrainRef.current.delivery || null;
    const pkg = await readWorkspacePackage();
    const scripts =
      pkg?.scripts && typeof pkg.scripts === 'object' && !Array.isArray(pkg.scripts)
        ? pkg.scripts
        : null;
    const decision = decideElectronDist(delivery, scripts);
    if (!decision.run) {
      if (delivery !== 'electron') return null;
      const note =
        decision.reason === 'unsafe-script-name'
          ? 'All steps verified, but the dist script name is not safe to run — installer was not built.'
          : 'All steps verified, but package.json has no dist/pack (electron-builder) script — installer was not built.';
      rememberDistNote(note);
      return note;
    }
    if (!tryBeginElectronDist(workspacePath)) {
      return 'Electron dist is already running — did not start another build.';
    }
    try {
      if (window.electronAPI?.getTerminalBuffer) {
        const snap = await window.electronAPI.getTerminalBuffer({ maxChars: 4000 });
        if (parent && !runLive(parent)) return null;
        if (terminalLooksLikeRunningDist(snap?.content || '', !!snap?.running)) {
          return 'Electron dist is already running — did not start another build.';
        }
      }
      setExecutingPlanNotice(
        `All steps verified — packaging the Electron app (\`npm run ${decision.scriptName}\`)…`
      );
      const output = await executeTrackedCommand(decision.command, {
        timeoutSec: ELECTRON_DIST_TIMEOUT_SEC
      });
      if (parent && !runLive(parent)) return null;
      const failed = distCommandFailed(output);
      const listed = failed ? [] : await listPackagedExes(electronOutputDirs(pkg));
      if (parent && !runLive(parent)) return null;
      const summary = summarizeElectronDist({
        ok: !failed,
        scriptName: decision.scriptName,
        output: output || '',
        listedExes: listed
      });
      rememberDistNote(summary);
      return summary;
    } catch (err: any) {
      const summary = `Electron dist failed (\`npm run ${decision.scriptName}\`) — no installer was produced. ${String(
        err?.message || err
      ).slice(0, 360)}`;
      rememberDistNote(summary);
      return summary;
    } finally {
      endElectronDist(workspacePath);
    }
  };

  /** Final source review, then the Electron installer when verify already passed. */
  const finishVerifiedPlan = async (plan: PlannerPlan, parent?: ConductorRun | null) => {
    if (parent && !runLive(parent)) return;
    if (!planReadyForRelease(plan)) {
      if (!parent || runOwnsUi(parent)) {
        restorePlannerControl(
          'Plan is not ready to release — unfinished, failed, or abandoned steps stay off the final review and Electron dist.'
        );
      }
      return;
    }
    const shipping = markPlanFinalReview(plan);
    await commitPlannerPlan(shipping, parent?.token);
    if (parent && !runLive(parent)) return;
    const review = await reviewFinishedSource(shipping, parent);
    if (parent && !runLive(parent)) return;
    const distNote = await packageElectronDist(shipping, parent);
    if (!distNote) return;
    const prefix =
      review.ran && review.passed
        ? 'Source review passed. '
        : review.notes
          ? `${review.notes.replace(/\s+/g, ' ').trim().slice(0, 180)} `
          : '';
    setExecutingPlanNotice(`${prefix}${distNote}`.replace(/\s+/g, ' ').trim().slice(0, 500));
  };
  finishVerifiedPlanRef.current = finishVerifiedPlan;

  /** Apply Yay/Nay to durable plan, then next step or rework / escalate. */
  const applyStepVerdictAndContinue = async (
    verdictMsg: ChatMessage | null,
    packed?: { stepId: string; stepTitle: string; result: 'yay' | 'nay'; notes: string },
    parent?: ConductorRun | null
  ): Promise<void> => {
    const v = packed || verdictMsg?.stepVerdict;
    if (!v) return;
    if (verdictMsg?.stepVerdictApplied) return;
    const entered = bindRun(parent ?? null, false, 'verdict');
    if (!entered) {
      if (parent && runOwnsUi(parent)) setPlanPaused(true);
      return;
    }
    const run = entered.run;
    const { logRun } = scopeRunLog();
    try {
    if (!runLive(run)) {
      if (runOwnsUi(run)) setPlanPaused(true);
      return;
    }

    let plan = plannerPlanRef.current;
    if (!plan) return;

    let result = v.result;
    let notes = v.notes;
    const stepId = String(v.stepId || plan.activeStepId || '');
    const captured = coderTurnWritesRef.current;
    const turnWrites = captured && captured.stepId === stepId ? captured.tools : coderWriteTools();
    if (result === 'yay' && writesUnresolved(turnWrites)) {
      if (fullAutoRef.current && runLive(run)) {
        if (takeCoderRedispatchOnce(stepId)) {
          setPlanPaused(false);
          setPlanResumePhase('coder', run.token);
          setExecutingPlanNotice(`Full auto: retrying Coder on step #${stepId}…`);
          await dispatchActiveStep(run, { coderRetry: true });
          if (!runLive(run)) {
            giveBackCoderRedispatch(stepId);
            if (runOwnsUi(run)) setPlanPaused(true);
          }
          return;
        }
        result = 'nay';
        notes = unresolvedWriteNotes(turnWrites);
        logRun({
          kind: 'info',
          stepId,
          text: 'Full auto: Nay because coder writes failed'
        });
      } else {
        setPlanResumePhase('coder', run.token);
        setPlanPaused(true);
        restorePlannerControl(
          'Writes for this step failed or are still pending. Press Play to run the Coder again before accepting Pass.'
        );
        return;
      }
    }
    if (result === 'yay') {
      const gate = await verifyBeforeYay(run);
      if (!runLive(run) || gate.output === 'Stopped.') {
        if (runOwnsUi(run)) setPlanPaused(true);
        setPlanResumePhase('verdict', run.token);
        return;
      }
      if (!gate.ok) {
        result = 'nay';
        notes = `Verify failed — step cannot Yay.\n${(gate.output || '').slice(0, 1600)}`;
      }
    }
    logRun({
      kind: 'verdict',
      result,
      text: v.result === 'yay' && result === 'nay' && notes.startsWith('Verify failed')
        ? 'yay->nay (verify failed)'
        : notes,
      stepId
    });

    plan = applyStepVerdict(plan, {
      stepId,
      result,
      notes
    });
    await commitPlannerPlan(plan, run.token);
    if (!runLive(run)) {
      if (runOwnsUi(run)) setPlanPaused(true);
      return;
    }

    if (verdictMsg) {
      setMessages(prev => {
        const next = prev.map(m =>
          m.id === verdictMsg.id
            ? { ...m, stepVerdictApplied: true, stepVerdictNeedsConfirm: false }
            : m
        );
        messagesRef.current = next;
        return next;
      });
    }

    if (plan.status === 'completed') {
      stepReworkCountRef.current = {};
      setPlanPaused(false);
      await finishVerifiedPlan(plan, run);
      if (!runLive(run) && runOwnsUi(run)) setPlanPaused(true);
      return;
    }

    if (result === 'nay') {
      const sid = stepId;
      const stuck = plan.steps.find(s => String(s.id) === sid);
      const nextCount = effectiveStepReworkCount(sid, stuck?.reworkCount);
      if (nextCount > MAX_STEP_REWORKS) {
        // Verify/compile failures and existing Fix steps → heal, do not grow the plan.
        if (
          stepLooksLikeFixStep(stuck?.title || '') ||
          notesLookLikeVerifyFailure(notes || stuck?.reviewNote || '')
        ) {
          await commitPlannerPlan(
            {
              ...plan,
              blockedReason: `Heal needed on step #${sid} after ${nextCount} Nays (compiler/verify).`,
              resumePhase: 'coder',
              activeStepId: stuck?.id || plan.activeStepId,
              updatedAt: Date.now()
            },
            run.token
          );
          if (!runLive(run)) {
            if (runOwnsUi(run)) setPlanPaused(true);
            return;
          }
          await healBlockedPlan();
          return;
        }
        await escalateStepToPlannerFixes(sid, run);
        return;
      }
      setExecutingPlanNotice(
        `Reworking step #${sid} from Reviewer Nay (${nextCount}/${MAX_STEP_REWORKS})…`
      );
      await dispatchActiveStep(run);
      if (!runLive(run) && runOwnsUi(run)) setPlanPaused(true);
      return;
    }

    // Yay — clear heal counter so later steps get a fresh heal budget
    if (plannerPlanRef.current) {
      await commitPlannerPlan(
        {
          ...plannerPlanRef.current,
          healAttempts: 0,
          blockedReason: undefined,
          updatedAt: Date.now()
        },
        run.token
      );
    }
    if (!runLive(run)) {
      if (runOwnsUi(run)) setPlanPaused(true);
      return;
    }
    const next = getActiveStep(plannerPlanRef.current || plan);
    if (next) {
      setExecutingPlanNotice(`Step Yay — starting step #${next.id}: ${next.title}`);
      await dispatchActiveStep(run);
      if (!runLive(run) && runOwnsUi(run)) setPlanPaused(true);
    } else {
      restorePlannerControl('Planner plan complete — ask Planner what to build next.');
    }
    } finally {
      leaveConductorRun(entered.owned, run.token);
    }
  };

  /** After the user picks a plan option — Planner locks steps/tasks, then Coders run step 1. */
  const executeChosenPlan = async (
    option: PlanOption,
    planMsg: ChatMessage,
    confirmationText: string,
    attachedImages: string[] = [],
    parent?: ConductorRun | null
  ): Promise<void> => {
    const entered = bindRun(parent ?? null, !parent, 'plan');
    if (!entered) return;
    const run = entered.run;
    try {
    if (!runLive(run)) return;
    const original = findPlanOriginalRequest(messagesRef.current, planMsg);
    const approved = buildApprovedPlan(planMsg, option, original);
    approvedPlanRef.current = approved;
    commitProjectBrain({
      ...projectBrainRef.current,
      brief: projectBrainRef.current.brief || approved.originalUserRequest || option.title,
      delivery: approved.delivery || projectBrainRef.current.delivery,
      stack:
        deliveryToStack(approved.delivery) ||
        projectBrainRef.current.stack
    });
    executionQueueRef.current = null;
    stepReworkCountRef.current = {};
    // Keep the previous plan visible under Conductor until the new lock commits.

    onSelectAgent(plannerAgent.id);
    onConversationPatch?.({
      approvedPlan: approved,
      executionQueue: null,
      agentId: plannerAgent.id
    });

    const confirmDisplay = confirmationText.trim() || `Option ${option.id}: ${option.title}`;
    updateProgress(log => noteUserTurn(log, `${option.title}. ${option.description}`));
    const lockRoute = resolveRoute(`Lock execution plan for option ${option.id}`, plannerAgent);
    fitContext(
      modelMaxCtx(lockRoute?.routedNode, lockRoute?.routedModel || ''),
      lockRoute?.routedModel || ''
    );
    const userConfirm: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: 'user',
      raw: confirmDisplay,
      display: confirmDisplay,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      chosenPlanOptionId: option.id,
      personaHandle: 'planner',
      ...(attachedImages.length ? { images: attachedImages } : {})
    };
    setMessages(prev => {
      const marked = prev.map(m =>
        m.id === planMsg.id ? { ...m, selectedPlanOptionId: option.id } : m
      );
      const next = [...marked, userConfirm];
      messagesRef.current = next;
      return next;
    });

    resetAgentLoopBudget();

    const lockPrompt = `${formatApprovedPlanContext(approved)}

## Chosen option
${option.id}. ${option.title}
${option.description}

Break this into ordered <execution_plan> steps with concrete coder tasks. Do not implement code.`;

    setExecutingPlanNotice(`Planner locking execution plan for Option ${option.id}…`);

    const lockMsg = await runSingleNodeTurn({
      userText: `Lock execution plan for option ${option.id}`,
      fullPrompt: lockPrompt,
      attachedImages,
      agent: plannerAgent,
      lockPlanMode: true,
      skipUserAppend: true,
      notice: `Planner writing steps for Option ${option.id}`,
      run
    });

    if (!runLive(run)) return;

    const raw = lockMsg?.raw || '';
    let parsed = parseExecutionPlan(raw);
    if (!parsed?.steps.length) {
      // Fallback: one step from the chosen option so orchestration can still run
      parsed = {
        summary: option.title,
        steps: [
          {
            id: '1',
            title: option.title,
            description: option.description,
            tasks: [
              {
                id: '1a',
                title: option.title,
                description: option.description || approved.originalUserRequest
              }
            ]
          }
        ]
      };
    }

    let plan = createPlanFromParsed(parsed, {
      conversationId: conversationIdRef.current || undefined,
      chosenOptionId: option.id,
      chosenOptionTitle: option.title,
      ...(approved.delivery ? { delivery: approved.delivery } : {})
    });
    // Same conversation: keep finished steps and append the new lock.
    plan = appendPlannerPlan(plannerPlanRef.current, plan);
    if (approved.delivery && !plan.delivery) {
      plan = { ...plan, delivery: approved.delivery, updatedAt: Date.now() };
    }
    plan = activateNextStep(plan);
    fullAutoGateRef.current = null;
    await commitPlannerPlan(plan, run.token);
    if (!runLive(run)) return;
    setExecutingPlanNotice(
      `Plan locked (${plan.steps.length} steps) — dispatching next step…`
    );

    await dispatchActiveStep(run);
    } finally {
      leaveConductorRun(entered.owned, run.token);
    }
  };

  /**
   * When a planner proposal turn finishes: run a click that arrived while the run was held,
   * otherwise let Full auto pick. A selection already on the live messages blocks auto-pick.
   */
  const maybeFullAutoPickPlan = async (run: ConductorRun, origin?: ChatMessage) => {
    if (!runLive(run)) {
      releaseStashedPlanChoice();
      return;
    }
    const originId = origin?.id;
    const turn = originId ? messagesFromOrigin(messagesRef.current, originId) : [];
    const stashed = stashedPlanChoiceRef.current;
    const stashInTurn =
      !!stashed &&
      (stashed.messageId === originId || turn.some(message => message.id === stashed.messageId));
    if (stashInTurn && stashed) {
      const message =
        messagesRef.current.find(item => item.id === stashed.messageId) ||
        (origin?.id === stashed.messageId ? origin : undefined);
      if (!message || !runLive(run)) {
        releaseStashedPlanChoice();
        return;
      }
      stashedPlanChoiceRef.current = null;
      logRun({ kind: 'info', text: stashed.confirmation });
      setExecutingPlanNotice(stashed.confirmation);
      await executeChosenPlan(stashed.option, message, stashed.confirmation, [], run);
      return;
    }
    const liveOrigin = originId
      ? messagesRef.current.find(message => message.id === originId) || origin
      : origin;
    // Option ids repeat across proposals (1, 2, 3), so only move a click onto another card
    // when its own card is gone (a retry replaced it) or Full auto would pick anyway.
    const mayRetarget =
      !!stashed &&
      (fullAutoRef.current || !messagesRef.current.some(message => message.id === stashed.messageId));
    const matched =
      stashed && mayRetarget && liveOrigin?.planOptions
        ? liveOrigin.planOptions.find(
            option => option.id === stashed.option.id || option.title === stashed.option.title
          )
        : undefined;
    if (stashed && matched && liveOrigin && !liveOrigin.selectedPlanOptionId && runLive(run)) {
      stashedPlanChoiceRef.current = null;
      const confirmation = stashed.confirmation;
      logRun({ kind: 'info', text: confirmation });
      setExecutingPlanNotice(confirmation);
      const previousId = stashed.messageId;
      setMessages(prev => {
        const next = prev.map(message => {
          if (message.id === previousId && previousId !== liveOrigin.id) {
            return { ...message, selectedPlanOptionId: undefined };
          }
          if (message.id === liveOrigin.id) {
            return { ...message, selectedPlanOptionId: matched.id };
          }
          return message;
        });
        messagesRef.current = next;
        return next;
      });
      await executeChosenPlan(matched, { ...liveOrigin, selectedPlanOptionId: matched.id }, confirmation, [], run);
      return;
    }
    if (stashed) releaseStashedPlanChoice();
    if (!fullAutoRef.current || !runLive(run)) return;
    if (turn.some(message => !!message.selectedPlanOptionId)) return;
    const pending = pendingPlanChoice(messagesRef.current, originId);
    if (!pending?.planOptions || pending.planOptions.length < 2) return;
    const request = findPlanOriginalRequest(messagesRef.current, pending);
    const option = chooseFullAutoPlanOption(pending.planOptions, request);
    if (!option || !runLive(run)) return;
    const notice = fullAutoPickNotice(option);
    logRun({ kind: 'user', action: 'auto', text: notice });
    setExecutingPlanNotice(notice);
    await executeChosenPlan(option, pending, notice, [], run);
  };

  /** User chose "Retry differently" after the stuck ladder — one more local attempt, new approach. */
  const retryStuckLocally = async (task: string) => {
    const cleaned = stripKeepFixingPrefix(task).trim();
    if (!cleaned) return;
    const big = pickLargestLocalTarget(nodesRef.current);
    if (!big) {
      setExecutingPlanNotice('No local model online to retry.');
      return;
    }
    const entered = bindRun(null, true, 'retry');
    if (!entered) return;
    logRun({ kind: 'user', action: 'retry', text: cleaned.slice(0, 300) });
    const run = entered.run;
    try {
    stuckRef.current = { key: stuckKey(cleaned), stage: 'big' };
    setExecutingPlanNotice(`Retrying differently on ${big.node.name} · ${big.model}`);
    resetAgentLoopBudget();
    await runSingleNodeTurn({
      userText: `Retry differently: ${cleaned}`,
      fullPrompt: `You already repeated this step without finishing it. Do NOT repeat the same approach.\n\nEither:\n1) Implement a concrete different fix with <edit_file> / <write_file>, or\n2) Stop and state what is blocking in one short sentence.\n\nStuck step:\n${cleaned}`,
      agent: coderAgent,
      planMode: false,
      reviewMode: false,
      approvedPlan: approvedPlanRef.current,
      notice: `Stuck retry (different approach) on ${big.node.name} · ${big.model}`,
      pinRoute: big,
      forceRoute: true,
      run
    });
    if (runLive(run)) await reviewAndAdvance(0, cleaned, run);
    } finally {
      leaveConductorRun(entered.owned, run.token);
    }
  };

  const confirmPaidAssist = async (task: string) => {
    const paid = pickPaidFrontier(nodesRef.current);
    if (!paid || !task.trim()) return;
    const entered = bindRun(null, true, 'assist');
    if (!entered) return;
    const run = entered.run;
    const { hostLog } = scopeRunLog();
    try {
    setIsStreaming(true);
    setExecutingPlanNotice(`Asking ${paid.node.name} · ${paid.model}…`);
    let brief: string | null = null;
    try {
      brief = await requestAssistBrief(
        paid,
        'The local models are repeating this step and not fixing it. Give one short solution. Do not rewrite the file.',
        `${progressForPrompt()}\n\nStuck step:\n${task}`,
        false,
        run
      );
    } catch (err: any) {
      hostLog('warn', `paid stuck: ${err?.message || err}`);
    }
    if (!runLive(run)) return;
    if (!brief) {
      setIsStreaming(false);
      setExecutingPlanNotice('The paid API did not return a solution.');
      return;
    }
    const stamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    setMessages(prev => [
      ...prev,
      {
        id: `paid-${Date.now()}`,
        role: 'assistant',
        raw: brief,
        display: `Paid API solution:\n\n${brief}`,
        agentId: coderAgent.id,
        personaHandle: coderAgent.handle,
        endpointId: paid.node.id,
        endpointName: paid.node.name,
        model: paid.model,
        timestamp: stamp,
        notice: `Paid solution from ${paid.node.name}`,
        planOptions: [{ id: 'copy-paid', title: 'Copy solution', description: brief, action: 'copy' }]
      }
    ]);
    const big = roleTarget('coder', () => pickLargestLocalTarget(nodesRef.current));
    if (!big) {
      setIsStreaming(false);
      setExecutingPlanNotice('Paid solution is in the chat. No model is online to apply it.');
      return;
    }
    ephemeralWorkerRef.current = true;
    await runSingleNodeTurn({
      userText: 'Continue: apply the paid API solution',
      fullPrompt: `Apply this solution from the paid API. Do not repeat the failed approach.\n\n${brief}`,
      agent: coderAgent,
      planMode: false,
      approvedPlan: approvedPlanRef.current,
      notice: `Applying the paid solution on ${big.node.name} · ${big.model}`,
      pinRoute: big,
      forceRoute: true,
      freshContext: true,
      run
    });
    if (runLive(run)) await reviewAndAdvance(0, brief, run);
    if (runIsCurrent(run.token) || !heldRef.current) restorePlannerControl();
    } finally {
      if (runIsCurrent(run.token) || !heldRef.current) setIsStreaming(false);
      leaveConductorRun(entered.owned, run.token);
    }
  };

  const handleSelectPlanOption = (option: PlanOption, planMsg: ChatMessage) => {
    logRun({ kind: 'info', text: `Plan option ${option.id}: ${option.title}` });
    if (option.action === 'copy') {
      void navigator.clipboard.writeText(option.description);
      return;
    }
    const livePlan = messagesRef.current.find(message => message.id === planMsg.id) || planMsg;
    if (livePlan.selectedPlanOptionId) return;
    const markSelected = () => {
      setMessages(prev => {
        const next = prev.map(message =>
          message.id === planMsg.id ? { ...message, selectedPlanOptionId: option.id } : message
        );
        messagesRef.current = next;
        return next;
      });
    };
    if (option.action === 'paid' || option.action === 'retry-local' || option.action === 'stop') {
      if (isStreaming || heldRef.current) return;
      markSelected();
      if (option.action === 'paid') {
        void confirmPaidAssist(option.description);
        return;
      }
      if (option.action === 'retry-local') {
        void retryStuckLocally(option.description);
        return;
      }
      stuckRef.current = { key: '', stage: 'none' };
      setExecutingPlanNotice(null);
      return;
    }
    const confirmation = `Option ${option.id}: ${option.title}`;
    if (isStreaming || heldRef.current) {
      markSelected();
      stashedPlanChoiceRef.current = {
        messageId: planMsg.id,
        option,
        confirmation
      };
      logRun({ kind: 'info', text: confirmation });
      return;
    }
    void executeChosenPlan(option, livePlan, confirmation);
  };

  const handleSendMessage = async (
    e?: React.FormEvent,
    overrideText?: string,
    userAction: 'send' | 'retry' = 'send'
  ) => {
    if (e) e.preventDefault();
    const hasImages = !overrideText && pendingImages.length > 0;
    const typed = (overrideText ?? input).trim();
    if ((!typed && !hasImages) || isStreaming || heldRef.current) return;
    setAssistError(null);

    const sendRoute = resolveRoute(typed || 'Look at this screenshot', currentAgent);
    const sendNode = sendRoute?.routedNode;
    const sendModel = sendRoute?.routedModel || '';
    const sendTier = sendModel
      ? resolveModelFit(
          sendNode,
          sendModel,
          roleForDynamicCtx(currentAgent.handle),
          currentAgent.numCtx
        ).tier
      : 'standard';
    const attachedImages = selectImagesForTier(overrideText ? [] : [...pendingImages], sendTier);
    const userText =
      typed ||
      (hasImages
        ? 'Look at this screenshot and explain what you see. Identify any errors, UI issues, or what I might need help with.'
        : '');
    if (!overrideText) {
      setInput('');
      setPendingImages([]);
    }
    if (!projectBrainRef.current.brief) {
      commitProjectBrain({ ...projectBrainRef.current, brief: userText.slice(0, 1200) });
    }
    updateProgress(log => noteUserTurn(log, userText));
    fitContext(modelMaxCtx(sendNode, sendModel), sendModel);
    resetAgentLoopBudget();
    const enteredSend = bindRun(null, true, userAction);
    if (!enteredSend) return;
    logRun({ kind: 'user', action: userAction, text: userText.slice(0, 300) });
    try {
    stuckRef.current = { key: '', stage: 'none' };
    ephemeralWorkerRef.current = false;

    const mentionRels = [...new Set([...pinnedFiles, ...extractAtMentions(userText)])];
    let pinnedBlock = '';
    if (mentionRels.length && window.electronAPI?.readFile && workspacePath) {
      const sep = workspacePath.includes('\\') ? '\\' : '/';
      const chunks: string[] = [];
      for (const rel of mentionRels.slice(0, 6)) {
        try {
          const abs = `${workspacePath.replace(/[\\/]+$/, '')}${sep}${rel.replace(/\//g, sep)}`;
          const res = await window.electronAPI.readFile(abs);
          if (res.content != null) {
            chunks.push(`### @${rel}\n\`\`\`\n${res.content.slice(0, 8000)}\n\`\`\``);
            noteOwnedPath(rel);
          }
        } catch {
          chunks.push(`### @${rel}\n(unreadable)`);
        }
      }
      if (chunks.length) pinnedBlock = `${chunks.join('\n\n')}\n\n`;
    }
    if (!runLive(enteredSend.run)) return;

    let fileBlock = '';
    if (includeActiveFile && activeTab) {
      const capped = capActiveFileForTier(activeTab.content || '', sendTier, activeTab.cursorLine);
      fileBlock = `[Active File: ${activeTab.name}]\n\`\`\`${activeTab.language}\n${capped}\n\`\`\`\n\n`;
    }
    const fullPrompt = `${fileBlock}${pinnedBlock}User Task / Request:\n${userText}`;

    // Match "option 1" / "1" / title against the last pending Planner options
    const pendingPlan = findPendingPlanMessage(messagesRef.current);
    if (pendingPlan?.planOptions?.length) {
      const matched = matchPlanOption(userText, pendingPlan.planOptions);
      if (matched) {
        if (
          matched.action === 'paid' ||
          matched.action === 'retry-local' ||
          matched.action === 'stop' ||
          matched.action === 'copy'
        ) {
          // Stuck-ladder cards are not plans. The click handler binds its own run.
          leaveConductorRun(enteredSend.owned, enteredSend.run.token);
          handleSelectPlanOption(matched, pendingPlan);
          return;
        }
        return await executeChosenPlan(matched, pendingPlan, userText, attachedImages, enteredSend.run);
      }
    }

    const planActive = isPlanActive(plannerPlanRef.current);

    // During an active plan, the user talks to Planner (workers are ephemeral).
    if (planActive) {
      if (!isPlannerSelected) {
        onSelectAgent(plannerAgent.id);
        onConversationPatch?.({ agentId: plannerAgent.id });
      }
      setExecutingPlanNotice(null);
      const step = getActiveStep(plannerPlanRef.current);
      const planHint = step
        ? `\n\n[ACTIVE PLAN — step #${step.id}: ${step.title}. Advise the user, clarify, or replan only if they ask. Do not emit a fresh <plan_options> unless they want to replan. Do not implement files — Coders are dispatched automatically.]`
        : `\n\n[ACTIVE PLAN IN PROGRESS. Advise the user or replan only if they ask. Do not implement files yourself.]`;
      return await runSingleNodeTurn({
        userText,
        fullPrompt: `${fullPrompt}${planHint}`,
        attachedImages,
        agent: plannerAgent,
        planMode: false,
        run: enteredSend.run
      });
    }

    // Fresh Planner ask clears a prior finished approvedPlan — keep plannerPlan on the panel
    // until a new execution_plan locks (so the task list does not vanish under Conductor).
    if (approvedPlanRef.current && isPlannerSelected) {
      approvedPlanRef.current = null;
      executionQueueRef.current = null;
      onConversationPatch?.({ approvedPlan: null, executionQueue: null });
      setExecutingPlanNotice(null);
    }

    // Planner → propose options (Coder/Reviewer run later as workers)
    if (isPlannerSelected) {
      setExecutingPlanNotice(null);
      setMessages(prev => {
        const next = prev.map(m =>
          m.planOptions?.length && !m.selectedPlanOptionId
            ? { ...m, selectedPlanOptionId: 'dismissed' }
            : m
        );
        messagesRef.current = next;
        return next;
      });
      return await runSingleNodeTurn({
        userText,
        fullPrompt,
        attachedImages,
        agent: currentAgent,
        planMode: true,
        run: enteredSend.run
      });
    }

    // Explicit Reviewer (power-user) → findings + review_plan only (cleared context)
    if (isReviewerSelected) {
      setExecutingPlanNotice(null);
      ephemeralWorkerRef.current = true;
      return await runSingleNodeTurn({
        userText,
        fullPrompt,
        attachedImages,
        agent: currentAgent,
        reviewMode: true,
        freshContext: true,
        run: enteredSend.run
      });
    }

    // Explicit Coder / Docs (power-user shortcuts)
    if (isPipelineMode && !hasImages) {
      await handleSendPipelineMessage(userText, fullPrompt, {
        approvedPlan: approvedPlanRef.current,
        run: enteredSend.run
      });
    } else {
      await runSingleNodeTurn({
        userText,
        fullPrompt,
        attachedImages,
        agent: currentAgent,
        planMode: false,
        approvedPlan: approvedPlanRef.current,
        run: enteredSend.run
      });
    }
    if (runLive(enteredSend.run) && autoReviewOn()) {
      await reviewAndAdvance(0, '', enteredSend.run);
    }
    } finally {
      leaveConductorRun(enteredSend.owned, enteredSend.run.token);
    }
  };

  const handleStop = () => {
    pendingReviewResumeRef.current = null;
    ephemeralWorkerRef.current = false;
    releaseStashedPlanChoice();
    if (isPlanActive(plannerPlanRef.current)) {
      setPlanPaused(true);
      // Keep existing checkpoint; only stamp coder if nothing was saved yet.
      const plan = plannerPlanRef.current;
      if (plan && !plan.resumePhase) setPlanResumePhase('coder');
      const step = getActiveStep(plan);
      const phase = plan?.resumePhase || 'coder';
      const phaseLabel =
        phase === 'review' ? 'Review' : phase === 'verdict' ? 'verdict' : 'Coder';
      restorePlannerControl(
        step
          ? `Paused during ${phaseLabel} on step #${step.id}: ${step.title} — press Play to resume.`
          : 'Paused — press Play on the active step to resume.'
      );
    } else {
      setPlanPaused(false);
      setExecutingPlanNotice(null);
    }
    stopConductor();
    setIsStreaming(false);
  };

  /** True when escalate would only re-set blockedReason (Resume dead-loop). */
  const escalateWouldNoOp = (plan: PlannerPlan, stepId?: string | number | null) => {
    if (plan.blockedReason) return true;
    const escalations = plan.escalationCount || 0;
    if (escalations >= MAX_PLAN_ESCALATIONS || plan.steps.length >= MAX_PLAN_STEPS) return true;
    const stuck =
      (stepId != null && plan.steps.find(s => String(s.id) === String(stepId))) ||
      getActiveStep(plan);
    if (!stuck) return false;
    return (
      stuck.status === 'failed' &&
      effectiveStepReworkCount(String(stuck.id), stuck.reworkCount) > MAX_STEP_REWORKS &&
      (escalations >= MAX_PLAN_ESCALATIONS || plan.steps.length >= MAX_PLAN_STEPS)
    );
  };

  /** Resume from the saved checkpoint (coder / review / verdict) — not a blind step restart. */
  const resumeActivePlan = async () => {
    if (heldRef.current) return;
    const activePlan = plannerPlanRef.current;
    if (activePlan?.resumePhase === 'final-review') {
      if (!planReadyForRelease(activePlan)) {
        setExecutingPlanNotice('Final review is saved, but the plan is not ready to release.');
        return;
      }
      finalReviewPlanIdRef.current = null;
      const ship = bindRun(null, true, 'play');
      if (!ship) return;
      logRun({ kind: 'user', action: 'play', text: 'final-review' });
      try {
        setPlanPaused(false);
        await finishVerifiedPlan(activePlan, ship.run);
      } finally {
        leaveConductorRun(ship.owned, ship.run.token);
      }
      return;
    }
    if (!isPlanActive(activePlan) || !activePlan) {
      setPlanPaused(false);
      setExecutingPlanNotice('No active plan to continue.');
      return;
    }
    const ship = bindRun(null, true, 'play');
    if (!ship) return;
    logRun({ kind: 'user', action: 'play' });
    const plan = activePlan;
    setPlanPaused(false);
    resetAgentLoopBudget();
    try {

    const step = getActiveStep(plan);
    const stepId = step?.id;

    // Blocked / escalation wall → compiler heal (do not re-escalate into the same pause).
    if (
      plan.blockedReason ||
      (step &&
        step.status === 'failed' &&
        effectiveStepReworkCount(String(step.id), step.reworkCount) > MAX_STEP_REWORKS &&
        escalateWouldNoOp(plan, step.id))
    ) {
      await healBlockedPlan();
      return;
    }

    const pendingVerdict = [...messagesRef.current].reverse().find(
      m =>
        m.stepVerdict &&
        !m.stepVerdictApplied &&
        (m.stepVerdictNeedsConfirm || plan.resumePhase === 'verdict') &&
        (!stepId || !m.stepVerdict.stepId || m.stepVerdict.stepId === stepId)
    );

    // Infer phase: explicit checkpoint, else chat evidence, else coder.
    let phase: PlannerResumePhase = plan.resumePhase || 'coder';
    if (pendingVerdict?.stepVerdict) phase = 'verdict';
    else if (!plan.resumePhase) {
      const lastReview = [...messagesRef.current].reverse().find(
        m =>
          m.role === 'assistant' &&
          (m.personaHandle === 'reviewer' || m.stepVerdict) &&
          (!stepId || !m.stepVerdict?.stepId || m.stepVerdict.stepId === stepId)
      );
      const lastCoder = [...messagesRef.current].reverse().find(
        m =>
          m.role === 'assistant' &&
          (m.personaHandle === 'coder' || m.personaHandle === 'planner') &&
          (m.toolCalls || []).some(t => t.name === 'write_file' || t.name === 'edit_file')
      );
      const tasksDone =
        !!step &&
        step.tasks.length > 0 &&
        step.tasks.every(t => t.status === 'completed');
      if (lastReview?.stepVerdict && !lastReview.stepVerdictApplied) phase = 'verdict';
      else if (tasksDone || (lastCoder && (!lastReview || messagesRef.current.indexOf(lastCoder) > messagesRef.current.indexOf(lastReview)))) {
        phase = 'review';
      } else if (step?.status === 'failed') {
        phase = 'coder';
      }
    }

    if (phase === 'verdict') {
      const verdictMsg =
        pendingVerdict ||
        [...messagesRef.current].reverse().find(
          m => m.stepVerdict && !m.stepVerdictApplied
        );
      if (verdictMsg?.stepVerdict) {
        setExecutingPlanNotice(
          `Resuming — applying ${verdictMsg.stepVerdict.result === 'yay' ? 'Yay' : 'Nay'} then continuing…`
        );
        await applyStepVerdictAndContinue(verdictMsg, undefined, ship.run);
        return;
      }
      phase = 'review';
    }

    // Past Nay rework cap but escalate still can grow the plan — escalate; else heal.
    if (
      step &&
      step.status === 'failed' &&
      effectiveStepReworkCount(String(step.id), step.reworkCount) > MAX_STEP_REWORKS
    ) {
      if (escalateWouldNoOp(plan, step.id)) {
        await healBlockedPlan();
        return;
      }
      await escalateStepToPlannerFixes(String(step.id), ship.run);
      return;
    }

    if (phase === 'review') {
      setExecutingPlanNotice(
        step
          ? `Resuming Review on step #${step.id}: ${step.title}…`
          : 'Resuming Review…'
      );
      setPlanResumePhase('review');
      await reviewActiveStep(ship.run);
      return;
    }

    // phase === 'coder' — finish pending tool applies if any, else only re-dispatch when needed.
    const lastCoderMsg = [...messagesRef.current].reverse().find(
      m =>
        m.role === 'assistant' &&
        (m.toolCalls || []).some(
          t => t.name === 'write_file' || t.name === 'edit_file' || t.name === 'run_command'
        )
    );
    const pendingTools = (lastCoderMsg?.toolCalls || []).filter(
      t => t.status !== 'done' && t.status !== 'error'
    );
    if (lastCoderMsg && pendingTools.length > 0) {
      setExecutingPlanNotice('Resuming — finishing pending workspace actions…');
      setIsStreaming(true);
      let tools = lastCoderMsg.toolCalls || [];
      if (autoApplyOn()) {
        tools = await autoApplyWritableTools(tools, toolDepsRef.current);
        if (runLive(ship.run)) {
          tools = await runAuxTools(tools, toolDepsRef.current);
          if (runLive(ship.run)) {
            const cmdPass = await runCommandTools(tools, toolDepsRef.current);
            tools = cmdPass.tools;
          }
        }
        updateProgress(log => noteSavedFiles(log, tools, savedFileFingerprints()));
        noteAppliedWrites(tools);
      }
      const updatedMsg = { ...lastCoderMsg, toolCalls: tools };
      if (!runLive(ship.run)) {
        const saved = messagesRef.current.map(m => (m.id === lastCoderMsg.id ? updatedMsg : m));
        messagesRef.current = saved;
        setMessages(saved);
        if (runOwnsUi(ship.run)) {
          setIsStreaming(false);
          setPlanPaused(true);
        }
        return;
      }
      setMessages(prev => {
        const next = prev.map(m => (m.id === lastCoderMsg.id ? updatedMsg : m));
        messagesRef.current = next;
        return next;
      });
      setIsStreaming(false);
      if (!runLive(ship.run)) {
        if (runOwnsUi(ship.run)) {
          setPlanPaused(true);
          setPlanResumePhase('coder', ship.run.token);
        }
        return;
      }
      if (shouldContinueFromTools(tools, continueDecisionOpts())) {
        await continueWithToolResults(updatedMsg, {
          createIntent: true,
          freshContext: true,
          role: 'coder',
          run: ship.run
        });
      }
      if (!runLive(ship.run)) {
        if (runOwnsUi(ship.run)) {
          setPlanPaused(true);
          setPlanResumePhase('coder', ship.run.token);
        }
        return;
      }
      if (writesUnresolved(writeToolsFromCoderOrigin(updatedMsg))) {
        setExecutingPlanNotice('Resuming Coder — previous writes did not succeed.');
        await dispatchActiveStep(ship.run);
        return;
      }
      if (step) {
        const p = plannerPlanRef.current;
        if (p) {
          await commitPlannerPlan(
            { ...p, resumePhase: 'review', updatedAt: Date.now() },
            ship.run.token
          );
        }
      }
      setExecutingPlanNotice(
        step ? `Resuming Review on step #${step.id}…` : 'Resuming Review…'
      );
      await reviewActiveStep(ship.run);
      return;
    }

    const wroteSomething = (lastCoderMsg?.toolCalls || []).some(
      t =>
        (t.name === 'write_file' || t.name === 'edit_file') &&
        (t.status === 'done' || autoApplyOn())
    );
    const tasksAlreadyDone =
      !!step &&
      step.tasks.length > 0 &&
      step.tasks.every(t => t.status === 'completed');

    if (writesUnresolved(coderWriteTools())) {
      setExecutingPlanNotice(
        step
          ? `Resuming Coder on step #${step.id} — writes did not succeed.`
          : 'Resuming Coder — writes did not succeed.'
      );
      await dispatchActiveStep(ship.run);
      return;
    }

    if (wroteSomething || tasksAlreadyDone) {
      if (step) {
        const p = plannerPlanRef.current;
        if (p && p.resumePhase !== 'review') {
          await commitPlannerPlan({ ...p, resumePhase: 'review', updatedAt: Date.now() }, ship.run.token);
        } else {
          setPlanResumePhase('review', ship.run.token);
        }
      } else {
        setPlanResumePhase('review');
      }
      setExecutingPlanNotice(
        step
          ? `Resuming Review on step #${step.id}: ${step.title}…`
          : 'Resuming Review…'
      );
      await reviewActiveStep(ship.run);
      return;
    }

    setExecutingPlanNotice(
      step
        ? `Resuming Coder on step #${step.id}: ${step.title}…`
        : 'Resuming Coder…'
    );
    await dispatchActiveStep(ship.run);
    } finally {
      leaveConductorRun(ship.owned, ship.run.token);
    }
  };

  const handleApplyAllTools = async (msg: ChatMessage) => {
    if (!msg.toolCalls || msg.toolCalls.length === 0) return;
    await runAsUser('apply', async run => {
      setIsStreaming(true);
      resetAgentLoopBudget();
      try {
        const updated: ToolCall[] = [];
        const original = msg.toolCalls || [];
        const keepFinished = (rest: ToolCall[]) => {
          if (!updated.length) return;
          const partial: ChatMessage = { ...msg, toolCalls: [...updated, ...rest] };
          const saved = messagesRef.current.map(m => (m.id === msg.id ? partial : m));
          messagesRef.current = saved;
          setMessages(saved);
          updateProgress(log => noteSavedFiles(log, updated, savedFileFingerprints()));
        };
        for (let i = 0; i < original.length; i += 1) {
          const tool = original[i];
          if (!runLive(run)) {
            keepFinished(original.slice(i));
            return;
          }
          if (tool.status === 'done' || tool.status === 'error') {
            updated.push(tool);
            continue;
          }
          updated.push(await executeTool(tool, toolDepsRef.current));
        }
        if (!runLive(run)) {
          keepFinished([]);
          return;
        }
        updateProgress(log => noteSavedFiles(log, updated, savedFileFingerprints()));
        const nextMsg: ChatMessage = { ...msg, toolCalls: updated };
        setMessages(prev => {
          const next = prev.map(m => (m.id === msg.id ? nextMsg : m));
          messagesRef.current = next;
          return next;
        });
        if (shouldContinueFromTools(updated, continueDecisionOpts())) {
          await continueWithToolResults(nextMsg, { createIntent: true, run });
        }
      } finally {
        if (runOwnsUi(run)) setIsStreaming(false);
      }
    });
  };

  const latestAssistant = [...messages].reverse().find(m => m.role === 'assistant');
  const peerStreaming = !!(peerConductor?.isStreaming && !isStreaming);
  const localActivityLabel = activityLabelOf(activityStack);
  // A plan notice stays on the banner after a run ends or pauses; it only means "busy" while a run holds the lock.
  const showStreamingUi =
    isStreaming ||
    peerStreaming ||
    !!localActivityLabel ||
    (!!executingPlanNotice && heldRef.current);
  const runStatus = describeRunStatus({
    steps: nodeWorkSteps,
    activityLabel: localActivityLabel,
    notice: executingPlanNotice,
    message: isStreaming ? latestAssistant : undefined,
    peerLabel: peerStreaming ? peerConductor?.activityLabel : undefined
  });
  const activityLabel = runStatus.text;

  const handleNewChatClick = () => {
    if (isStreaming || heldRef.current) {
      stopConductor();
      setIsStreaming(false);
    }
    onNewChat();
  };
  newChatRef.current = () => {
    handleNewChatClick();
    requestAnimationFrame(() => composerRef.current?.focus());
  };

  const handleSelectChat = (id: string) => {
    if (id === conversation?.id) {
      setHistoryOpen(false);
      return;
    }
    if (isStreaming || heldRef.current) {
      stopConductor();
      setIsStreaming(false);
    }
    onSelectConversation(id);
  };

  // Ctrl/Cmd+L starts a new chat and focuses the composer.
  // The listener reads newChatRef so it is not stuck on the first render.
  // Monaco (select line) and the terminal keep the shortcut.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
      if (e.key.toLowerCase() !== 'l') return;
      const target = e.target;
      if (target instanceof Element) {
        if (target.closest('.monaco-editor, .xterm')) return;
        const field = target.closest('input, textarea, select, [contenteditable="true"]');
        if (field && field !== composerRef.current) return;
      }
      e.preventDefault();
      newChatRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const [controlColWidth, setControlColWidth] = useState(controlWidth);
  const controlColWidthRef = useRef(controlWidth);
  const [nodeWorkColWidth, setNodeWorkColWidth] = useState(nodeWorkWidth);
  const nodeWorkColWidthRef = useRef(nodeWorkWidth);
  const controlPaneRef = useRef<HTMLDivElement>(null);
  const nodePaneRef = useRef<HTMLDivElement>(null);
  const paneWidthRef = useRef(0);
  const nodeBasisRef = useRef(nodeWorkWidth);
  useEffect(() => {
    setControlColWidth(controlWidth);
    controlColWidthRef.current = controlWidth;
  }, [controlWidth]);
  useEffect(() => {
    setNodeWorkColWidth(nodeWorkWidth);
    nodeWorkColWidthRef.current = nodeWorkWidth;
  }, [nodeWorkWidth]);

  const { collapsed: nodeWorkCollapsed, toggle: toggleNodeWork } = useNodeWorkCollapse(
    nodeWorkSteps.length > 0
  );
  const tailMessage = messages[messages.length - 1];
  const scrollSignature = `${messages.length}:${tailMessage?.id || ''}:${tailMessage?.display?.length || 0}:${tailMessage?.raw?.length || 0}:${tailMessage?.toolCalls?.length || 0}:${isStreaming ? 1 : 0}`;
  const transcriptScroll = useStickToBottom(scrollSignature);
  const [paneWidth, setPaneWidth] = useState(0);
  useLayoutEffect(() => {
    const el = document.getElementById('agent-conductor-root');
    if (!el) return;
    const publish = () => setPaneWidth(el.clientWidth);
    publish();
    if (typeof ResizeObserver === 'undefined') return;
    const obs = new ResizeObserver(publish);
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  paneWidthRef.current = paneWidth;

  const limitsFor = (
    pane: number,
    control: number,
    node: number,
    collapsed: boolean,
    nodeForControl = node
  ) => {
    if (fill || pane <= 0) {
      const shownNode = collapsed ? NODE_WORK_RAIL : Math.min(Math.max(0, node), NODE_WORK_MIN);
      const shownControl = Math.min(Math.max(0, control), CONTROL_MIN);
      return {
        shownControl,
        shownNode,
        controlMin: Math.min(CONTROL_MIN, shownControl),
        controlMax: CONTROL_MAX,
        nodeMin: collapsed ? NODE_WORK_RAIL : Math.min(NODE_WORK_MIN, shownNode),
        nodeMax: collapsed ? NODE_WORK_RAIL : NODE_WORK_MAX,
        transcriptMin: TRANSCRIPT_MIN
      };
    }
    return fitInnerColumns(pane, control, node, collapsed, nodeForControl);
  };

  const commitControlWidth = (next: number) => {
    controlColWidthRef.current = next;
    setControlColWidth(next);
    onControlWidthChange?.(next);
  };
  const commitNodeWorkWidth = (next: number) => {
    nodeWorkColWidthRef.current = next;
    setNodeWorkColWidth(next);
    onNodeWorkWidthChange?.(next);
  };

  const controlDrag = usePaneDrag({
    axis: 'x',
    valueSide: 'after',
    disabled: fill,
    getMin: () =>
      limitsFor(
        paneWidthRef.current,
        controlColWidthRef.current,
        nodeBasisRef.current,
        nodeWorkCollapsed,
        nodeBasisRef.current
      ).controlMin,
    getMax: () =>
      limitsFor(
        paneWidthRef.current,
        controlColWidthRef.current,
        nodeBasisRef.current,
        nodeWorkCollapsed,
        nodeBasisRef.current
      ).controlMax,
    getValue: () => controlColWidthRef.current,
    getPane: () => controlPaneRef.current,
    onPreview: next => {
      controlColWidthRef.current = next;
      setControlColWidth(next);
    },
    onCommit: commitControlWidth
  });
  const nodeDrag = usePaneDrag({
    axis: 'x',
    valueSide: 'after',
    disabled: fill || nodeWorkCollapsed,
    getMin: () =>
      limitsFor(
        paneWidthRef.current,
        controlColWidthRef.current,
        nodeWorkColWidthRef.current,
        nodeWorkCollapsed,
        nodeBasisRef.current
      ).nodeMin,
    getMax: () =>
      limitsFor(
        paneWidthRef.current,
        controlColWidthRef.current,
        nodeWorkColWidthRef.current,
        nodeWorkCollapsed,
        nodeBasisRef.current
      ).nodeMax,
    getValue: () => nodeWorkColWidthRef.current,
    getPane: () => nodePaneRef.current,
    onPreview: next => {
      nodeWorkColWidthRef.current = next;
      setNodeWorkColWidth(next);
    },
    onCommit: commitNodeWorkWidth
  });

  const retryMessage = useStableCallback((_messageId: string) => {
    const last = [...messagesRef.current].reverse().find(m => m.role === 'user');
    const text = (last?.raw || last?.display || '').trim();
    if (text) void handleSendMessage(undefined, text, 'retry');
  });
  const selectPlan = useStableCallback((messageId: string, option: PlanOption) => {
    const msg = messagesRef.current.find(m => m.id === messageId);
    if (msg) handleSelectPlanOption(option, msg);
  });
  const sendReview = useStableCallback((messageId: string) => {
    const msg = messagesRef.current.find(m => m.id === messageId);
    if (msg) void sendReviewPlanToPlanner(msg);
  });
  const continueReview = useStableCallback((messageId: string) => {
    const msg = messagesRef.current.find(m => m.id === messageId);
    if (msg) void continueAfterCleanReview(msg);
  });
  const applyVerdict = useStableCallback((messageId: string) => {
    const msg = messagesRef.current.find(m => m.id === messageId);
    if (msg) void runAsUser('verdict', run => applyStepVerdictAndContinue(msg, undefined, run));
  });
  const applyAllTools = useStableCallback((messageId: string) => {
    const msg = messagesRef.current.find(m => m.id === messageId);
    if (msg) void handleApplyAllTools(msg);
  });
  const runTool = useStableCallback((tool: ToolCall) => runSingleTool(tool));
  const frontierOnline = nodes.filter(
    n => n.online && isFrontierNode(n) && getEnabledModelsForNode(n).length > 0
  ).length;
  const modelReady = nodes.some(n => n.online && getEnabledModelsForNode(n).length > 0);
  const meterSnap = lastContextMeter();
  const sampledAssistant = [...messages].reverse().find(
    m => m.role === 'assistant' && (m.stats?.promptTokens || 0) > 0
  );
  const contextUsed = sampledAssistant?.stats?.promptTokens || meterSnap?.promptTokens;
  const contextPinned = activeTargetMaxCtx || meterSnap?.pinnedCtx || sampledAssistant?.stats?.numCtx || 0;
  if (!nodeDrag.dragging) nodeBasisRef.current = nodeWorkColWidth;
  const liveColumns = limitsFor(
    paneWidth,
    controlColWidth,
    nodeWorkColWidth,
    nodeWorkCollapsed,
    nodeBasisRef.current
  );
  const shownControl = liveColumns.shownControl;
  const shownNodeWork = liveColumns.shownNode;
  const controlMin = liveColumns.controlMin;
  const controlMax = liveColumns.controlMax;
  const nodeMin = liveColumns.nodeMin;
  const nodeMax = liveColumns.nodeMax;
  const chromeReportRef = useRef({ control: -1, node: -1 });
  const onChromeWidthsChangeRef = useRef(onChromeWidthsChange);
  onChromeWidthsChangeRef.current = onChromeWidthsChange;
  useLayoutEffect(() => {
    if (fill || paneWidth <= 0) return;
    if (
      chromeReportRef.current.control === shownControl &&
      chromeReportRef.current.node === shownNodeWork
    ) {
      return;
    }
    chromeReportRef.current = { control: shownControl, node: shownNodeWork };
    onChromeWidthsChangeRef.current?.(shownControl, shownNodeWork);
  }, [fill, paneWidth, shownControl, shownNodeWork]);

  const nodeWorkColumn = (
    <div
      ref={nodePaneRef}
      style={fill ? undefined : { width: shownNodeWork }}
      className={`flex flex-col min-h-0 ${
        fill ? 'w-full border-t border-[#27272a]' : 'shrink-0'
      } ${nodeWorkCollapsed && !fill ? '' : fill ? '' : 'min-w-0'}`}
    >
      <NodeWorkPanel
        steps={nodeWorkSteps}
        collapsed={!fill && nodeWorkCollapsed}
        onToggleCollapsed={toggleNodeWork}
        persona={runStatus.persona}
        node={runStatus.node}
        model={runStatus.model}
        file={runStatus.file}
        statusText={runStatus.text}
      />
    </div>
  );

  const conductorColumn = (
      <div
        ref={controlPaneRef}
        style={fill ? undefined : { width: shownControl }}
        className={`flex flex-col min-h-0 bg-[#121215] ${
          fill ? 'w-full h-full' : 'shrink-0 min-w-0 border-l border-[#27272a]'
        }`}
      >
        <div className="p-2.5 border-b border-[#27272a] shrink-0 space-y-2">
          <div className="flex items-center justify-between gap-1">
            <div className="flex items-center gap-1.5 text-[10px] uppercase font-bold tracking-wider text-zinc-300">
              <Cpu className="w-3 h-3 text-indigo-400" />
              <span>Conductor</span>
            </div>
            {fill ? (
              <button
                type="button"
                onClick={() => setMobileControlsOpen(false)}
                className="p-1 text-zinc-400 hover:text-white rounded"
                title="Close conductor"
                aria-label="Close conductor"
              >
                <X className="w-4 h-4" />
              </button>
            ) : (
              <HelpTip title="Agent personas" align="right">
                <p>Left column is the conversation. This column is personas, the durable plan/task list, and routing.</p>
                <ul className="list-disc pl-3.5 space-y-1">
                  <li><b className="text-zinc-300">coder</b> — edits files</li>
                  <li><b className="text-zinc-300">planner</b> — proposes a plan, then locks the steps</li>
                  <li><b className="text-zinc-300">reviewer</b> — pass or fail for each step</li>
                  <li><b className="text-zinc-300">docs</b> — writes explanations</li>
                </ul>
              </HelpTip>
            )}
          </div>
          <div className="flex flex-wrap gap-1">
            {agents.map(a => (
              <button
                key={a.id}
                onClick={() => onSelectAgent(a.id)}
                title={`${a.name}: ${a.role}`}
                className={`px-2 py-0.5 text-[11px] font-medium rounded transition ${
                  selectedAgentId === a.id
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-[#202026]'
                }`}
              >
                {a.handle}
              </button>
            ))}
          </div>
        </div>

        <div className="px-2.5 pt-2 space-y-1.5 shrink-0">
          {(progressLog.next || progressLog.done.length > 0) && (
            <div className="text-[10px] text-zinc-400 truncate" title={renderWorkLog(progressLog)}>
              <span className="text-emerald-300/90 font-medium">Next:</span> {progressLog.next || '—'}
              <span className="text-zinc-500"> · {progressLog.done.length} done</span>
            </div>
          )}
          {executingPlanNotice && (
            <div className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-md bg-emerald-600/15 border border-emerald-500/30 text-[10px] text-emerald-200">
              <span className="font-medium whitespace-normal break-all line-clamp-4" title={executingPlanNotice}>
                {executingPlanNotice}
              </span>
              <button
                type="button"
                className="shrink-0 text-zinc-400 hover:text-zinc-200"
                onClick={() => setExecutingPlanNotice(null)}
                title="Dismiss"
                aria-label="Dismiss notice"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )}
          {projectBrain.lastDistNote && (
            <div
              className="px-2 py-1 rounded-md bg-[#18181d] border border-[#2a2a32] text-[10px] text-zinc-300 break-all line-clamp-4"
              title={projectBrain.lastDistNote}
            >
              {projectBrain.lastDistNote}
            </div>
          )}
        </div>

        <div className="flex-1 min-h-0 flex flex-col px-2.5 py-2 overflow-y-auto">
          {plannerPlanView && plannerPlanView.steps.length > 0 ? (
            <PlannerPlanPanel
              plan={plannerPlanView}
              isBusy={showStreamingUi}
              isPaused={
                planPaused ||
                (!showStreamingUi &&
                  isPlanActive(plannerPlanView) &&
                  !!plannerPlanView?.resumePhase &&
                  !heldRef.current)
              }
              onPause={handleStop}
              onResume={() => void resumeActivePlan()}
              onSkipStep={stepId => {
                const plan = plannerPlanRef.current;
                if (!plan) return;
                logRun({ kind: 'user', action: 'skip', stepId: String(stepId) });
                void commitPlannerPlan(skipStep(plan, stepId, 'Skipped.'));
              }}
              onEditStepTask={(stepId, taskId, text) => {
                const plan = plannerPlanRef.current;
                if (!plan) return;
                logRun({ kind: 'user', action: 'edit', stepId: String(stepId), text: text.slice(0, 300) });
                void commitPlannerPlan(editStepTask(plan, stepId, taskId, { title: text }));
              }}
              onRetryStep={stepId => {
                const plan = plannerPlanRef.current;
                if (!plan) return;
                logRun({ kind: 'user', action: 'retry', stepId: String(stepId) });
                const next = retryFailedStep(plan, stepId);
                if (next === plan) return;
                void runAsUser('retry', async run => {
                  await commitPlannerPlan(next, run.token);
                  if (!runLive(run)) return;
                  await dispatchActiveStep(run);
                });
              }}
              onUndoStep={stepId => {
                logRun({ kind: 'user', action: 'undo', stepId: String(stepId) });
                void (async () => {
                  const snap = stepSnapshotsRef.current.get(String(stepId));
                  const plan = plannerPlanRef.current;
                  if (!plan) return;
                  const undoConversationId = conversationIdRef.current;
                  if (!snap?.length) {
                    setExecutingPlanNotice(`No pre-coder snapshot for step #${stepId}.`);
                    return;
                  }
                  for (const file of snap) {
                    await onApplyFileWrite(file.path, file.content);
                  }
                  if (conversationIdRef.current !== undoConversationId) return;
                  await commitPlannerPlan({
                    ...plan,
                    status: 'active',
                    activeStepId: String(stepId),
                    resumePhase: 'coder',
                    blockedReason: undefined,
                    updatedAt: Date.now(),
                    steps: plan.steps.map(s => {
                      if (String(s.id) !== String(stepId)) {
                        return s.status === 'in_progress' ? { ...s, status: 'pending' } : s;
                      }
                      return {
                        ...s,
                        status: 'pending',
                        blockerKind: undefined,
                        tasks: s.tasks.map(t => ({
                          ...t,
                          status: 'pending',
                          failureNote: undefined
                        }))
                      };
                    })
                  });
                  if (conversationIdRef.current !== undoConversationId) return;
                  setPlanPaused(true);
                  setExecutingPlanNotice(
                    `Restored the pre-coder files for step #${stepId} and marked it pending.`
                  );
                })();
              }}
            />
          ) : (
            <div className="rounded-md border border-dashed border-[#2a2a36] bg-[#0e0e12] px-2.5 py-3 text-[10px] text-zinc-500 leading-relaxed">
              No active plan — pick a Planner option to lock steps and tasks here.
            </div>
          )}
        </div>

        <div className="p-2.5 border-t border-[#27272a] space-y-2 shrink-0 text-[10px] overflow-y-auto max-h-[45%]">
          <div className="flex flex-col space-y-1.5">
            <span className="text-zinc-500 font-medium flex items-center space-x-1">
              <Cpu className="w-3 h-3 text-emerald-400 shrink-0" />
              <span>Models</span>
              <HelpTip title="Planner, Coder, and Reviewer" align="right">
                <p>
                  Each role can use its own computer and model. Auto keeps the usual routing. Choose a
                  computer for me, and Cloud, still apply to roles left on Auto. Swarm still sends different
                  files to every GPU.
                </p>
                <p>
                  Context is that model&apos;s max window. Changing it reloads the model, so it waits until
                  the run finishes.
                </p>
              </HelpTip>
            </span>
            {(['planner', 'coder', 'reviewer'] as const).map(role => {
              const label = role === 'planner' ? 'Planner' : role === 'coder' ? 'Coder' : 'Reviewer';
              const pick = explicitRolePick(roleRoutes, role);
              const resolved = resolvedRole(role);
              const usable = resolved?.source === 'pick';
              const fallbackReason = pick && resolved?.fallbackReason ? resolved.fallbackReason : undefined;
              const runningNode = resolved?.node;
              const runningModel = resolved?.model || '';
              const node = pick ? nodes.find(item => item.id === pick.nodeId) : runningNode;
              const model = pick?.model || runningModel;
              const explicit = !!pick;
              const enabledModels = node ? getEnabledModelsForNode(node) : [];
              const modelOptions =
                explicit && model && !enabledModels.includes(model) ? [model, ...enabledModels] : enabledModels;
              const personaCtx =
                role === 'planner' ? plannerAgent.numCtx : role === 'reviewer' ? reviewerAgent.numCtx : coderAgent.numCtx;
              const pinned =
                runningNode && runningModel ? pinnedNumCtx(runningNode, runningModel, personaCtx) : 0;
              const info = node?.models?.find(item => item.name === model);
              const runningInfo = runningNode?.models?.find(item => item.name === runningModel);
              const choice =
                usable && runningModel
                  ? modelContextSelect(runningModel, runningInfo, pinned)
                  : undefined;
              const thinkInfo =
                info ||
                (node?.modelMeta?.[model]
                  ? {
                      name: model,
                      capabilities: node.modelMeta[model].capabilities,
                      thinking: node.modelMeta[model].thinking
                    }
                  : undefined);
              const supportsThink = !!model && modelSupportsThinking(thinkInfo);
              const thinkPref = node?.modelPrefs?.[model]?.think;
              const thinkOn =
                thinkPref === true ||
                thinkPref === 'true' ||
                (typeof thinkPref === 'string' && thinkPref !== 'false');
              const ctxTitle = isStreaming
                ? 'Changing context reloads the model. Wait until this run finishes.'
                : fallbackReason
                  ? `${fallbackReason}. This pick will not run, so context cannot be changed.`
                  : usable
                    ? 'Max context for this model on this computer.'
                    : runningModel
                      ? `Auto right now: ${runningNode?.name || 'Auto'} / ${runningModel}`
                      : 'Auto has no model online.';
              const selectClass =
                'bg-[#1c1c24] border border-[#2a2a36] text-zinc-200 rounded px-1 py-0.5 outline-none text-[10px] truncate disabled:opacity-50 min-w-0 w-full';
              return (
                <div key={role} className="space-y-0.5">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-[9px] uppercase tracking-wide text-zinc-500 flex items-center gap-1">
                      {node && isFrontierNode(node) ? (
                        <Cloud className="w-2.5 h-2.5 text-sky-400" />
                      ) : null}
                      {label}
                    </span>
                    {supportsThink && onToggleModelThinking && node && model && (
                      <button
                        type="button"
                        onClick={() => onToggleModelThinking(node.id, model, !thinkOn)}
                        className={`shrink-0 flex items-center gap-0.5 px-1 py-0.5 rounded border text-[9px] font-medium ${
                          thinkOn
                            ? 'bg-violet-600/25 border-violet-500/40 text-violet-200'
                            : 'bg-[#18181d] border-[#2a2a34] text-zinc-400'
                        }`}
                        title="Thinking: on is slower and more careful"
                        aria-pressed={thinkOn}
                      >
                        <Brain className={`w-2.5 h-2.5 ${thinkOn ? 'text-violet-300' : 'text-zinc-500'}`} />
                        <span>{thinkingToggleLabel(thinkOn)}</span>
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)_3.25rem] gap-1">
                    <select
                      aria-label={`${label} computer`}
                      value={explicit ? pick.nodeId : ''}
                      disabled={nodes.length === 0}
                      onChange={e => {
                        const nodeId = e.target.value;
                        if (!nodeId) {
                          const next = { ...roleRoutesRef.current };
                          delete next[role];
                          commitRoleRoutes(next);
                          return;
                        }
                        const nextNode = nodes.find(item => item.id === nodeId);
                        const nextModel = nextNode
                          ? getPreferredModelForNode(nextNode) ||
                            pickBestModelForComplexity(nextNode, 'heavy') ||
                            ''
                          : '';
                        if (!nextNode || !nextModel) {
                          setExecutingPlanNotice(`${nextNode?.name || 'That computer'} has no enabled model.`);
                          return;
                        }
                        commitRoleRoutes({
                          ...roleRoutesRef.current,
                          [role]: { nodeId, model: nextModel }
                        });
                      }}
                      className={selectClass}
                    >
                      <option value="">Auto</option>
                      {pick && !nodes.some(item => item.id === pick.nodeId) && (
                        <option value={pick.nodeId}>{pick.nodeId} (missing)</option>
                      )}
                      {nodes.map(item => (
                        <option key={item.id} value={item.id} disabled={!item.online}>
                          {item.name}
                          {item.online ? '' : ' (offline)'}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label={`${label} model`}
                      value={explicit ? model : ''}
                      disabled={!explicit || modelOptions.length === 0}
                      title={explicit ? model : ctxTitle}
                      onChange={e => {
                        const nextModel = e.target.value;
                        if (!nextModel || !pick) {
                          const next = { ...roleRoutesRef.current };
                          delete next[role];
                          commitRoleRoutes(next);
                          return;
                        }
                        commitRoleRoutes({
                          ...roleRoutesRef.current,
                          [role]: { nodeId: pick.nodeId, model: nextModel }
                        });
                      }}
                      className={selectClass}
                    >
                      {!explicit ? (
                        <option value="">{runningModel ? `Auto · ${runningModel}` : 'Auto'}</option>
                      ) : modelOptions.length === 0 ? (
                        <option value={model}>{model || 'No models'}</option>
                      ) : (
                        <>
                          <option value="">Auto (computer + model)</option>
                          {modelOptions.map(item => (
                            <option key={item} value={item}>
                              {item}
                            </option>
                          ))}
                        </>
                      )}
                    </select>
                    <select
                      aria-label={`${label} context`}
                      value={usable && choice ? choice.value : pinned || 'none'}
                      disabled={!usable || isStreaming || !choice}
                      title={ctxTitle}
                      onChange={e => {
                        if (!usable || !runningNode || !runningModel) return;
                        writeModelNumCtx(runningNode.id, runningModel, parseInt(e.target.value, 10));
                      }}
                      className={`${selectClass} font-mono`}
                    >
                      {usable && choice ? (
                        choice.options.map(size => (
                          <option key={size} value={size}>
                            {formatCtxLabel(size)}
                          </option>
                        ))
                      ) : (
                        <option value={pinned || 'none'}>{pinned ? formatCtxLabel(pinned) : '—'}</option>
                      )}
                    </select>
                  </div>
                  {fallbackReason && (
                    <p className="text-[9px] leading-snug text-amber-400/90" title={fallbackReason}>
                      {fallbackReason}
                      {runningModel ? ` — using ${runningNode?.name || 'Auto'} / ${runningModel}` : ''}
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          <AutomationDrawer
            swarmOn={isPipelineMode}
            onSwarm={next => {
              setIsPipelineMode(next);
              onConductorPrefsChange?.({ swarmEnabled: next });
            }}
            localCount={onlineLocalNodes.length}
            cloudCount={frontierOnline}
            cloudOn={cloudStrategist}
            onCloud={next => {
              cloudStrategistRef.current = next;
              setCloudStrategist(next);
              onConductorPrefsChange?.({ cloudStrategistEnabled: next });
            }}
            autoNode={autoSelectEndpoint}
            onAutoNode={next => {
              setAutoSelectEndpoint(next);
              onConductorPrefsChange?.({ autoSelectEndpoint: next });
            }}
            autoApply={autoApplyWrites}
            onAutoApply={next => {
              autoApplyWritesRef.current = next;
              setAutoApplyWrites(next);
              onConductorPrefsChange?.({ autoApplyWrites: next });
            }}
            autoReview={autoReview}
            onAutoReview={next => {
              autoReviewRef.current = next;
              setAutoReview(next);
              onConductorPrefsChange?.({ autoReview: next });
            }}
            fullAuto={fullAuto}
            onFullAuto={next => {
              fullAutoRef.current = next;
              setFullAuto(next);
              onConductorPrefsChange?.({ fullAuto: next });
            }}
          />

          {onUpdateNodes && nodes.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setAutoConfigPlan(buildClusterAutoConfigPlan(nodesRef.current));
                setAutoConfigMode('confirm');
              }}
              className="w-full flex items-center justify-center space-x-1.5 px-2 py-1 rounded border border-indigo-500/35 bg-indigo-600/15 hover:bg-indigo-600/30 text-indigo-200 font-medium transition"
              title="Preview a cluster setup, then apply it"
            >
              <Sparkles className="w-3 h-3 text-amber-300 shrink-0" />
              <span className="truncate">Smart Auto-Configure</span>
            </button>
          )}
          {autoConfigPlan && onUpdateNodes && (
            <AutoConfigConfirm
              plan={autoConfigPlan}
              mode={autoConfigMode}
              canUndo={!!autoConfigUndo}
              showDetails={false}
              onApply={() => {
                setAutoConfigUndo(snapshotNodeConfigs(nodesRef.current));
                const updated = applyClusterAutoConfigPlan(nodesRef.current, autoConfigPlan);
                onUpdateNodes(normalizeClusterNodes(updated));
                setAutoConfigMode('applied');
              }}
              onUndo={() => {
                if (!autoConfigUndo) return;
                onUpdateNodes(autoConfigUndo);
                setAutoConfigUndo(null);
                setAutoConfigMode('confirm');
              }}
              onSelectNode={nodeId => {
                const nextNode = nodesRef.current.find(item => item.id === nodeId);
                if (!nextNode) return;
                const model =
                  pickBestModelForComplexity(nextNode, 'heavy') || getPreferredModelForNode(nextNode);
                if (!model) return;
                commitRoleRoutes({ ...roleRoutesRef.current, coder: { nodeId, model } });
              }}
            />
          )}
        </div>
      </div>
  );

  return (
    <div
      id="agent-conductor-root"
      className={`h-full bg-[#161619] border-l border-[#27272a] flex min-w-0 relative ${
        fill ? 'w-full flex-col select-text' : 'flex-1 flex-row select-none min-w-0'
      }`}
    >
      {/* Left — Conversation */}
      <div className={`flex-1 flex flex-col min-h-0 overflow-hidden ${fill || liveColumns.transcriptMin < TRANSCRIPT_MIN ? 'min-w-0' : 'min-w-[320px]'}`}>
      <div className="p-3 border-b border-[#27272a] bg-[#121215] flex flex-col space-y-2 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center space-x-1.5 text-xs font-bold text-zinc-200 min-w-0">
            <Sparkles className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
            <span className="truncate" title={conversation?.title || 'Conversation'}>
              {conversation?.title || 'Conversation'}
            </span>
          </div>

          <div className="flex items-center space-x-1 shrink-0">
            {fill && (
              <button
                type="button"
                onClick={() => setMobileControlsOpen(true)}
                className={`flex items-center gap-1 px-1.5 py-1 rounded text-[11px] font-medium border transition ${
                  mobileControlsOpen
                    ? 'bg-indigo-600/30 text-indigo-200 border-indigo-500/40'
                    : 'text-zinc-300 hover:text-white hover:bg-[#202026] border-transparent hover:border-[#2a2a36]'
                }`}
                title="Conductor controls"
                aria-label="Conductor controls"
              >
                <SlidersHorizontal className="w-3.5 h-3.5 text-indigo-400" />
                <span>Controls</span>
              </button>
            )}
            <div className="relative">
              <button
                type="button"
                onClick={() => setHistoryOpen(o => !o)}
                className={`p-1 rounded transition ${
                  historyOpen ? 'bg-indigo-600/30 text-indigo-200' : 'text-zinc-400 hover:text-white hover:bg-[#202026]'
                }`}
                title="Chat history"
                aria-expanded={historyOpen}
                aria-label="Chat history"
              >
                <History className="w-3.5 h-3.5" />
              </button>
              {historyOpen && (
                <div className="absolute right-0 top-full mt-1 z-40 w-64 max-h-72 overflow-y-auto bg-[#1a1a20] border border-[#2e2e3a] rounded-lg shadow-xl py-1">
                  <div className="px-2.5 py-1.5 text-[10px] uppercase tracking-wide text-zinc-500 font-semibold">
                    This workspace
                  </div>
                  {workspaceConversations.length === 0 ? (
                    <div className="px-2.5 py-3 text-[11px] text-zinc-500">No chats yet</div>
                  ) : (
                    workspaceConversations.map(c => (
                      <div
                        key={c.id}
                        className={`group flex items-start gap-1 px-1.5 py-0.5 ${
                          c.id === conversation?.id ? 'bg-indigo-600/20' : 'hover:bg-[#252530]'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => handleSelectChat(c.id)}
                          className="flex-1 text-left px-1.5 py-1.5 min-w-0"
                        >
                          <div className="text-[11px] text-zinc-200 truncate font-medium">{c.title}</div>
                          <div className="text-[9px] text-zinc-500 mt-0.5">
                            {formatConversationTime(c.updatedAt)} · {c.messages.length} msgs
                          </div>
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteConversation(c.id);
                          }}
                          className="opacity-0 group-hover:opacity-100 p-1.5 text-zinc-500 hover:text-red-400 transition shrink-0"
                          title="Delete chat"
                          aria-label={`Delete ${c.title}`}
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>

            {!isWebConsoleClient() && (
            <div className="relative" ref={runLogMenuRef}>
              <button
                type="button"
                onClick={() => {
                  setHistoryOpen(false);
                  setRunLogOpen(open => !open);
                }}
                className={`flex items-center space-x-1 px-1.5 py-1 rounded text-[11px] font-medium border border-transparent transition ${
                  runLogOpen
                    ? 'bg-sky-600/20 text-sky-100 border-sky-500/30'
                    : 'text-zinc-300 hover:text-white hover:bg-[#202026] hover:border-[#2a2a36]'
                }`}
                title="Copy this Conductor's run log"
                aria-expanded={runLogOpen}
                aria-label="Run log"
              >
                <ScrollText className="w-3.5 h-3.5 text-sky-300" />
                <span>Log</span>
                {runLogFailures > 0 && (
                  <span className="min-w-[1rem] rounded-full bg-rose-500/90 px-1 text-[9px] font-semibold leading-4 text-white">
                    {runLogFailures > 99 ? '99+' : runLogFailures}
                  </span>
                )}
              </button>
              {runLogOpen && (
                <div className="absolute right-0 top-full mt-1 z-40 w-44 bg-[#1a1a20] border border-[#2e2e3a] rounded-lg shadow-xl py-1">
                  <button
                    type="button"
                    onClick={copyRunLog}
                    className="w-full text-left px-2.5 py-1.5 text-[11px] text-zinc-200 hover:bg-[#252530]"
                  >
                    {runLogCopyState === 'copied'
                      ? 'Copied'
                      : runLogCopyState === 'failed'
                        ? 'Copy failed'
                        : 'Copy run log'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void openRunLogFile()}
                    disabled={!workspacePath || !conversation?.id}
                    className="w-full text-left px-2.5 py-1.5 text-[11px] text-zinc-200 hover:bg-[#252530] disabled:opacity-40 disabled:hover:bg-transparent"
                  >
                    Open log file
                  </button>
                  <button
                    type="button"
                    onClick={clearRunLog}
                    className="w-full text-left px-2.5 py-1.5 text-[11px] text-zinc-200 hover:bg-[#252530]"
                  >
                    Clear log
                  </button>
                  {runLogSaveError && (
                    <div className="px-2.5 py-1 text-[10px] text-rose-300" title={runLogSaveError}>
                      Save failed
                    </div>
                  )}
                </div>
              )}
            </div>
            )}
            <button
              type="button"
              onClick={() => {
                logRun({ kind: 'user', action: 'compact' });
                fitContext(modelMaxCtx(selectedNode, activeTargetModel), true, activeTargetModel);
              }}
              disabled={isStreaming || messages.length < 6}
              className="flex items-center space-x-1 px-1.5 py-1 rounded text-[11px] font-medium text-zinc-300 hover:text-white hover:bg-[#202026] border border-transparent hover:border-[#2a2a36] transition disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-zinc-300"
              title="Compact this chat. The work log keeps the finished steps and the next step."
            >
              <Shrink className="w-3.5 h-3.5 text-emerald-400" />
              <span>Compact</span>
            </button>
            {onClearProjectChats && (
              <button
                type="button"
                onClick={() => {
                  if (
                    window.confirm(
                      'Clear all chat threads for this project? Source files and the project brain stay.'
                    )
                  ) {
                    onClearProjectChats();
                  }
                }}
                className="flex items-center space-x-1 px-1.5 py-1 rounded text-[11px] font-medium text-zinc-500 hover:text-rose-200 hover:bg-[#202026] border border-transparent hover:border-[#2a2a36] transition"
                title="Clear chat history only"
                aria-label="Clear chat history"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              type="button"
              onClick={handleNewChatClick}
              className="flex items-center space-x-1 px-1.5 py-1 rounded text-[11px] font-medium text-zinc-300 hover:text-white hover:bg-[#202026] border border-transparent hover:border-[#2a2a36] transition"
              title="New chat — keeps this project's history and project brain (Ctrl+L)"
            >
              <Plus className="w-3.5 h-3.5 text-indigo-400" />
              <span>New</span>
            </button>
          </div>
        </div>

        {fill && (
          <div className="flex flex-wrap gap-1">
            {agents.map(a => (
              <button
                key={a.id}
                type="button"
                onClick={() => onSelectAgent(a.id)}
                className={`px-2 py-0.5 text-[11px] font-medium rounded transition ${
                  selectedAgentId === a.id
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-[#202026]'
                }`}
              >
                {a.handle}
              </button>
            ))}
          </div>
        )}

      </div>

      {fill && (
        <div className={`shrink-0 overflow-hidden border-b border-[#27272a] flex flex-col ${nodeWorkCollapsed ? 'h-8' : 'h-36 max-h-[34%] min-h-[88px]'}`}>
          <NodeWorkPanel
            steps={nodeWorkSteps}
            collapsed={nodeWorkCollapsed}
            collapseLayout="bar"
            onToggleCollapsed={toggleNodeWork}
            persona={runStatus.persona}
            node={runStatus.node}
            model={runStatus.model}
            file={runStatus.file}
            statusText={runStatus.text}
          />
        </div>
      )}

      <div className="flex-1 min-h-0 relative">
        <div
          ref={transcriptScroll.ref}
          onScroll={transcriptScroll.onScroll}
          className="h-full p-3 overflow-y-auto space-y-3.5 select-text"
        >
        {messages.length === 0 ? (
          <EmptyChatChecklist
            agentName={currentAgent.name}
            agentRole={currentAgent.role}
            folderOpen={!!workspacePath}
            nodeOnline={nodes.some(n => n.online)}
            modelReady={modelReady}
            onOpenFolder={onOpenFolder}
            onOpenHardware={onOpenHardware}
            onTrySample={() => {
              setInput('Explain this project in a few sentences, then list the next three files you would read.');
              requestAnimationFrame(() => composerRef.current?.focus());
            }}
          />
        ) : (
          <>
          {(planPaused && isPlanActive(plannerPlanView)) ||
          (plannerPlanView?.resumePhase === 'final-review' && !showStreamingUi) ? (
            <div className="mb-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-100">
              <div className="font-semibold text-amber-200">
                {plannerPlanView?.resumePhase === 'final-review'
                  ? 'Resume final review'
                  : plannerPlanView?.blockedReason
                    ? 'Heal and continue'
                    : 'Resume unfinished work'}
              </div>
              <p className="mt-1 text-amber-100/90 leading-relaxed">
                {plannerPlanView?.blockedReason
                  ? plannerPlanView.blockedReason.slice(0, 320)
                  : projectBrain.brief
                    ? projectBrain.brief.slice(0, 220)
                    : plannerPlanView?.summary || 'An active plan is waiting.'}
              </p>
              <p className="mt-1 text-zinc-400">
                Step {plannerPlanView?.activeStepId || '—'}
                {plannerPlanView?.resumePhase ? ` · ${plannerPlanView.resumePhase}` : ''}
                {projectBrain.delivery ? ` · ${projectBrain.delivery}` : ''}
                {projectBrain.lastVerifyOk === false ? ' · last verify failed' : ''}
                {typeof plannerPlanView?.healAttempts === 'number'
                  ? ` · heal ${plannerPlanView.healAttempts}/${MAX_HEAL_ATTEMPTS}`
                  : ''}
              </p>
              {projectBrain.lastVerifyOk === false && projectBrain.lastVerifyNote && (
                <pre className="mt-1 max-h-24 overflow-auto rounded bg-black/30 px-2 py-1 text-[9px] text-rose-200/90 whitespace-pre-wrap">
                  {projectBrain.lastVerifyNote.slice(-500)}
                </pre>
              )}
              <button
                type="button"
                onClick={() => void resumeActivePlan()}
                className="mt-2 px-2 py-1 rounded border border-emerald-500/50 bg-emerald-600/20 text-emerald-200 text-[10px] font-semibold"
              >
                {plannerPlanView?.blockedReason ? 'Heal and continue' : 'Resume'}
              </button>
            </div>
          ) : null}
          <MessageList
            messages={messages}
            agents={agents}
            currentAgent={currentAgent}
            busy={isStreaming}
            planActive={isPlanActive(plannerPlanView)}
            tasksOpen={hasOpenTasks(executionQueueRef.current)}
            workspacePath={workspacePath}
            onApplyFileWrite={onApplyFileWrite}
            onExecuteToolCommand={onExecuteToolCommand}
            onOpenFileInEditor={onOpenFileInEditor}
            onRunSingleTool={runTool}
            onRetry={retryMessage}
            onOpenHardware={onOpenHardware}
            onSelectPlan={selectPlan}
            onSendReview={sendReview}
            onContinueReview={continueReview}
            onApplyVerdict={applyVerdict}
            onApplyAll={applyAllTools}
          />
          </>
        )}
        </div>
        {transcriptScroll.away && messages.length > 0 && (
          <button
            type="button"
            onClick={transcriptScroll.jump}
            className="absolute bottom-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full border border-indigo-400/50 bg-[#1a1a22] text-[11px] font-medium text-indigo-100 shadow-lg hover:bg-indigo-600/30"
          >
            Jump to latest
          </button>
        )}
      </div>

      {/* Input Composer */}
      <div className="p-3 border-t border-[#27272a] bg-[#121215]">
        {assistError && (
          <ErrorCard
            className="mb-2"
            cause={assistError.cause}
            node={assistError.node}
            model={assistError.model}
            onRetry={
              isStreaming
                ? undefined
                : () => {
                    setAssistError(null);
                    retryMessage('assist');
                  }
            }
            onOpenHardware={onOpenHardware}
          />
        )}
        <ContextMeter
          used={contextUsed}
          pinned={contextPinned}
          tier={meterSnap?.tier}
          budget={meterSnap?.promptBudget}
          model={meterSnap?.model || activeTargetModel}
          node={selectedNode?.name}
        />
        {showStreamingUi && (
          <ActivityIndicator
            label={activityLabel}
            persona={runStatus.persona}
            node={runStatus.node}
            model={runStatus.model}
            file={runStatus.file}
          />
        )}
        {projectBrain.lastTerminal && (
          <div className="mb-2 px-2 py-1.5 rounded-md bg-[#0e0e12] border border-[#2a2a36] text-[10px] text-zinc-400 font-mono truncate" title={projectBrain.lastTerminal.output}>
            <span className="text-emerald-400/90">$</span> {projectBrain.lastTerminal.command}
          </div>
        )}
        {(pinnedFiles.length > 0 || projectBrain.ownedFiles.length > 0) && (
          <div className="mb-2 flex flex-wrap gap-1">
            {pinnedFiles.map(p => (
              <button
                key={p}
                type="button"
                onClick={() => setPinnedFiles(prev => prev.filter(x => x !== p))}
                className="text-[9px] px-1.5 py-0.5 rounded border border-indigo-500/40 bg-indigo-600/15 text-indigo-200"
                title="Unpin from the next message"
                aria-label={`Unpin ${p}`}
              >
                @{p} ×
              </button>
            ))}
            {projectBrain.contractLocked && projectBrain.contractFile && (
              <span className="text-[9px] px-1.5 py-0.5 rounded border border-sky-500/30 text-sky-200">
                contract locked
              </span>
            )}
          </div>
        )}
        {isPlanActive(plannerPlanView) && (
          <div className="mb-2 px-2 py-1.5 rounded-md bg-indigo-600/15 border border-indigo-500/30 text-[10px] text-indigo-100/90 leading-snug">
            Talk to <span className="font-semibold">Planner</span> — use{' '}
            <span className="font-semibold">Pause / Play</span> on the active step under Conductor
            (or the red Stop next to Send). Closing the app also pauses; Play resumes with Auto-* as
            checked.
          </div>
        )}
        {activeTab && (
          <div className="flex items-center justify-between mb-2 px-1 text-[11px] text-zinc-400">
            <label className="flex items-center space-x-1.5 cursor-pointer hover:text-zinc-200">
              <input
                type="checkbox"
                checked={includeActiveFile}
                onChange={(e) => setIncludeActiveFile(e.target.checked)}
                className="rounded border-[#31313e] bg-[#1e1e24] text-indigo-500"
              />
              <span className="flex items-center space-x-1 font-mono text-[10px] truncate max-w-[200px]">
                <Paperclip className="w-3 h-3 text-amber-400" />
                <span>Attach {activeTab.name}</span>
              </span>
              <HelpTip title="Attach active file">
                <p>When checked, the open editor tab’s contents are included with your next message so the agent can edit or explain that file without reading it first.</p>
                <p>Uncheck for general questions that should not depend on the current buffer.</p>
              </HelpTip>
            </label>
            <span className="text-[10px] text-zinc-500 font-mono">{activeTab.language}</span>
          </div>
        )}

        {pendingImages.length > 0 && (
          <div className="mb-2 flex flex-wrap items-center gap-2 px-1">
            {pendingImages.map((src, i) => (
              <div key={`pending-${i}`} className="relative group">
                <img
                  src={src}
                  alt={`Pending ${i + 1}`}
                  className="h-14 w-auto max-w-[120px] rounded border border-[#3a3a48] object-cover"
                />
                <button
                  type="button"
                  onClick={() => setPendingImages(prev => prev.filter((_, j) => j !== i))}
                  className="absolute -top-1.5 -right-1.5 p-0.5 rounded-full bg-zinc-800 border border-zinc-600 text-zinc-300 hover:text-white hover:bg-red-700"
                  title="Remove image"
                  aria-label={`Remove image ${i + 1}`}
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
            {!selectedSupportsVision && (
              <span className="text-[10px] text-amber-400/90 max-w-[180px] leading-snug">
                {activeTargetModel || 'This model'} may not read images — pick a vision model like gemma4.
              </span>
            )}
          </div>
        )}

        <form onSubmit={handleSendMessage} className="relative flex items-end gap-1.5">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={async e => {
              await addImageFiles(e.target.files);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isStreaming}
            className="shrink-0 p-2 mb-0.5 text-zinc-400 hover:text-indigo-300 hover:bg-[#1e1e24] rounded-md transition disabled:opacity-30"
            title="Attach screenshot or image"
            aria-label="Attach image"
          >
            <ImagePlus className="w-4 h-4" />
          </button>
          <button
            type="button"
            disabled={isStreaming || !activeTab}
            onClick={() => {
              if (!activeTab || !workspacePath) return;
              const rel = activeTab.path.startsWith(workspacePath)
                ? activeTab.path.slice(workspacePath.length).replace(/^[\\/]/, '').replace(/\\/g, '/')
                : activeTab.name;
              setPinnedFiles(prev => (prev.includes(rel) ? prev : [...prev, rel].slice(0, 8)));
              setInput(prev => (prev.includes(`@${rel}`) ? prev : `${prev}${prev ? ' ' : ''}@${rel}`));
            }}
            className="shrink-0 p-2 mb-0.5 text-zinc-400 hover:text-sky-300 hover:bg-[#1e1e24] rounded-md transition disabled:opacity-30"
            title="Pin the active editor file into the next message (@file)"
            aria-label="Pin the active file"
          >
            <span className="text-[11px] font-mono">@</span>
          </button>
          <div className="relative flex-1">
            <textarea
              ref={composerRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onPaste={handlePaste}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSendMessage();
                }
              }}
              placeholder={
                findPendingPlanMessage(messages)
                  ? 'Pick an option (click or type option 1)…'
                  : isPlanActive(plannerPlanView)
                    ? 'Tell Planner what to change, skip, or do next…'
                    : isPlannerSelected
                      ? 'Describe what you want — Planner will propose options…'
                      : isPipelineMode
                        ? 'Dispatch task in parallel across all GPUs...'
                        : selectedSupportsVision
                          ? `Ask ${currentAgent.name}… (Ctrl+V to paste a screenshot)`
                          : `Ask ${currentAgent.name}...`
              }
              rows={2}
              className="w-full bg-[#1a1a20] border border-[#2a2a34] focus:border-indigo-500 text-zinc-200 placeholder-zinc-500 text-xs rounded-lg p-2.5 pr-10 outline-none resize-none transition font-sans"
            />

            <div className="absolute right-2 bottom-2.5">
              {isStreaming ? (
                <button
                  type="button"
                  onClick={handleStop}
                  className="p-1.5 bg-red-600 hover:bg-red-500 text-white rounded-md transition shadow"
                  title="Stop generation"
                  aria-label="Stop generation"
                >
                  <Square className="w-3.5 h-3.5" />
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!input.trim() && pendingImages.length === 0}
                  className="p-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-30 text-white rounded-md transition shadow"
                  aria-label="Send"
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        </form>
      </div>
      </div>

      {!fill && (
        <>
          <SplitHandle
            orientation="vertical"
            label="Resize conductor column"
            value={shownControl}
            min={Math.min(controlMin, shownControl)}
            max={Math.max(shownControl, controlMax)}
            valueSide="after"
            resetValue={CONTROL_DEFAULT}
            active={controlDrag.dragging}
            onPointerDown={controlDrag.onPointerDown}
            onChange={next => {
              controlColWidthRef.current = next;
              setControlColWidth(next);
            }}
            onCommit={commitControlWidth}
          />
          {conductorColumn}
          <SplitHandle
            orientation="vertical"
            label="Resize node work column"
            value={shownNodeWork}
            min={nodeWorkCollapsed ? NODE_WORK_RAIL : Math.min(nodeMin, shownNodeWork)}
            max={nodeWorkCollapsed ? NODE_WORK_RAIL : Math.max(shownNodeWork, nodeMax)}
            valueSide="after"
            resetValue={NODE_WORK_DEFAULT}
            disabled={nodeWorkCollapsed}
            active={nodeDrag.dragging}
            onPointerDown={nodeDrag.onPointerDown}
            onChange={next => {
              if (nodeWorkCollapsed) return;
              nodeWorkColWidthRef.current = next;
              setNodeWorkColWidth(next);
            }}
            onCommit={next => {
              if (nodeWorkCollapsed) return;
              commitNodeWorkWidth(next);
            }}
          />
          {nodeWorkColumn}
        </>
      )}

      {fill && mobileControlsOpen && (
        <div className="absolute inset-0 z-50 flex flex-col bg-[#121215] min-h-0">
          <div className="flex-1 min-h-0 overflow-hidden flex flex-col">{conductorColumn}</div>
        </div>
      )}
    </div>
  );
};
