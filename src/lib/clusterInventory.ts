import type { EndpointNode, NodeRole } from '../types';
import {
  DEFAULT_FRONTIER_NUM_CTX,
  isFrontierEndpoint,
  isWideFrontierModel,
  resolveModelMaxNumCtx
} from './contextSize';

export type ModelFitTier = 'tight' | 'standard' | 'wide';
export type ModelFitRole = NodeRole | 'coder' | 'reviewer' | 'planner' | 'docs' | 'worker';

const TIGHT_CTX = 16384;
const WIDE_CTX = 65536;

/** Same heuristic as tools.isSmallModel — kept local to avoid import cycles. */
function looksSmallModel(modelName?: string): boolean {
  if (!modelName) return false;
  const m = modelName.toLowerCase();
  if (/gemini|gpt-4|claude|grok/i.test(m)) return false;
  const moe = m.match(/(?:^|[^a-z0-9])(\d+)\s*x\s*(\d+(?:\.\d+)?)\s*b\b/);
  if (moe) return parseFloat(moe[1]) * parseFloat(moe[2]) <= 14;
  const match = m.match(/(\d+(?:\.\d+)?)\s*b\b/);
  if (match) {
    const b = parseFloat(match[1]);
    return b <= 14;
  }
  return /gemma|qwen|phi|llama|deepseek|tiny|mini|smollm/i.test(m);
}

/** Classify how dense / checklist-style the worker packet should be. */
export function modelFitTier(model: string, maxCtx: number): ModelFitTier {
  // Cloud Gemini / GPT / Claude / Grok: never "tight" — they manage long context themselves.
  if (isWideFrontierModel(model)) {
    const ctx = Math.floor(maxCtx || DEFAULT_FRONTIER_NUM_CTX);
    return ctx >= WIDE_CTX ? 'wide' : 'standard';
  }
  const small = looksSmallModel(model);
  const ctx = Math.floor(maxCtx || 0);
  if (ctx <= TIGHT_CTX && (small || ctx > 0)) return 'tight';
  if (!small && ctx >= WIDE_CTX) return 'wide';
  return 'standard';
}

export function describeRoutedModel(
  node: Pick<EndpointNode, 'name'> | undefined,
  model: string,
  role: string,
  maxCtx: number
): string {
  const nodeName = node?.name || 'node';
  const ctx = maxCtx > 0 ? `${maxCtx.toLocaleString()} ctx` : 'ctx unknown';
  return `${role} on ${nodeName} · ${model || '(no model)'} · ${ctx}`;
}

function rolesLabel(node: EndpointNode): string {
  const roles = node.roles?.length ? node.roles.join(', ') : 'Auto';
  return roles;
}

function isEmbeddingName(name: string, capabilities?: string[]): boolean {
  const n = name.toLowerCase();
  if (n.includes('embed') || n.includes('bge-') || n.includes('bge:') || n.includes('mxbai')) {
    return true;
  }
  if (capabilities && capabilities.length === 1 && capabilities[0] === 'embedding') return true;
  return false;
}

/** Enabled generative models — mirrors tools.getEnabledModelsForNode without importing tools. */
function enabledModelsOnNode(node: EndpointNode): string[] {
  const disabled = new Set(node.disabledModels || []);
  const discovered = (node.models || [])
    .filter(m => !isEmbeddingName(m.name, m.capabilities) && !disabled.has(m.name))
    .map(m => m.name);
  if (node.online) return discovered;
  if (discovered.length > 0) return discovered;
  const benchKeys = Object.keys(node.benchmarks || {}).filter(
    k => !isEmbeddingName(k) && !disabled.has(k)
  );
  if (benchKeys.length > 0) return benchKeys;
  if (node.activeModel && !disabled.has(node.activeModel)) return [node.activeModel];
  return [];
}

function modelDetailLine(node: EndpointNode, modelName: string, fallbackCtx: number): string {
  const live = node.models?.find(m => m.name === modelName);
  const family = live?.details?.family || '';
  const params = live?.details?.parameter_size || '';
  const maxCtx = resolveModelMaxNumCtx(node, modelName, fallbackCtx);
  const meta = [family, params].filter(Boolean).join(' ');
  const active = node.activeModel === modelName ? ' [active]' : '';
  const loaded = (node.loaded || []).some(l => l.name === modelName) ? ' [loaded]' : '';
  return `  - ${modelName}${meta ? ` (${meta})` : ''} · max ctx ${maxCtx}${active}${loaded}`;
}

/**
 * Compact cluster roster for Planner system prompts: nodes, roles, models, max ctx.
 */
export function formatClusterInventory(
  nodes: EndpointNode[],
  opts?: { fallbackNumCtx?: number }
): string {
  const fallback = opts?.fallbackNumCtx && opts.fallbackNumCtx > 0 ? opts.fallbackNumCtx : 16384;
  if (!nodes?.length) return '## Cluster inventory\n(no nodes configured)';

  const lines: string[] = ['## Cluster inventory', 'Live nodes the Studio can route to:'];
  for (const n of nodes) {
    const status = n.online ? 'online' : 'offline';
    const dev = n.isDevNode ? ' · Dev' : '';
    const frontier = n.type === 'openai' || n.apiKey ? ' · frontier' : '';
    const spec = n.specialty ? ` · specialty: ${n.specialty}` : '';
    const vram =
      !frontier && n.hardware?.vramGB
        ? ` · ${Math.max(0, n.hardware.vramGB - (n.hardware.reserveVramGB || 0)).toFixed(1)}/${n.hardware.vramGB}GB VRAM`
        : '';
    lines.push(`- **${n.name}** [id=${n.id}] (${status}${dev}${frontier}${vram}${spec}) · roles: ${rolesLabel(n)}`);
    const enabled = enabledModelsOnNode(n);
    if (!enabled.length) {
      lines.push('  - (no enabled models)');
      continue;
    }
    for (const m of enabled.slice(0, 8)) {
      lines.push(modelDetailLine(n, m, fallback));
    }
    if (enabled.length > 8) lines.push(`  - …+${enabled.length - 8} more`);
  }
  lines.push(
    'Size plan steps for the worker that will run them: small / ≤16k-ctx models need concrete checklists and one primary file; wide-ctx models can take richer packets.'
  );
  return lines.join('\n');
}

export interface ModelFitOpts {
  model: string;
  nodeName: string;
  role: string;
  maxCtx: number;
  tier?: ModelFitTier;
}

const TIGHT_RULES = `Rules for this model (tight context):
- Be concrete: named sections, options, and file paths — not open-ended "improve this".
- Prefer one primary file; pack the highest-value upgrades that fit.
- Emit <edit_file> / <write_file> soon; no long analysis essays.
- Implement listed items as an explicit checklist; do not invent a parallel redesign.`;

const STANDARD_RULES = `Rules for this model:
- Follow the step tasks and prefer edit_file when file bodies are provided.
- Stay on the assigned files; keep output actionable.`;

const WIDE_RULES = `Rules for this model (wide context):
- You may use more of the preloaded file bodies and sibling context.
- Still prefer surgical edit_file over rewriting whole trees.`;

/** Injected into worker user packets after route is known. */
export function buildModelFitSection(opts: ModelFitOpts): string {
  const tier = opts.tier ?? modelFitTier(opts.model, opts.maxCtx);
  const rules =
    tier === 'tight' ? TIGHT_RULES : tier === 'wide' ? WIDE_RULES : STANDARD_RULES;
  return `### MODEL FIT
You are running as ${opts.role} on ${opts.nodeName} · ${opts.model}.
Max context for this model: ${opts.maxCtx} tokens (Studio caps the request to fit).
Tier: ${tier}.

${rules}`;
}

/** Extra line appended to step task packets for tight-tier workers. */
export const TIGHT_PACKING_LINE =
  'Implement the listed items as an explicit checklist in the target file(s); do not invent a parallel redesign.';

export function fileContextCapsForTier(tier: ModelFitTier): {
  maxFiles: number;
  maxCharsPerFile: number;
  maxTotalChars: number;
} {
  if (tier === 'tight') {
    return { maxFiles: 4, maxCharsPerFile: 4000, maxTotalChars: 12000 };
  }
  if (tier === 'wide') {
    return { maxFiles: 12, maxCharsPerFile: 14000, maxTotalChars: 64000 };
  }
  return { maxFiles: 8, maxCharsPerFile: 8000, maxTotalChars: 32000 };
}

/** Resolve tier + caps for a concrete route. */
export function resolveModelFit(
  node: EndpointNode | undefined,
  model: string,
  role: string,
  fallbackNumCtx = 16384
): {
  maxCtx: number;
  tier: ModelFitTier;
  section: string;
  caps: ReturnType<typeof fileContextCapsForTier>;
  packingLine: string | null;
} {
  const frontier = isFrontierEndpoint(node) || isWideFrontierModel(model);
  const maxCtx = resolveModelMaxNumCtx(
    node,
    model,
    frontier ? DEFAULT_FRONTIER_NUM_CTX : fallbackNumCtx
  );
  const tier = modelFitTier(model, maxCtx);
  return {
    maxCtx,
    tier,
    section: buildModelFitSection({
      model,
      nodeName: node?.name || 'node',
      role,
      maxCtx,
      tier
    }),
    caps: fileContextCapsForTier(tier),
    packingLine: tier === 'tight' ? TIGHT_PACKING_LINE : null
  };
}
