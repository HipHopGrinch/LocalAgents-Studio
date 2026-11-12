import { EndpointNode, OllamaModel } from '../types';
import { MODEL_CATALOG } from '../config/modelCatalog';

const MAX_EDGE = 1920;
const JPEG_QUALITY = 0.88;

export type ImageTier = 'tight' | 'standard' | 'wide';

/** Conservative floor. A screenshot must count in the context fill check. */
export const MIN_IMAGE_TOKENS = 1500;

export interface ImageCompressOptions {
  tier?: ImageTier;
  /** Overrides the tier edge. Ignored when below 64. */
  maxEdge?: number;
}

/** Tight 1024px and 1 image; standard 1280; wide 1920 (previous default) and up to 6. */
export function imageLimitsForTier(tier: ImageTier = 'standard'): { maxEdge: number; maxImages: number } {
  if (tier === 'tight') return { maxEdge: 1024, maxImages: 1 };
  if (tier === 'wide') return { maxEdge: 1920, maxImages: 6 };
  return { maxEdge: 1280, maxImages: 4 };
}

export function resolveImageMaxEdge(opts?: ImageCompressOptions): number {
  if (typeof opts?.maxEdge === 'number' && opts.maxEdge >= 64) return Math.floor(opts.maxEdge);
  if (opts?.tier) return imageLimitsForTier(opts.tier).maxEdge;
  return MAX_EDGE;
}

/** Keep the first N images for the tier (tight keeps one). */
export function selectImagesForTier<T>(images: T[], tier: ImageTier = 'standard'): T[] {
  const { maxImages } = imageLimitsForTier(tier);
  return (images || []).slice(0, maxImages);
}

/**
 * Vision-token estimate from pixel size. Unknown dimensions use the floor
 * ({@link MIN_IMAGE_TOKENS}) so images are dropped before text when the window is tight.
 * Sized images scale up from that floor (~1 token per 512 pixels).
 */
export function estimateImageTokens(
  image?: { width?: number; height?: number } | string | null
): number {
  let width = 0;
  let height = 0;
  if (image && typeof image === 'object') {
    width = Number(image.width) || 0;
    height = Number(image.height) || 0;
  }
  if (width >= 8 && height >= 8) {
    const est = Math.ceil((width * height) / 512);
    return Math.max(MIN_IMAGE_TOKENS, Math.min(est, 8192));
  }
  return MIN_IMAGE_TOKENS;
}

/** Strip `data:image/...;base64,` so Ollama gets raw base64. */
export function toOllamaBase64(dataUrlOrBase64: string): string {
  const i = dataUrlOrBase64.indexOf('base64,');
  return i >= 0 ? dataUrlOrBase64.slice(i + 7) : dataUrlOrBase64;
}

export function isDataUrl(s: string): boolean {
  return /^data:image\//i.test(s);
}

/** Downscale large screenshots so vision models stay responsive. */
export async function compressImageBlob(
  blob: Blob,
  opts?: ImageCompressOptions
): Promise<{ dataUrl: string; mime: string }> {
  const bitmap = await createImageBitmap(blob);
  try {
    let { width, height } = bitmap;
    const maxEdge = resolveImageMaxEdge(opts);
    const scale = Math.min(1, maxEdge / Math.max(width, height));
    width = Math.max(1, Math.round(width * scale));
    height = Math.max(1, Math.round(height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas unavailable');
    ctx.drawImage(bitmap, 0, 0, width, height);

    const mime = blob.type === 'image/png' && scale === 1 ? 'image/png' : 'image/jpeg';
    const dataUrl = canvas.toDataURL(mime, mime === 'image/jpeg' ? JPEG_QUALITY : undefined);
    return { dataUrl, mime };
  } finally {
    bitmap.close();
  }
}

export async function fileToChatImage(file: Blob, opts?: ImageCompressOptions): Promise<string> {
  const { dataUrl } = await compressImageBlob(file, opts);
  return dataUrl;
}

export function modelSupportsVision(
  modelName: string,
  node?: EndpointNode,
  live?: Pick<OllamaModel, 'name' | 'capabilities'>
): boolean {
  const caps = live?.capabilities || node?.modelMeta?.[modelName]?.capabilities || [];
  if (caps.includes('vision')) return true;

  const catalog = MODEL_CATALOG.find(m => {
    const a = m.tag.toLowerCase();
    const b = modelName.toLowerCase();
    return a === b || b.startsWith(a.split(':')[0] + ':') || a.startsWith(b.split(':')[0] + ':');
  });
  if (catalog?.caps.includes('vision')) return true;

  const n = modelName.toLowerCase();
  return /gemma4|gemma3|llava|moondream|minicpm-v|qwen2\.5-vl|qwen3-vl|llama3\.2-vision|vision/.test(n);
}
