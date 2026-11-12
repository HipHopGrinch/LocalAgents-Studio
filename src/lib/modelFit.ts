import type { EndpointNode } from '../types';
import type { TaskId } from '../config/modelCatalog';
import {
  estimateInstalledModelFit,
  findCatalogModel,
  normTag,
  parseParams,
  type FitKind
} from './recommender';
import { resolveModelNumCtx } from './contextSize';

/** Routing bucket used by conductor model choice. Distinct from Model Hub TaskId. */
export type RoutingTask = 'heavy' | 'light' | 'review' | 'plan';

/** VRAM fit of an installed model on its node at the pinned (or given) num_ctx. Frontier nodes always fit. */
export function modelFitAtCtx(node: EndpointNode, modelName: string, numCtx?: number): FitKind {
  if (node.type === 'openai') return 'gpu';
  const model = node.models?.find(m => normTag(m.name) === normTag(modelName));
  if (!model) return 'none';
  const ctx = numCtx ?? resolveModelNumCtx(node, modelName);
  return estimateInstalledModelFit(model, node.hardware, ctx).kind;
}

export function isFullGpuFit(node: EndpointNode, modelName: string, numCtx?: number): boolean {
  return modelFitAtCtx(node, modelName, numCtx) === 'gpu';
}

/** Measured generation tok/s, or undefined when only a provisional/seeded estimate exists. */
export function measuredEvalTokPerSec(node: EndpointNode, modelName: string): number | undefined {
  const b = node.benchmarks?.[modelName];
  if (!b || b.provisional || b.error || !(b.evalTokPerSec > 0)) return undefined;
  return b.evalTokPerSec;
}

/** Measured prompt-eval tok/s (prefill), or undefined when not measured. */
export function measuredPromptTokPerSec(node: EndpointNode, modelName: string): number | undefined {
  const b = node.benchmarks?.[modelName];
  if (!b || b.provisional || b.error || !(b.promptTokPerSec > 0)) return undefined;
  return b.promptTokPerSec;
}

/** True when the model is currently resident on the node per the last /api/ps poll. */
export function isModelLoaded(node: EndpointNode, modelName: string): boolean {
  return !!node.loaded?.some(l => normTag(l.name) === normTag(modelName));
}

/**
 * Parameter count that should drive ranking.
 * MoE rows use `activeB` (qwen3-coder 30B → 3.3), not the headline size, when
 * `parameter_size` is in the same size class as the catalog row.
 */
/** Active-parameter count for quality scoring. MoE uses catalog `activeB` when `parameter_size` is the same size class. */
export function catalogActiveParamsB(modelName: string, parameterSize?: string): number {
  const row = findCatalogModel(modelName);
  const details = parseParams(parameterSize);
  if (row?.activeB && row.activeB > 0) {
    if (details == null) return row.activeB;
    const nearTotal = Math.abs(details - row.paramsB) / Math.max(row.paramsB, 0.5) <= 0.3;
    const nearActive = Math.abs(details - row.activeB) / Math.max(row.activeB, 0.5) <= 0.3;
    if (nearTotal || nearActive) return row.activeB;
  }
  if (details != null && details > 0) return details;
  if (row) return row.activeB ?? row.paramsB;
  return parseParams(modelName) ?? 0;
}

function rawQuality(modelName: string, task: RoutingTask): { quality: number; active: number } {
  const row = findCatalogModel(modelName);
  const active = row ? (row.activeB ?? row.paramsB) : (parseParams(modelName) ?? 0);
  if (!row) {
    return { quality: heuristicQuality(active, task), active };
  }
  const q = row.quality;
  if (task === 'heavy') return { quality: q.agent ?? q.coding ?? 5, active };
  if (task === 'review') return { quality: q.review ?? q.coding ?? 5, active };
  if (task === 'plan') return { quality: q.reasoning ?? q.agent ?? 5, active };
  // Light work: chat / autocomplete. A coding score on a large model is not "fast utility".
  if (q.chat != null) return { quality: q.chat, active };
  if (q.autocomplete != null) return { quality: q.autocomplete, active };
  return { quality: Math.min(q.coding ?? q.agent ?? 5, 6), active };
}

function heuristicQuality(active: number, task: RoutingTask): number {
  if (!(active > 0)) return 4;
  if (task === 'light') {
    if (active <= 4) return 6.5;
    if (active <= 9) return 7;
    if (active <= 16) return 5.5;
    return 4.5;
  }
  if (task === 'review') {
    if (active >= 13) return 7;
    if (active >= 7) return 6.5;
    return 5;
  }
  if (active >= 24) return 8.5;
  if (active >= 13) return 7.5;
  if (active >= 7) return 6.5;
  return 5;
}

function activeSizeFactor(active: number, task: RoutingTask): number {
  if (task === 'light') {
    if (active > 0 && active <= 8) return 1.05;
    if (active > 14) return 0.85;
    return 1;
  }
  if (task === 'heavy' || task === 'plan') {
    // Bonus follows active params. A 3B-active MoE does not get a dense-30B bump.
    if (active >= 13) return 1.08;
    if (active >= 7) return 1;
    if (active > 0) return 0.95;
  }
  return 1;
}

/**
 * 0–10 suitability for conductor routing.
 * Catalog quality is the base. MoE size adjustments use `activeB`, not total parameters.
 */
export function qualityScoreForTask(modelName: string, task: RoutingTask): number {
  const { quality, active } = rawQuality(modelName, task);
  const scored = quality * activeSizeFactor(active, task);
  return Math.round(Math.max(0, Math.min(10, scored)) * 10) / 10;
}

/** Map a routing bucket onto the Model Hub task id used for catalog quality. */
export function routingTaskToCatalogTask(task: RoutingTask): TaskId {
  if (task === 'heavy') return 'agent';
  if (task === 'review') return 'review';
  if (task === 'plan') return 'reasoning';
  return 'chat';
}
