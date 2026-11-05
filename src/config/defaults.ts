import { AgentPersona, AppSettings, HardwareProfile, NodeConfig } from '../types';
import { normalizeClusterNodes } from '../lib/tools';

export const SETTINGS_VERSION = 6;

/** Memory bandwidth presets (GB/s). Bandwidth, not TFLOPs, is what limits local token generation speed. */
export const GPU_PRESETS: { name: string; vramGB: number; bandwidth: number }[] = [
  { name: 'RTX 5090', vramGB: 32, bandwidth: 1792 },
  { name: 'RTX 5080', vramGB: 16, bandwidth: 960 },
  { name: 'RTX 5070 Ti', vramGB: 16, bandwidth: 896 },
  { name: 'RTX 5070', vramGB: 12, bandwidth: 672 },
  { name: 'RTX 5060 Ti 16GB', vramGB: 16, bandwidth: 448 },
  { name: 'RTX 4090', vramGB: 24, bandwidth: 1008 },
  { name: 'RTX 4080', vramGB: 16, bandwidth: 717 },
  { name: 'RTX 4070 Ti', vramGB: 12, bandwidth: 504 },
  { name: 'RTX 4060 Ti 16GB', vramGB: 16, bandwidth: 288 },
  { name: 'RTX 3090', vramGB: 24, bandwidth: 936 },
  { name: 'RTX 3080', vramGB: 10, bandwidth: 760 },
  { name: 'RTX 3060 12GB', vramGB: 12, bandwidth: 360 },
  { name: 'RTX 3060 Laptop (6GB)', vramGB: 6, bandwidth: 336 },
  { name: 'GTX 1080 Ti', vramGB: 11, bandwidth: 484 },
  { name: 'GTX 1080', vramGB: 8, bandwidth: 320 },
  { name: 'Radeon RX 7900 XTX', vramGB: 24, bandwidth: 960 },
  { name: 'Radeon RX 9070 XT', vramGB: 16, bandwidth: 640 }
];

export const RAM_PRESETS: { name: string; bandwidth: number }[] = [
  { name: 'DDR5-6400 dual channel', bandwidth: 102 },
  { name: 'DDR5-6000 dual channel', bandwidth: 96 },
  { name: 'DDR5-5600 dual channel', bandwidth: 90 },
  { name: 'DDR4-3600 dual channel', bandwidth: 58 },
  { name: 'DDR4-3200 dual channel', bandwidth: 51 },
  { name: 'DDR4-2666 dual channel', bandwidth: 43 }
];

export function guessGpuBandwidth(gpuName: string): number | undefined {
  const n = gpuName.toLowerCase();
  const hit = GPU_PRESETS.find(p => n.includes(p.name.toLowerCase().replace(/ \(.*\)$/, '')));
  return hit?.bandwidth;
}

/** Generic hardware used when merging incomplete node records. */
export const DEFAULT_HARDWARE: HardwareProfile = {
  cpu: 'Generic CPU',
  gpu: 'Generic GPU',
  vramGB: 8,
  gpuBandwidthGBs: 300,
  ramGB: 16,
  ramBandwidthGBs: 50,
  reserveVramGB: 1,
  kvCacheType: 'f16'
};

/** No seeded endpoints — add nodes manually in Hardware Settings. */
export const DEFAULT_NODES: NodeConfig[] = [];

export const DEFAULT_AGENTS: AgentPersona[] = [
  {
    id: 'planner',
    handle: 'planner',
    name: 'Architect',
    role: 'Primary chat with the user. Plans, dispatches Coder/Reviewer workers, tracks the work.',
    endpointId: '',
    model: 'qwen2.5-coder:7b',
    temperature: 0.4,
    numCtx: 16384,
    toolsEnabled: true,
    autoApproveWrites: false,
    autoApproveCommands: false,
    systemPrompt: `You are the software architect and the user's primary conversational partner. Own goals, options, progress, and what happens next. Coder and Reviewer are short-lived workers you dispatch — they do not keep the long conversation.

Explore with read_file, list_dir, and search when helpful, then produce a concrete plan: intent, assumptions, phases/files, and 2–4 numbered options with short tradeoffs.

Bend over backwards to match the user's delivery goal (e.g. "open in browser" → prefer static HTML unless they ask for React). Ask only architecture-changing decisions — do not spam questions. Do NOT write the deliverable files yet; wait for the user to pick an option. Always end with a <plan_options> XML block the UI can parse. After a plan is locked, keep the user oriented: what finished, what is next, and any blockers.`
  },
  {
    id: 'coder',
    handle: 'coder',
    name: 'Lead Coder',
    role: 'Ephemeral worker: implements one locked step/task, then returns control to Planner.',
    endpointId: '',
    model: 'qwen2.5-coder:7b',
    temperature: 0.2,
    numCtx: 16384,
    toolsEnabled: true,
    autoApproveWrites: true,
    autoApproveCommands: false,
    systemPrompt: `You are a focused implementation worker. You receive a locked step or task packet — implement only that. Use tool tags (<write_file>, <edit_file>, <run_command>, <web_search>, <generate_image>) to change the workspace. Do not reply with only markdown code blocks.

Do not re-plan the whole project. Do not reopen option debates. Trust the packet, the work log, and the files provided. Match the delivery stack in the packet (static HTML vs React/TS, Python, Go, Rust, Electron, etc.). When the step is done, stop — Planner and Reviewer handle what comes next.`
  },
  {
    id: 'reviewer',
    handle: 'reviewer',
    name: 'Reviewer',
    role: 'Ephemeral worker: verifies one step or change set, then returns control to Planner.',
    endpointId: '',
    model: 'qwen2.5-coder:7b-instruct',
    temperature: 0.1,
    numCtx: 16384,
    toolsEnabled: true,
    autoApproveWrites: false,
    autoApproveCommands: false,
    systemPrompt: `You are a focused review worker. Verify only the active step or change set you were given. Look for correctness bugs, unhandled edge cases, security problems, and clear failures. Cite file/line when possible.

Do NOT edit or write project files. Do not invent a new product roadmap. For Planner step gates, end with <step_verdict>. For broader review handoffs, end with a <review_plan> for Planner→Coder. Then stop — Planner owns the next decision.`
  },
  {
    id: 'docs',
    handle: 'docs',
    name: 'Explainer',
    role: 'Explains code, writes docs, tests and commit messages',
    endpointId: '',
    model: 'qwen2.5-coder:7b-instruct',
    temperature: 0.3,
    numCtx: 16384,
    toolsEnabled: true,
    autoApproveWrites: true,
    autoApproveCommands: false,
    systemPrompt: `You explain code clearly and write documentation, docstrings, unit tests and commit messages. When generating new tests or documentation files, use <write_file path="..."> so they are saved to the workspace.`
  }
];

export const DEFAULT_SETTINGS: AppSettings = {
  version: SETTINGS_VERSION,
  nodes: DEFAULT_NODES,
  agents: DEFAULT_AGENTS,
  keepAlive: '30m',
  maxAgentSteps: 12,
  commandTimeoutSec: 180,
  pollIntervalSec: 15,
  estimateContext: 16384,
  localTokensGenerated: 0,
  frontierTokensUsed: 0,
  explorerWidth: 240,
  chatWidth: 640,
  agentControlWidth: 270,
  agentNodeWorkWidth: 280,
  uiScale: 1.0,
  recentWorkspaces: [],
  conversations: [],
  activeConversationId: undefined,
  searxngUrl: '',
  webConsole: {
    enabled: false,
    port: 3847
  }
};

/** Merge persisted settings over defaults so new fields added in later versions get sane values. */
export function mergeSettings(saved: Partial<AppSettings> | null): AppSettings {
  if (!saved) return structuredClone(DEFAULT_SETTINGS);

  const nodes = Array.isArray(saved.nodes) ? saved.nodes : DEFAULT_NODES;
  const uiScale = typeof saved.uiScale === 'number' && saved.uiScale >= 0.7 && saved.uiScale <= 2.5
    ? saved.uiScale
    : 1.0;

  return {
    ...DEFAULT_SETTINGS,
    ...saved,
    version: SETTINGS_VERSION,
    uiScale,
    nodes: normalizeClusterNodes(
      nodes.map(n => ({
        ...n,
        hardware: { ...DEFAULT_HARDWARE, ...n.hardware }
      }))
    ),
    agents: (saved.agents?.length ? saved.agents : DEFAULT_AGENTS).map(a => {
      const def =
        DEFAULT_AGENTS.find(d => d.id === a.id || d.handle === a.handle) || DEFAULT_AGENTS[0];
      // Refresh built-in planner/coder/reviewer prompts so the Planner-owned workflow stays current
      const refreshPrompt =
        a.handle === 'planner' ||
        a.handle === 'coder' ||
        a.handle === 'reviewer' ||
        a.id === 'planner' ||
        a.id === 'coder' ||
        a.id === 'reviewer';
      return {
        ...def,
        ...a,
        systemPrompt: refreshPrompt ? def.systemPrompt : a.systemPrompt || def.systemPrompt
      };
    }),
    conversations: Array.isArray(saved.conversations) ? saved.conversations : [],
    webConsole: {
      enabled: false,
      port: 3847,
      ...(saved.webConsole || {})
    }
  };
}
