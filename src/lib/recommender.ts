import { HardwareProfile, EndpointNode, OllamaModel } from '../types';
import { CatalogModel, MODEL_CATALOG, TASKS, TaskId, QuantVariant } from '../config/modelCatalog';
import { resolveModelMaxContext } from './contextSize';

export type FitKind = 'gpu' | 'partial' | 'cpu' | 'none';

export interface FitEstimate {
  kind: FitKind;
  totalGB: number; // weights + KV cache + runtime overhead
  weightsGB: number;
  kvGB: number;
  gpuFraction: number; // share of the model resident in VRAM
  tokensPerSec: number; // rough generation-speed estimate
}

export interface QuantRecommendation {
  tag: string;
  quant: string;
  sizeGB: number;
  /** spill = default weights don't fit; headroom = default leaves >3 GB usable VRAM empty. */
  reason: 'spill' | 'headroom';
  fit: FitEstimate;
  defaultTag: string;
}

export interface Recommendation {
  model: CatalogModel;
  nodeId: string;
  task: TaskId;
  fit: FitEstimate;
  score: number;
  installed: boolean;
  /** Set when another verified quant tag fits this node better than `model.tag`. */
  quantSuggestion?: QuantRecommendation;
}

/** Known OLLAMA_KV_CACHE_TYPE scales. Anything else stays at full f16. */
const KV_MULT = { f16: 1, q8_0: 0.53, q4_0: 0.28 } as const;

const QUANT_LADDER = ['q3_k_m', 'q4_k_m', 'q5_k_m', 'q8_0'] as const;

/**
 * Shared with Smart Auto-Configure. A partial offload (0.35) or CPU/RAM model (0.1)
 * must not outrank a model that sits fully in VRAM on quality alone.
 */
export const FIT_FACTOR: Record<FitKind, number> = { gpu: 1, partial: 0.35, cpu: 0.1, none: 0 };

/**
 * f16 KV KB/token. Catalog `kvKB` wins.
 * Otherwise assume a GQA decoder (8 KV heads, head dim 128; MoE uses 4 KV heads).
 * 14B dense is 48 layers → 192 KB/token (the 150–200 KB band). Do not use a curve that
 * returns ~64 KB at 14B — that recommends a context the card cannot hold.
 */
export function estimateKvKBPerToken(m: {
  kvKB?: number;
  paramsB: number;
  activeB?: number;
}): number {
  if (m.kvKB !== undefined) return m.kvKB;
  const params = Math.max(0.1, m.paramsB || 0);
  const active = m.activeB && m.activeB > 0 ? m.activeB : params;
  const moe = active < params * 0.5;
  const kvHeads = moe ? 4 : 8;
  const headDim = 128;
  let layers: number;
  if (moe) {
    layers = Math.round(32 + 6 * Math.log2(Math.max(params / 4, 1.5)));
  } else if (params < 4) layers = params < 2 ? 24 : 28;
  else if (params < 8) layers = params < 6 ? 28 : 32;
  else if (params < 12) layers = 40;
  else if (params < 20) layers = 48;
  else layers = 64;
  return (layers * kvHeads * headDim) / 256;
}

/** 1 unless the node explicitly reports q8_0 / q4_0 / f16. Never assume a quantized KV cache. */
export function kvCacheScale(kvCacheType: string | undefined | null): number {
  if (kvCacheType === 'q8_0') return KV_MULT.q8_0;
  if (kvCacheType === 'q4_0') return KV_MULT.q4_0;
  if (kvCacheType === 'f16') return KV_MULT.f16;
  return 1;
}

/**
 * Estimate whether/how a model runs on a node.
 *
 * Token generation is memory-bandwidth bound: every generated token streams the active weights once.
 *   time/token ~ activeGB_on_gpu / gpuBW + activeGB_in_ram / ramBW
 * The efficiency factor accounts for real-world overhead (kernels, sampling, KV reads).
 */
export function estimateFit(
  m: Pick<CatalogModel, 'sizeGB' | 'paramsB' | 'activeB' | 'kvKB' | 'contextMax'>,
  hw: HardwareProfile,
  ctx: number
): FitEstimate {
  const effectiveCtx = Math.min(ctx, m.contextMax || ctx);
  const weightsGB = m.sizeGB;
  const kvGB =
    (estimateKvKBPerToken(m) * effectiveCtx * kvCacheScale(hw.kvCacheType)) / (1024 * 1024);
  const overheadGB = 0.4 + weightsGB * 0.03;
  const totalGB = weightsGB + kvGB + overheadGB;

  const hasGpu = !!hw.gpu && hw.vramGB > 0;
  const usableVram = hasGpu ? Math.max(0, hw.vramGB - hw.reserveVramGB) : 0;
  const usableRam = Math.max(0, hw.ramGB * 0.75 - 4); // leave room for the OS and apps

  let kind: FitKind;
  let gpuFraction = 0;
  if (hasGpu && totalGB <= usableVram) {
    kind = 'gpu';
    gpuFraction = 1;
  } else if (hasGpu && totalGB <= usableVram + usableRam) {
    kind = 'partial';
    gpuFraction = Math.max(0, Math.min(1, usableVram / totalGB));
  } else if (totalGB <= usableRam + usableVram) {
    kind = 'cpu';
  } else {
    kind = 'none';
  }

  const activeGB = weightsGB * ((m.activeB ?? m.paramsB) / m.paramsB);
  let tokensPerSec = 0;
  if (kind !== 'none') {
    const gpuBW = hw.gpuBandwidthGBs || 1;
    const ramBW = hw.ramBandwidthGBs || 40;
    const seconds = (activeGB * gpuFraction) / gpuBW + (activeGB * (1 - gpuFraction)) / ramBW;
    const efficiency = kind === 'gpu' ? 0.65 : kind === 'partial' ? 0.45 : 0.55;
    tokensPerSec = seconds > 0 ? efficiency / seconds : 0;
  }

  return { kind, totalGB, weightsGB, kvGB, gpuFraction, tokensPerSec: Math.round(tokensPerSec) };
}

export function scoreFor(model: CatalogModel, task: TaskId, fit: FitEstimate, ctx: number): number {
  const quality = model.quality[task];
  if (!quality || fit.kind === 'none') return 0;
  const minTps = TASKS.find(t => t.id === task)?.minTps ?? 0;
  const speedFactor = minTps > 0 ? Math.min(1, Math.sqrt(fit.tokensPerSec / minTps)) : 1;
  const ctxFactor = model.contextMax >= ctx ? 1 : 0.85;
  return quality * FIT_FACTOR[fit.kind] * speedFactor * ctxFactor;
}

/** Normalize tags so "foo" matches "foo:latest" */
export const normTag = (t: string) => (t.includes(':') ? t : `${t}:latest`).toLowerCase();

export function isInstalled(node: EndpointNode, tag: string): boolean {
  const want = normTag(tag);
  return node.models.some(m => normTag(m.name) === want);
}

/** Ranked recommendations for one node and task. */
export function recommend(node: EndpointNode, task: TaskId, ctx: number, limit = 5): Recommendation[] {
  return MODEL_CATALOG.filter(m => m.quality[task])
    .map(model => {
      const taskCtx = task === 'embedding' ? Math.min(ctx, model.contextMax) : ctx;
      const fit = estimateFit(model, node.hardware, taskCtx);
      const quantSuggestion = recommendQuantVariant(node, model, taskCtx) ?? undefined;
      return {
        model,
        nodeId: node.id,
        task,
        fit,
        score: scoreFor(model, task, fit, ctx),
        installed: isInstalled(node, model.tag),
        ...(quantSuggestion ? { quantSuggestion } : {})
      };
    })
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** Parse "14b" / "7.6B" / "e4b" style parameter hints from a tag or Ollama details. */
export function parseParams(text: string | undefined): number | undefined {
  if (!text) return undefined;
  const m = text.toLowerCase().match(/(\d+(?:\.\d+)?)\s*([bm])\b/);
  if (!m) return undefined;
  return m[2] === 'm' ? parseFloat(m[1]) / 1000 : parseFloat(m[1]);
}

/** Pull a quant token such as q5_k_m / q8_0 / fp16 out of an Ollama tag or quantization_level. */
export function parseQuantSuffix(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const m = text.toLowerCase().match(/q[2-8]_(?:k_[a-z0-9]+|[01skm]+)|q[2-8]_k|iq\d+_[a-z0-9]+|fp16|bf16|mxfp4/);
  return m ? m[0] : undefined;
}

/** Repo name without a glued size token (`qwen2.5-coder-14b` → `qwen2.5-coder`). */
export function modelFamilyBase(modelName: string): string {
  const base = modelName.toLowerCase().trim().split(':')[0] || '';
  return base.replace(/[-_.]e?\d+(?:\.\d+)?b$/i, '');
}

function paramsDistance(row: CatalogModel, queryParams: number): number {
  const points = [row.paramsB];
  if (typeof row.activeB === 'number' && row.activeB > 0) points.push(row.activeB);
  const tagged = parseParams(row.tag);
  if (typeof tagged === 'number') points.push(tagged);
  return Math.min(...points.map(p => Math.abs(p - queryParams)));
}

/**
 * Parameters the model actually runs.
 * Ollama `details.parameter_size` wins, then catalog active params (`e4b` → 4), then the tag.
 */
export function installedModelSizeB(modelName: string, parameterSize?: string): number {
  const fromDetails = parseParams(parameterSize);
  if (typeof fromDetails === 'number' && fromDetails > 0) return fromDetails;
  const row = MODEL_CATALOG.find(m => normTag(m.tag) === normTag(modelName));
  if (row) {
    if (typeof row.activeB === 'number' && row.activeB > 0) return row.activeB;
    if (typeof row.paramsB === 'number' && row.paramsB > 0) return row.paramsB;
  }
  return parseParams(modelName) ?? 0;
}

export function formatGB(gb: number): string {
  return gb >= 10 ? `${gb.toFixed(0)} GB` : `${gb.toFixed(1)} GB`;
}

export const FIT_LABEL: Record<FitKind, string> = {
  gpu: 'Full GPU',
  partial: 'GPU + RAM',
  cpu: 'CPU only',
  none: "Won't fit"
};

/**
 * Match an installed Ollama tag to a catalog row.
 * Exact tag, then same family + nearest parameter count (quant suffixes ignored).
 * A bare `:latest` on a multi-size family returns undefined — never the first or largest row.
 */
export function findCatalogModel(modelName: string): CatalogModel | undefined {
  if (!modelName) return undefined;
  const want = normTag(modelName);
  const exact = MODEL_CATALOG.find(m => normTag(m.tag) === want);
  if (exact) return exact;

  const base = modelFamilyBase(modelName);
  if (!base) return undefined;
  const family = MODEL_CATALOG.filter(m => modelFamilyBase(m.tag) === base);
  if (!family.length) return undefined;

  const queryParams = parseParams(modelName);
  if (queryParams == null) {
    return family.length === 1 ? family[0] : undefined;
  }

  let best: CatalogModel | undefined;
  let bestDist = Infinity;
  for (const row of family) {
    const dist = paramsDistance(row, queryParams);
    const tiedSmaller =
      best != null && Math.abs(dist - bestDist) <= 0.05 && row.paramsB < best.paramsB;
    if (dist < bestDist - 0.05 || tiedSmaller) {
      best = row;
      bestDist = dist;
    }
  }
  if (!best) return undefined;
  if (bestDist > 8 && bestDist / Math.max(queryParams, 0.5) > 0.6) return undefined;
  return best;
}

/**
 * VRAM estimate for an installed Ollama model at a chosen num_ctx.
 * On-disk size and `details.parameter_size` win over the catalog when the tag is not an exact row.
 * KV comes from the catalog only when that row is the same size class; otherwise the conservative heuristic.
 */
export function estimateInstalledModelFit(
  model: Pick<OllamaModel, 'name' | 'size' | 'details'>,
  hw: HardwareProfile,
  ctx: number
): FitEstimate {
  const exact = MODEL_CATALOG.find(m => normTag(m.tag) === normTag(model.name));
  const detailsParams = parseParams(model.details?.parameter_size);
  // Tag quant suffixes resolve through findCatalogModel. A bare :latest uses parameter_size
  // so we still pick the 7B row instead of the family's largest.
  const nearest =
    exact ??
    findCatalogModel(model.name) ??
    (detailsParams != null
      ? findCatalogModel(`${modelFamilyBase(model.name)}:${detailsParams}b`)
      : undefined);
  const nameParams = parseParams(model.name);
  // Exact catalog tags keep that row's parameter count (architecture). A quant tag or :latest
  // trusts Ollama's parameter_size, then the tag, then the nearest row.
  const paramsB = exact
    ? exact.paramsB
    : (detailsParams ?? nameParams ?? nearest?.paramsB ?? 7);

  const arch = exact ?? nearest;
  const archClose =
    !!arch && Math.abs(arch.paramsB - paramsB) / Math.max(paramsB, 0.5) <= 0.3;
  const diskGB = model.size > 0 ? model.size / 1e9 : undefined;
  const sizeGB =
    diskGB ??
    (exact ? exact.sizeGB : archClose ? arch?.sizeGB : undefined) ??
    Math.max(0.4, paramsB * 0.62);

  const useArch = !!exact || archClose;
  const activeB = useArch ? arch?.activeB : undefined;
  const kvKB = useArch ? arch?.kvKB : undefined;
  const contextMax =
    resolveModelMaxContext(model.name, model) ??
    arch?.contextMax ??
    Math.max(ctx, 8192);

  return estimateFit(
    {
      sizeGB,
      paramsB,
      contextMax,
      ...(activeB != null ? { activeB } : {}),
      ...(kvKB != null ? { kvKB } : {})
    },
    hw,
    ctx
  );
}

/** True when the estimate does not fit fully in usable GPU VRAM. */
export function fitSpillsToSystemRam(kind: FitKind): boolean {
  return kind === 'partial' || kind === 'cpu' || kind === 'none';
}

export function quantLadderRank(quant: string | undefined): number {
  if (!quant) return -1;
  const n = quant.toLowerCase();
  return QUANT_LADDER.indexOf(n as (typeof QUANT_LADDER)[number]);
}

function defaultQuant(row: CatalogModel): string {
  const fromTag = parseQuantSuffix(row.tag);
  if (fromTag && quantLadderRank(fromTag) >= 0) return fromTag;
  const variants = (row.quantVariants || []).filter(v => v.confident !== false);
  let best = 'q4_k_m';
  let dist = Infinity;
  for (const v of variants) {
    const d = Math.abs(v.sizeGB - row.sizeGB);
    if (d < dist) {
      dist = d;
      best = v.quant.toLowerCase();
    }
  }
  return best;
}

function confidentVariants(row: CatalogModel): QuantVariant[] {
  return (row.quantVariants || []).filter(v => v.confident !== false && quantLadderRank(v.quant) >= 0);
}

/**
 * When the catalog default would spill, or would leave more than 3 GB of usable VRAM empty,
 * return a verified heavier or lighter quant tag. Uncertain variants (`confident: false`) are skipped.
 * Null means keep `catalogRow.tag`.
 */
export function recommendQuantVariant(
  node: { hardware?: HardwareProfile | null },
  catalogRow: CatalogModel,
  ctx: number
): QuantRecommendation | null {
  const hw = node.hardware;
  if (!hw || !(hw.vramGB > 0)) return null;
  const variants = confidentVariants(catalogRow);
  if (!variants.length) return null;

  const usable = Math.max(0, hw.vramGB - (hw.reserveVramGB || 0));
  const defaultFit = estimateFit(catalogRow, hw, ctx);
  const spills = defaultFit.kind !== 'gpu';
  const unused = usable - defaultFit.totalGB;
  const headroom = defaultFit.kind === 'gpu' && unused > 3;
  if (!spills && !headroom) return null;

  const fitted = variants
    .map(v => ({
      v,
      fit: estimateFit({ ...catalogRow, sizeGB: v.sizeGB }, hw, ctx)
    }))
    .filter(x => x.fit.kind === 'gpu' && normTag(x.v.tag) !== normTag(catalogRow.tag));
  if (!fitted.length) return null;

  if (spills) {
    fitted.sort((a, b) => quantLadderRank(b.v.quant) - quantLadderRank(a.v.quant));
    const best = fitted[0];
    return {
      tag: best.v.tag,
      quant: best.v.quant,
      sizeGB: best.v.sizeGB,
      reason: 'spill',
      fit: best.fit,
      defaultTag: catalogRow.tag
    };
  }

  const baseRank = quantLadderRank(defaultQuant(catalogRow));
  const heavier = fitted.filter(
    x => quantLadderRank(x.v.quant) > baseRank && x.v.sizeGB > catalogRow.sizeGB + 0.15
  );
  if (!heavier.length) return null;
  heavier.sort((a, b) => quantLadderRank(b.v.quant) - quantLadderRank(a.v.quant));
  const best = heavier[0];
  return {
    tag: best.v.tag,
    quant: best.v.quant,
    sizeGB: best.v.sizeGB,
    reason: 'headroom',
    fit: best.fit,
    defaultTag: catalogRow.tag
  };
}
