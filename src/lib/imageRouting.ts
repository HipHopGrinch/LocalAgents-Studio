import { EndpointNode } from '../types';
import { isFrontierNode } from './tools';
import { estimateInstalledModelFit, normTag, type FitKind } from './recommender';

const IMAGE_NAME =
  /flux|sdxl|stable[-_]?diffusion|kolors|qwen[-_]?image|dreamshaper|playground|auraflow|hidream|omnigen|kandinsky|z-image|image[-_]?gen|sd3|juggernaut/i;

export function modelLooksLikeImageGen(name: string, capabilities?: string[]): boolean {
  const caps = (capabilities || []).map(c => c.toLowerCase());
  if (caps.some(c => c.includes('image') && (c.includes('gen') || c.includes('diffusion') || c === 'image'))) {
    return true;
  }
  return IMAGE_NAME.test(name);
}

export interface ImageTarget {
  node: EndpointNode;
  model: string;
}

/** Coder to load again after image generation evicts it. The caller performs the warmup. */
export interface CoderRewarm {
  nodeId: string;
  nodeName: string;
  model: string;
  numCtx?: number;
}

function imageFitKind(node: EndpointNode, modelName: string): FitKind | 'frontier' {
  if (isFrontierNode(node)) return 'frontier';
  const model = (node.models || []).find(m => m.name === modelName);
  if (!model || !node.hardware) return 'none';
  // Image prompts are short; a 2K window is enough to decide whether the weights fit.
  return estimateInstalledModelFit(model, node.hardware, 2048).kind;
}

function vramOf(node: EndpointNode): number {
  return node.hardware?.vramGB || 0;
}

function isScoutLike(node: EndpointNode): boolean {
  if (node.specialty === 'scout') return true;
  const v = vramOf(node);
  return v > 0 && v <= 8;
}

function primaryIsThisImage(node: EndpointNode, model: string): boolean {
  const active = node.activeModel;
  if (!active) return false;
  return normTag(active) === normTag(model);
}

/**
 * Online local node with an image-generation model. Frontier only if nothing local qualifies.
 * Prefer a node whose pinned model is already the image model (no coder to evict).
 * Otherwise the smallest-VRAM scout-like node that can hold the weights — not the architect GPU.
 */
export function pickImageTarget(nodes: EndpointNode[]): ImageTarget | null {
  const forced: ImageTarget[] = [];
  const hits: ImageTarget[] = [];
  for (const node of nodes) {
    if (!node.online) continue;
    const models = node.models || [];
    const disabled = new Set(node.disabledModels || []);
    if (node.imageModel && !disabled.has(node.imageModel) && models.some(m => m.name === node.imageModel)) {
      forced.push({ node, model: node.imageModel });
    }
    for (const model of models) {
      if (disabled.has(model.name)) continue;
      const caps = model.capabilities || node.modelMeta?.[model.name]?.capabilities;
      if (modelLooksLikeImageGen(model.name, caps)) {
        hits.push({ node, model: model.name });
      }
    }
  }
  const poolSource = forced.length ? forced : hits;
  if (!poolSource.length) return null;
  const local = poolSource.filter(h => !isFrontierNode(h.node));
  const pool = local.length ? local : poolSource;
  const runnable = pool.filter(h => {
    const kind = imageFitKind(h.node, h.model);
    return kind === 'gpu' || kind === 'frontier';
  });
  const ranked = runnable.length ? runnable : pool;
  ranked.sort((a, b) => {
    const pa = primaryIsThisImage(a.node, a.model) ? 0 : 1;
    const pb = primaryIsThisImage(b.node, b.model) ? 0 : 1;
    if (pa !== pb) return pa - pb;
    const sa = isScoutLike(a.node) ? 0 : 1;
    const sb = isScoutLike(b.node) ? 0 : 1;
    if (sa !== sb) return sa - sb;
    const va = vramOf(a.node) || 999;
    const vb = vramOf(b.node) || 999;
    if (va !== vb) return va - vb;
    return 0;
  });
  return ranked[0] || null;
}

/**
 * Generative model to re-warm on the image target's node after generation.
 * Null when that node's primary model is already the image model.
 */
export function coderModelToRewarm(target: ImageTarget): CoderRewarm | null {
  const node = target.node;
  const active = node.activeModel;
  if (!active) return null;
  if (normTag(active) === normTag(target.model)) return null;
  if (modelLooksLikeImageGen(active)) return null;
  const disabled = new Set(node.disabledModels || []);
  if (disabled.has(active)) return null;
  return {
    nodeId: node.id,
    nodeName: node.name,
    model: active,
    numCtx: node.modelPrefs?.[active]?.numCtx
  };
}

export function placeholderSvg(prompt: string): string {
  const safe = prompt.replace(/[<>&]/g, ' ').slice(0, 180);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">
  <rect width="800" height="600" fill="#1e1e24"/>
  <rect x="24" y="24" width="752" height="552" fill="none" stroke="#6366f1" stroke-width="2"/>
  <text x="400" y="280" fill="#e4e4e7" font-family="Segoe UI, sans-serif" font-size="22" text-anchor="middle">Placeholder image</text>
  <text x="400" y="320" fill="#a1a1aa" font-family="Segoe UI, sans-serif" font-size="14" text-anchor="middle">${safe}</text>
</svg>
`;
}
