import React, { useState, useRef, useEffect } from 'react';
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
  Zap,
  Cloud,
  Plus,
  History,
  Trash2,
  Brain,
  ImagePlus,
  X,
  Shrink,
  SlidersHorizontal
} from 'lucide-react';
import { SplitHandle } from './ui/SplitHandle';
import { AutoConfigConfirm } from './hardware/AutoConfigConfirm';
import { useStableCallback } from '../hooks/useStableCallback';
import { useStickToBottom } from '../hooks/useStickToBottom';
import { useNodeWorkCollapse } from '../hooks/useNodeWorkCollapse';
import { formatConversationTime } from '../lib/conversations';
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
  type StudioActivity
} from '../lib/studioActivity';
import {
  deliveryToStack,
  looksLikeRealIndexHtml,
  scaffoldFilesForStack
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
import { streamChat } from '../lib/ollamaClient';
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
  pinnedNumCtx,
  type DynamicCtxRole
} from '../lib/contextSize';
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
  isRepeatStop,
  nextStuckStage,
  resolveStuckStage,
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
  SPECIALTY_META,
  applyClusterAutoConfigPlan,
  buildClusterAutoConfigPlan,
  type ClusterAutoConfigPlan
} from '../lib/clusterAdvisor';
import { normalizeClusterNodes } from '../lib/tools';

const MESSAGE_COLUMN_MIN = 320;
const NODE_WORK_RAIL = 36;

interface AgentChatProps {
  agents: AgentPersona[];
  selectedAgentId: string;
  onSelectAgent: (id: string) => void;
  nodes: EndpointNode[];
  activeTab?: OpenTab;
  workspacePath: string;
  workspaceFiles?: WorkspaceFile[];
  width?: number | string;
  /** Fill parent (mobile web console). */
  fill?: boolean;
  /** Right orchestration column width inside the conductor */
  controlWidth?: number;
  onControlWidthChange?: (width: number) => void;
  /** Far-right Node Work column width */
  nodeWorkWidth?: number;
  onNodeWorkWidthChange?: (width: number) => void;
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
  cloudStrategistEnabled?: boolean;
  onConductorPrefsChange?: (
    patch: Partial<
      Pick<
        AppSettings,
        'swarmEnabled' | 'autoSelectEndpoint' | 'autoApplyWrites' | 'autoReview' | 'cloudStrategistEnabled'
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
}

export const AgentChat: React.FC<AgentChatProps> = ({
  agents,
  selectedAgentId,
  onSelectAgent,
  nodes,
  activeTab,
  workspacePath,
  workspaceFiles,
  width = 640,
  fill = false,
  controlWidth = 270,
  onControlWidthChange,
  nodeWorkWidth = 280,
  onNodeWorkWidthChange,
  onSelectNodeModel,
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
  cloudStrategistEnabled = true,
  onConductorPrefsChange,
  onUpdateNodes,
  maxAgentSteps = 12,
  onBusyChange,
  onOpenHardware,
  onOpenFolder,
  peerConductor = null,
  peerChatMirror = null,
  onLiveConductorPublish
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

  // Routing states
  const [targetNodeId, setTargetNodeId] = useState<string>(currentAgent.endpointId);
  const [targetModel, setTargetModel] = useState<string>(currentAgent.model);
  const [autoSelectEndpoint, setAutoSelectEndpoint] = useState<boolean>(autoNodeEnabled);
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const targetNodeIdRef = useRef(targetNodeId);
  targetNodeIdRef.current = targetNodeId;
  const targetModelRef = useRef(targetModel);
  targetModelRef.current = targetModel;
  const autoSelectRef = useRef(autoSelectEndpoint);
  autoSelectRef.current = autoSelectEndpoint;
  const [includeActiveFile, setIncludeActiveFile] = useState(true);
  const [isPipelineMode, setIsPipelineMode] = useState(swarmEnabled);
  const [autoApplyWrites, setAutoApplyWrites] = useState<boolean>(autoApplyEnabled);
  const autoApplyWritesRef = useRef(autoApplyEnabled);
  /** After each coding step: Reviewer runs; ON = auto Send to Planner→Coder / continue, OFF = wait for user */
  const [autoReview, setAutoReview] = useState(autoReviewEnabled);
  const autoReviewRef = useRef(autoReviewEnabled);
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
  const peerConductorRevAppliedRef = useRef(0);
  const [historyOpen, setHistoryOpen] = useState(false);
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
  };
  const endActivity = () => {
    const next = popActivity(activityStackRef.current);
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
  const finishVerifiedPlanRef = useRef<(plan: PlannerPlan) => Promise<void>>(async () => {});
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
  /** True after Stop (or idle) while a durable plan is still active — show Continue. */
  const [planPaused, setPlanPaused] = useState(false);
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
  /** Stop and chat switches: nothing is running any more, so no card or activity may still say it is. */
  const stopConductor = () => {
    stopConductorSession();
    failUnfinishedWork('Stopped');
    activityStackRef.current = [];
    setActivityStack([]);
  };
  /** An owned run that ends with a card still pending or running never reported back. */
  const leaveConductorRun = (owned: boolean, token: RunToken) => {
    const releasing = owned && runIsCurrent(token);
    leaveConductorSession(owned, token);
    if (releasing && !heldRef.current) failUnfinishedWork('Stopped before finishing');
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
    clearStop: boolean
  ): { run: ConductorRun; owned: boolean } | null => {
    const entered = enterConductorRun(conversationIdRef.current, {
      clearStop,
      parent: parent ?? null
    });
    if (!entered) return null;
    if (entered.owned) {
      toolDepsRef.current = {
        ...toolDepsRef.current,
        editProgress: editProgressRef.current
      };
    }
    return entered;
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
        const same =
          brain.todo.length === todo.length &&
          brain.todo.every((t, i) => t.id === todo[i].id && t.status === todo[i].status);
        if (!same) {
          commitProjectBrain({
            ...brain,
            todo,
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
      window.electronAPI?.writeLog?.(
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

  // Sync local message buffer when App switches conversations
  useEffect(() => {
    const nextId = conversation?.id ?? null;
    if (nextId !== conversationIdRef.current) {
      stopConductor();
      setIsStreaming(false);
      resetAgentLoopBudget();
      conversationIdRef.current = nextId;
      const savedMsgs = conversation?.messages || [];
      const nextMsgs = reopenMessages(savedMsgs);
      // Persist only when reopening corrected Swarm steps left running.
      skipPersistRef.current = nextMsgs === savedMsgs;
      setMessages(nextMsgs);
      messagesRef.current = nextMsgs;
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
          if (fromDisk && (!conversation?.plannerPlan || fromDisk.updatedAt >= (conversation.plannerPlan.updatedAt || 0))) {
            plannerPlanRef.current = fromDisk;
            setPlannerPlanView(fromDisk);
            const seeded: Record<string, number> = {};
            for (const s of fromDisk.steps || []) {
              if (s.reworkCount) seeded[String(s.id)] = s.reworkCount;
            }
            stepReworkCountRef.current = seeded;
            onConversationPatch?.({ plannerPlan: fromDisk });
          }
        });
      }
    }
  }, [conversation?.id]);

  // Adopt peer / parent conversation messages when we are not the one streaming.
  useEffect(() => {
    if (!conversation || conversation.id !== conversationIdRef.current) return;
    if (isStreaming) return;
    const next = conversation.messages || [];
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
  }, [conversation?.messages, conversation?.id, isStreaming]);

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
    setIncludeActiveFile(!!peerConductor.includeActiveFile);
    if (peerConductor.targetNodeId) setTargetNodeId(peerConductor.targetNodeId);
    if (peerConductor.targetModel) setTargetModel(peerConductor.targetModel);
    if (peerConductor.executingPlanNotice !== undefined) {
      setExecutingPlanNotice(peerConductor.executingPlanNotice || null);
    }
    if (Array.isArray(peerConductor.nodeWork) && !isStreaming) {
      syncNodeWork(peerConductor.nodeWork, false);
    }
    window.setTimeout(() => {
      applyingPeerConductorRef.current = false;
    }, 200);
  }, [peerConductor]);

  // Publish local conductor + chat buffer for peers.
  useEffect(() => {
    if (!onLiveConductorPublish) return;
    if (applyingPeerConductorRef.current) return;
    const timer = window.setTimeout(() => {
      if (applyingPeerConductorRef.current) return;
      conductorRevisionRef.current += 1;
      const latestAssistant = [...messagesRef.current].reverse().find(m => m.role === 'assistant');
      onLiveConductorPublish({
        conductor: {
          isPipelineMode,
          autoSelectEndpoint,
          autoApplyWrites,
          autoReview,
          includeActiveFile,
          isStreaming,
          activityLabel: describeRunStatus({
            steps: nodeWorkStepsRef.current,
            activityLabel: activityLabelOf(activityStackRef.current),
            notice: executingPlanNotice,
            message: isStreaming ? latestAssistant : undefined
          }).text,
          targetNodeId,
          targetModel,
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
    includeActiveFile,
    isStreaming,
    targetNodeId,
    targetModel,
    executingPlanNotice,
    activityStack,
    messages,
    nodeWorkSteps
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
    }
  }, [conversation?.plannerPlan, conversation?.id]);

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
      return;
    }
    if (!conversation?.id || conversationIdRef.current !== conversation.id) return;
    onMessagesChange(messages);
  }, [messages]);

  // Workspace file tree summary for prompt injection
  const workspaceOverview = (workspaceFiles && workspaceFiles.length > 0)
    ? workspaceFiles.slice(0, 80).map(f => (f.isDirectory ? `📁 ${f.name}/` : `📄 ${f.name}`)).join('\n')
    : '(empty workspace or loading)';

  const executeTrackedCommand = async (command: string, opts?: { timeoutSec?: number }) => {
    beginActivity('tool', 'Terminal', command.slice(0, 90));
    try {
      const out = await onExecuteToolCommand(command, opts);
      commitProjectBrain({
        ...projectBrainRef.current,
        lastTerminal: {
          command: command.slice(0, 240),
          output: (out || '').slice(-1800),
          at: Date.now()
        }
      });
      return out;
    } finally {
      endActivity();
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
    toolResultTier: toolResultTierRef.current
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

  // Sync the pinned endpoint when the persona changes. Node polls must not snap
  // the dropdown back onto a model the user just disabled.
  useEffect(() => {
    const id = currentAgent.endpointId;
    if (!id) return;
    if (nodesRef.current.some(n => n.id === id)) setTargetNodeId(id);
  }, [currentAgent.id, currentAgent.endpointId]);

  // Selected node with fallback to online node if offline (undefined when cluster is empty)
  const requestedNode = nodes.find(n => n.id === targetNodeId) || nodes[0];
  const onlineLocalNodes = nodes.filter(
    n => n.online && n.type !== 'openai' && getEnabledModelsForNode(n).length > 0
  );
  const selectedNode =
    requestedNode &&
    requestedNode.online &&
    getEnabledModelsForNode(requestedNode).length > 0
      ? requestedNode
      : onlineLocalNodes[0] || requestedNode;

  const isFrontier = selectedNode?.type === 'openai' || !!selectedNode?.apiKey;

  // Enabled models on selected node (live catalog when online — never invent deleted models)
  const availableModels = getEnabledModelsForNode(selectedNode);
  const effectiveModels =
    availableModels.length > 0
      ? availableModels
      : isFrontier && !selectedNode?.online
        ? ['grok-2-1212', 'grok-beta', 'gpt-4o', 'claude-3-5-sonnet']
        : [];

  // Drop a disabled model or an offline node on the next render. A newly enabled
  // larger model becomes the target when the previous one is no longer usable.
  useEffect(() => {
    const live = nodes;
    const current = live.find(n => n.id === targetNodeId);
    const enabledHere = getEnabledModelsForNode(current);
    const usable = !!current?.online && enabledHere.length > 0;
    if (!usable) {
      const locals = live.filter(
        n => n.online && !isFrontierNode(n) && getEnabledModelsForNode(n).length > 0
      );
      const next =
        rankModelsForWeight(locals, 'heavy', { role: 'planner' }) ||
        rankModelsForWeight(
          live.filter(n => n.online && getEnabledModelsForNode(n).length > 0),
          'heavy',
          { role: 'planner' }
        );
      if (next && (next.node.id !== targetNodeId || next.model !== targetModel)) {
        setTargetNodeId(next.node.id);
        setTargetModel(next.model);
      }
      return;
    }
    if (!enabledHere.includes(targetModel)) {
      const nextModel = pickBestModelForComplexity(current, 'heavy') || enabledHere[0];
      if (nextModel && nextModel !== targetModel) setTargetModel(nextModel);
    }
  }, [nodes, targetNodeId, targetModel]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Persona defaults (qwen2.5-coder:7b, etc.) are only a hint. The label and the
  // request use a model that is actually enabled on the selected node.
  const activeTargetModel = effectiveModels.includes(targetModel)
    ? targetModel
    : (selectedNode
        ? pickBestModelForComplexity(selectedNode, 'heavy') || effectiveModels[0]
        : effectiveModels[0]) || '';
  const activeTargetMaxCtx = activeTargetModel
    ? pinnedNumCtx(selectedNode, activeTargetModel, currentAgent.numCtx)
    : 0;

  const benchmarkStat = selectedNode?.benchmarks?.[activeTargetModel];
  const selectedModelInfo =
    selectedNode?.models?.find(m => m.name === activeTargetModel) ||
    (selectedNode?.modelMeta?.[activeTargetModel]
      ? {
          name: activeTargetModel,
          capabilities: selectedNode.modelMeta[activeTargetModel].capabilities,
          thinking: selectedNode.modelMeta[activeTargetModel].thinking
        }
      : undefined);
  const selectedSupportsThink = modelSupportsThinking(selectedModelInfo);
  const selectedThinkPref = selectedNode?.modelPrefs?.[activeTargetModel]?.think;
  const selectedThinkOn =
    selectedThinkPref === true ||
    selectedThinkPref === 'true' ||
    (typeof selectedThinkPref === 'string' && selectedThinkPref !== 'false');
  const selectedSupportsVision = modelSupportsVision(
    activeTargetModel,
    selectedNode,
    selectedNode?.models?.find(m => m.name === activeTargetModel)
  );

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
    const entered = bindRun(parent ?? null, false);
    if (!entered) return null;
    const run = entered.run;
    try {
    if (!runLive(run)) return null;

    const runOnce = async (): Promise<{ content: string; aborted: boolean; stats?: { evalCount?: number; promptEvalCount?: number }; error?: string }> => {
      if (countFreeTier) {
        const waited = await waitForFreeTierRpm(target.node, {
          signal: stopRequestedRef.current ? { aborted: true } : undefined,
          onWait: ms => {
            setExecutingPlanNotice(
              `Free-tier RPM limit — waiting ${Math.ceil(ms / 1000)}s before assist on ${target.node.name}…`
            );
          }
        });
        if (!runLive(run)) return { content: '', aborted: true };
        if (waited > 0) {
          window.electronAPI?.writeLog?.(
            'info',
            `free-tier RPM wait ${waited}ms on ${target.node.name}`
          );
        }
      }
      const assistMessages = [
        { role: 'system', content: FREE_TIER_ASSIST_SYSTEM },
        { role: 'user', content: `${purpose}\n\n${tailForAssist(payload)}` }
      ];
      const body = {
        model: target.model,
        messages: assistMessages,
        think: thinkFalseForSidePaths(),
        options: {
          temperature: 0.1,
          num_predict: ASSIST_MAX_PREDICT,
          num_ctx: pinnedNumCtx(target.node, target.model, currentAgent.numCtx)
        }
      };
      try {
        const taken = await awaitConductorChat(
          () => streamChat(target.node.url, body, () => {}, target.node.type, target.node.apiKey),
          { registerAbort, live: () => runLive(run) }
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
      window.electronAPI?.writeLog?.(
        'warn',
        `free-tier rate limit retry in ${backoff}ms: ${result.error}`
      );
      await new Promise<void>(r => setTimeout(r, backoff));
      if (!runLive(run)) return null;
      result = await runOnce();
    }

    if (result.aborted || !runLive(run)) return null;
    if (result.error && !result.content.trim()) {
      window.electronAPI?.writeLog?.('warn', `free-tier assist failed: ${result.error}`);
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

  /** Hand control back to Planner after an ephemeral Coder/Reviewer worker finishes. */
  const restorePlannerControl = (notice?: string) => {
    ephemeralWorkerRef.current = false;
    onSelectAgent(plannerAgent.id);
    onConversationPatch?.({ agentId: plannerAgent.id });
    if (notice) setExecutingPlanNotice(notice);
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
    const body = withThink(
      {
        model,
        messages: continueMsgs,
        options: chatOptions(node, model, 'coder', { createIntent: true, temperature: 0.2 })
      },
      node,
      model,
      'coder'
    );
    try {
      const taken = await awaitConductorChat(
        () => streamChat(node.url, body, () => {}, node.type, node.apiKey),
        { registerAbort, live: () => runIsCurrent(token) && !stopRequestedRef.current }
      );
      if (taken.aborted || !runIsCurrent(token)) return content;
      const extra = (taken.result.content || '').trim();
      if (!extra) return content;
      return content + (content.endsWith('\n') ? '' : '\n') + extra;
    } catch (err: any) {
      window.electronAPI?.writeLog?.('error', `finish truncated write: ${err?.message || err}`);
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
    setMessages(prev =>
      prev.map(m => {
        if (!m.toolCalls?.some(t => t.id === tool.id)) return m;
        const next = {
          ...m,
          toolCalls: m.toolCalls!.map(t => (t.id === tool.id ? updated : t))
        };
        hostMsg = next;
        return next;
      })
    );
    // Manual Run on a failed command → one self-correct attempt
    if (
      updated.name === 'run_command' &&
      updated.status === 'error' &&
      hostMsg &&
      shouldContinueFromTools(hostMsg.toolCalls || [], continueDecisionOpts())
    ) {
      resetAgentLoopBudget();
      await continueWithToolResults(hostMsg, { createIntent: true });
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
      run?: ConductorRun;
    }
  ) => {
    const budget = opts?.budget;
    const depth = budget ? budget.depth : continuationDepthRef.current;
    if (depth >= toolStepLimit) return;

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
    if (!shouldContinueFromTools(originMsg.toolCalls || [], continueOpts)) {
      rememberTerminalFingerprint(originMsg.toolCalls || [], budget);
      return;
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
    if (isReadOnlyToolBatch(originMsg.toolCalls || [])) {
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
    const routeNode = opts?.node || selectedNode;
    if (!routeNode) return;
    const routeModel = opts?.model || activeTargetModel;
    const followUpId = `followup-${Date.now()}`;
    const continueAgent = reviewModeContinue
      ? reviewerAgent
      : planModeContinue || lockPlanContinue
        ? plannerAgent
        : coderAgent;
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
            ? 'Explored the workspace. Drafting the review fix plan...'
            : 'Analyzed project files. Now generating implementation...',
      agentId: continueAgent.id,
      personaHandle: continueAgent.handle || originRole,
      endpointId: routeNode.id,
      endpointName: routeNode.name,
      model: routeModel,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      toolCalls: []
    };

    const entered = bindRun(opts?.run ?? null, false);
    if (!entered) return;
    const run = entered.run;
    if (!runLive(run)) {
      leaveConductorRun(entered.owned, entered.run.token);
      return;
    }
    setMessages(prev => [...prev, followUpMsg]);
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
        stepVerdictMode: stepVerdictContinue || (planLocked && reviewModeContinue),
        projectContext: projectContextForPrompt(rulesCapFor(continueTier)),
        inferenceModel: routeModel
      });
      // Ephemeral workers: only this turn + tool feedback. Planner keeps full chat memory.
      const historySlice = freshContinue
        ? []
        : historyForModel(
            messagesRef.current.filter(m => m.id !== followUpId),
            stripThinking
          );
      const conversationPayload = [
        { role: 'system', content: systemPrompt },
        ...historySlice,
        {
          role: 'assistant',
          content: stripThinking(originMsg.raw || 'I inspected the project / terminal.')
        },
        {
          role: 'user',
          content: prependVolatileContext(
            planModeContinue
              ? `${continuationPrompt}\n\n[PLANNER DIRECTIVE: After using exploration results, produce the plan and end with a <plan_options> block. Do NOT write deliverable files.]`
              : lockPlanContinue && !reviewModeContinue
                ? `${continuationPrompt}\n\n[PLANNER DIRECTIVE: Finish the <execution_plan> steps/tasks for the chosen option. Do NOT emit <plan_options>. Do NOT write deliverable files.]`
                : reviewModeContinue
                  ? stepVerdictContinue || planLocked
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
          )
        }
      ];

      const body = withThink({
        model: routeModel,
        messages: conversationPayload,
        options: chatOptions(routeNode, routeModel, continueRole, {
          createIntent: !readOnlyContinue,
          tier: continueTier,
          temperature: continueAgent.temperature,
          fallbackNumCtx: continueAgent.numCtx
        })
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
          setMessages(prev => prev.map(m => {
            if (m.id === followUpId) {
              return {
                ...m,
                raw: content,
                display: displayLive,
                thinking: parsed.thinking || thinking,
                toolCalls: collapseDuplicateReadTools(
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
              };
            }
            return m;
          }));
        },
        routeNode.type,
        routeNode.apiKey
      );
      const taken = await awaitConductorChat(openContinue, {
        registerAbort,
        live: () => runLive(run)
      });
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
        if (truncated) tools = [...tools, truncated];
      }
      if (readOnlyContinue) {
        tools = tools.filter(t =>
          ['read_file', 'list_dir', 'search', 'read_terminal'].includes(t.name)
        );
      }
      if (!runLive(run)) return;
      const readPass = await runReadOnlyTools(tools, toolDepsRef.current);
      tools = readPass.tools;
      if (!runLive(run)) return;

      if (!readOnlyContinue && autoApplyWritesRef.current) {
        tools = await autoApplyWritableTools(tools, toolDepsRef.current);
        if (!runLive(run)) return;
        tools = await runAuxTools(tools, toolDepsRef.current);
        const cmdPass = await runCommandTools(tools, toolDepsRef.current);
        tools = cmdPass.tools;
        updateProgress(log => noteSavedFiles(log, tools, savedFileFingerprints()));
        noteAppliedWrites(tools);
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

      setMessages(prev => prev.map(m => (m.id === followUpId ? followUpMsgFinal : m)));

      if (runLive(run) && shouldContinueFromTools(tools, continueDecisionOpts(budget))) {
        await continueWithToolResults(followUpMsgFinal, { ...opts, run });
      }
    } catch (err: any) {
      window.electronAPI?.writeLog?.('error', `code generation: ${err?.message || err}`);
      if (runLive(run)) {
        setMessages(prev => prev.map(m => {
          if (m.id === followUpId) {
            return {
              ...m,
              error: err?.message || String(err),
              endpointName: m.endpointName || routeNode.name,
              model: m.model || routeModel
            };
          }
          return m;
        }));
      }
    } finally {
      if (!runLive(run)) {
        setMessages(prev =>
          prev.map(m =>
            m.id === followUpId && m.display === followUpMsg.display ? { ...m, display: 'Stopped.' } : m
          )
        );
      }
      if (runIsCurrent(run.token) || !heldRef.current) setIsStreaming(false);
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
    const entered = bindRun(opts?.run ?? null, false);
    if (!entered) return;
    const run = entered.run;
    try {
    void fullPrompt;
    resetAgentLoopBudget();
    fitContext(modelMaxCtx(selectedNode, activeTargetModel), activeTargetModel);
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
    let architect = findLeadArchitect(nodesRef.current);

    const patchPipelineMsg = (
      patch: Partial<ChatMessage> | ((m: ChatMessage) => ChatMessage)
    ) => {
      if (!runLive(run)) return;
      setMessages(prev =>
        prev.map(m => {
          if (m.id !== agentMsgId) return m;
          return typeof patch === 'function' ? patch(m) : { ...m, ...patch };
        })
      );
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
        const taken = await awaitConductorChat(() => openWorker(body), {
          registerAbort,
          live: () => runLive(run)
        });
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
          const retried = await awaitConductorChat(
            () => streamChat(node.url, retryBody, () => {}, node.type, node.apiKey),
            { registerAbort, live: () => runLive(run) }
          );
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
          if (truncated) tools = [...tools, anchorWritePath(truncated, expectedFilePath)];
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
        if (autoApplyWritesRef.current) {
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
          await continueWithToolResults(origin, {
            expectedFilePath,
            createIntent: true,
            node,
            model,
            budget: workerBudget,
            role: 'coder',
            run
          });
        }

        const writeErrors = tools.filter(
          t => (t.name === 'write_file' || t.name === 'edit_file') && t.status === 'error'
        );

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
          : `Completed ${expectedFilePath}`;
        patchPipelineMsg(m => {
          if (!m.pipelineSteps) return m;
          const updatedSteps = [...m.pipelineSteps];
          if (updatedSteps[idx]) {
            updatedSteps[idx] = {
              ...updatedSteps[idx],
              status: writeErrors.length ? 'failed' : 'completed',
              content: doneContent,
              toolCalls: tools,
              stats: doneStats
            };
          }
          const allTools = updatedSteps.flatMap(s => s.toolCalls || []);
          const annot = annotateAppliedWrites(tools);
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
            status: writeErrors.length ? 'failed' : 'completed',
            content: doneContent,
            toolCalls: tools,
            stats: doneStats
          },
          idx
        );
        return writeErrors.length === 0;
      } catch (workerErr: any) {
        const errText = String(workerErr?.message || workerErr || '');
        if (!runLive(run)) return false;
        if (!opts.retriedSame) {
          window.electronAPI?.writeLog?.(
            'warn',
            `swarm: ${node.name} failed (${errText.slice(0, 120)}); retrying ${expectedFilePath} once`
          );
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
          window.electronAPI?.writeLog?.(
            'warn',
            `swarm: ${node.name} failed (${errText.slice(0, 120)}); rerouting ${expectedFilePath} to ${fallback.node.name}`
          );
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
        ? `⚡ Pass 1 — Lead Architect (${architect.node.name} • ${architect.model}, largest model for this contract${
            architect.usedFrontierBackup ? ' · frontier backup' : ''
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

      // ── Scaffold gate (stack from locked delivery) ──
      const lockedDelivery =
        lockedPlan?.delivery || plannerPlanRef.current?.delivery || undefined;
      const scaffoldStack =
        deliveryToStack(lockedDelivery) ||
        (/\breact|typescript|vite|r3f|three\b/i.test(userText) ? 'typescript' : null);
      if (!skipPass1 && scaffoldStack && workspacePath && window.electronAPI?.writeFile) {
        beginActivity('install', 'Scaffolding project', scaffoldStack);
        try {
          const files = scaffoldFilesForStack(scaffoldStack);
          for (const f of files) {
            const abs = `${workspacePath.replace(/[\\/]+$/, '')}${
              workspacePath.includes('\\') ? '\\' : '/'
            }${f.path.replace(/\//g, workspacePath.includes('\\') ? '\\' : '/')}`;
            let shouldWrite = true;
            try {
              const existing = await window.electronAPI.readFile?.(abs);
              if (existing?.content != null) {
                if (f.path === 'index.html' && looksLikeRealIndexHtml(existing.content)) {
                  shouldWrite = false;
                } else if (f.path !== 'index.html' && String(existing.content).trim()) {
                  shouldWrite = false;
                } else if (
                  f.path === 'index.html' &&
                  !looksLikeRealIndexHtml(existing.content)
                ) {
                  shouldWrite = true; // replace plan prose
                }
              }
            } catch {
              /* missing — write */
            }
            if (shouldWrite) {
              await window.electronAPI.writeFile(abs, f.content);
            }
          }
          patchPipelineMsg({
            display: `🧱 Ensured ${scaffoldStack} scaffold (package/tsconfig/entry) before Pass 1…`
          });
        } finally {
          endActivity();
        }
      }

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
      architect = findLeadArchitect(nodesRef.current, {
        preferCloudStrategist: cloudStrategistRef.current
      });
      if (!architect?.node?.online || !getEnabledModelsForNode(architect.node).includes(architect.model)) {
        patchPipelineMsg({
          display: 'No online computers with a model enabled.',
          error: 'No online computers with a model enabled. Open Hardware and enable a model.'
        });
        return;
      }
      beginActivity(
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
          if (fittedPass.note) setExecutingPlanNotice(fittedPass.note);
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
        const decompTaken = await awaitConductorChat(
          () =>
            streamChat(
              lead.node.url,
              withThink(architectBody, lead.node, lead.model, 'planner'),
              () => {},
              lead.node.type,
              lead.node.apiKey
            ),
          { registerAbort, live: () => runLive(run) }
        );
        if (decompTaken.aborted || !runLive(run)) return;
        const decompRes = decompTaken.result;
        recordTok(architect.node, decompRes.stats, { model: architect.model, messages: architectMsgs });
        const parsed = parseSwarmManifest(decompRes.content, swarmTaskText);
        if (parsed) manifest = parsed;
        else console.warn('Pass 1 JSON parse failed — using fallback manifest');
      } catch (decompErr) {
        console.warn('Pass 1 Lead Architect failed — using fallback:', decompErr);
      }
      }

      if (!skipPass1) {
      if (!architect) return;
      // ── Stage 2: Write Contract & Verify Syntax ──
      patchPipelineMsg({
        display: `📝 Writing shared contract \`${manifest.contractFile}\` (${manifest.tasks.length} worker file${
          manifest.tasks.length === 1 ? '' : 's'
        })…`
      });

      const priorContract = await readWorkspaceRel(manifest.contractFile);
      if (priorContract && shouldPreserveContract(priorContract, manifest.contractCode)) {
        manifest = { ...manifest, contractCode: priorContract };
        patchPipelineMsg({
          display: `🔒 Kept existing contract \`${manifest.contractFile}\` — incoming rewrite would drop domain types. Workers will extend owned files.`
        });
      }
      const writeOk = await onApplyFileWrite(manifest.contractFile, manifest.contractCode);
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
        const checkText = `${check.output || ''}\n${check.error || ''}`;
        if (!check.ok && typesCannotResolve(checkText)) {
          const failText = annotateMissingDependencies(checkText);
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
            const repairBody: Record<string, unknown> = {
              model: architect.model,
              messages: repairMsgs,
              format: 'json',
              options: chatOptions(architect.node, architect.model, 'pass1', {
                createIntent: false,
                tier: repairTier,
                temperature: 0.1,
                fallbackNumCtx: plannerAgent.numCtx
              })
            };
            if (!architect || !runLive(run)) return;
            const repairLead = architect;
            const repairTaken = await awaitConductorChat(
              () =>
                streamChat(
                  repairLead.node.url,
                  withThink(repairBody, repairLead.node, repairLead.model, 'planner'),
                  () => {},
                  repairLead.node.type,
                  repairLead.node.apiKey
                ),
              { registerAbort, live: () => runLive(run) }
            );
            if (repairTaken.aborted || !runLive(run)) return;
            const repairRes = repairTaken.result;
            recordTok(architect.node, repairRes.stats, {
              model: architect.model,
              messages: repairMsgs
            });
            const repaired = parseSwarmManifest(repairRes.content, swarmTaskText);
            if (repaired) {
              const keep = await readWorkspaceRel(repaired.contractFile || manifest.contractFile);
              if (keep && shouldPreserveContract(keep, repaired.contractCode)) {
                repaired.contractCode = keep;
              }
              manifest = repaired;
              const repairedOk = await onApplyFileWrite(manifest.contractFile, manifest.contractCode);
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
            }
          } catch (repairErr) {
            console.warn('Contract repair failed:', repairErr);
          }

          if (!check.ok) {
            const failText = check.output || check.error || 'Contract typecheck failed.';
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

      if (contractVerified) {
        commitProjectBrain({
          ...projectBrainRef.current,
          contractFile: manifest.contractFile,
          contractLocked: true
        });
      } else {
        endActivity();
        return;
      }

      endActivity(); // Pass 1 done
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
      if (!assignments.length) {
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
            : `Lead Architect · contract${architect?.usedFrontierBackup ? ' (frontier)' : ' (local)'}`,
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

      // ── Stage 4: Verify (tsc only for TypeScript stacks) ──
      if (manifest.stack !== 'typescript' && manifest.verifyCommand) {
        patchPipelineMsg(m => ({
          ...m,
          display: `${m.display || ''}\n\n🔍 Verifying ${manifest.stack}: \`${manifest.verifyCommand}\``
        }));
        const output = await executeTrackedCommand(manifest.verifyCommand);
        const failed = /Exit code:\s*(?!0\b)\d+/i.test(output) || /timed out/i.test(output);
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
          patchPipelineMsg(m => ({
            ...m,
            display: `⚠️ Conductor Swarm finished ${assignments.length} worker file(s), but project typecheck was skipped (${wsCheck.output || 'no tsconfig'}). Scaffold a tsconfig and re-run verify — this is NOT a pass.`
          }));
        } else if (wsCheck.ok) {
          patchPipelineMsg(m => ({
            ...m,
            display: `✅ Conductor Swarm finished ${assignments.length} worker file(s). Workspace typecheck passed.`
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
      window.electronAPI?.writeLog?.('error', `swarm: ${err?.message || err}`);
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
    } finally {
      leaveConductorRun(entered.owned, entered.run.token);
    }
  };

  // ==========================================
  // STANDARD SINGLE-TASK EXECUTION (+ Planner → Coder)
  // ==========================================

  const resolveRoute = (userText: string, agent: AgentPersona) => {
    const live = nodesRef.current;
    const fitRole =
      agent.handle === 'planner' || agent.id === 'planner'
        ? 'planner'
        : agent.handle === 'reviewer' || agent.id === 'reviewer'
          ? 'reviewer'
          : agent.handle === 'docs' || agent.id === 'docs'
            ? 'docs'
            : null;
    if (autoSelectRef.current && (fitRole === 'planner' || fitRole === 'reviewer')) {
      const picked = pickCapableReviewTarget(live, fitRole);
      if (picked) {
        return {
          routedNode: picked.node,
          routedModel: picked.model,
          routedIsFrontier: picked.node.type === 'openai' || !!picked.node.apiKey
        };
      }
    }
    const requested = live.find(n => n.id === targetNodeIdRef.current);
    const requestedOk = !!requested?.online && getEnabledModelsForNode(requested).length > 0;
    let routedNode = autoSelectRef.current
      ? selectBestEndpointForTask(userText, agent.handle, live)
      : requestedOk
        ? requested
        : undefined;
    if (!routedNode || !routedNode.online || getEnabledModelsForNode(routedNode).length === 0) {
      const locals = live.filter(
        n => n.online && !isFrontierNode(n) && getEnabledModelsForNode(n).length > 0
      );
      routedNode =
        rankModelsForWeight(locals, fitRole === 'docs' ? 'medium' : 'heavy', {
          role: fitRole || 'coder'
        })?.node ||
        live.find(n => n.online && getEnabledModelsForNode(n).length > 0);
    }
    if (!routedNode) return null;
    const enabled = getEnabledModelsForNode(routedNode);
    if (!enabled.length) return null;
    const weight = fitRole === 'docs' ? 'medium' : 'heavy';
    const manual = targetModelRef.current;
    const routedModel = autoSelectRef.current
      ? pickBestModelForComplexity(routedNode, weight) || enabled[0]
      : enabled.includes(manual)
        ? manual
        : pickBestModelForComplexity(routedNode, weight) || enabled[0];
    if (!routedModel || !enabled.includes(routedModel)) return null;
    return {
      routedNode,
      routedModel,
      routedIsFrontier: routedNode.type === 'openai' || !!routedNode.apiKey
    };
  };

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
      freshContext
    } = opts;
    const readOnlyMode = !!planMode || !!reviewMode || !!lockPlanMode || !!stepVerdictMode;
    const useFreshContext = !!(freshContext || ephemeralWorkerRef.current);

    const pinRole =
      agent.handle === 'planner' || agent.id === 'planner'
        ? 'planner'
        : agent.handle === 'reviewer' || agent.id === 'reviewer'
          ? 'reviewer'
          : agent.handle === 'docs' || agent.id === 'docs'
            ? 'docs'
            : 'coder';
    const livePin = pinRoute ? liveRoutePin(nodesRef.current, pinRoute, pinRole) : undefined;
    const route = livePin
      ? {
          routedNode: livePin.node,
          routedModel: livePin.model,
          routedIsFrontier: livePin.node.type === 'openai' || !!livePin.node.apiKey
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
    if (routedNode.id !== targetNodeId) setTargetNodeId(routedNode.id);
    if (routedModel !== targetModel) setTargetModel(routedModel);

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

    const entered = bindRun(opts.run ?? null, false);
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
        window.electronAPI?.writeLog?.('info', fittedPrompt.note);
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
      const taken = await awaitConductorChat(openTurn, {
        registerAbort,
        live: () => runLive(run)
      });
      if (taken.aborted || !runLive(run)) return;
      let result = taken.result;
      if (
        !routedIsFrontier &&
        fittedPrompt.shrinks < 2 &&
        contextWasExhausted(result.stats, turnReq.pinnedCtx, turnOptions.num_ctx)
      ) {
        const note = `Context monitor: ${routedModel} filled ${turnOptions.num_ctx} tokens. Resubmitting a smaller packet.`;
        setExecutingPlanNotice(note);
        window.electronAPI?.writeLog?.('info', note);
        userContent = shrinkUserPacket(userContent, 2);
        historySent = [];
        conversationPayload = [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent }
        ];
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
        const retried = await awaitConductorChat(
          () =>
            streamChat(
              routedNode.url,
              retryBody,
              () => {},
              routedNode.type,
              routedNode.apiKey
            ),
          { registerAbort, live: () => runLive(run) }
        );
        if (retried.aborted || !runLive(run)) return;
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
        if (truncated) tools = [...tools, truncated];
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

      if (!readOnlyMode && autoApplyWritesRef.current) {
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
        reviewMode && !stepVerdictMode
          ? parseReviewPlan(finished) ||
            ({
              summary: 'No structured issues found.',
              tasks: []
            } as const)
          : null;
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

      setMessages(prev => prev.map(m => (m.id === agentMsgId ? origin : m)));
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

      const turnContinueOpts = continueDecisionOpts(undefined, {
        maxReadOnlyContinues:
          reviewMode || stepVerdictMode ? 1 : planMode || lockPlanMode ? 2 : undefined
      });
      const continueRole =
        (agent.handle as 'planner' | 'reviewer' | 'coder' | 'docs') ||
        (planMode || lockPlanMode
          ? 'planner'
          : reviewMode || stepVerdictMode
            ? 'reviewer'
            : 'coder');
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
      } else if (readOnlyMode && shouldContinueFromTools(tools, turnContinueOpts)) {
        // Planner/Reviewer: bounded explore continues, then they must emit the plan
        await continueWithToolResults(origin, {
          createIntent: false,
          node: routedNode,
          model: routedModel,
          role: continueRole,
          lockPlanMode: !!lockPlanMode,
          reviewMode: !!reviewMode || !!stepVerdictMode,
          stepVerdictMode: !!stepVerdictMode,
          freshContext: useFreshContext,
          run
        });
        // After tool continuations, refresh reviewPlan from latest follow-up if reviewer
        if (reviewMode && !stepVerdictMode) {
          const latest = [...messagesRef.current].reverse().find(
            m => m.personaHandle === 'reviewer' && m.role === 'assistant'
          );
          if (latest) {
            const rp = coerceDirtyReviewPlan(
              latest.reviewPlan || parseReviewPlan(latest.raw || ''),
              `${latest.display || ''}\n${latest.raw || ''}`
            );
            originOut = { ...latest, reviewPlan: rp };
            setMessages(prev =>
              prev.map(m => (m.id === latest.id ? { ...m, reviewPlan: rp } : m))
            );
            if (rp?.tasks?.length && !hasOpenTasks(executionQueueRef.current)) {
              commitExecutionQueue(createQueueFromReviewPlan(rp, latest.id));
            }
          }
        }
      }
    } catch (err: any) {
      const errText = String(err?.message || err || '');
      turnError = errText;
      window.electronAPI?.writeLog?.('error', `single-node ${routedNode?.name || ''}: ${errText}`);
      if (runLive(run) && !opts.retriedSame) {
        retryBubble = `Retrying ${routedNode.name}…`;
        setMessages(prev =>
          prev.map(m =>
            m.id === agentMsgId ? { ...m, display: retryBubble, error: undefined } : m
          )
        );
        await new Promise(r => setTimeout(r, 400));
        if (!runLive(run)) return originOut;
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
    reviewNotes?: string
  ) => {
    if (planMsg?.reviewSentToCoder && !executionQueueRef.current) return;

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
        if (autoReviewRef.current) await decideNextStepAndAdvance(depth, '');
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
      if (!stopRequestedRef.current) return false;
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
    stopRequestedRef.current = false;

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
        { approvedPlan: syntheticPlan, skipUserAppend: true }
      );
      if (!stoppedMidTask()) {
        await reviewAndAdvance(depth + 1, `Task #${task.id}: ${task.title}`);
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
      notice: `Planner locking fix contract — task #${task.id}`
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
      freshContext: true
    });
    if (!stoppedMidTask()) {
      await reviewAndAdvance(depth + 1, `Task #${task.id}: ${task.title}`);
    }
    restorePlannerControl();
  };

  /** User approved a clean review — resume next-step continuation. */
  const continueAfterCleanReview = async (planMsg: ChatMessage) => {
    if (!planMsg.reviewNeedsContinue) return;
    const resume = pendingReviewResumeRef.current;
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
    setExecutingPlanNotice('Continuing after clean review…');
    await decideNextStepAndAdvance(resume?.depth ?? 0, resume?.previousTask ?? '');
  };

  /**
   * After a clean Reviewer pass (or user Continue), decide continue / ask / done.
   * Does not write files — Reviewer → Planner → Coder owns fixes.
   */
  const decideNextStepAndAdvance = async (
    depth: number,
    previousTask = '',
    parent?: ConductorRun | null
  ): Promise<void> => {
    const entered = bindRun(parent ?? null, false);
    if (!entered) return;
    const run = entered.run;
    try {
    if (!runLive(run)) return;

    // Planner-owned plan is the sole controller — never invent next steps while active.
    if (isPlanActive(plannerPlanRef.current)) {
      const step = getActiveStep(plannerPlanRef.current);
      if (step && (step.status === 'in_progress' || step.status === 'pending')) {
        await dispatchActiveStep();
      } else if (plannerPlanRef.current?.status === 'completed') {
        setExecutingPlanNotice('Planner plan complete — ask Planner for the next feature if needed.');
      }
      return;
    }

    // Legacy flat queue still has work — Planner dispatches; do not invent a new feature step.
    if (hasOpenTasks(executionQueueRef.current)) {
      await sendReviewPlanToPlanner(null, depth);
      return;
    }

    const recent = messagesRef.current;
    const target = pickCapableReviewTarget(nodesRef.current);
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
      setIsStreaming(false);
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
        const body = withThink(
          {
            model,
            messages: askMsgs,
            options: chatOptions(node, model, 'reviewer', {
              createIntent: false,
              tier: contTier,
              temperature: 0.2,
              fallbackNumCtx: reviewerAgent.numCtx
            })
          },
          node,
          model,
          'reviewer'
        );
        const taken = await awaitConductorChat(
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
          {
            registerAbort,
            live: () => runLive(run)
          }
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
      if (loopTask) {
        handledLoop = true;
        const key = stuckKey(loopTask);
        const stage: StuckStage = resolveStuckStage(stuckRef.current, key);
        let step = nextStuckStage(stage);
        stuckRef.current = { key, stage };
        const stuckPayload = `${progressForPrompt()}\n\nStuck step:\n${loopTask}`;
        if (step === 'big') {
          const big = pickLargestLocalTarget(nodesRef.current);
          if (big) {
            stuckRef.current.stage = 'big';
            handoff = true;
            nextTask = loopTask;
            pinFix = true;
            pinStuck = big;
            runTask = loopTask;
            options = [];
            display = `Stuck repeating. Retrying on ${big.node.name} · ${big.model} (${big.node.hardware?.vramGB || 0} GB) with a different approach.`;
          } else {
            step = 'free';
          }
        }
        if (step === 'free') {
          stuckRef.current.stage = 'free';
          let brief: string | null = null;
          try {
            brief = await requestFreeTierBrief(
              'The local models are repeating this step and not fixing it. Give one short solution. Do not rewrite the file.',
              stuckPayload
            );
          } catch (err: any) {
            window.electronAPI?.writeLog?.('warn', `free-tier stuck: ${err?.message || err}`);
          }
          if (brief) {
            const big = pickLargestLocalTarget(nodesRef.current);
            display = `Free-tier solution:\n\n${brief}`;
            options = [{ id: 'copy-solution', title: 'Copy solution', description: brief, action: 'copy' }];
            if (big) {
              handoff = true;
              nextTask = `Apply this solution. Do not repeat the failed approach.\n\n${brief}`;
              pinFix = true;
              pinStuck = big;
              runTask = nextTask;
            }
          } else {
            step = 'paid';
          }
        }
        if (step === 'paid') {
          stuckRef.current.stage = 'paid';
          const paid = pickPaidFrontier(nodesRef.current);
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
      if (!handledLoop && !runTask && (decision?.decision === 'done' || decision?.decision === 'ask' || options.length)) {
        setExecutingPlanNotice(
          decision?.decision === 'done' ? 'Work looks complete — optional next steps below' : 'Waiting for a choice'
        );
      } else if (handledLoop && options.some(o => o.action === 'paid')) {
        setExecutingPlanNotice('Waiting for confirmation before a paid API call');
      } else if (!handoff) {
        setExecutingPlanNotice(null);
      }
    } catch (err: any) {
      if (!runLive(run)) return;
      window.electronAPI?.writeLog?.('error', `continuation check: ${err?.message || err}`);
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
      if (!handoff) {
        setIsStreaming(false);
      }
    }

    if (!handoff || !runLive(run)) return;

    const stuckTarget = pinStuck;
    setExecutingPlanNotice(
      stuckTarget
        ? `Retrying on ${stuckTarget.node.name} — ${nextTask.slice(0, 90)}`
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
      notice: stuckTarget
        ? `Stuck-loop retry on ${stuckTarget.node.name} · ${stuckTarget.model}`
        : pinFix
          ? `Fixing on ${node.name} — ${nextTask.slice(0, 120)}`
          : `Continuing automatically — ${nextTask.slice(0, 140)}`,
      freshContext: true,
      run,
      ...(stuckTarget ? { pinRoute: stuckTarget } : pinFix ? { pinRoute: { node, model } } : {})
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
    const entered = bindRun(parent ?? null, false);
    if (!entered) return;
    const run = entered.run;
    try {
    if (!runLive(run)) return;

    if (isPlanActive(plannerPlanRef.current)) {
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

    const target = pickCapableReviewTarget(nodesRef.current);
    if (!target) {
      if (autoReviewRef.current) await decideNextStepAndAdvance(depth, previousTask, run);
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
    const filesBody = await buildTouchedFilesContext(workspacePath, touchedPaths, {
      maxFiles: 8,
      maxCharsPerFile: 5000,
      maxTotalChars: 20000
    });
    if (!runLive(run)) {
      setIsStreaming(false);
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
      autoReviewRef.current
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

    // —— Delta path: update durable queue status; never reseed from a new full plan ——
    if (deltaMode && existingQueue && activeTask) {
      let delta = parseReviewDelta(latestReview?.raw || '');
      if (!delta) {
        const parsedPlan =
          latestReview?.reviewPlan ||
          (latestReview ? parseReviewPlan(latestReview.raw || '') : null) ||
          ({ summary: 'No structured issues found.', tasks: [] } as const);
        const coerced = coerceDirtyReviewPlan(parsedPlan, rawBlob);
        if (coerced.tasks.length === 0) {
          delta = {
            taskId: activeTask.id,
            verdict: 'completed',
            notes: coerced.summary || 'Looks good.'
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
                  reviewNeedsContinue: !autoReviewRef.current
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
        if (autoReviewRef.current) {
          await sendReviewPlanToPlanner(
            latestReview ? { ...latestReview, reviewPlan: snap } : null,
            depth,
            after?.failureNote
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
          if (autoReviewRef.current) {
            await sendReviewPlanToPlanner(null, depth);
            return;
          }
          pendingReviewResumeRef.current = { depth, previousTask };
          setExecutingPlanNotice('Task done — Send to Planner for the next queued task');
          return;
        }
        // Queue finished
        if (!autoReviewRef.current) {
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
          setExecutingPlanNotice('All review tasks done — click Looks good / Continue');
          return;
        }
        await decideNextStepAndAdvance(depth, previousTask, run);
        return;
      }
    }

    // —— Seed path: first review creates the durable list once ——
    const parsedPlan =
      latestReview?.reviewPlan ||
      (latestReview ? parseReviewPlan(latestReview.raw || '') : null) ||
      ({ summary: 'No structured issues found.', tasks: [] } as const);
    const plan = coerceDirtyReviewPlan(parsedPlan, rawBlob);

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

      if (autoReviewRef.current) {
        await sendReviewPlanToPlanner(planMsg, depth);
        return;
      }
      pendingReviewResumeRef.current = { depth, previousTask };
      setExecutingPlanNotice('Review found issues — Send to Planner when ready');
      return;
    }

    if (latestReview && (!latestReview.reviewPlan || latestReview.reviewPlan.tasks.length !== plan.tasks.length)) {
      setMessages(prev => {
        const next = prev.map(m => (m.id === latestReview.id ? { ...m, reviewPlan: plan } : m));
        messagesRef.current = next;
        return next;
      });
    }

    const planMsg = latestReview ? { ...latestReview, reviewPlan: plan } : null;

    if (!autoReviewRef.current) {
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
      setExecutingPlanNotice('Review looks clean — click Looks good / Continue');
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
  const dispatchActiveStep = async (): Promise<void> => {
    const entered = bindRun(null, false);
    if (!entered) return;
    const run = entered.run;
    try {
    if (!runLive(run)) return;
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
      if (isPipelineMode && stepFiles.length > 0) {
        await handleSendPipelineMessage(`Plan step #${step.id}: ${step.title}`, coderPrompt, {
          approvedPlan: approvedPlanRef.current,
          skipUserAppend: true,
          run,
          stepDispatch: {
            files: stepFiles,
            brief: formatStepForCoders(plan, step)
          }
        });
      } else {
        await runSingleNodeTurn({
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
      }

      if (!runLive(run)) {
        setPlanPaused(true);
        setPlanResumePhase('coder', run.token);
        restorePlannerControl(
          `Paused during Coder on step #${step.id} — press Play to resume.`
        );
        return;
      }

      if (writesUnresolved(coderWriteTools())) {
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
      setPlanPaused(true);
      setPlanResumePhase('coder', run.token);
      restorePlannerControl(`Coder step failed: ${err?.message || err}`);
      throw err;
    }
    } finally {
      leaveConductorRun(entered.owned, entered.run.token);
    }
  };

  /** Reviewer Yay/Nay on the active Planner step. `parent` is the conductor run that owns this review. */
  const reviewActiveStep = async (parent?: ConductorRun | null): Promise<void> => {
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

    const target = pickCapableReviewTarget(nodesRef.current);
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
    beginActivity('review', `Reviewer on step #${step.id}`, step.title);
    const reviewFit = resolveModelFit(target.node, target.model, 'reviewer', reviewerAgent.numCtx);
    setIsStreaming(true);
    const filesBody = await buildTouchedFilesContext(
      workspacePath,
      reviewPaths,
      reviewFit.tier === 'tight'
        ? reviewFit.caps
        : { maxFiles: 16, maxCharsPerFile: 10000, maxTotalChars: 64000 }
    );
    if ((parent && !runLive(parent)) || (!parent && stopRequestedRef.current)) {
      setIsStreaming(false);
      endActivity();
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
      autoReviewRef.current
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

    if ((parent && !runLive(parent)) || (!parent && stopRequestedRef.current)) {
      endActivity();
      setPlanPaused(true);
      setPlanResumePhase('review');
      restorePlannerControl(
        `Paused during Review on step #${step.id} — press Play to resume.`
      );
      return;
    }
    endActivity();

    const latest =
      reviewMsg ||
      [...messagesRef.current].reverse().find(
        m => m.role === 'assistant' && (m.stepVerdict || m.personaHandle === 'reviewer')
      );

    const parsedVerdict = latest?.stepVerdict
      ? {
          stepId: latest.stepVerdict.stepId,
          result: latest.stepVerdict.result as 'yay' | 'nay' | 'missing',
          notes: latest.stepVerdict.notes
        }
      : parseStepVerdict(latest?.raw || '', { allowMissing: true });

    if (!parsedVerdict || parsedVerdict.result === 'missing') {
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
      if (latest) {
        setMessages(prev => {
          const next = prev.map(m =>
            m.id === latest.id
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

    const verdict: { stepId: string; result: 'yay' | 'nay'; notes: string } = {
      stepId: parsedVerdict.stepId,
      result: parsedVerdict.result === 'nay' ? 'nay' : 'yay',
      notes: parsedVerdict.notes
    };
    const packed = {
      stepId: verdict.stepId || step.id,
      stepTitle: step.title,
      result: verdict.result,
      notes: verdict.notes
    };

    if (latest) {
      setMessages(prev => {
        const next = prev.map(m =>
          m.id === latest.id
            ? {
                ...m,
                stepVerdict: packed,
                stepVerdictNeedsConfirm: !autoReviewRef.current,
                stepVerdictApplied: false
              }
            : m
        );
        messagesRef.current = next;
        return next;
      });
    }

    if (!autoReviewRef.current) {
      setPlanResumePhase('verdict');
      setPlanPaused(true);
      restorePlannerControl(
        packed.result === 'yay'
          ? `Step #${step.id} Yay — Accept on the card or press Play to continue`
          : `Step #${step.id} Nay — Accept on the card or press Play to send fixes to Coder`
      );
      return;
    }

    if (parent && !runLive(parent)) return;
    await applyStepVerdictAndContinue(
      latest ? { ...latest, stepVerdict: packed } : null,
      packed
    );
    restorePlannerControl();
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
  const escalateStepToPlannerFixes = async (stepId: string): Promise<void> => {
    if (stopRequestedRef.current) return;
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
      await healBlockedPlan();
      return;
    }

    setPlanPaused(false);
    beginActivity(
      'escalate',
      `Escalating step #${stuck.id}`,
      `${reworkCount} Nays → Planner fix steps`
    );
    const escalationFrame = activityStackRef.current[activityStackRef.current.length - 1];
    const escalationConversationId = conversationIdRef.current;
    const escalationRun = runRef.current;
    /** A Send after Stop clears the stop flag; that newer run now owns the plan controls. */
    const newerRunHolds = () => heldRef.current && runRef.current !== escalationRun;
    /** Stop clears the stack, and a newer run may have pushed its own frame since. */
    const endEscalationActivity = () => {
      const stack = activityStackRef.current;
      if (stack[stack.length - 1] === escalationFrame) endActivity();
    };
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
      freshContext: true
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
    await dispatchActiveStep();
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
    if (typeof token === 'number' && !runIsCurrent(token)) {
      return { ok: false, output: 'Stopped.', fingerprint: 'aborted' };
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
      return { ok: false, output: failure.output, fingerprint: failure.fingerprint };
    }
    beginActivity('verify', 'Project verify');
    try {
      const out = typescriptVerifyUsesCompiler(begun.command)
        ? await runTypescriptVerify()
        : await executeTrackedCommand(begun.command);
      if (typeof token === 'number' && !runIsCurrent(token)) {
        return { ok: false, output: 'Stopped.', fingerprint: 'aborted' };
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
      return { ok: !failed, output: combined, fingerprint };
    } catch (err: any) {
      const msg = err?.message || String(err);
      commitProjectBrain({
        ...projectBrainRef.current,
        lastVerifyOk: false,
        lastVerifyNote: msg.slice(0, 800)
      });
      return { ok: false, output: msg, fingerprint: 'err' };
    } finally {
      endActivity();
    }
  };

  /** Compiler/build must pass before a step can Yay. */
  const verifyBeforeYay = async (): Promise<{ ok: boolean; output: string }> => {
    const r = await runProjectVerify();
    return { ok: r.ok, output: r.output };
  };

  /** Advance the stuck step after heal verify passes (no Reviewer round-trip). */
  const advanceAfterHealVerify = async (stepId: string, fingerprint: string, note: string) => {
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
      await commitPlannerPlan(held.plan);
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
    await commitPlannerPlan(moved.plan);
    if (moved.effect !== 'verify-advanced') {
      setPlanPaused(true);
      restorePlannerControl('Verify passed, but this step was not advanced.');
      return;
    }
    plan = moved.plan;
    if (plan.resumePhase === 'final-review' || plan.status === 'completed') {
      setPlanPaused(false);
      await finishVerifiedPlanRef.current(plan);
      return;
    }
    const next = getActiveStep(plan);
    if (next) {
      setExecutingPlanNotice(`Heal: verify OK — starting step #${next.id}: ${next.title}`);
      await dispatchActiveStep();
    } else {
      restorePlannerControl('Heal: verify passed — plan complete.');
    }
  };

  /**
   * Heal budget spent: record compiler debt and keep going on the next pending step.
   * Does not set blockedReason. User Stop is the halt.
   */
  const deferFailedStepAndContinue = async (stepId: string, note: string) => {
    let plan = plannerPlanRef.current;
    if (!plan) return;
    plan = continuePastFailedStep(plan, stepId, note);
    commitPlannerPlan(plan);
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
    await dispatchActiveStep();
  };

  /**
   * Compiler-driven heal when blocked / escalation would no-op.
   * Does not append steps or bump escalationCount. Max MAX_HEAL_ATTEMPTS per plan.
   */
  const frontierBriefUsed = (plan: PlannerPlan | null | undefined) =>
    !!(plan as (PlannerPlan & { frontierHealBriefUsed?: boolean }) | null | undefined)
      ?.frontierHealBriefUsed;

  const healBlockedPlan = async (): Promise<void> => {
    const entered = bindRun(null, false);
    if (!entered) return;
    const run = entered.run;
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
      await deferFailedStepAndContinue(
        String(stuck.id),
        `Heal budget used (${attempts}) on step #${stuck.id}. ${(stuck.reviewNote || plan.blockedReason || '').slice(0, 500)}`
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
    beginActivity(
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
        setPlanPaused(true);
        endActivity();
        restorePlannerControl('Paused during Heal verify — press Heal and continue to retry.');
        return;
      }
      if (verify.ok) {
        endActivity();
        await advanceAfterHealVerify(
          String(stuck.id),
          verify.fingerprint,
          'Heal: stack verify passed — advancing.'
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
        setPlanPaused(true);
        endActivity();
        restorePlannerControl('Paused during Heal — press Play to resume.');
        return;
      }
      // Skip another local coder if this fingerprint already survived a prior heal attempt.
      const skipLocal = !!prevFp && prevFp === fingerprint && attempts >= 1;

      if (!skipLocal) {
        const blankPage = /TS9001|TS9002/.test(verify.output || '');
        const frontierFix = blankPage ? pickFinalSourceReviewTarget(nodesRef.current) : undefined;
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
          setPlanPaused(true);
          endActivity();
          restorePlannerControl('Paused during Heal Coder — press Heal and continue to retry.');
          return;
        }
        verify = await runProjectVerify(run.token);
        if (verify.ok) {
          endActivity();
          await advanceAfterHealVerify(
            String(stuck.id),
            verify.fingerprint,
            'Heal: local Coder fixed verify — advancing.'
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
        const marked = {
          ...(plannerPlanRef.current || plan),
          frontierHealBriefUsed: true
        } as PlannerPlan;
        await commitPlannerPlan(marked, run.token);
        const stuckPayload = `${errorBlock}\n\nFingerprint: ${fingerprint}\nStep: #${stuck.id} ${stuck.title}`;
        let brief: string | null = null;
        try {
          brief = await requestFreeTierBrief(
            'Local heal did not clear these compile errors. Give one short concrete fix plan naming files and edits. Do not rewrite whole files.',
            stuckPayload,
            run
          );
        } catch (err: any) {
          window.electronAPI?.writeLog?.('warn', `heal frontier: ${err?.message || err}`);
        }
        const big = pickLargestLocalTarget(nodesRef.current);
        if (brief && big && runLive(run)) {
          await runHealCoder(
            `### Frontier heal brief\nApply this solution. Do not repeat the failed approach.\n\n${brief}`,
            `Heal: applying the one frontier brief on ${big.node.name} · ${big.model}…`,
            big
          );
          if (!runLive(run)) {
            setPlanPaused(true);
            endActivity();
            return;
          }
          verify = await runProjectVerify(run.token);
          if (verify.ok) {
            endActivity();
            await advanceAfterHealVerify(
              String(stuck.id),
              verify.fingerprint,
              'Heal: frontier brief cleared verify — advancing.'
            );
            return;
          }
        }
        endActivity();
        setPlanPaused(true);
        restorePlannerControl(
          'Heal stopped: the error fingerprint did not change. This plan already used its frontier brief.'
        );
        return;
      }
      if (unchanged) {
        endActivity();
        setPlanPaused(true);
        restorePlannerControl(
          briefAlreadyUsed
            ? 'Heal stopped: the error fingerprint is unchanged and the frontier brief was already used.'
            : 'Heal stopped: the error fingerprint did not change after the local Coder.'
        );
        return;
      }

      const snippet = (verify.output || '').slice(-700);
      const used = plannerPlanRef.current?.healAttempts || attempts + 1;
      endActivity();
      if (used >= MAX_HEAL_ATTEMPTS || !runLive(run)) {
        if (!runLive(run)) {
          setPlanPaused(true);
          return;
        }
        await deferFailedStepAndContinue(
          String(stuck.id),
          `Heal failed on step #${stuck.id} after ${used} attempts.\n${snippet}`
        );
        return;
      }
      setExecutingPlanNotice(
        `Heal attempt ${used}/${MAX_HEAL_ATTEMPTS} changed the errors on step #${stuck.id} — retrying…`
      );
      await healBlockedPlan();
    } catch (err: any) {
      endActivity();
      const msg = String(err?.message || err);
      if (/no workspace|workspace (path|required)|no local model|no model online/i.test(msg)) {
        const reason = `Heal paused: ${msg}`;
        commitPlannerPlan({
          ...(plannerPlanRef.current || plan),
          blockedReason: reason,
          updatedAt: Date.now()
        });
        setPlanPaused(true);
        restorePlannerControl(reason);
        return;
      }
      await deferFailedStepAndContinue(
        String(stuck.id),
        `Heal error on step #${stuck.id}: ${msg.slice(0, 500)}`
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
    plan: PlannerPlan
  ): Promise<{ ran: boolean; passed: boolean; notes: string }> => {
    const skipped = { ran: false, passed: false, notes: '' };
    if (!plan.steps.length || plan.steps.some(s => s.status !== 'completed')) return skipped;
    if (finalReviewPlanIdRef.current === plan.id) return skipped;
    finalReviewPlanIdRef.current = plan.id;
    if (stopRequestedRef.current) return skipped;

    const target = pickFinalSourceReviewTarget(nodesRef.current);
    if (!target || !workspacePath) {
      const notes = 'All plan steps complete — no model online for the final source review.';
      restorePlannerControl(notes);
      return { ran: false, passed: false, notes };
    }
    const frontier = isFrontierNode(target.node);
    const caps = frontier
      ? { maxFiles: 80, maxCharsPerFile: 14000, maxTotalChars: 180000 }
      : { maxFiles: 24, maxCharsPerFile: 8000, maxTotalChars: 48000 };
    beginActivity('project-review', 'Final source review', `${target.node.name} · ${target.model}`);
    setExecutingPlanNotice(
      frontier
        ? `Checklist done — reviewing the source folder on ${target.node.name} · ${target.model}…`
        : `Checklist done — reviewing the source folder on ${target.node.name} · ${target.model} (no frontier online)…`
    );
    try {
      const files = await listSourceFolderFiles(workspacePath);
      const filesBody = await buildTouchedFilesContext(workspacePath, files, caps);
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
        freshContext: true
      });
      if (stopRequestedRef.current) {
        endActivity();
        restorePlannerControl('Paused during the final source review.');
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
      endActivity();
      const notice = passed
        ? `Final source review passed on ${target.node.name} · ${target.model}.`
        : `Final source review found gaps on ${target.node.name}. ${notes.slice(0, 280)}`;
      restorePlannerControl(notice);
      return { ran: true, passed, notes: notice };
    } catch (err: any) {
      endActivity();
      const notice = `Final source review failed: ${err?.message || err}`;
      restorePlannerControl(notice);
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
  const packageElectronDist = async (plan: PlannerPlan): Promise<string | null> => {
    if (!workspacePath || stopRequestedRef.current) return null;
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
      const failed = distCommandFailed(output);
      const listed = failed ? [] : await listPackagedExes(electronOutputDirs(pkg));
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
  const finishVerifiedPlan = async (plan: PlannerPlan) => {
    if (!planReadyForRelease(plan)) {
      restorePlannerControl(
        'Plan is not ready to release — unfinished, failed, or abandoned steps stay off the final review and Electron dist.'
      );
      return;
    }
    const shipping = markPlanFinalReview(plan);
    await commitPlannerPlan(shipping);
    const review = await reviewFinishedSource(shipping);
    if (stopRequestedRef.current) return;
    const distNote = await packageElectronDist(shipping);
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
    packed?: { stepId: string; stepTitle: string; result: 'yay' | 'nay'; notes: string }
  ): Promise<void> => {
    const v = packed || verdictMsg?.stepVerdict;
    if (!v) return;
    if (verdictMsg?.stepVerdictApplied) return;

    let plan = plannerPlanRef.current;
    if (!plan) return;

    let result = v.result;
    let notes = v.notes;
    if (result === 'yay') {
      if (writesUnresolved(coderWriteTools())) {
        setPlanResumePhase('coder');
        setPlanPaused(true);
        restorePlannerControl(
          'Writes for this step failed or are still pending. Press Play to run the Coder again before accepting Pass.'
        );
        return;
      }
      const gate = await verifyBeforeYay();
      if (!gate.ok) {
        result = 'nay';
        notes = `Verify failed — step cannot Yay.\n${(gate.output || '').slice(0, 1600)}`;
      }
    }

    plan = applyStepVerdict(plan, {
      stepId: v.stepId,
      result,
      notes
    });
    commitPlannerPlan(plan);

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
      await finishVerifiedPlan(plan);
      return;
    }

    if (result === 'nay') {
      const sid = String(v.stepId || '');
      const stuck = plan.steps.find(s => String(s.id) === sid);
      const nextCount = effectiveStepReworkCount(sid, stuck?.reworkCount);
      if (nextCount > MAX_STEP_REWORKS) {
        // Verify/compile failures and existing Fix steps → heal, do not grow the plan.
        if (
          stepLooksLikeFixStep(stuck?.title || '') ||
          notesLookLikeVerifyFailure(notes || stuck?.reviewNote || '')
        ) {
          commitPlannerPlan({
            ...plan,
            blockedReason: `Heal needed on step #${sid} after ${nextCount} Nays (compiler/verify).`,
            resumePhase: 'coder',
            activeStepId: stuck?.id || plan.activeStepId,
            updatedAt: Date.now()
          });
          await healBlockedPlan();
          return;
        }
        await escalateStepToPlannerFixes(sid);
        return;
      }
      setExecutingPlanNotice(
        `Reworking step #${sid} from Reviewer Nay (${nextCount}/${MAX_STEP_REWORKS})…`
      );
      await dispatchActiveStep();
      return;
    }

    // Yay — clear heal counter so later steps get a fresh heal budget
    if (plannerPlanRef.current) {
      commitPlannerPlan({
        ...plannerPlanRef.current,
        healAttempts: 0,
        blockedReason: undefined,
        updatedAt: Date.now()
      });
    }
    const next = getActiveStep(plannerPlanRef.current || plan);
    if (next) {
      setExecutingPlanNotice(`Step Yay — starting step #${next.id}: ${next.title}`);
      await dispatchActiveStep();
    } else {
      restorePlannerControl('Planner plan complete — ask Planner what to build next.');
    }
  };

  /** After the user picks a plan option — Planner locks steps/tasks, then Coders run step 1. */
  const executeChosenPlan = async (
    option: PlanOption,
    planMsg: ChatMessage,
    confirmationText: string,
    attachedImages: string[] = []
  ) => {
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
    fitContext(modelMaxCtx(selectedNode, activeTargetModel), activeTargetModel);
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
    stopRequestedRef.current = false;

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
      notice: `Planner writing steps for Option ${option.id}`
    });

    if (stopRequestedRef.current) return;

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
    commitPlannerPlan(plan);
    setExecutingPlanNotice(
      `Plan locked (${plan.steps.length} steps) — dispatching next step…`
    );

    await dispatchActiveStep();
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
    stuckRef.current = { key: stuckKey(cleaned), stage: 'big' };
    setExecutingPlanNotice(`Retrying differently on ${big.node.name} · ${big.model}`);
    resetAgentLoopBudget();
    stopRequestedRef.current = false;
    await runSingleNodeTurn({
      userText: `Retry differently: ${cleaned}`,
      fullPrompt: `You already repeated this step without finishing it. Do NOT repeat the same approach.\n\nEither:\n1) Implement a concrete different fix with <edit_file> / <write_file>, or\n2) Stop and state what is blocking in one short sentence.\n\nStuck step:\n${cleaned}`,
      agent: coderAgent,
      planMode: false,
      reviewMode: false,
      approvedPlan: approvedPlanRef.current,
      notice: `Stuck retry (different approach) on ${big.node.name} · ${big.model}`,
      pinRoute: big
    });
    if (!stopRequestedRef.current) await reviewAndAdvance(0, cleaned);
  };

  const confirmPaidAssist = async (task: string) => {
    const paid = pickPaidFrontier(nodesRef.current);
    if (!paid || !task.trim()) return;
    setIsStreaming(true);
    setExecutingPlanNotice(`Asking ${paid.node.name} · ${paid.model}…`);
    let brief: string | null = null;
    try {
      brief = await requestAssistBrief(
        paid,
        'The local models are repeating this step and not fixing it. Give one short solution. Do not rewrite the file.',
        `${progressForPrompt()}\n\nStuck step:\n${task}`,
        false
      );
    } catch (err: any) {
      window.electronAPI?.writeLog?.('warn', `paid stuck: ${err?.message || err}`);
    }
    if (!brief || stopRequestedRef.current) {
      setIsStreaming(false);
      setExecutingPlanNotice(brief ? null : 'The paid API did not return a solution.');
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
    const big = pickLargestLocalTarget(nodesRef.current);
    if (!big) {
      setIsStreaming(false);
      setExecutingPlanNotice('Paid solution is in the chat. No local model is online to apply it.');
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
      freshContext: true
    });
    if (!stopRequestedRef.current) await reviewAndAdvance(0, brief);
    restorePlannerControl();
  };

  const handleSelectPlanOption = (option: PlanOption, planMsg: ChatMessage) => {
    if (option.action === 'copy') {
      void navigator.clipboard.writeText(option.description);
      return;
    }
    if (isStreaming || planMsg.selectedPlanOptionId) return;
    if (option.action === 'paid') {
      setMessages(prev =>
        prev.map(m => (m.id === planMsg.id ? { ...m, selectedPlanOptionId: option.id } : m))
      );
      void confirmPaidAssist(option.description);
      return;
    }
    if (option.action === 'retry-local') {
      setMessages(prev =>
        prev.map(m => (m.id === planMsg.id ? { ...m, selectedPlanOptionId: option.id } : m))
      );
      void retryStuckLocally(option.description);
      return;
    }
    if (option.action === 'stop') {
      setMessages(prev =>
        prev.map(m => (m.id === planMsg.id ? { ...m, selectedPlanOptionId: option.id } : m))
      );
      stuckRef.current = { key: '', stage: 'none' };
      setExecutingPlanNotice(null);
      return;
    }
    void executeChosenPlan(option, planMsg, `Option ${option.id}: ${option.title}`);
  };

  const handleSendMessage = async (e?: React.FormEvent, overrideText?: string) => {
    if (e) e.preventDefault();
    const hasImages = !overrideText && pendingImages.length > 0;
    const typed = (overrideText ?? input).trim();
    if ((!typed && !hasImages) || isStreaming || heldRef.current) return;
    setAssistError(null);

    const sendTier = activeTargetModel
      ? resolveModelFit(
          selectedNode,
          activeTargetModel,
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
    fitContext(modelMaxCtx(selectedNode, activeTargetModel), activeTargetModel);
    resetAgentLoopBudget();
    const enteredSend = bindRun(null, true);
    if (!enteredSend) return;
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
        return await executeChosenPlan(matched, pendingPlan, userText, attachedImages);
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
    if (runLive(enteredSend.run) && autoReviewRef.current) {
      await reviewAndAdvance(0, '', enteredSend.run);
    }
    } finally {
      leaveConductorRun(enteredSend.owned, enteredSend.run.token);
    }
  };

  const handleStop = () => {
    stopConductor();
    pendingReviewResumeRef.current = null;
    ephemeralWorkerRef.current = false;
    setIsStreaming(false);
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
      const ship = bindRun(null, true);
      if (!ship) return;
      try {
        setPlanPaused(false);
        await finishVerifiedPlan(activePlan);
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
    const ship = bindRun(null, true);
    if (!ship) return;
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
        await applyStepVerdictAndContinue(verdictMsg);
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
      await escalateStepToPlannerFixes(String(step.id));
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
      if (autoApplyWritesRef.current) {
        tools = await autoApplyWritableTools(tools, toolDepsRef.current);
        tools = await runAuxTools(tools, toolDepsRef.current);
        const cmdPass = await runCommandTools(tools, toolDepsRef.current);
        tools = cmdPass.tools;
        updateProgress(log => noteSavedFiles(log, tools, savedFileFingerprints()));
        noteAppliedWrites(tools);
      }
      const updatedMsg = { ...lastCoderMsg, toolCalls: tools };
      if (!runLive(ship.run)) {
        setIsStreaming(false);
        setPlanPaused(true);
        return;
      }
      setMessages(prev => {
        const next = prev.map(m => (m.id === lastCoderMsg.id ? updatedMsg : m));
        messagesRef.current = next;
        return next;
      });
      setIsStreaming(false);
      if (stopRequestedRef.current) {
        setPlanPaused(true);
        return;
      }
      if (shouldContinueFromTools(tools, continueDecisionOpts())) {
        await continueWithToolResults(updatedMsg, {
          createIntent: true,
          freshContext: true,
          role: 'coder'
        });
      }
      if (stopRequestedRef.current) {
        setPlanPaused(true);
        setPlanResumePhase('coder');
        return;
      }
      if (writesUnresolved(coderWriteTools())) {
        setExecutingPlanNotice('Resuming Coder — previous writes did not succeed.');
        await dispatchActiveStep();
        return;
      }
      if (step) {
        const p = plannerPlanRef.current;
        if (p) await commitPlannerPlan({ ...p, resumePhase: 'review', updatedAt: Date.now() });
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
        (t.status === 'done' || autoApplyWritesRef.current)
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
      await dispatchActiveStep();
      return;
    }

    if (wroteSomething || tasksAlreadyDone) {
      if (step) {
        const p = plannerPlanRef.current;
        if (p && p.resumePhase !== 'review') {
          await commitPlannerPlan({ ...p, resumePhase: 'review', updatedAt: Date.now() });
        } else {
          setPlanResumePhase('review');
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
    await dispatchActiveStep();
    } finally {
      leaveConductorRun(ship.owned, ship.run.token);
    }
  };

  const handleApplyAllTools = async (msg: ChatMessage) => {
    if (!msg.toolCalls || msg.toolCalls.length === 0) return;
    setIsStreaming(true);
    resetAgentLoopBudget();

    const updated: ToolCall[] = [];
    for (const tool of msg.toolCalls) {
      if (tool.status === 'done' || tool.status === 'error') {
        updated.push(tool);
        continue;
      }
      updated.push(await executeTool(tool, toolDepsRef.current));
    }

    updateProgress(log => noteSavedFiles(log, updated, savedFileFingerprints()));
    const nextMsg: ChatMessage = { ...msg, toolCalls: updated };
    setMessages(prev => prev.map(m => (m.id === msg.id ? nextMsg : m)));
    setIsStreaming(false);

    if (shouldContinueFromTools(updated, continueDecisionOpts())) {
      await continueWithToolResults(nextMsg, { createIntent: true });
    }
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
  const nodeWorkCollapsedRef = useRef(false);
  const [resizingControl, setResizingControl] = useState(false);
  const [resizingNodeWork, setResizingNodeWork] = useState(false);
  useEffect(() => {
    setControlColWidth(controlWidth);
    controlColWidthRef.current = controlWidth;
  }, [controlWidth]);
  useEffect(() => {
    setNodeWorkColWidth(nodeWorkWidth);
    nodeWorkColWidthRef.current = nodeWorkWidth;
  }, [nodeWorkWidth]);
  useEffect(() => {
    if (!resizingControl) return;
    const onMove = (e: MouseEvent) => {
      const el = document.getElementById('agent-conductor-root');
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const nodeW = nodeWorkCollapsedRef.current ? NODE_WORK_RAIL : nodeWorkColWidthRef.current;
      const max = rect.width - nodeW - MESSAGE_COLUMN_MIN - 8;
      const next = Math.max(200, Math.min(560, max, rect.right - e.clientX - nodeW - 4));
      controlColWidthRef.current = next;
      setControlColWidth(next);
    };
    const onUp = () => {
      setResizingControl(false);
      onControlWidthChange?.(controlColWidthRef.current);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [resizingControl, onControlWidthChange]);
  useEffect(() => {
    if (!resizingNodeWork) return;
    const onMove = (e: MouseEvent) => {
      const el = document.getElementById('agent-conductor-root');
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const max = rect.width - controlColWidthRef.current - MESSAGE_COLUMN_MIN - 8;
      const next = Math.max(200, Math.min(480, max, rect.right - e.clientX));
      nodeWorkColWidthRef.current = next;
      setNodeWorkColWidth(next);
    };
    const onUp = () => {
      setResizingNodeWork(false);
      onNodeWorkWidthChange?.(nodeWorkColWidthRef.current);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [resizingNodeWork, onNodeWorkWidthChange]);

  const { collapsed: nodeWorkCollapsed, toggle: toggleNodeWork } = useNodeWorkCollapse(
    nodeWorkSteps.length > 0
  );
  nodeWorkCollapsedRef.current = nodeWorkCollapsed;
  const tailMessage = messages[messages.length - 1];
  const scrollSignature = `${messages.length}:${tailMessage?.id || ''}:${tailMessage?.display?.length || 0}:${tailMessage?.raw?.length || 0}:${tailMessage?.toolCalls?.length || 0}:${isStreaming ? 1 : 0}`;
  const transcriptScroll = useStickToBottom(scrollSignature);
  const [paneWidth, setPaneWidth] = useState(0);
  useEffect(() => {
    const el = document.getElementById('agent-conductor-root');
    if (!el || typeof ResizeObserver === 'undefined') return;
    const publish = () => setPaneWidth(el.clientWidth);
    const obs = new ResizeObserver(publish);
    obs.observe(el);
    publish();
    return () => obs.disconnect();
  }, []);
  const retryMessage = useStableCallback((_messageId: string) => {
    const last = [...messagesRef.current].reverse().find(m => m.role === 'user');
    const text = (last?.raw || last?.display || '').trim();
    if (text) void handleSendMessage(undefined, text);
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
    if (msg) void applyStepVerdictAndContinue(msg);
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
  let shownControl = controlColWidth;
  let shownNodeWork = nodeWorkCollapsed ? NODE_WORK_RAIL : nodeWorkColWidth;
  if (!fill && paneWidth > 0) {
    const splits = 8;
    const reservedNode = nodeWorkCollapsed ? NODE_WORK_RAIL : 200;
    const maxControl = Math.max(200, paneWidth - reservedNode - MESSAGE_COLUMN_MIN - splits);
    shownControl = Math.min(controlColWidth, Math.min(560, maxControl));
    const maxNode = Math.max(200, paneWidth - shownControl - MESSAGE_COLUMN_MIN - splits);
    shownNodeWork = nodeWorkCollapsed
      ? NODE_WORK_RAIL
      : Math.min(nodeWorkColWidth, Math.min(480, maxNode));
  }

  const nodeWorkColumn = (
    <div
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
              isPaused={planPaused || (!showStreamingUi && isPlanActive(plannerPlanView))}
              onPause={handleStop}
              onResume={() => void resumeActivePlan()}
              onSkipStep={stepId => {
                const plan = plannerPlanRef.current;
                if (!plan) return;
                void commitPlannerPlan(skipStep(plan, stepId, 'Skipped.'));
              }}
              onEditStepTask={(stepId, taskId, text) => {
                const plan = plannerPlanRef.current;
                if (!plan) return;
                void commitPlannerPlan(editStepTask(plan, stepId, taskId, { title: text }));
              }}
              onRetryStep={stepId => {
                const plan = plannerPlanRef.current;
                if (!plan) return;
                const next = retryFailedStep(plan, stepId);
                if (next === plan) return;
                void (async () => {
                  await commitPlannerPlan(next);
                  if (!isStreaming && !heldRef.current) await dispatchActiveStep();
                })();
              }}
              onUndoStep={stepId => {
                void (async () => {
                  const snap = stepSnapshotsRef.current.get(String(stepId));
                  const plan = plannerPlanRef.current;
                  if (!plan) return;
                  if (!snap?.length) {
                    setExecutingPlanNotice(`No pre-coder snapshot for step #${stepId}.`);
                    return;
                  }
                  for (const file of snap) {
                    await onApplyFileWrite(file.path, file.content);
                  }
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
          <div className="grid grid-cols-1 gap-2">
            <div className="flex flex-col space-y-1">
              <span className="text-zinc-500 font-medium flex items-center space-x-1">
                {isFrontier ? <Cloud className="w-3 h-3 text-sky-400 shrink-0" /> : <Cpu className="w-3 h-3 text-emerald-400 shrink-0" />}
                <span>Computer</span>
                <HelpTip title="Computer" align="right">
                  <p>The machine that answers. Turn on “Choose a computer for me” under Automation if you want Studio to pick.</p>
                </HelpTip>
              </span>
              <select
                value={nodes.some(n => n.id === targetNodeId) ? targetNodeId : ''}
                onChange={(e) => {
                  const newNodeId = e.target.value;
                  setTargetNodeId(newNodeId);
                  setAutoSelectEndpoint(false);
                  const nextNode = nodes.find(n => n.id === newNodeId);
                  if (nextNode) {
                    setTargetModel(
                      pickBestModelForComplexity(nextNode, 'heavy') || getPreferredModelForNode(nextNode)
                    );
                  }
                }}
                disabled={nodes.length === 0}
                className="bg-[#1c1c24] border border-[#2a2a36] text-zinc-200 rounded px-2 py-1 outline-none text-[11px] truncate disabled:opacity-50"
              >
                {nodes.length === 0 ? (
                  <option value="">No endpoints — open Hardware & Models</option>
                ) : (
                  nodes.map(n => (
                    <option key={n.id} value={n.id} disabled={!n.online}>
                      {n.name}
                      {n.specialty && SPECIALTY_META[n.specialty]
                        ? ` [${SPECIALTY_META[n.specialty].shortLabel}]`
                        : ''}{' '}
                      {n.online ? `(${n.latency}ms)` : '(Offline)'}
                    </option>
                  ))
                )}
              </select>
            </div>
            <div className="flex flex-col space-y-1">
              <span className="text-zinc-500 font-medium flex items-center justify-between">
                <span>Model</span>
                <span className="flex items-center gap-1.5 font-mono text-[9px]">
                  {activeTargetMaxCtx > 0 && (
                    <span
                      className="text-sky-400/90"
                      title="Studio max context for this model (Hardware & Models → Models). Worker prompts are shaped to this ceiling."
                    >
                      {activeTargetMaxCtx.toLocaleString()} ctx
                    </span>
                  )}
                  {benchmarkStat && (
                    <span className="text-amber-400 flex items-center space-x-0.5">
                      <Zap className="w-2.5 h-2.5" />
                      <span>{benchmarkStat.evalTokPerSec} t/s</span>
                    </span>
                  )}
                </span>
              </span>
              <select
                value={activeTargetModel}
                onChange={(e) => {
                  const newModel = e.target.value;
                  if (!newModel) return;
                  setTargetModel(newModel);
                  if (selectedNode) onSelectNodeModel?.(selectedNode.id, newModel);
                }}
                disabled={effectiveModels.length === 0}
                className="bg-[#1c1c24] border border-[#2a2a36] text-zinc-200 rounded px-2 py-1 outline-none text-[11px] truncate disabled:opacity-50"
              >
                {effectiveModels.length === 0 ? (
                  <option value="">
                    {!selectedNode
                      ? 'Add an endpoint in Hardware & Models'
                      : selectedNode.online
                        ? 'No models installed — pull in Hardware & Models'
                        : 'Node offline / no models'}
                  </option>
                ) : (
                  effectiveModels.map(m => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))
                )}
              </select>
              {selectedSupportsThink && onToggleModelThinking && selectedNode && activeTargetModel && (
                <button
                  type="button"
                  onClick={() => onToggleModelThinking(selectedNode.id, activeTargetModel, !selectedThinkOn)}
                  className={`w-full flex items-center justify-center space-x-1.5 px-2 py-1 rounded border text-[10px] font-medium transition ${
                    selectedThinkOn
                      ? 'bg-violet-600/25 border-violet-500/40 text-violet-200'
                      : 'bg-[#18181d] border-[#2a2a34] text-zinc-400 hover:text-zinc-200'
                  }`}
                  title="Qwen3-style thinking: ON = deeper/slower, OFF = faster direct answers"
                >
                  <Brain className={`w-3 h-3 ${selectedThinkOn ? 'text-violet-300' : 'text-zinc-500'}`} />
                  <span>{thinkingToggleLabel(!!selectedThinkOn)}</span>
                </button>
              )}
            </div>
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
                setTargetNodeId(nodeId);
                const nextNode = nodesRef.current.find(n => n.id === nodeId);
                if (nextNode) {
                  setTargetModel(
                    pickBestModelForComplexity(nextNode, 'heavy') || getPreferredModelForNode(nextNode)
                  );
                }
              }}
            />
          )}
        </div>
      </div>
  );

  return (
    <div
      id="agent-conductor-root"
      style={fill ? undefined : { width }}
      className={`h-full bg-[#161619] border-l border-[#27272a] flex min-w-0 relative ${
        fill ? 'w-full flex-col select-text' : 'flex-row select-none shrink-0'
      }`}
    >
      {/* Left — Conversation */}
      <div className={`flex-1 flex flex-col min-h-0 overflow-hidden ${fill ? 'min-w-0' : 'min-w-[320px]'}`}>
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

            <button
              type="button"
              onClick={() => fitContext(modelMaxCtx(selectedNode, activeTargetModel), true, activeTargetModel)}
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
            min={200}
            max={560}
            active={resizingControl}
            onDragStart={() => setResizingControl(true)}
            onChange={next => {
              controlColWidthRef.current = next;
              setControlColWidth(next);
            }}
            onCommit={next => {
              controlColWidthRef.current = next;
              setControlColWidth(next);
              onControlWidthChange?.(next);
            }}
          />
          {conductorColumn}
          <SplitHandle
            orientation="vertical"
            label="Resize node work column"
            value={shownNodeWork}
            min={nodeWorkCollapsed ? NODE_WORK_RAIL : 200}
            max={nodeWorkCollapsed ? NODE_WORK_RAIL : 480}
            active={resizingNodeWork}
            onDragStart={() => {
              if (!nodeWorkCollapsed) setResizingNodeWork(true);
            }}
            onChange={next => {
              if (nodeWorkCollapsed) return;
              nodeWorkColWidthRef.current = next;
              setNodeWorkColWidth(next);
            }}
            onCommit={next => {
              if (nodeWorkCollapsed) return;
              nodeWorkColWidthRef.current = next;
              setNodeWorkColWidth(next);
              onNodeWorkWidthChange?.(next);
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
