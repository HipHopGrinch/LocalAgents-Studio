import { ModelThinkingInfo, OllamaModel } from '../types';

/** Normalize /api/show thinking metadata into a stable shape. */
export function normalizeThinkingInfo(
  thinking: unknown,
  capabilities?: string[]
): ModelThinkingInfo | undefined {
  if (thinking && typeof thinking === 'object') {
    const t = thinking as { values?: unknown; default?: unknown };
    if (Array.isArray(t.values) && t.values.length > 0) {
      return {
        values: t.values as Array<boolean | string>,
        default: t.default as boolean | string | undefined
      };
    }
  }
  if (capabilities?.includes('thinking')) {
    return { values: [false, true], default: true };
  }
  return undefined;
}

/**
 * True when Ollama advertises controllable thinking.
 * `values: [false]` alone means the model does not support thinking.
 */
export function modelSupportsThinking(model?: Pick<OllamaModel, 'name' | 'capabilities' | 'thinking'>): boolean {
  if (!model) return false;
  const vals = model.thinking?.values;
  if (vals && vals.length > 0) {
    if (vals.length === 1 && vals[0] === false) return false;
    return vals.some(v => v === true || (typeof v === 'string' && v.length > 0));
  }
  if (model.capabilities?.includes('thinking')) return true;
  return false;
}

export type ThinkPersona = 'planner' | 'coder' | 'reviewer' | 'docs' | string;

/** Bench, cloud audit, image generation, and embeddings must send this — never omit `think`. */
export const THINK_FALSE_FOR_SIDE_PATHS = false;

/** Same value as {@link THINK_FALSE_FOR_SIDE_PATHS}, for call sites that want a function. */
export function thinkFalseForSidePaths(): false {
  return false;
}

const LEVEL_ORDER = ['minimal', 'low', 'medium', 'mid', 'high', 'max', 'xhigh'];

function levelRank(level: string): number {
  const i = LEVEL_ORDER.indexOf(level.toLowerCase());
  return i === -1 ? LEVEL_ORDER.indexOf('medium') : i;
}

function stringLevels(model: Pick<OllamaModel, 'thinking'> | undefined): string[] {
  const vals = model?.thinking?.values || [];
  return vals.filter(
    (v): v is string =>
      typeof v === 'string' &&
      v.length > 0 &&
      v.toLowerCase() !== 'false' &&
      v.toLowerCase() !== 'off' &&
      v.toLowerCase() !== 'none'
  );
}

function lowestLevel(levels: string[]): string {
  return [...levels].sort((a, b) => levelRank(a) - levelRank(b) || a.localeCompare(b))[0];
}

function highestLevel(levels: string[]): string {
  return [...levels].sort((a, b) => levelRank(b) - levelRank(a) || b.localeCompare(a))[0];
}

function thinkingEnabled(userPref: boolean | string | null | undefined): boolean {
  if (userPref === false || userPref === null || userPref === undefined) return false;
  if (typeof userPref === 'string') {
    const l = userPref.toLowerCase();
    if (l === 'false' || l === 'off' || l === 'none' || l === '0') return false;
  }
  return true;
}

/**
 * Effective think flag for a chat request (undefined = omit / model cannot think).
 * Default stays off when the user has no saved preference.
 * When thinking is enabled and the model advertises levels: coder/reviewer/docs get the
 * lowest level, planner gets the highest. With no persona, an enabled boolean stays at the lowest level.
 */
export function resolveThinkOption(
  model: Pick<OllamaModel, 'name' | 'thinking' | 'capabilities'> | undefined,
  userPref: boolean | string | null | undefined,
  opts?: { persona?: ThinkPersona }
): boolean | string | undefined {
  if (!modelSupportsThinking(model)) return undefined;
  if (userPref === null || userPref === undefined) return false;
  if (!thinkingEnabled(userPref)) return false;

  const levels = stringLevels(model);
  const persona = opts?.persona?.toLowerCase();
  if (levels.length && persona) {
    if (persona === 'planner') return highestLevel(levels);
    if (persona === 'coder' || persona === 'reviewer' || persona === 'docs') return lowestLevel(levels);
  }
  if (levels.length && (userPref === true || persona)) return lowestLevel(levels);
  return userPref;
}

export function thinkingToggleLabel(enabled: boolean): string {
  return enabled ? 'Thinking ON' : 'Thinking OFF';
}
