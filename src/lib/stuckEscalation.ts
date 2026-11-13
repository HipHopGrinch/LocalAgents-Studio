import { normTag } from './recommender';

/** none → biggest local model, then free tier, then a confirmed paid call (or user ask). */
export type StuckStage = 'none' | 'big' | 'free' | 'paid';

const NOISE =
  /\b(read|verify|examine|check|look(?:\s+at)?|inspect|review|analyze|understand|investigate|the|a|an|to|for|and|of|in|on|with|please|ensure|correctly|handles?|functionality|logic|implementation|current|specific|issues?|keep|fixing|going)\b/gi;

/** Strip repeated "Keep fixing." / "Keep going." prefixes from work-log / stuck text. */
export function stripKeepFixingPrefix(text: string): string {
  let t = (text || '').replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 16; i++) {
    const next = t.replace(/^(keep\s+fixing\.?\s*|keep\s+going\.?\s*)+/i, '').trim();
    if (next === t) break;
    t = next;
  }
  return t;
}

/**
 * Collapse verify/read wording so "Read app.js for hard drop" and
 * "Verify the hard drop logic in src/app.js" share one stuck key.
 */
export function stuckKey(task: string): string {
  const cleaned = stripKeepFixingPrefix(task);
  const files = [...cleaned.matchAll(/[A-Za-z0-9_.-]+\.(?:py|ts|tsx|js|jsx|json|md|html|css|go|rs|cpp|h|hpp|c|cs)/gi)].map(
    m => m[0].toLowerCase()
  );
  const body = cleaned
    .toLowerCase()
    .replace(NOISE, ' ')
    .replace(/[^a-z0-9.\s_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const uniqFiles = [...new Set(files)].sort().join(' ');
  const key = [uniqFiles, body].filter(Boolean).join(' ').trim();
  return (key || cleaned.toLowerCase().replace(/\s+/g, ' ').trim()).slice(0, 180);
}

export function nextStuckStage(stage: StuckStage): 'big' | 'free' | 'paid' {
  if (stage === 'none') return 'big';
  if (stage === 'big') return 'free';
  return 'paid';
}

/** When the stuck key changes, restart the ladder from none. */
export function resolveStuckStage(
  prev: { key: string; stage: StuckStage },
  key: string
): StuckStage {
  if (!key) return 'none';
  if (prev.key && prev.key !== key) return 'none';
  return prev.stage;
}

export function isRepeatStop(note?: string): boolean {
  if (!note) return false;
  return note.startsWith('Stopped repeating') || note.startsWith('Not asking that again');
}

function taskFiles(task: string): string[] {
  // Longer extensions first, and a boundary so ".json" is not read as ".js".
  const fileRe = /[A-Za-z0-9_.-]+\.(?:tsx|jsx|json|html|cpp|hpp|py|ts|js|md|css|go|rs|cs|c|h)\b/gi;
  return [...new Set([...(task || '').matchAll(fileRe)].map(match => match[0].toLowerCase()))];
}

/** Different files, or different wording when neither step names a file. */
export function tasksAreDifferentWork(previousTask: string, nextTask: string): boolean {
  const prev = stripKeepFixingPrefix(previousTask || '').trim();
  const next = stripKeepFixingPrefix(nextTask || '').trim();
  if (!prev || !next) return false;
  if (stuckKey(prev) === stuckKey(next)) return false;
  const prevFiles = taskFiles(prev);
  const nextFiles = taskFiles(next);
  if (prevFiles.length && nextFiles.length) {
    const sameSet =
      prevFiles.length === nextFiles.length && prevFiles.every(file => nextFiles.includes(file));
    return !sameSet;
  }
  return true;
}

function normWritePath(path: string): string {
  return (path || '').replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
}

function pathSet(paths: string[]): string[] {
  return [...new Set(paths.map(normWritePath).filter(Boolean))].sort();
}

function samePathSet(a: string[], b: string[]): boolean {
  const left = pathSet(a);
  const right = pathSet(b);
  return left.length === right.length && left.every((path, index) => path === right[index]);
}

/**
 * A repeated next-step is not stuck when the task changed or this step wrote a different set of files.
 * The same unnamed task that rewrites the same paths is still stuck.
 */
export function shouldEscalateStuck(opts: {
  previousTask?: string;
  nextTask?: string;
  recentWritePaths?: string[];
  /** Files written by the step before `recentWritePaths`. */
  priorWritePaths?: string[];
}): boolean {
  const previousTask = opts.previousTask || '';
  const nextTask = opts.nextTask || '';
  if (tasksAreDifferentWork(previousTask, nextTask)) return false;
  const writes = pathSet(opts.recentWritePaths || []);
  if (!writes.length) return true;
  const named = new Set(taskFiles(previousTask));
  if (!named.size) {
    const prior = pathSet(opts.priorWritePaths || []);
    if (!prior.length) return false;
    return samePathSet(writes, prior);
  }
  const wroteSomethingNew = writes.some(path => {
    const base = path.split('/').pop() || path;
    return !named.has(base) && !named.has(path);
  });
  return !wroteSomethingNew;
}

export function escalationMatchesRoute(
  current: { nodeId?: string; model?: string } | null | undefined,
  target: { nodeId?: string; model?: string } | null | undefined
): boolean {
  const nodeId = (current?.nodeId || '').trim();
  const model = (current?.model || '').trim();
  const targetNode = (target?.nodeId || '').trim();
  const targetModel = (target?.model || '').trim();
  if (!nodeId || !model || !targetNode || !targetModel) return false;
  return nodeId === targetNode && normTag(model) === normTag(targetModel);
}

export interface StuckStepMessage {
  id?: string;
  role?: string;
  personaHandle?: string;
  endpointId?: string;
  model?: string;
  toolCalls?: { name?: string; status?: string; args?: { path?: string } }[];
}

function messageWritePaths(message: StuckStepMessage): string[] | null {
  const calls = message.toolCalls || [];
  if (!calls.length) return null;
  const writes = calls.filter(call => call.name === 'write_file' || call.name === 'edit_file');
  if (!writes.length) return null;
  return writes
    .filter(call => call.status === 'done' && call.args?.path)
    .map(call => String(call.args?.path));
}

function writeSteps(messages: StuckStepMessage[], skipIds: string[]): StuckStepMessage[] {
  const skip = new Set(skipIds);
  const found: StuckStepMessage[] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (!message || message.role !== 'assistant') continue;
    if (message.id && skip.has(message.id)) continue;
    if (message.personaHandle === 'reviewer') continue;
    if (messageWritePaths(message) == null) continue;
    found.push(message);
  }
  return found;
}

/** Successful writes from the latest coder step that actually wrote. Read-only turns are skipped. */
export function latestStepWritePaths(messages: StuckStepMessage[], skipIds: string[] = []): string[] {
  const step = writeSteps(messages, skipIds)[0];
  return step ? messageWritePaths(step) || [] : [];
}

/** Writes from the coder step before the latest write, for unchanged-set checks. */
export function priorStepWritePaths(messages: StuckStepMessage[], skipIds: string[] = []): string[] {
  const step = writeSteps(messages, skipIds)[1];
  return step ? messageWritePaths(step) || [] : [];
}

/** Node and model of the latest write step, when the message recorded them. */
export function latestCoderRoute(
  messages: StuckStepMessage[],
  skipIds: string[] = []
): { nodeId: string; model: string } | null {
  const step = writeSteps(messages, skipIds)[0];
  if (step?.endpointId && step.model) return { nodeId: step.endpointId, model: step.model };
  return null;
}
