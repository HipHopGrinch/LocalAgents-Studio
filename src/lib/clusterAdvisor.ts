import {
  EndpointNode,
  NodeConfig,
  NodeRole,
  NodeSpecialty,
  OllamaModel
} from '../types';
import { MODEL_CATALOG, CatalogModel } from '../config/modelCatalog';
import {
  estimateInstalledModelFit,
  findCatalogModel,
  fitSpillsToSystemRam,
  installedModelSizeB,
  normTag,
  parseParams,
  recommend
} from './recommender';
import { clampNumCtx, resolveModelMaxContext, snapNumCtxToOption } from './contextSize';
import { extractJsonObject, sanitizeLooseJson, stripThinkBlocks } from './swarmContract';

export type GpuArchTier = 'blackwell_ada' | 'ampere' | 'pascal_turing' | 'generic' | 'cloud';

export interface NodeModelAdvice {
  name: string;
  sizeGB: number;
  paramsB: number;
  recommendedNumCtx: number;
  fitsVramAtRecommendedCtx: boolean;
  estimatedTokPerSec: number;
  measuredTokPerSec?: number;
  score: number;
  keepEnabled: boolean;
  isPrimary: boolean;
  reason: string;
}

export interface RecommendedPull {
  tag: string;
  sizeGB: number;
  estimatedTokPerSec: number;
  reason: string;
}

export interface NodeAutoConfigAdvice {
  nodeId: string;
  nodeName: string;
  isFrontier: boolean;
  gpuArch: GpuArchTier;
  vramGB: number;
  recommendedReserveVramGB: number;
  recommendedOverheadMode?: 'windows_desktop' | 'headless_linux' | 'igpu_display';
  usableVramGB: number;
  bandwidthGBs: number;
  specialty: NodeSpecialty;
  roles: NodeRole[];
  primaryModel?: string;
  enabledModels: string[];
  disabledModels: string[];
  modelNumCtx: Record<string, number>;
  modelAdvice: NodeModelAdvice[];
  recommendedPulls: RecommendedPull[];
  rationale: string;
}

export interface ClusterAutoConfigPlan {
  source: 'physics' | 'cloud_strategist';
  strategistModel?: string;
  summary: string;
  nodes: NodeAutoConfigAdvice[];
  generatedAt: number;
}

export const SPECIALTY_META: Record<
  NodeSpecialty,
  { label: string; shortLabel: string; badgeClass: string; shortDesc: string; description: string }
> = {
  architect: {
    label: 'Lead Architect & Heavy Coder',
    shortLabel: 'Architect',
    badgeClass: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
    shortDesc: 'Contracts, complex multi-file logic, core state & compiler repair',
    description: 'Contracts, complex multi-file logic, core state & compiler repair'
  },
  heavy_coder: {
    label: 'Heavy Implementation Coder',
    shortLabel: 'Heavy Coder',
    badgeClass: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40',
    shortDesc: 'Core feature implementation & multi-file refactoring',
    description: 'Core feature implementation & multi-file refactoring'
  },
  module_coder: {
    label: 'Module Coder & Reviewer',
    shortLabel: 'Module Coder',
    badgeClass: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
    shortDesc: 'Parallel single-file modules, backend services, unit tests & code review',
    description: 'Parallel single-file modules, backend services, unit tests & code review'
  },
  reviewer: {
    label: 'Code Reviewer & Verifier',
    shortLabel: 'Reviewer',
    badgeClass: 'bg-violet-500/20 text-violet-300 border-violet-500/40',
    shortDesc: 'Step verification, bug hunting & diff review',
    description: 'Step verification, bug hunting & diff review'
  },
  scout: {
    label: 'Fast Scout & UI Specialist',
    shortLabel: 'Scout / UI',
    badgeClass: 'bg-teal-500/20 text-teal-300 border-teal-500/40',
    shortDesc: 'Fast UI/CSS/HTML, docs, repo summarization & light leaf files',
    description: 'Fast UI/CSS/HTML, docs, repo summarization & light leaf files'
  },
  strategist: {
    label: 'Cloud Strategist & Meta-Router',
    shortLabel: 'Strategist',
    badgeClass: 'bg-sky-500/20 text-sky-300 border-sky-500/40',
    shortDesc: 'Cluster advisor, Pass-1 task decomposition & stuck-loop escalation arbiter',
    description: 'Cluster advisor, Pass-1 task decomposition & stuck-loop escalation arbiter'
  }
};

function isEmbeddingModel(m: { name: string; capabilities?: string[] }): boolean {
  const n = m.name.toLowerCase();
  return (
    !!m.capabilities?.includes('embedding') ||
    n.includes('embed') ||
    n.includes('bge-') ||
    n.includes('bge:') ||
    n.includes('mxbai')
  );
}

/** Detect GPU architecture generation from GPU name for prefill & KV cache tuning. */
export function detectGpuArchTier(node: EndpointNode): GpuArchTier {
  if (node.type === 'openai' || !!node.apiKey) return 'cloud';
  const g = (node.hardware?.gpu || '').toLowerCase();
  if (/rtx\s*[45]0\d\d|ada|blackwell|l40|h100|b200/i.test(g)) return 'blackwell_ada';
  if (/rtx\s*30\d\d|ampere|a100|a6000|a4000/i.test(g)) return 'ampere';
  if (/gtx\s*10\d\d|gtx\s*16\d\d|rtx\s*20\d\d|pascal|turing|titan\s*x|p100|p40/i.test(g)) {
    return 'pascal_turing';
  }
  return 'generic';
}

/**
 * Determine optimal reserved VRAM based on node role, OS/display hints, and GPU type:
 * - Headless Linux (or 1080 Ti / server node): 0.2 GB
 * - Laptop with iGPU handling Windows display (or non-Dev RTX 3060 laptop): 0.1 GB
 * - Main Windows Dev Desktop driving monitors: 0.8 – 1.0 GB
 */
export function recommendReserveVram(node: EndpointNode): {
  reserveVramGB: number;
  mode: 'windows_desktop' | 'headless_linux' | 'igpu_display';
} {
  if (node.type === 'openai' || !!node.apiKey) {
    return { reserveVramGB: 0, mode: 'headless_linux' };
  }
  const explicitMode = node.hardware?.vramOverheadMode;
  if (explicitMode === 'headless_linux') {
    return { reserveVramGB: 0.2, mode: 'headless_linux' };
  }
  if (explicitMode === 'igpu_display') {
    return { reserveVramGB: 0.1, mode: 'igpu_display' };
  }
  if (explicitMode === 'windows_desktop') {
    return { reserveVramGB: Math.min(1.0, Math.max(0.5, node.hardware?.reserveVramGB || 1.0)), mode: 'windows_desktop' };
  }

  const text = `${node.name} ${node.hardware?.gpu || ''} ${node.hardware?.cpu || ''}`.toLowerCase();
  const isLocalhost = /localhost|127\.0\.0\.1|\[::1\]/i.test(node.url || '');
  const isDev = !!node.isDevNode || isLocalhost;

  // Headless Linux or GTX 1080 Ti secondary node
  if (/linux|headless|ubuntu|debian|server|1080\s*ti/i.test(text) && !isDev) {
    return { reserveVramGB: 0.2, mode: 'headless_linux' };
  }
  // Laptop GPU (e.g. RTX 3060 6GB) where Windows display runs on iGPU
  if (/laptop|mobile|3060|igpu/i.test(text) && (node.hardware?.vramGB || 0) <= 8 && !isDev) {
    return { reserveVramGB: 0.1, mode: 'igpu_display' };
  }
  // Remote secondary node on LAN: if user already lowered reserveVramGB <= 0.3, honor it
  if (!isDev && typeof node.hardware?.reserveVramGB === 'number' && node.hardware.reserveVramGB <= 0.3) {
    return {
      reserveVramGB: node.hardware.reserveVramGB,
      mode: node.hardware.reserveVramGB <= 0.15 ? 'igpu_display' : 'headless_linux'
    };
  }
  if (!isDev) {
    // Non-dev remote node defaults to minimal reserve
    return { reserveVramGB: 0.2, mode: 'headless_linux' };
  }
  return { reserveVramGB: 1.0, mode: 'windows_desktop' };
}

/**
 * Compute the highest safe num_ctx ceiling for `model` on `node` that:
 * 1) Never spills model + KV cache out of usable VRAM into system RAM (if weights fit in VRAM).
 * 2) Respects architecture prefill speed limits (Pascal GTX 1080 Ti lacks Tensor Cores -> cap at 8K-12K;
 *    6GB Laptop RTX 3060 -> cap at 8K for 7B/8B models or 16K for <=4B models;
 *    Blackwell RTX 5070 Ti 16GB -> 16K-32K).
 */
export function computeOptimalNumCtxForModel(
  node: EndpointNode,
  model: OllamaModel,
  usableVramGB: number
): { numCtx: number; fitsVram: boolean; estimatedTokPerSec: number } {
  const arch = detectGpuArchTier(node);
  const hw = {
    ...node.hardware,
    reserveVramGB: Math.max(0, (node.hardware?.vramGB || 0) - usableVramGB)
  };
  const nativeMax = resolveModelMaxContext(model.name, model) || 32768;
  const paramsB = installedModelSizeB(model.name, model.details?.parameter_size);

  // Candidate context tiers from highest practical down to 4096
  let candidates: number[];
  if (arch === 'pascal_turing') {
    // Pascal has no Tensor Cores: keep prefill fast and leave VRAM headroom on 11GB
    candidates = paramsB >= 12 ? [8192, 4096] : [12288, 8192, 4096];
  } else if (usableVramGB <= 6.2) {
    // 6GB dedicated card (e.g. Laptop RTX 3060)
    candidates = paramsB >= 6.5 ? [8192, 4096] : [16384, 8192, 4096];
  } else if (usableVramGB <= 12.5) {
    candidates = paramsB >= 13 ? [12288, 8192, 4096] : [16384, 12288, 8192, 4096];
  } else {
    // 16GB+ Blackwell / Ada (e.g. RTX 5070 Ti)
    candidates = paramsB >= 22 ? [16384, 12288, 8192] : [32768, 24576, 16384, 12288, 8192];
  }

  for (const cand of candidates) {
    const clamped = clampNumCtx(cand, nativeMax);
    const snapped = snapNumCtxToOption(clamped, nativeMax);
    const fit = estimateInstalledModelFit(model, hw, snapped);
    if (!fitSpillsToSystemRam(fit.kind)) {
      return {
        numCtx: snapped,
        fitsVram: true,
        estimatedTokPerSec: fit.tokensPerSec
      };
    }
  }

  // Fallback if even 4096 spills to RAM
  const minCtx = snapNumCtxToOption(clampNumCtx(4096, nativeMax), nativeMax);
  const fallbackFit = estimateInstalledModelFit(model, hw, minCtx);
  return {
    numCtx: minCtx,
    fitsVram: !fitSpillsToSystemRam(fallbackFit.kind),
    estimatedTokPerSec: fallbackFit.tokensPerSec
  };
}

/**
 * Score an installed generative model for a specific node based on:
 * - Full VRAM fit (huge penalty for spilling to system RAM)
 * - Coding & agentic specialization (qwen2.5-coder, qwen3-coder, devstral, deepcoder, gpt-oss, qwen3, deepseek-r1)
 * - Measured or estimated tok/s throughput
 * - Parameter count sweet-spot for the node's usable VRAM
 */
export function scoreInstalledModelForNode(
  node: EndpointNode,
  model: OllamaModel,
  usableVramGB: number,
  targetSpecialty: NodeSpecialty
): {
  score: number;
  recommendedNumCtx: number;
  fitsVram: boolean;
  estimatedTokPerSec: number;
  measuredTokPerSec?: number;
  sizeGB: number;
  paramsB: number;
  reason: string;
} {
  const catalog = findCatalogModel(model.name);
  const sizeGB = model.size > 0 ? model.size / 1e9 : catalog?.sizeGB ?? 4.5;
  const paramsB =
    installedModelSizeB(model.name, model.details?.parameter_size) ||
    parseParams(model.name) ||
    7;

  const { numCtx, fitsVram, estimatedTokPerSec } = computeOptimalNumCtxForModel(
    node,
    model,
    usableVramGB
  );
  const bm = node.benchmarks?.[model.name];
  const measuredTokPerSec =
    bm && !bm.isEmbedding && bm.evalTokPerSec > 0 ? bm.evalTokPerSec : undefined;
  const effectiveTps = measuredTokPerSec ?? estimatedTokPerSec;

  const lower = model.name.toLowerCase();
  const isCoderTuned =
    /coder|devstral|codestral|deepcoder|starcoder|codellama/i.test(lower);
  const isReasoningTuned = /deepseek-r1|qwq|gpt-oss|qwen3/i.test(lower);
  const isVisionOnly = /llava|moondream|minicpm-v/i.test(lower);

  // Base quality from catalog or heuristic
  let baseQuality =
    catalog?.quality?.coding ??
    catalog?.quality?.agent ??
    (isCoderTuned ? 8.0 : isReasoningTuned ? 7.5 : 6.0);

  if (isCoderTuned) baseQuality += 1.5;
  if (isVisionOnly) baseQuality -= 3.0;

  // Specialty alignment bonus
  if (targetSpecialty === 'architect' || targetSpecialty === 'heavy_coder') {
    // Prefer 14B–30B models that fit in VRAM
    if (paramsB >= 13 && paramsB <= 32) baseQuality += 2.5;
    else if (paramsB >= 7) baseQuality += 1.0;
  } else if (targetSpecialty === 'module_coder' || targetSpecialty === 'reviewer') {
    // On 10.8GB 1080 Ti: 14B Q4 (~9GB) or 7B/8B Q4 (~4.7-5.2GB) are both great
    if (paramsB >= 7 && paramsB <= 15) baseQuality += 2.2;
  } else if (targetSpecialty === 'scout') {
    // On 6GB 3060: 3B–8B models that run fast and fit 100% in 6GB
    if (paramsB >= 3 && paramsB <= 8.5) baseQuality += 2.5;
    if (effectiveTps >= 45) baseQuality += 1.0;
  }

  // Fit multiplier: never let a slow RAM-spilling model beat a crisp full-VRAM model
  const fitMultiplier = fitsVram ? 1.0 : sizeGB <= usableVramGB * 1.15 ? 0.35 : 0.1;

  // Throughput factor (normalized around 35 tok/s)
  const speedFactor = Math.max(0.35, Math.min(1.35, Math.sqrt(Math.max(5, effectiveTps) / 35)));

  const score = Math.round(baseQuality * fitMultiplier * speedFactor * 100) / 10;

  const fitNote = fitsVram
    ? `Fits 100% in ${usableVramGB.toFixed(1)}GB usable VRAM (${sizeGB.toFixed(1)}GB weights, ${Math.round(numCtx / 1024)}K ctx)`
    : `Spills ${sizeGB.toFixed(1)}GB weights across ${usableVramGB.toFixed(1)}GB usable VRAM (causes CPU/RAM slowdown)`;
  const speedNote = measuredTokPerSec
    ? `${measuredTokPerSec} tok/s benchmarked`
    : `~${estimatedTokPerSec} tok/s est.`;

  return {
    score,
    recommendedNumCtx: numCtx,
    fitsVram,
    estimatedTokPerSec,
    measuredTokPerSec,
    sizeGB,
    paramsB,
    reason: `${fitNote} · ${speedNote}`
  };
}

/** Suggest 1-2 top catalog models to pull if not already installed on this node. */
function computeRecommendedPulls(
  node: EndpointNode,
  usableVramGB: number,
  specialty: NodeSpecialty
): RecommendedPull[] {
  if (node.type === 'openai' || !!node.apiKey) return [];
  const hw = {
    ...node.hardware,
    reserveVramGB: Math.max(0, (node.hardware?.vramGB || 0) - usableVramGB)
  };
  const targetCtx = specialty === 'architect' || specialty === 'heavy_coder' ? 16384 : 8192;
  const task = specialty === 'reviewer' ? 'review' : specialty === 'scout' ? 'coding' : 'agent';
  const recs = recommend({ ...node, hardware: hw }, task, targetCtx, 8);

  const out: RecommendedPull[] = [];
  // Curated priority tags per hardware tier
  const priorityTags =
    usableVramGB >= 14
      ? ['qwen2.5-coder:14b', 'gpt-oss:20b', 'devstral-small-2:latest', 'qwen3:14b']
      : usableVramGB >= 9.5
        ? ['qwen2.5-coder:14b', 'qwen2.5-coder:7b', 'deepseek-r1:8b', 'qwen3:8b']
        : ['qwen2.5-coder:7b', 'qwen3:8b', 'qwen3.5:4b', 'qwen2.5-coder:3b'];

  const installedSet = new Set((node.models || []).map(m => normTag(m.name)));

  for (const tag of priorityTags) {
    if (installedSet.has(normTag(tag))) continue;
    const cat = MODEL_CATALOG.find(m => normTag(m.tag) === normTag(tag));
    if (!cat) continue;
    const fit = estimateInstalledModelFit(
      { name: cat.tag, size: cat.sizeGB * 1e9 },
      hw,
      targetCtx
    );
    if (fitSpillsToSystemRam(fit.kind)) continue;
    out.push({
      tag: cat.tag,
      sizeGB: cat.sizeGB,
      estimatedTokPerSec: fit.tokensPerSec,
      reason: cat.notes
    });
    if (out.length >= 2) break;
  }

  if (out.length < 2) {
    for (const r of recs) {
      if (r.installed || fitSpillsToSystemRam(r.fit.kind)) continue;
      if (out.some(x => normTag(x.tag) === normTag(r.model.tag))) continue;
      out.push({
        tag: r.model.tag,
        sizeGB: r.model.sizeGB,
        estimatedTokPerSec: r.fit.tokensPerSec,
        reason: r.model.notes
      });
      if (out.length >= 2) break;
    }
  }

  return out;
}

/**
 * Build a deterministic, hardware-physics-driven cluster configuration plan across all nodes.
 * Ranks local GPUs by usable VRAM and memory bandwidth, assigns complementary specialties
 * (`architect`, `module_coder`, `scout`, `strategist`), pins 1 primary model per GPU to stop
 * VRAM weight-swap thrashing, and tunes `num_ctx` + `reserveVramGB` per node.
 */
export function buildClusterAutoConfigPlan(nodes: EndpointNode[]): ClusterAutoConfigPlan {
  const localNodes = nodes.filter(n => n.type !== 'openai' && !n.apiKey);

  // Rank local nodes by compute score: usableVram * sqrt(bandwidth)
  const localRanked = [...localNodes]
    .map(n => {
      const rev = recommendReserveVram(n);
      const usable = Math.max(0, (n.hardware?.vramGB || 0) - rev.reserveVramGB);
      const bw = n.hardware?.gpuBandwidthGBs || 300;
      const computeScore = usable * Math.sqrt(bw);
      return { node: n, usable, bw, rev, computeScore };
    })
    .sort((a, b) => b.computeScore - a.computeScore);

  const rankByNodeId = new Map<string, number>();
  localRanked.forEach((item, idx) => rankByNodeId.set(item.node.id, idx));

  const nodeAdvices: NodeAutoConfigAdvice[] = nodes.map(node => {
    const isFrontier = node.type === 'openai' || !!node.apiKey;
    const gpuArch = detectGpuArchTier(node);
    const rev = recommendReserveVram(node);
    const vramGB = node.hardware?.vramGB || 0;
    const usableVramGB = isFrontier ? 80 : Math.max(0, vramGB - rev.reserveVramGB);
    const bandwidthGBs = node.hardware?.gpuBandwidthGBs || (isFrontier ? 3000 : 300);

    if (isFrontier) {
      const generative = (node.models || []).filter(m => !isEmbeddingModel(m));
      const primary =
        node.activeModel && generative.some(m => m.name === node.activeModel)
          ? node.activeModel
          : generative[0]?.name;
      return {
        nodeId: node.id,
        nodeName: node.name,
        isFrontier: true,
        gpuArch: 'cloud',
        vramGB,
        recommendedReserveVramGB: 0,
        usableVramGB: 80,
        bandwidthGBs,
        specialty: 'strategist',
        roles: ['planner', 'reviewer'],
        primaryModel: primary,
        enabledModels: generative.map(m => m.name),
        disabledModels: [],
        modelNumCtx: {},
        modelAdvice: [],
        recommendedPulls: [],
        rationale:
          'Cloud Frontier endpoint assigned as Cluster Strategist & Meta-Router (Pass-1 Swarm decomposition, cluster advisor & stuck-loop escalation).'
      };
    }

    const rank = rankByNodeId.get(node.id) ?? 0;
    let specialty: NodeSpecialty;
    let roles: NodeRole[];

    if (localRanked.length === 1) {
      specialty = 'architect';
      roles = ['planner', 'coder', 'reviewer', 'docs'];
    } else if (rank === 0) {
      // Top GPU (e.g. RTX 5070 Ti 16GB)
      specialty = 'architect';
      roles = ['planner', 'coder', 'reviewer'];
    } else if (rank === 1 && usableVramGB >= 8) {
      // Second GPU with 8GB+ (e.g. GTX 1080 Ti 10.8GB Headless Linux)
      specialty = 'module_coder';
      roles = ['coder', 'reviewer'];
    } else {
      // Compact / third GPU (e.g. Laptop RTX 3060 6GB on iGPU display)
      specialty = 'scout';
      roles = ['coder', 'docs', 'reviewer'];
    }

    const generative = (node.models || []).filter(m => !isEmbeddingModel(m));
    const scored = generative
      .map(m => {
        const s = scoreInstalledModelForNode(node, m, usableVramGB, specialty);
        return { model: m, ...s };
      })
      .sort((a, b) => b.score - a.score);

    const primary = scored[0]?.model.name;
    const modelNumCtx: Record<string, number> = {};
    const enabledModels: string[] = [];
    const disabledModels: string[] = [];

    // Pin ONLY the #1 primary generative model per local GPU to completely eliminate
    // Ollama multi-GB model unload/reload thrashing mid-workflow!
    const modelAdvice: NodeModelAdvice[] = scored.map((item, idx) => {
      const isPrimary = idx === 0;
      const keepEnabled = isPrimary;
      modelNumCtx[item.model.name] = item.recommendedNumCtx;
      if (keepEnabled) {
        enabledModels.push(item.model.name);
      } else {
        disabledModels.push(item.model.name);
      }
      return {
        name: item.model.name,
        sizeGB: item.sizeGB,
        paramsB: item.paramsB,
        recommendedNumCtx: item.recommendedNumCtx,
        fitsVramAtRecommendedCtx: item.fitsVram,
        estimatedTokPerSec: item.estimatedTokPerSec,
        measuredTokPerSec: item.measuredTokPerSec,
        score: item.score,
        keepEnabled,
        isPrimary,
        reason: isPrimary
          ? `★ Pinned in VRAM (${SPECIALTY_META[specialty].label}) · ${item.reason}`
          : !item.fitsVram
            ? `Disabled to prevent CPU/RAM spill · ${item.reason}`
            : `Disabled to prevent VRAM weight-swap thrashing with ${primary}`
      };
    });

    const recommendedPulls = computeRecommendedPulls(node, usableVramGB, specialty);
    const modeLabel =
      rev.mode === 'headless_linux'
        ? 'headless Linux (0.2 GB reserve)'
        : rev.mode === 'igpu_display'
          ? 'iGPU display offload (0.1 GB reserve)'
          : `Windows desktop (${rev.reserveVramGB.toFixed(1)} GB reserve)`;
    const archNote =
      gpuArch === 'pascal_turing'
        ? 'Pascal/Turing prefill cap applied (8K–12K ctx) for snappy prompt evaluation.'
        : gpuArch === 'ampere' && vramGB <= 6.5
          ? 'Ampere 6GB dedicated cap applied (8K ctx) for zero-spill full-VRAM speed.'
          : 'High-bandwidth Tensor Core tier (16K–32K ctx).';

    return {
      nodeId: node.id,
      nodeName: node.name,
      isFrontier: false,
      gpuArch,
      vramGB,
      recommendedReserveVramGB: rev.reserveVramGB,
      recommendedOverheadMode: rev.mode,
      usableVramGB,
      bandwidthGBs,
      specialty,
      roles,
      primaryModel: primary,
      enabledModels,
      disabledModels,
      modelNumCtx,
      modelAdvice,
      recommendedPulls,
      rationale: `${SPECIALTY_META[specialty].label} · ${usableVramGB.toFixed(1)} GB usable VRAM via ${modeLabel}. ${
        primary
          ? `Pinned ${primary} at ${Math.round((modelNumCtx[primary] || 8192) / 1024)}K ctx.`
          : 'No generative model installed yet.'
      } ${archNote}`
    };
  });

  const summaryParts = nodeAdvices.map(
    n =>
      `${n.nodeName}: ${SPECIALTY_META[n.specialty].label}${
        n.primaryModel ? ` (${n.primaryModel})` : ''
      }`
  );

  return {
    source: 'physics',
    summary: summaryParts.join(' · '),
    nodes: nodeAdvices,
    generatedAt: Date.now()
  };
}

/** Apply a `ClusterAutoConfigPlan` to the current `EndpointNode[]`, returning updated `NodeConfig[]`. */
export function applyClusterAutoConfigPlan(
  nodes: EndpointNode[],
  plan: ClusterAutoConfigPlan
): NodeConfig[] {
  const byId = new Map(plan.nodes.map(n => [n.nodeId, n]));
  return nodes.map(node => {
    const adv = byId.get(node.id);
    if (!adv) return node;
    if (adv.isFrontier) {
      return {
        ...node,
        specialty: adv.specialty,
        roles: adv.roles,
        advisorNote: adv.rationale,
        ...(adv.primaryModel ? { activeModel: adv.primaryModel } : {})
      };
    }

    const nextPrefs = { ...(node.modelPrefs || {}) };
    for (const [mName, ctx] of Object.entries(adv.modelNumCtx)) {
      nextPrefs[mName] = {
        ...(nextPrefs[mName] || {}),
        numCtx: ctx,
        // Default thinking OFF on coding workers for fast deterministic tool output
        ...(nextPrefs[mName]?.think === undefined ? { think: false } : {})
      };
    }

    return {
      ...node,
      specialty: adv.specialty,
      roles: adv.roles,
      advisorNote: adv.rationale,
      activeModel: adv.primaryModel || node.activeModel,
      disabledModels: adv.disabledModels,
      modelPrefs: nextPrefs,
      hardware: {
        ...node.hardware,
        reserveVramGB: adv.recommendedReserveVramGB,
        ...(adv.recommendedOverheadMode
          ? { vramOverheadMode: adv.recommendedOverheadMode }
          : {})
      }
    };
  });
}

/** Build the prompt for the Cloud Frontier model to audit the cluster and refine the auto-config plan. */
export function buildCloudClusterAuditPrompt(
  nodes: EndpointNode[],
  baselinePlan: ClusterAutoConfigPlan
): string {
  const inventory = nodes.map(n => {
    const adv = baselinePlan.nodes.find(a => a.nodeId === n.id);
    return {
      nodeId: n.id,
      name: n.name,
      type: n.type || 'ollama',
      online: n.online,
      isDevNode: !!n.isDevNode,
      hardware: {
        gpu: n.hardware?.gpu,
        vramGB: n.hardware?.vramGB,
        usableVramGB: adv?.usableVramGB,
        recommendedReserveVramGB: adv?.recommendedReserveVramGB,
        gpuBandwidthGBs: n.hardware?.gpuBandwidthGBs,
        gpuArch: adv?.gpuArch
      },
      installedModels: (n.models || [])
        .filter(m => !isEmbeddingModel(m))
        .map(m => ({
          name: m.name,
          sizeGB: Number((m.size / 1e9).toFixed(2)),
          params: m.details?.parameter_size || '',
          quant: m.details?.quantization_level || '',
          benchTokPerSec: n.benchmarks?.[m.name]?.evalTokPerSec ?? null
        })),
      physicsBaseline: adv
        ? {
            specialty: adv.specialty,
            roles: adv.roles,
            primaryModel: adv.primaryModel,
            modelNumCtx: adv.modelNumCtx,
            recommendedPulls: adv.recommendedPulls.map(p => p.tag)
          }
        : null
    };
  });

  return `You are the Cloud Strategist for a distributed multi-GPU coding cluster in LocalAgents Studio.
Inspect the hardware inventory, usable VRAM, memory bandwidth, and installed Ollama models below.
Your job is to assign the optimal role specialty, pinned primary model (1 model per local GPU to avoid VRAM swap thrashing), max context window (num_ctx) per model, and any recommended ollama pull tags.

Hardware Rules:
1. Pin exactly ONE primary generative model per local GPU (keepEnabledModels = [primaryModel]) so Ollama never thrashes disk/VRAM swapping weights mid-workflow.
2. Never pick a primaryModel whose sizeGB + KV cache exceeds usableVramGB if a model that fits 100% in VRAM is installed.
3. For Pascal GPUs (e.g. GTX 1080 Ti, gpuArch="pascal_turing"), cap num_ctx at 8192–12288 because Pascal lacks Tensor Cores and large prefills are slow.
4. For 6GB GPUs (e.g. Laptop RTX 3060), cap num_ctx at 8192 for 7B/8B models so weights + KV stay under 6.0 GB.
5. For 16GB Blackwell/Ada GPUs (e.g. RTX 5070 Ti), allow 16384–32768 num_ctx and assign specialty "architect".
6. Valid specialties: "architect" | "heavy_coder" | "module_coder" | "reviewer" | "scout" | "strategist".
7. Valid roles array items: "planner" | "coder" | "reviewer" | "docs".

Cluster Inventory JSON:
${JSON.stringify(inventory, null, 2)}

Respond ONLY with a valid JSON object matching this exact schema (no markdown fences):
{
  "summary": "1-2 sentence executive summary of how the cluster is orchestrated",
  "nodes": [
    {
      "nodeId": "exact nodeId from inventory",
      "specialty": "architect | heavy_coder | module_coder | reviewer | scout | strategist",
      "roles": ["planner", "coder", "reviewer"],
      "primaryModel": "exact installed model name from installedModels",
      "modelNumCtx": { "modelName": 16384 },
      "rationale": "concise hardware & model explanation for this node"
    }
  ]
}`;
}

/** Parse the Cloud Strategist JSON audit and safely merge it over the deterministic physics baseline. */
export function mergeCloudAuditIntoPlan(
  rawResponse: string,
  baseline: ClusterAutoConfigPlan,
  strategistModel: string
): ClusterAutoConfigPlan {
  try {
    let cleaned = stripThinkBlocks(rawResponse);
    const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) cleaned = fence[1].trim();
    const slice = extractJsonObject(cleaned);
    if (!slice) return baseline;
    let parsed: any;
    try {
      parsed = JSON.parse(slice);
    } catch {
      parsed = JSON.parse(sanitizeLooseJson(slice));
    }
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.nodes)) {
      return baseline;
    }

    const validSpecialties = new Set<NodeSpecialty>([
      'architect',
      'heavy_coder',
      'module_coder',
      'reviewer',
      'scout',
      'strategist'
    ]);
    const validRoles = new Set<NodeRole>(['planner', 'coder', 'reviewer', 'docs']);

    const mergedNodes = baseline.nodes.map(baseNode => {
      const cloudNode = parsed.nodes.find(
        (n: any) => n && String(n.nodeId) === baseNode.nodeId
      );
      if (!cloudNode) return baseNode;

      const specialty: NodeSpecialty = validSpecialties.has(cloudNode.specialty)
        ? cloudNode.specialty
        : baseNode.specialty;

      const roles: NodeRole[] = Array.isArray(cloudNode.roles)
        ? (cloudNode.roles.filter((r: any) => validRoles.has(r)) as NodeRole[])
        : baseNode.roles;

      const installedNames = new Set(baseNode.modelAdvice.map(m => m.name));
      const primaryModel =
        typeof cloudNode.primaryModel === 'string' &&
        installedNames.has(cloudNode.primaryModel)
          ? cloudNode.primaryModel
          : baseNode.primaryModel;

      const modelNumCtx = { ...baseNode.modelNumCtx };
      if (cloudNode.modelNumCtx && typeof cloudNode.modelNumCtx === 'object') {
        for (const [k, v] of Object.entries(cloudNode.modelNumCtx)) {
          if (installedNames.has(k) && typeof v === 'number' && v >= 2048 && v <= 131072) {
            modelNumCtx[k] = snapNumCtxToOption(v);
          }
        }
      }

      const enabledModels = baseNode.isFrontier
        ? baseNode.enabledModels
        : primaryModel
          ? [primaryModel]
          : baseNode.enabledModels;
      const disabledModels = baseNode.isFrontier
        ? []
        : baseNode.modelAdvice
            .map(m => m.name)
            .filter(name => !enabledModels.includes(name));

      const modelAdvice = baseNode.modelAdvice.map(m => ({
        ...m,
        recommendedNumCtx: modelNumCtx[m.name] || m.recommendedNumCtx,
        isPrimary: m.name === primaryModel,
        keepEnabled: enabledModels.includes(m.name)
      }));

      return {
        ...baseNode,
        specialty,
        roles: roles.length ? roles : baseNode.roles,
        primaryModel,
        enabledModels,
        disabledModels,
        modelNumCtx,
        modelAdvice,
        rationale:
          typeof cloudNode.rationale === 'string' && cloudNode.rationale.trim()
            ? cloudNode.rationale.trim()
            : baseNode.rationale
      };
    });

    return {
      source: 'cloud_strategist',
      strategistModel,
      summary:
        typeof parsed.summary === 'string' && parsed.summary.trim()
          ? parsed.summary.trim()
          : baseline.summary,
      nodes: mergedNodes,
      generatedAt: Date.now()
    };
  } catch {
    return baseline;
  }
}
