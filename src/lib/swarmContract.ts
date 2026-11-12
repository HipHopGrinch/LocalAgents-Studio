import { EndpointNode } from '../types';
import {
  inferDeliveryStack,
  isDeliveryStack,
  stackFromFilePaths,
  verifyCommandForStack,
  type DeliveryStack
} from './deliveryIntent';
import {
  getEnabledModelsForNode,
  isFrontierNode,
  nodeAllowsRole,
  nodeHasExplicitRole,
  pickBestModelForComplexity,
  rankModelsForWeight,
  type ConductorFileJob
} from './tools';
import type { NodeRole } from '../types';
import { pickCapableReviewTarget } from './continuationReview';
import { fileContextCapsForTier, type ModelFitTier } from './clusterInventory';

export type SwarmComplexity = 'high' | 'medium' | 'low';
export type SwarmPreferredRole = '@coder' | '@docs' | '@reviewer';

export interface SwarmTask {
  filePath: string;
  complexity: SwarmComplexity;
  preferredRole: SwarmPreferredRole;
  requiredExports: string[];
  requiredImports: string[];
  instructions: string;
  /** Display role label for UI */
  role?: string;
  /**
   * Other task filePaths that must finish before this one starts.
   * Empty/omitted = can run in the first wave (after the shared contract).
   */
  dependsOn?: string[];
  /** Optional target GPU node id recommended by Cloud Strategist / Lead Architect */
  targetNodeId?: string;
  /** Optional target model id recommended by Cloud Strategist / Lead Architect */
  targetModel?: string;
}

export interface SwarmManifest {
  contractFile: string;
  contractCode: string;
  tasks: SwarmTask[];
  stack: DeliveryStack;
  verifyCommand?: string | null;
}

export interface SwarmAssignment {
  task: SwarmTask;
  node: EndpointNode;
  model: string;
  usedFrontierBackup?: boolean;
  skippedReason?: string;
}

/** One assigned file plus its pipeline-step index (step 0 is the contract). */
export interface SwarmWorkItem {
  assignment: SwarmAssignment;
  stepIdx: number;
}

/** Planner / option-list prose that must never land in source files. */
export function looksLikePlannerProse(text: string): boolean {
  const t = (text || '').trim();
  if (!t) return false;
  if (/<plan_options\b/i.test(t)) return true;
  if (/<review_plan\b/i.test(t)) return true;
  if (/<review_delta\b/i.test(t)) return true;
  if (/<execution_plan\b/i.test(t)) return true;
  if (/###\s*Intent Analysis/i.test(t)) return true;
  if (/Please pick an option/i.test(t)) return true;
  if (/Options for Architecture/i.test(t)) return true;
  if (/Proposed Plan/i.test(t) && /Option\s*1\s*:/i.test(t)) return true;
  if (/IMPORTANT:\s*Decompose and implement/i.test(t)) return true;
  // Multiple numbered architecture options = plan dump, not code
  const optionHits = (t.match(/\*\*Option\s*\d+/gi) || []).length + (t.match(/<option\s+id=/gi) || []).length;
  if (optionHits >= 2 && t.length > 400) return true;
  return false;
}

/** Obvious stubs that must not Yay interaction / AI / integration steps. */
export function looksLikePlaceholderCode(text: string): boolean {
  const t = text || '';
  if (/Placeholder for actual/i.test(t)) return true;
  if (/TODO:\s*(implement|wire|raycast|drag)/i.test(t)) return true;
  if (/console\.log\(\s*['"]Handling piece drag/i.test(t)) return true;
  if (/not implemented yet/i.test(t)) return true;
  return false;
}

/** Short request line for fallbacks — never the full approved-plan essay. */
export function briefUserTask(userTask: string, max = 220): string {
  const line = (userTask || '')
    .replace(/APPROVED USER PLAN[\s\S]*$/i, '')
    .replace(/Chosen option[\s\S]*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  return (line || userTask || 'the requested app').slice(0, max);
}

export function sanitizeTaskInstructions(
  instructions: string,
  filePath: string,
  userTask: string
): string {
  const brief = briefUserTask(userTask);
  const clean = (instructions || '').trim();
  if (!clean || looksLikePlannerProse(clean) || clean.length > 900) {
    return `Write complete, valid contents for \`${filePath}\` for this project: ${brief}. Output only that file's real source — no Intent Analysis, option lists, or markdown plans.`;
  }
  return clean;
}

const SOURCE_EXT = /\.(bat|cmd|ps1|h|hpp|c|cpp|cc|cxx|rc|cs|py|go|rs|js|jsx|ts|tsx|html|css|json)$/i;

/** Essay dumped into a source file (no import/export, starts like a review). */
export function looksLikeSourceProse(path: string, body: string): boolean {
  const p = (path || '').toLowerCase();
  if (!/\.(ts|tsx|js|jsx|py|css)$/.test(p)) return false;
  const head = (body || '').trim().slice(0, 600);
  if (!head) return false;
  if (looksLikePlannerProse(head)) return true;
  const startsAsCode = /^(import |export |\/\*|\/\/|const |let |function |class |type |interface |#|['"]use |<)/.test(
    head
  );
  const startsAsEssay =
    /^(this is|the (build|primary|goal|file)|i will |identified |surgical |here is|in order to)\b/i.test(head);
  return startsAsEssay && !startsAsCode;
}

/** True when a write_file body is planner prose for a path that should be real source. */
export function shouldRejectPlannerWrite(path: string, body: string): boolean {
  const p = (path || '').toLowerCase();
  if (!SOURCE_EXT.test(p)) return false;
  return looksLikePlannerProse(body) || looksLikeSourceProse(path, body);
}

/** Same Ollama URL shares one GPU, even if two node entries point at it. */
export function endpointQueueKey(node: EndpointNode): string {
  return (node.url || node.id || '').replace(/\/+$/, '').toLowerCase();
}

/**
 * One in-flight chat per GPU URL. Different URLs stay parallel.
 * The heaviest file's model is pinned for the whole queue so a 16GB card
 * does not load a 14B and a 7B at the same time.
 */
export function queueAssignmentsByGpu(assignments: SwarmAssignment[]): SwarmWorkItem[][] {
  const queues = new Map<string, SwarmWorkItem[]>();
  assignments.forEach((assignment, i) => {
    const key = endpointQueueKey(assignment.node);
    const queue = queues.get(key) ?? [];
    queue.push({ assignment, stepIdx: i + 1 });
    queues.set(key, queue);
  });

  for (const queue of queues.values()) {
    let heaviest = queue[0];
    for (const item of queue) {
      const itemWeight = COMPLEXITY_WEIGHT[item.assignment.task.complexity];
      const bestWeight = COMPLEXITY_WEIGHT[heaviest.assignment.task.complexity];
      if (itemWeight > bestWeight) heaviest = item;
    }
    const pinned = heaviest.assignment.model;
    for (const item of queue) item.assignment.model = pinned;
  }

  return [...queues.values()];
}

const COMPLEXITY_WEIGHT: Record<SwarmComplexity, number> = {
  high: 3,
  medium: 2,
  low: 1
};

/** Map swarm complexity → existing Conductor complexity labels. */
export function toConductorComplexity(
  c: SwarmComplexity
): ConductorFileJob['complexity'] {
  if (c === 'high') return 'heavy';
  if (c === 'low') return 'light';
  return 'medium';
}

export function stripThinkBlocks(raw: string): string {
  return raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

/** Pull the outermost `{...}` with brace counting (ignores braces inside strings). */
export function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/** Fix common local-model JSON mistakes before parse. */
export function sanitizeLooseJson(raw: string): string {
  let s = raw.trim();
  // Trailing commas before } or ]
  s = s.replace(/,\s*([}\]])/g, '$1');
  // Unescaped newlines inside double-quoted strings (best-effort)
  let out = '';
  let inString = false;
  let escape = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inString) {
      if (escape) {
        out += ch;
        escape = false;
        continue;
      }
      if (ch === '\\') {
        out += ch;
        escape = true;
        continue;
      }
      if (ch === '"') {
        out += ch;
        inString = false;
        continue;
      }
      if (ch === '\n' || ch === '\r') {
        out += '\\n';
        continue;
      }
      out += ch;
      continue;
    }
    if (ch === '"') inString = true;
    out += ch;
  }
  return out;
}

/**
 * Parse Pass-1 Lead Architect JSON (tolerates fences + think blocks).
 */
export function parseSwarmManifest(raw: string, userTask: string): SwarmManifest | null {
  try {
    let cleaned = stripThinkBlocks(raw);
    const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) cleaned = fence[1].trim();
    const slice = extractJsonObject(cleaned);
    if (!slice) return null;
    let parsed: any;
    try {
      parsed = JSON.parse(slice);
    } catch {
      parsed = JSON.parse(sanitizeLooseJson(slice));
    }
    if (!parsed || typeof parsed !== 'object') return null;

    const contractFile = String(parsed.contractFile || 'src/types/swarm-contract.ts')
      .trim()
      .replace(/^[\\/]+/, '')
      .replace(/\.\.[\\/]+/g, '');
    let contractCode = String(parsed.contractCode || '').trim();
    if (!contractCode) return null;
    // Strip accidental fences inside contractCode
    contractCode = contractCode
      .replace(/^\s*```(?:typescript|ts)?\s*\n?/i, '')
      .replace(/\n?```\s*$/i, '');

    const seen = new Set<string>();
    const tasks: SwarmTask[] = (Array.isArray(parsed.tasks) ? parsed.tasks : [])
      .filter((t: any) => t && typeof t.filePath === 'string' && t.filePath.trim())
      .map((t: any) => {
        const filePath = String(t.filePath)
          .trim()
          .replace(/^[\\/]+/, '')
          .replace(/\.\.[\\/]+/g, '');
        const complexity: SwarmComplexity =
          t.complexity === 'high' || t.complexity === 'low' || t.complexity === 'medium'
            ? t.complexity
            : t.complexity === 'heavy'
              ? 'high'
              : t.complexity === 'light'
                ? 'low'
                : 'medium';
        const preferredRole: SwarmPreferredRole =
          t.preferredRole === '@docs' || t.preferredRole === '@reviewer' ? t.preferredRole : '@coder';
        const dependsOn = Array.isArray(t.dependsOn)
          ? t.dependsOn
              .map((d: unknown) =>
                String(d || '')
                  .trim()
                  .replace(/^[\\/]+/, '')
                  .replace(/\.\.[\\/]+/g, '')
              )
              .filter(Boolean)
          : [];
        return {
          filePath,
          complexity,
          preferredRole,
          requiredExports: Array.isArray(t.requiredExports)
            ? t.requiredExports.map(String)
            : [],
          requiredImports: Array.isArray(t.requiredImports)
            ? t.requiredImports.map(String)
            : [],
          dependsOn,
          instructions: sanitizeTaskInstructions(
            String(t.instructions || '').trim(),
            filePath,
            userTask
          ),
          role: String(t.role || preferredRole || 'Worker'),
          targetNodeId: typeof t.targetNodeId === 'string' && t.targetNodeId.trim() ? t.targetNodeId.trim() : undefined,
          targetModel: typeof t.targetModel === 'string' && t.targetModel.trim() ? t.targetModel.trim() : undefined
        } as SwarmTask;
      })
      .filter((t: SwarmTask) => {
        const key = t.filePath.toLowerCase();
        if (seen.has(key)) return false;
        if (key === contractFile.toLowerCase()) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 6);

    const tasksFinal = inferTaskDependsOn(tasks);
    if (!tasksFinal.length) return null;
    const fromFiles = stackFromFilePaths(tasksFinal.map(t => t.filePath));
    const declared = isDeliveryStack(String(parsed.stack || '')) ? (parsed.stack as DeliveryStack) : null;
    // Prefer file paths over a mistaken "typescript" declaration when sources are native.
    const stack =
      (fromFiles === 'native-win32' ? fromFiles : null) ||
      declared ||
      fromFiles ||
      inferDeliveryStack(userTask);
    const verifyCommand =
      typeof parsed.verifyCommand === 'string' && parsed.verifyCommand.trim()
        ? String(parsed.verifyCommand).trim()
        : verifyCommandForStack(stack);
    return { contractFile, contractCode, tasks: tasksFinal, stack, verifyCommand };
  } catch {
    return null;
  }
}

function normPathKey(p: string): string {
  return (p || '').replace(/\\/g, '/').trim().toLowerCase();
}

const IMPORT_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.rs', '.h', '.hpp', '.cpp', '.cs'];

/** Resolve `./` and `../` against the importing file. Bare names stay as given — never a basename search. */
function resolveSpec(fromFile: string, spec: string): string {
  const raw = spec.replace(/\\/g, '/').trim();
  if (!raw) return '';
  if (!raw.startsWith('.')) return raw.replace(/^\//, '');
  const dir = fromFile.replace(/\\/g, '/').split('/').slice(0, -1);
  const stack = [...dir];
  for (const part of raw.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  return stack.join('/');
}

function lookupTaskPath(byKey: Map<string, string>, fromFile: string, spec: string): string | undefined {
  const resolved = resolveSpec(fromFile, spec);
  if (!resolved) return undefined;
  const candidates = [resolved];
  if (!/\.[A-Za-z0-9]+$/.test(resolved)) {
    for (const ext of IMPORT_EXTS) candidates.push(resolved + ext);
  }
  for (const c of candidates) {
    const hit = byKey.get(normPathKey(c));
    if (hit) return hit;
  }
  return undefined;
}

/**
 * Fill missing dependsOn from requiredImports that resolve to another task's full relative path.
 * Basename-only matches are ignored so `src/util.ts` is not tied to `tests/util.ts`.
 */
export function inferTaskDependsOn(tasks: SwarmTask[]): SwarmTask[] {
  const byKey = new Map(tasks.map(t => [normPathKey(t.filePath), t.filePath]));

  return tasks.map(task => {
    const selfKey = normPathKey(task.filePath);
    const declared = [...(task.dependsOn || [])];
    for (const imp of task.requiredImports || []) {
      const m =
        imp.match(/from\s+['"]([^'"]+)['"]/i) ||
        imp.match(/#include\s*[<"]([^>"]+)[>"]/i) ||
        imp.match(/['"]([A-Za-z0-9_./\\-]+\.[A-Za-z0-9]+)['"]/);
      const raw = (m?.[1] || '').replace(/\\/g, '/');
      if (!raw) continue;
      const hit = lookupTaskPath(byKey, task.filePath, raw);
      if (hit && normPathKey(hit) !== selfKey) declared.push(hit);
    }
    const uniq: string[] = [];
    const seen = new Set<string>();
    for (const d of declared) {
      const hit = lookupTaskPath(byKey, task.filePath, d);
      if (!hit) continue;
      const key = normPathKey(hit);
      if (!key || key === selfKey || seen.has(key)) continue;
      seen.add(key);
      uniq.push(hit);
    }
    return { ...task, dependsOn: uniq };
  });
}

/**
 * Partition tasks into sequential waves. Within a wave, files may run in parallel.
 * A dependency cycle is serialized (one file per wave) instead of one parallel wave.
 */
export function partitionSwarmTasksIntoWaves(tasks: SwarmTask[]): SwarmTask[][] {
  if (!tasks.length) return [];
  const remaining = new Map(tasks.map(t => [normPathKey(t.filePath), t]));
  const done = new Set<string>();
  const waves: SwarmTask[][] = [];
  const maxWaves = tasks.length + 2;

  while (remaining.size > 0 && waves.length < maxWaves) {
    const ready: SwarmTask[] = [];
    for (const task of remaining.values()) {
      const deps = task.dependsOn || [];
      const ok = deps.every(d => done.has(normPathKey(d)));
      if (ok) ready.push(task);
    }
    if (!ready.length) {
      // Cycle: one task per wave so those files are not written in parallel.
      for (const task of remaining.values()) waves.push([task]);
      break;
    }
    // Heavier files first within a wave (same as prior assigner preference)
    ready.sort(
      (a, b) => COMPLEXITY_WEIGHT[b.complexity] - COMPLEXITY_WEIGHT[a.complexity]
    );
    waves.push(ready);
    for (const t of ready) {
      const key = normPathKey(t.filePath);
      remaining.delete(key);
      done.add(key);
    }
  }
  return waves;
}

/** Deterministic fallback when Pass 1 JSON fails — still produces a usable contract. */
export function fallbackSwarmManifest(userTask: string): SwarmManifest {
  const stack = inferDeliveryStack(userTask);
  const verifyCommand = verifyCommandForStack(stack);
  const brief = briefUserTask(userTask);
  if (stack === 'native-win32') {
    return {
      stack,
      verifyCommand,
      contractFile: 'SWARM.md',
      contractCode: `# Native Windows swarm notes\nRequest: ${brief}\nShared: American checkers rules, 8x8 board, Win32 message loop owns input.\n`,
      tasks: [
        {
          filePath: 'Checkers.h',
          complexity: 'medium',
          preferredRole: '@coder',
          requiredExports: [],
          requiredImports: [],
          dependsOn: [],
          instructions: `C/C++ header: board state, piece types, move APIs, and window proc declarations for a Win32 checkers game (${brief}). Real #ifndef guards and prototypes only — no markdown.`,
          role: 'Headers'
        },
        {
          filePath: 'Resource.h',
          complexity: 'low',
          preferredRole: '@coder',
          requiredExports: [],
          requiredImports: [],
          dependsOn: [],
          instructions: `Win32 resource IDs only (#define IDC_*, IDM_*, IDI_*). No planner prose.`,
          role: 'Resources'
        },
        {
          filePath: 'Checkers.cpp',
          complexity: 'high',
          preferredRole: '@coder',
          requiredExports: [],
          requiredImports: [],
          dependsOn: ['Checkers.h'],
          instructions: `Complete Win32 + GDI checkers implementation: window, board draw, clicks, turns, jumps, kings (${brief}). Valid C++ only.`,
          role: 'Main'
        },
        {
          filePath: 'Checkers.rc',
          complexity: 'low',
          preferredRole: '@coder',
          requiredExports: [],
          requiredImports: [],
          dependsOn: ['Resource.h'],
          instructions: `Valid .rc script including Resource.h (menu/icon/dialog stubs as needed).`,
          role: 'RC'
        },
        {
          filePath: 'build.bat',
          complexity: 'low',
          preferredRole: '@coder',
          requiredExports: [],
          requiredImports: [],
          dependsOn: ['Checkers.cpp', 'Checkers.rc'],
          instructions: `@echo off batch that compiles Checkers.cpp / Checkers.rc with cl.exe or g++ into Checkers.exe. Real commands only — never paste a plan.`,
          role: 'Build'
        }
      ]
    };
  }
  if (stack === 'python') {
    return {
      stack,
      verifyCommand,
      contractFile: 'SWARM.md',
      contractCode: `# Shared names\nProject: ${brief}\n`,
      tasks: [
        {
          filePath: 'main.py',
          complexity: 'high',
          preferredRole: '@coder',
          requiredExports: [],
          requiredImports: [],
          instructions: `Implement the Python program for: ${brief}`,
          role: 'Main'
        },
        {
          filePath: 'README.md',
          complexity: 'low',
          preferredRole: '@docs',
          requiredExports: [],
          requiredImports: [],
          instructions: `Short run instructions for: ${brief}`,
          role: 'Docs'
        }
      ]
    };
  }
  if (stack === 'go') {
    return {
      stack,
      verifyCommand,
      contractFile: 'SWARM.md',
      contractCode: `# Shared names\n`,
      tasks: [
        {
          filePath: 'go.mod',
          complexity: 'low',
          preferredRole: '@coder',
          requiredExports: [],
          requiredImports: [],
          instructions: 'Create a go.mod module named example.com/app',
          role: 'Module'
        },
        {
          filePath: 'main.go',
          complexity: 'high',
          preferredRole: '@coder',
          requiredExports: [],
          requiredImports: [],
          instructions: `Implement the Go program for: ${brief}`,
          role: 'Main'
        }
      ]
    };
  }
  if (stack === 'rust') {
    return {
      stack,
      verifyCommand,
      contractFile: 'SWARM.md',
      contractCode: `# Shared names\n`,
      tasks: [
        {
          filePath: 'Cargo.toml',
          complexity: 'low',
          preferredRole: '@coder',
          requiredExports: [],
          requiredImports: [],
          instructions: 'Cargo.toml for a binary named app',
          role: 'Cargo'
        },
        {
          filePath: 'src/main.rs',
          complexity: 'high',
          preferredRole: '@coder',
          requiredExports: [],
          requiredImports: [],
          instructions: `Implement the Rust program for: ${brief}`,
          role: 'Main'
        }
      ]
    };
  }
  if (stack === 'node') {
    return {
      stack,
      verifyCommand,
      contractFile: 'SWARM.md',
      contractCode: `# Shared names\n`,
      tasks: [
        {
          filePath: 'package.json',
          complexity: 'medium',
          preferredRole: '@coder',
          requiredExports: [],
          requiredImports: [],
          instructions: `package.json for: ${brief}`,
          role: 'Package'
        },
        {
          filePath: 'main.js',
          complexity: 'high',
          preferredRole: '@coder',
          requiredExports: [],
          requiredImports: [],
          instructions: `Implement the Node/Electron entry for: ${brief}`,
          role: 'Main'
        }
      ]
    };
  }
  if (stack === 'static-web') {
    return {
      stack,
      verifyCommand,
      contractFile: 'SWARM.md',
      contractCode: `# Shared names\nUse the same product names, prices, and image paths in every file.\n`,
      tasks: [
        {
          filePath: 'index.html',
          complexity: 'high',
          preferredRole: '@coder',
          requiredExports: [],
          requiredImports: [],
          instructions: `Complete static page for: ${brief}. Link styles.css and app.js. Use generate_image paths under assets/ when pictures are needed.`,
          role: 'HTML'
        },
        {
          filePath: 'styles.css',
          complexity: 'medium',
          preferredRole: '@docs',
          requiredExports: [],
          requiredImports: [],
          instructions: `Styles for: ${brief}`,
          role: 'CSS'
        },
        {
          filePath: 'app.js',
          complexity: 'medium',
          preferredRole: '@coder',
          requiredExports: [],
          requiredImports: [],
          instructions: `Browser script (cart or behavior) for: ${brief}`,
          role: 'JS'
        }
      ]
    };
  }

  const lower = userTask.toLowerCase();
  const isWeb =
    /\b(web|webpage|website|html|react|ui|dashboard|frontend)\b/.test(lower) ||
    !/\b(python|tkinter|desktop|windows app|cli)\b/.test(lower);

  if (isWeb) {
    return {
      stack: 'typescript',
      verifyCommand: null,
      contractFile: 'src/types/swarm-contract.ts',
      contractCode: `/** Shared contract for Conductor Swarm — do not redefine in worker files. */
export interface AppState {
  title: string;
  ready: boolean;
}

export type AppMessage = { type: 'ready' } | { type: 'error'; message: string };

export function createInitialState(): AppState {
  return { title: 'App', ready: false };
}
`,
      tasks: [
        {
          filePath: 'src/app.ts',
          complexity: 'high',
          preferredRole: '@coder',
          requiredExports: ['export function boot(): void'],
          requiredImports: [
            "import type { AppState } from './types/swarm-contract';",
            "import { createInitialState } from './types/swarm-contract';"
          ],
          instructions: `Implement application bootstrap using createInitialState for: ${brief}`,
          role: 'Core App'
        },
        {
          filePath: 'src/ui.ts',
          complexity: 'medium',
          preferredRole: '@docs',
          requiredExports: ['export function renderApp(root: HTMLElement, state: AppState): void'],
          requiredImports: ["import type { AppState } from './types/swarm-contract';"],
          instructions: `Implement UI rendering helpers for: ${brief}`,
          role: 'UI'
        },
        {
          filePath: 'index.html',
          complexity: 'low',
          preferredRole: '@reviewer',
          requiredExports: [],
          requiredImports: [],
          instructions: `Create index.html that loads the app entry for: ${brief}`,
          role: 'HTML Shell'
        }
      ]
    };
  }

  return {
    stack: 'typescript',
    verifyCommand: null,
    contractFile: 'src/types/swarm-contract.ts',
    contractCode: `/** Shared contract for Conductor Swarm. */
export interface AppConfig {
  name: string;
  version: string;
}

export function getDefaultConfig(): AppConfig {
  return { name: 'app', version: '0.1.0' };
}
`,
    tasks: [
      {
        filePath: 'src/main.ts',
        complexity: 'high',
        preferredRole: '@coder',
        requiredExports: ['export function main(): void'],
        requiredImports: [
          "import type { AppConfig } from './types/swarm-contract';",
          "import { getDefaultConfig } from './types/swarm-contract';"
        ],
        instructions: `Implement main entry for: ${brief}`,
        role: 'Main'
      },
      {
        filePath: 'src/services.ts',
        complexity: 'medium',
        preferredRole: '@coder',
        requiredExports: ['export function describeConfig(cfg: AppConfig): string'],
        requiredImports: ["import type { AppConfig } from './types/swarm-contract';"],
        instructions: `Implement service helpers for: ${brief}`,
        role: 'Services'
      }
    ]
  };
}

function clipText(text: string, max: number): string {
  const t = (text || '').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}\n…(truncated)`;
}

function stripRepeatedPlan(userTask: string, plan: string): string {
  const p = plan.trim();
  if (!p || !userTask.includes(p)) return userTask;
  return userTask.split(p).join('').replace(/\n{3,}/g, '\n\n').trim();
}

function capSnippetBlob(text: string, maxFiles: number, maxEach: number, maxTotal: number): string {
  const raw = (text || '').trim();
  if (!raw) return '(none loaded)';
  const parts = raw.split(/\n(?=###\s+)/).map(p => p.trim()).filter(Boolean);
  const chunks = (parts.length ? parts : [raw]).slice(0, maxFiles).map(p =>
    p.length <= maxEach ? p : `${p.slice(0, maxEach)}\n…(snippet truncated)`
  );
  let out = chunks.join('\n\n');
  if (out.length > maxTotal) out = `${out.slice(0, maxTotal)}\n…(snippets truncated)`;
  return out;
}

function overviewPathsOnly(overview: string, maxLines: number): string {
  const kept: string[] = [];
  let inFence = false;
  for (const line of (overview || '').split(/\r?\n/)) {
    const t = line.trim();
    if (t.startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (inFence || !t || t.length > 160) continue;
    if (/[{};]/.test(t) && t.length > 48) continue;
    kept.push(line.replace(/\s+$/, ''));
    if (kept.length >= maxLines) break;
  }
  return kept.join('\n') || '(no files)';
}

function formatStrategistRoster(nodes: EndpointNode[]): string {
  return nodes
    .filter(n => n.online && !isFrontierNode(n) && getEnabledModelsForNode(n).length > 0)
    .map(n => {
      const enabled = getEnabledModelsForNode(n);
      const pinned =
        n.activeModel && enabled.includes(n.activeModel) ? n.activeModel : enabled[0];
      const total = n.hardware?.vramGB ?? 0;
      const reserve = n.hardware?.reserveVramGB ?? 0;
      const usable = total > 0 ? Math.max(0, +(total - reserve).toFixed(1)) : 0;
      return `- ${n.id} | ${n.name} | ${usable}GB | ${n.specialty || 'auto'} | ${pinned}`;
    })
    .join('\n');
}

function takeNamedSnippets(existing: string, maxFiles: number, maxChars: number): string {
  const raw = (existing || '').trim();
  if (!raw) return '';
  const parts = raw.split(/\n(?=###\s+)/).map(p => p.trim()).filter(Boolean);
  return (parts.length ? parts : [raw])
    .slice(0, maxFiles)
    .map(p => {
      const lines = p.split('\n');
      const title = lines[0].replace(/^###\s+/, '').trim() || 'snippet';
      const body = lines.slice(lines[0].startsWith('###') ? 1 : 0).join('\n').trim();
      const clipped = body.length > maxChars ? `${body.slice(0, maxChars)}…` : body;
      return clipped ? `### ${title}\n${clipped}` : `### ${title}`;
    })
    .join('\n\n');
}

export interface CloudStrategistPromptInput {
  userTask: string;
  approvedPlanBrief?: string | null;
  nodes?: EndpointNode[];
  rosterLines?: string;
  workspaceOverview?: string;
  existingSnippets?: string;
  snippets?: { path: string; body: string }[];
}

/**
 * Short Pass-1 packet for the Cloud Strategist (~1.5K tokens): task, plan brief once,
 * roster lines, file-tree paths, and at most three named snippets.
 */
export function buildCloudStrategistPrompt(input: CloudStrategistPromptInput): string {
  const plan = (input.approvedPlanBrief || '').trim();
  const task = clipText(stripRepeatedPlan(input.userTask || '', plan), 1200);
  const planBlock = plan ? clipText(plan, 800) : '';
  const roster = input.rosterLines?.trim() || formatStrategistRoster(input.nodes || []);
  const tree = clipText(overviewPathsOnly(input.workspaceOverview || '', 50), 800);
  const named = input.snippets?.length
    ? input.snippets
        .slice(0, 3)
        .map(s => `### ${s.path}\n${clipText(s.body, 350)}`)
        .join('\n\n')
    : takeNamedSnippets(input.existingSnippets || '', 3, 350);
  return `You are the Cloud Strategist. Decompose the task into a Swarm JSON manifest. JSON only — no implementation bodies.

Paths live on the Dev workspace. Set targetNodeId from the roster so independent files run in parallel.

### TASK
${task || '(none)'}
${planBlock ? `\n### APPROVED PLAN (follow this once)\n${planBlock}\n` : ''}
### ROSTER
${roster || '(no local workers online)'}

### FILE TREE (paths only)
${tree}
${named ? `\n### SNIPPETS (at most 3)\n${named}\n` : ''}
### OUTPUT
JSON object with stack, contractFile, short contractCode, and 2–5 tasks (filePath, complexity high|medium|low, preferredRole, requiredExports, requiredImports, dependsOn, 1–3 sentence instructions, optional targetNodeId), plus verifyCommand.
Do not paste the approved plan into instructions. Output JSON only.`;
}

export function buildLeadArchitectPrompt(
  userTask: string,
  workspaceOverview: string,
  existingSnippets: string,
  approvedPlanText?: string | null,
  workLog?: string | null,
  devHostSection?: string | null,
  nodes?: EndpointNode[],
  opts?: { cloudStrategist?: boolean }
): string {
  if (opts?.cloudStrategist) {
    return buildCloudStrategistPrompt({
      userTask,
      approvedPlanBrief: approvedPlanText,
      nodes,
      workspaceOverview,
      existingSnippets
    });
  }
  const planText = approvedPlanText?.trim() || '';
  const taskForPrompt = stripRepeatedPlan(userTask, planText);
  const cappedSnippets = capSnippetBlob(existingSnippets, 3, 1200, 3600);
  const planSection = planText
    ? `
### APPROVED PLAN (user already chose — follow this architecture)
${planText}
`
    : '';

  const hostBlock = devHostSection?.trim()
    ? `
### DEVELOPMENT HOST
${devHostSection.trim()}
Workers may run on other GPUs; they still write into this Dev workspace. Installs and run_command execute on the Dev PC only.
`
    : `
### DEVELOPMENT HOST
The workspace, installs, and terminal live on the Dev PC where LocalAgents Studio is open — not necessarily on the GPU that runs this pass. Plan file paths for that Dev workspace.
`;

  const onlineWorkers = (nodes || []).filter(
    n => n.online && !isFrontierNode(n) && getEnabledModelsForNode(n).length > 0
  );
  const clusterRosterSection = onlineWorkers.length > 0
    ? `
### CLUSTER WORKER ROSTER (Distribute tasks across these GPUs in parallel waves!)
${onlineWorkers.map(n => {
  const totalVram = n.hardware?.vramGB ?? 16;
  const reserve = n.hardware?.reserveVramGB ?? 1;
  const usable = Math.max(1, +(totalVram - reserve).toFixed(1));
  const enabled = getEnabledModelsForNode(n);
  const pinned = n.activeModel && enabled.includes(n.activeModel) ? n.activeModel : enabled[0];
  return `- targetNodeId: "${n.id}" | ${n.name} (${n.hardware?.gpu || 'GPU'}, ${usable}GB usable VRAM) | specialty: ${n.specialty || 'auto'} | roles: [${(n.roles || []).join(', ') || 'auto'}] | primaryModel: "${pinned}"`;
}).join('\n')}
When decomposing tasks, you MAY set \`"targetNodeId"\` on each task to balance parallel execution across ALL online GPUs simultaneously:
- Assign \`"high"\` complexity core logic/entry files to the \`architect\` / \`heavy_coder\` GPU (e.g., 16GB RTX 5070 Ti).
- Assign \`"medium"\` complexity modules/components/services to the \`module_coder\` GPU (e.g., 11GB GTX 1080 Ti with 10.8GB usable VRAM).
- Assign \`"low"\` complexity config/styles/HTML/utility files to the \`scout\` GPU (e.g., 6GB Laptop RTX 3060 with 5.9GB usable VRAM).
`
    : '';

  return `You are the Lead Architect for LocalAgents Studio's Conductor Swarm.
Decompose a multi-file coding request into a JSON manifest. The shared contract is written first; then workers write ONE file each — **in dependency order** (waves). Independent files in the same wave may run in parallel.
When an APPROVED PLAN is present, honor the chosen stack and scope — never invent React/TypeScript for native C++/Win32 or static HTML.
${hostBlock}${clusterRosterSection}
### WORKSPACE CONTEXT
Existing file tree:
${workspaceOverview || '(empty or unknown)'}

Relevant existing files:
${cappedSnippets}

### WORK LOG
${workLog?.trim() || '(none yet)'}
Do not assign a task that is already under Done. Do not ask the user a question listed under Already asked.

### USER REQUEST
${taskForPrompt}
${planSection}
### OUTPUT REQUIREMENTS
Respond ONLY with a valid JSON object. Do NOT write full implementation bodies in the JSON.
1. \`stack\`: one of "typescript", "static-web", "python", "go", "rust", "node", "native-win32".
2. \`contractFile\` + \`contractCode\`:
   - typescript: prefer \`src/types/swarm-contract.ts\` with real shared types that typecheck **alone** (no \`import\` from \`three\`, \`react\`, \`@react-three/fiber\`, etc. until deps are installed — use plain interfaces/types only).
   - For R3F / Three.js apps, put \`@react-three/fiber\` in package.json (never the obsolete unscoped \`react-three-fiber\` name).
   - static-web / python / go / rust / node / native-win32: prefer \`SWARM.md\` with SHORT shared notes (names, APIs, rules). Markdown is fine — not TypeScript unless the stack is typescript.
3. \`tasks\`: 2–5 distinct \`filePath\`s (never the contract file). List foundation files **before** files that import them. Each needs SHORT \`instructions\` (1–3 sentences). Never paste Intent Analysis, option lists, or the approved-plan essay into \`instructions\` or \`contractCode\`. Include optional \`"targetNodeId"\` from the CLUSTER WORKER ROSTER to spread independent tasks across all GPUs in parallel.
4. \`dependsOn\` (REQUIRED when a file imports/uses another task file): array of those \`filePath\` strings. Example: logic that imports models → \`"dependsOn": ["internal/models/game.go"]\`. Omit or \`[]\` only when the file truly needs nothing else from this task list (contract is always written first).
5. \`verifyCommand\`: one shell check, or null when typescript (tsc is run separately). For native-win32, prefer verifying \`build.bat\` exists and is a real batch file.

Example (native Win32):
{
  "stack": "native-win32",
  "contractFile": "SWARM.md",
  "contractCode": "# Shared\\n8x8 checkers, Win32 UI\\n",
  "tasks": [
    {
      "filePath": "Checkers.h",
      "complexity": "medium",
      "preferredRole": "@coder",
      "requiredExports": [],
      "requiredImports": [],
      "dependsOn": [],
      "instructions": "Header: board state, piece types, move APIs."
    },
    {
      "filePath": "Checkers.cpp",
      "complexity": "high",
      "preferredRole": "@coder",
      "requiredExports": [],
      "requiredImports": ["#include \\"Checkers.h\\""],
      "dependsOn": ["Checkers.h"],
      "instructions": "Win32 GDI checkers implementation using Checkers.h. Valid C++ only."
    }
  ],
  "verifyCommand": null
}

Example (TypeScript):
{
  "contractFile": "src/types/swarm-contract.ts",
  "contractCode": "export interface Example { id: string }\\n",
  "stack": "typescript",
  "tasks": [
    {
      "filePath": "package.json",
      "complexity": "low",
      "preferredRole": "@coder",
      "requiredExports": [],
      "requiredImports": [],
      "dependsOn": [],
      "instructions": "Vite + React + typescript. Use @react-three/fiber (scoped), never react-three-fiber."
    },
    {
      "filePath": "src/example.ts",
      "complexity": "high",
      "preferredRole": "@coder",
      "requiredExports": ["export function run(): void"],
      "requiredImports": ["import type { Example } from './types/swarm-contract';"],
      "dependsOn": ["package.json"],
      "instructions": "Implement run() using the shared contract."
    }
  ]
}

Use complexity "high" | "medium" | "low" and preferredRole "@coder" | "@docs" | "@reviewer".
Output JSON only.`;
}

function capFileBody(content: string, maxChars: number): string {
  const text = (content || '').replace(/\r\n/g, '\n');
  if (text.length <= maxChars) return text;
  const marker = '\n…(truncated)…\n';
  const budget = Math.max(80, maxChars - marker.length);
  const head = Math.floor(budget * 0.65);
  const tail = budget - head;
  return `${text.slice(0, head)}${marker}${text.slice(-tail)}`;
}

/** Export signatures only — not function bodies or the rest of the contract. */
export function extractContractExports(code: string, maxLines = 40): string {
  const lines = (code || '').replace(/\r\n/g, '\n').split('\n');
  const kept: string[] = [];
  for (const line of lines) {
    if (!/^\s*export\s+/.test(line)) continue;
    const sig = /\{/.test(line) && !/\}/.test(line) ? line.replace(/\{.*/, '{ /* … */ }') : line;
    kept.push(sig.trim());
    if (kept.length >= maxLines) break;
  }
  if (kept.length) return kept.join('\n');
  const decls = lines.filter(l =>
    /^\s*(export\s+)?(interface|type|function|class|const|enum)\s+/.test(l)
  );
  return decls.slice(0, maxLines).join('\n') || '(no exports parsed)';
}

/** At most `max` diagnostic lines (error lines preferred). */
export function capDiagnosticLines(text: string, max = 40): string {
  const lines = (text || '').split(/\r?\n/);
  const interesting = lines.filter(l => /error|TS\d+/i.test(l));
  const source = interesting.length ? interesting : lines.filter(l => l.trim());
  const picked = source.slice(0, max);
  const omitted = Math.max(0, source.length - picked.length);
  const body = picked.join('\n');
  return omitted > 0 ? `${body}\n…(${omitted} more lines omitted)` : body;
}

/** ±radius lines around each error, merged when windows overlap. */
export function sliceErrorWindows(content: string, errors: string, radius = 40): string {
  const lines = (content || '').replace(/\r\n/g, '\n').split('\n');
  const nums = [
    ...new Set(
      [...(errors || '').matchAll(/\((\d+),\d+\)|:(\d+):\d+/g)]
        .map(m => Number(m[1] || m[2]))
        .filter(n => n > 0)
    )
  ].sort((a, b) => a - b);
  if (!nums.length || !lines.length) {
    return lines
      .slice(0, 40)
      .map((l, i) => `${i + 1}|${l}`)
      .join('\n');
  }
  const ranges: [number, number][] = [];
  for (const n of nums) {
    const start = Math.max(1, n - radius);
    const end = Math.min(lines.length, n + radius);
    const last = ranges[ranges.length - 1];
    if (last && start <= last[1] + 1) last[1] = Math.max(last[1], end);
    else ranges.push([start, end]);
  }
  return ranges
    .map(([a, b]) => {
      const body = lines
        .slice(a - 1, b)
        .map((l, i) => `${a + i}|${l}`)
        .join('\n');
      return `// lines ${a}-${b}\n${body}`;
    })
    .join('\n\n');
}

export function buildContractRepairPrompt(
  userTask: string,
  previous: SwarmManifest,
  tscError: string,
  opts?: { tier?: ModelFitTier }
): string {
  const exports = extractContractExports(previous.contractCode);
  const tightNote =
    opts?.tier === 'tight' ? '\nTight context: keep contractCode to the export signatures that failed.' : '';
  const tasks = previous.tasks
    .map(t => {
      const exp = t.requiredExports.length ? ` exports: ${t.requiredExports.join('; ')}` : '';
      return `- ${t.filePath}${exp}`;
    })
    .join('\n');
  const errors = capDiagnosticLines(tscError, 40);
  return `The swarm contract failed typecheck. Return the full JSON manifest with fixed contractCode. JSON only.

### REQUEST
${clipText(userTask, 800)}

### CONTRACT EXPORTS (\`${previous.contractFile}\`)
${exports}

### TASK PATHS
${tasks || '(none)'}

### ERRORS (≤40)
${errors}

Keep task file paths. Prefer plain exported types with no third-party imports in contractCode.
If package.json is wrong, use \`@react-three/fiber\` not \`react-three-fiber\`. Do not paste task essays.${tightNote}`;
}

export interface SwarmSiblingFile {
  path: string;
  exports?: string[];
  /** Inlined only when this path is a direct dependsOn of the task. */
  content?: string;
}

/**
 * Stable swarm-worker system prompt (~400 tokens): persona, tool skeleton, write only this path.
 * Dev-host blurb and work log stay out — they belong in the user turn if needed at all.
 */
export function buildSwarmWorkerSystemStub(filePath: string, stack?: string): string {
  const path = (filePath || 'the assigned file').replace(/\\/g, '/');
  const lang = stack || 'source';
  return `You are one GPU worker in a Conductor Swarm. Write ONLY \`${path}\` (${lang}).
Other workers own other paths. Do not rewrite them. The shared contract is read-only.
Filesystem tools apply to the Dev workspace, not to this GPU.

Emit exactly one tool, then stop:
<write_file path="${path}">
complete ${lang} for this path only
</write_file>

When the current file is already shown, prefer a hunk:
<edit_file path="${path}">
<<<<<<< SEARCH
exact lines
=======
new lines
>>>>>>> REPLACE
</edit_file>

Rules: no Intent Analysis, no option lists, no markdown plan inside the tag.
Match required exports. Do not redefine contract types.
If a sibling is listed as a path plus exports, import it — do not paste that file.`;
}

export function buildSwarmWorkerPrompt(opts: {
  task: SwarmTask;
  contractFile: string;
  contractCode: string;
  siblingSummary: string;
  currentFileContent?: string;
  userPrompt: string;
  /** Accepted for compatibility. Not repeated here — the system stub covers the worker role. */
  devHostSection?: string | null;
  stack?: DeliveryStack;
  tier?: ModelFitTier;
  siblingFiles?: SwarmSiblingFile[];
}): string {
  const { task, contractFile, contractCode, siblingSummary, currentFileContent, userPrompt } = opts;
  const stack = opts.stack || 'typescript';
  const tier = opts.tier ?? 'tight';
  const caps = fileContextCapsForTier(tier);
  const tsMode = stack === 'typescript' && isTypeScriptContractPath(contractFile);
  const imports = task.requiredImports.length
    ? task.requiredImports.map(i => `- ${i}`).join('\n')
    : '- (none specified)';
  const exports = task.requiredExports.length
    ? task.requiredExports.map(e => `- ${e}`).join('\n')
    : '- (export what the instructions require)';
  const contractBody =
    contractCode.length > caps.maxCharsPerFile
      ? extractContractExports(contractCode)
      : contractCode;
  const contractBlock = tsMode
    ? `### CONTRACT (\`${contractFile}\`) — read-only
Imports:
${imports}
Exports to provide:
${exports}
\`\`\`typescript
${contractBody}
\`\`\`
Do not redefine types from \`${contractFile}\`.`
    : `### SHARED NOTES (\`${contractFile}\`)
\`\`\`
${capFileBody(contractBody, caps.maxCharsPerFile)}
\`\`\`
Write real ${stack} for \`${task.filePath}\` only. No plans inside the file.`;

  const fileBody = currentFileContent?.trim()
    ? capFileBody(currentFileContent, caps.maxCharsPerFile)
    : '(new file — create it from scratch)';

  const depKeys = new Set((task.dependsOn || []).map(normPathKey));
  let siblingBlock: string;
  if (opts.siblingFiles?.length) {
    const lines = opts.siblingFiles.map(s => {
      const exp = s.exports?.length ? ` — exports: ${s.exports.join(', ')}` : '';
      return `- ${s.path}${exp}`;
    });
    const inlineCap = Math.min(1500, Math.floor(caps.maxCharsPerFile / 2));
    let budget = Math.min(caps.maxTotalChars, inlineCap * 2);
    const inlined: string[] = [];
    for (const s of opts.siblingFiles) {
      if (!depKeys.has(normPathKey(s.path)) || !s.content || budget <= 0) continue;
      const body = capFileBody(s.content, Math.min(inlineCap, budget));
      inlined.push(`#### ${s.path}\n\`\`\`\n${body}\n\`\`\``);
      budget -= body.length;
    }
    siblingBlock = [`### SIBLINGS (path + exports)`, lines.join('\n'), inlined.length ? `### DIRECT DEPENDENCIES\n${inlined.join('\n\n')}` : '']
      .filter(Boolean)
      .join('\n');
  } else {
    siblingBlock = `### SIBLINGS\n${capFileBody(siblingSummary || '(none)', Math.min(2000, caps.maxTotalChars))}`;
  }

  const depNote = task.dependsOn?.length
    ? `Prerequisites already on disk: ${task.dependsOn.join(', ')}.`
    : '';

  return `Implement ONLY \`${task.filePath}\` (stack: ${stack}).
${depNote}
${contractBlock}

### CURRENT FILE
${fileBody}

${siblingBlock}

### BRIEF
${clipText(userPrompt, 500)}

### TASK
${task.instructions}

Emit one <edit_file path="${task.filePath}"> hunk if the current file is shown, otherwise one <write_file path="${task.filePath}">. This path only.`;
}

export function buildRepairWorkerPrompt(opts: {
  task: SwarmTask;
  contractFile: string;
  contractCode: string;
  currentFileContent: string;
  tscErrors: string;
  /** Accepted for compatibility. Omitted so the repair packet stays on the error window. */
  devHostSection?: string | null;
  tier?: ModelFitTier;
}): string {
  const tier = opts.tier ?? 'tight';
  const errors = capDiagnosticLines(opts.tscErrors, 40);
  const windows = sliceErrorWindows(opts.currentFileContent, opts.tscErrors, 40);
  const exports = extractContractExports(opts.contractCode);
  const preferEdit = tier === 'tight';
  const how = preferEdit
    ? `Use <edit_file path="${opts.task.filePath}"> SEARCH/REPLACE hunks on the windows below. Do not rewrite the whole file.`
    : `Prefer <edit_file path="${opts.task.filePath}"> hunks. Use <write_file path="${opts.task.filePath}"> only when a hunk cannot fix the window.`;
  return `Repair ONLY \`${opts.task.filePath}\`.

### CONTRACT EXPORTS (\`${opts.contractFile}\`)
${exports}

### YOUR EXPORTS
${opts.task.requiredExports.map(e => `- ${e}`).join('\n') || '(see windows)'}

### ERRORS (≤40)
${errors}

### WINDOWS (±40 lines)
${windows}

${how}`;
}

function nodeTokPerSec(n: EndpointNode, model: string): number {
  const bm = n.benchmarks?.[model];
  if (bm?.evalTokPerSec) return Math.max(bm.evalTokPerSec, 5);
  if (isFrontierNode(n)) return 80;
  return Math.max(Math.round((n.hardware?.gpuBandwidthGBs || 300) / 6), 5);
}

function preferredToNodeRole(preferred: SwarmPreferredRole): NodeRole {
  if (preferred === '@docs') return 'docs';
  if (preferred === '@reviewer') return 'reviewer';
  return 'coder';
}

/** Hard eligibility: Auto or allow-list includes the swarm preferred role. */
function nodeAllowsPreferred(n: EndpointNode, preferred: SwarmPreferredRole): boolean {
  // Planner/Reviewer/Docs-only nodes must not receive @coder file jobs.
  return nodeAllowsRole(n, preferredToNodeRole(preferred));
}

/**
 * Lead Architect (Pass-1):
 * - When `preferCloudStrategist` is enabled and a Frontier/Cloud node is online with an enabled model,
 *   routes Pass-1 decomposition to the Cloud Strategist (~500 tokens) so it can decompose the manifest
 *   and assign each file to the ideal local GPU in the cluster.
 * - Otherwise picks the largest local model that fits and may plan (or Frontier as fallback when all local planners are offline).
 * When `usedCloudStrategist` is set, pass `{ cloudStrategist: true }` to `buildLeadArchitectPrompt`
 * (or call `buildCloudStrategistPrompt`) so Pass-1 stays on the short strategist packet.
 */
export function findLeadArchitect(
  nodes: EndpointNode[],
  opts?: { preferCloudStrategist?: boolean }
): { node: EndpointNode; model: string; tokPerSec: number; usedFrontierBackup?: boolean; usedCloudStrategist?: boolean } | null {
  if (opts?.preferCloudStrategist) {
    const cloudNodes = nodes.filter(
      n => n.online && isFrontierNode(n) && getEnabledModelsForNode(n).length > 0 && nodeAllowsRole(n, 'planner')
    );
    if (cloudNodes.length > 0) {
      const strategist = cloudNodes.find(n => n.specialty === 'strategist') || cloudNodes[0];
      const enabled = getEnabledModelsForNode(strategist);
      const model = strategist.activeModel && enabled.includes(strategist.activeModel)
        ? strategist.activeModel
        : enabled[0];
      return {
        node: strategist,
        model,
        tokPerSec: nodeTokPerSec(strategist, model),
        usedCloudStrategist: true
      };
    }
  }

  const picked = pickCapableReviewTarget(nodes, 'planner');
  if (!picked) return null;
  const explicitPlanners = nodes.filter(
    n => n.online && nodeHasExplicitRole(n, 'planner') && !isFrontierNode(n)
  );
  return {
    node: picked.node,
    model: picked.model,
    tokPerSec: nodeTokPerSec(picked.node, picked.model),
    usedFrontierBackup: explicitPlanners.length === 0 && isFrontierNode(picked.node)
  };
}

/**
 * Assign Pass-2 tasks across online GPUs with wave-aware multi-GPU load balancing.
 * - Honors `task.targetNodeId` / `task.targetModel` from the Cloud Strategist / Lead Architect when valid.
 * - Matches `node.specialty` (`architect`/`heavy_coder` -> high, `module_coder` -> medium, `scout` -> low).
 * - Balances concurrent assignments across distinct GPU endpoints so a 3-node cluster (e.g. 5070 Ti + 1080 Ti + 3060)
 *   executes wave files in parallel across all 3 GPUs instead of stacking everything onto one card.
 */
export function assignSwarmTasksToCluster(
  tasks: SwarmTask[],
  nodes: EndpointNode[]
): SwarmAssignment[] {
  const online = nodes.filter(n => n.online && getEnabledModelsForNode(n).length > 0);
  const local = online.filter(n => !isFrontierNode(n));
  const frontier = online.filter(isFrontierNode);
  const usedFrontierBackup = local.length === 0 && frontier.length > 0;
  const activeNodes = local.length > 0 ? local : frontier;

  const sortedTasks = [...tasks].sort(
    (a, b) => COMPLEXITY_WEIGHT[b.complexity] - COMPLEXITY_WEIGHT[a.complexity]
  );

  if (!activeNodes.length) {
    const any = nodes.filter(n => getEnabledModelsForNode(n).length > 0);
    const pool = any.length ? any : nodes;
    if (!pool.length) return [];
    return sortedTasks.map((task, idx) => {
      const node = pool[idx % pool.length];
      return {
        task,
        node,
        model: pickBestModelForComplexity(node, toConductorComplexity(task.complexity)),
        skippedReason: node.online ? undefined : 'Node offline — assignment may fail',
        usedFrontierBackup: isFrontierNode(node)
      };
    });
  }

  // Track how many tasks in this wave have been assigned to each physical GPU URL
  const waveLoadByGpu = new Map<string, number>();

  return sortedTasks.map(task => {
    const eligible = activeNodes.filter(n => nodeAllowsPreferred(n, task.preferredRole));
    // Never fall back to Planner/Reviewer-only GPUs for @coder work.
    const candidates =
      eligible.length > 0
        ? eligible
        : activeNodes.filter(n => nodeAllowsRole(n, preferredToNodeRole(task.preferredRole)));
    const weight = toConductorComplexity(task.complexity);
    if (!candidates.length) {
      return {
        task,
        node: activeNodes[0],
        model: pickBestModelForComplexity(activeNodes[0], weight),
        usedFrontierBackup,
        skippedReason: `No node allows role ${task.preferredRole} — check Allowed Roles`
      };
    }

    // 1. Check if Cloud Strategist / Lead Architect explicitly targeted a node that is eligible & idle
    let chosenNode: EndpointNode | null = null;
    let chosenModel: string | null = null;

    if (task.targetNodeId) {
      const targetMatch = candidates.find(
        n => n.id.toLowerCase() === task.targetNodeId!.toLowerCase() ||
             n.name.toLowerCase() === task.targetNodeId!.toLowerCase()
      );
      if (targetMatch) {
        const targetLoad = waveLoadByGpu.get(endpointQueueKey(targetMatch)) || 0;
        const hasIdleAlternative = candidates.some(
          c => (waveLoadByGpu.get(endpointQueueKey(c)) || 0) === 0
        );
        // Honor targetNodeId unless it's already busy in this wave AND another eligible GPU is completely idle
        if (targetLoad === 0 || !hasIdleAlternative) {
          chosenNode = targetMatch;
          const enabled = getEnabledModelsForNode(targetMatch);
          if (task.targetModel && enabled.includes(task.targetModel)) {
            chosenModel = task.targetModel;
          } else if (targetMatch.activeModel && enabled.includes(targetMatch.activeModel)) {
            chosenModel = targetMatch.activeModel;
          } else {
            chosenModel = pickBestModelForComplexity(targetMatch, weight);
          }
        }
      }
    }

    // 2. Otherwise prefer idle GPUs in this wave, breaking ties with specialty match + rankModelsForWeight
    if (!chosenNode) {
      const idleCandidates = candidates.filter(
        c => (waveLoadByGpu.get(endpointQueueKey(c)) || 0) === 0
      );
      const poolToRank = idleCandidates.length > 0 ? idleCandidates : candidates;

      // Filter to specialty match within the idle pool if available
      const specialtyMatches = poolToRank.filter(c => {
        if (weight === 'heavy') return c.specialty === 'architect' || c.specialty === 'heavy_coder';
        if (weight === 'medium') return c.specialty === 'module_coder' || c.specialty === 'heavy_coder';
        if (weight === 'light') return c.specialty === 'scout' || c.specialty === 'module_coder';
        return false;
      });

      const finalPool = specialtyMatches.length > 0 ? specialtyMatches : poolToRank;
      const picked = rankModelsForWeight(finalPool, weight);
      chosenNode = picked?.node || finalPool[0];
      const enabled = getEnabledModelsForNode(chosenNode);
      // Prefer pinned activeModel if enabled so the GPU never swaps weights mid-wave
      chosenModel = (chosenNode.activeModel && enabled.includes(chosenNode.activeModel))
        ? chosenNode.activeModel
        : (picked?.model || pickBestModelForComplexity(chosenNode, weight));
    }

    const gpuKey = endpointQueueKey(chosenNode);
    waveLoadByGpu.set(gpuKey, (waveLoadByGpu.get(gpuKey) || 0) + 1);

    return {
      task,
      node: chosenNode,
      model: chosenModel || pickBestModelForComplexity(chosenNode, weight),
      usedFrontierBackup,
      skippedReason: usedFrontierBackup
        ? 'Frontier backup — no local Ollama nodes online'
        : undefined
    };
  });
}

/** Group tsc stderr lines by relative file path (best-effort). */
export function groupTscErrorsByFile(
  tscOutput: string,
  workspaceRoot: string
): Map<string, string> {
  const map = new Map<string, string>();
  const rootNorm = workspaceRoot.replace(/[\\/]+$/, '').toLowerCase();
  const lines = tscOutput.split(/\r?\n/);
  let currentFile = '';

  for (const line of lines) {
    const m = line.match(/^(.+?)\((\d+),(\d+)\):\s+(error TS\d+:.+)$/i)
      || line.match(/^(.+?):(\d+):(\d+)\s+-\s+(error TS\d+:.+)$/i);
    if (m) {
      let file = m[1].trim().replace(/\\/g, '/');
      const absLower = file.toLowerCase();
      if (absLower.startsWith(rootNorm.replace(/\\/g, '/'))) {
        file = file.slice(workspaceRoot.length).replace(/^[\\/]+/, '');
      }
      // Also handle paths already relative
      file = file.replace(/\\/g, '/');
      currentFile = file;
      const prev = map.get(currentFile) || '';
      map.set(currentFile, prev ? `${prev}\n${line}` : line);
    } else if (currentFile && line.trim()) {
      map.set(currentFile, `${map.get(currentFile)}\n${line}`);
    }
  }
  return map;
}

export function isTypeScriptContractPath(filePath: string): boolean {
  return /\.tsx?$/i.test(filePath);
}
