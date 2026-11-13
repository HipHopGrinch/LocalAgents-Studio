import type { DeliveryTarget } from '../types';
import type { DeliveryStack } from './deliveryIntent';
import { ownedTailTwin, parallelModulePath } from './workspacePaths';

/** Durable project memory — survives New Chat and compaction. */
export interface ProjectBrain {
  version: 1;
  brief: string;
  delivery?: DeliveryTarget;
  stack?: DeliveryStack;
  contractFile?: string;
  /** When true, Swarm must extend the on-disk contract instead of replacing it. */
  contractLocked: boolean;
  ownedFiles: string[];
  verifyCommand?: string;
  lastVerifyOk?: boolean;
  lastVerifyNote?: string;
  /** Last Electron pack result (installer path, or why no .exe was produced). */
  lastDistNote?: string;
  lastTerminal?: { command: string; output: string; at: number };
  /** Snapshot of plan steps so a new thread still sees the todo. */
  todo: Array<{ id: string; title: string; status: string }>;
  updatedAt: number;
}

export function emptyProjectBrain(): ProjectBrain {
  return {
    version: 1,
    brief: '',
    contractLocked: false,
    ownedFiles: [],
    todo: [],
    updatedAt: Date.now()
  };
}

/** True when the brain holds nothing worth keeping (a fresh folder, or one just reset). */
export function isBlankProjectBrain(brain: ProjectBrain): boolean {
  return (
    !brain.brief &&
    !brain.delivery &&
    !brain.stack &&
    !brain.contractFile &&
    !brain.contractLocked &&
    !brain.verifyCommand &&
    !brain.lastVerifyNote &&
    !brain.lastDistNote &&
    !brain.lastTerminal &&
    brain.ownedFiles.length === 0 &&
    brain.todo.length === 0
  );
}

/**
 * The brain file is gone from disk but memory still holds a brain: the folder was deleted and
 * recreated (or swapped) under the same path, so that memory belongs to the old folder.
 */
export function brainIsStaleForFolder(brainFileExists: boolean, brain: ProjectBrain): boolean {
  return !brainFileExists && !isBlankProjectBrain(brain);
}

/** Identity of one opened folder: the same path string opened again is a new key. */
export function brainWorkspaceKey(workspacePath: string, epoch: number): string {
  return `${(workspacePath || '').replace(/[\\/]+$/, '').toLowerCase()}#${epoch}`;
}

export type BrainWriteDecision = 'write' | 'memory-only' | 'drop';

/**
 * Where a brain commit may go.
 * - `drop`: the commit came from a closure for a folder that is no longer open.
 * - `memory-only`: this folder is open, but its brain has not been loaded/initialised yet.
 * - `write`: the in-memory brain belongs to this folder and may be saved under it.
 */
export function brainWriteDecision(
  callerKey: string,
  openKey: string,
  loadedKey: string
): BrainWriteDecision {
  if (callerKey !== openKey) return 'drop';
  if (loadedKey !== openKey) return 'memory-only';
  return 'write';
}

export function projectBrainPath(root: string): string {
  const sep = root.includes('\\') ? '\\' : '/';
  return `${root.replace(/[\\/]+$/, '')}${sep}.localagents${sep}project.json`;
}

export function rulesCandidatePaths(root: string): string[] {
  const sep = root.includes('\\') ? '\\' : '/';
  const base = root.replace(/[\\/]+$/, '');
  return [
    `${base}${sep}AGENTS.md`,
    `${base}${sep}.localagents${sep}rules.md`,
    `${base}${sep}AGENTS.txt`
  ];
}

export function rulesDir(root: string): string {
  const sep = root.includes('\\') ? '\\' : '/';
  return `${root.replace(/[\\/]+$/, '')}${sep}.localagents${sep}rules`;
}

export function parseProjectBrain(raw: string): ProjectBrain | null {
  try {
    const data = JSON.parse(raw) as Partial<ProjectBrain>;
    if (!data || typeof data !== 'object') return null;
    return {
      ...emptyProjectBrain(),
      ...data,
      version: 1,
      brief: String(data.brief || ''),
      contractLocked: !!data.contractLocked,
      ownedFiles: Array.isArray(data.ownedFiles) ? data.ownedFiles.map(String).slice(0, 80) : [],
      todo: Array.isArray(data.todo)
        ? data.todo
            .filter(t => t && t.title)
            .slice(0, 40)
            .map(t => ({
              id: String(t.id || ''),
              title: String(t.title),
              status: String(t.status || 'pending')
            }))
        : [],
      lastDistNote:
        typeof data.lastDistNote === 'string' && data.lastDistNote.trim()
          ? data.lastDistNote.slice(0, 800)
          : undefined
    };
  } catch {
    return null;
  }
}

export function rememberOwnedFile(brain: ProjectBrain, relPath: string): ProjectBrain {
  const rel = (relPath || '').replace(/\\/g, '/').replace(/^\.?\//, '').trim();
  if (!rel || rel.includes('..')) return brain;
  if (brain.ownedFiles.some(p => p.toLowerCase() === rel.toLowerCase())) return brain;
  return {
    ...brain,
    ownedFiles: [...brain.ownedFiles, rel].slice(-60),
    updatedAt: Date.now()
  };
}

/** Export names in a TS contract (`export interface Foo`, `export type Bar`). */
export function exportedTypeNames(code: string): string[] {
  const names = new Set<string>();
  const re = /export\s+(?:type|interface|class|enum)\s+(\w+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code || '')) !== null) names.add(m[1]);
  return [...names];
}

/**
 * Keep the on-disk contract when an incoming Swarm rewrite would drop
 * domain types (the Checkers collapse: GameState → BuildStatus only).
 */
export function shouldPreserveContract(existing: string, incoming: string): boolean {
  const oldBody = (existing || '').trim();
  const nextBody = (incoming || '').trim();
  if (!oldBody || !nextBody) return false;
  if (oldBody === nextBody) return false;
  const oldNames = exportedTypeNames(oldBody);
  const newNames = exportedTypeNames(nextBody);
  if (oldNames.length >= 3 && newNames.length <= Math.max(1, Math.floor(oldNames.length / 2))) {
    return true;
  }
  const lost = oldNames.filter(n => !newNames.includes(n));
  return oldNames.length >= 3 && lost.length >= 2;
}

/**
 * If a worker invents a parallel file for a module we already own
 * (`Board.tsx` vs `CheckersBoard.tsx`), return the existing path.
 * The path-identity rules live in `workspacePaths`.
 */
export function preferredExistingPath(owned: string[], candidate: string): string | null {
  return parallelModulePath(owned, candidate);
}

/** Block a second entrypoint (`src/app.ts` beside `src/App.tsx`) or a dir-suffix twin (`game/types.ts`). */
export function shadowOwnedPath(owned: string[], candidate: string): string | null {
  const rel = (candidate || '').replace(/\\/g, '/').replace(/^\.?\//, '');
  const lower = rel.toLowerCase();
  const has = (p: string) => owned.some(o => o.replace(/\\/g, '/').toLowerCase() === p);
  if ((lower === 'src/app.ts' || lower === 'app.ts') && has('src/app.tsx')) return 'src/App.tsx';
  if (lower === 'src/ui.ts' || lower === 'ui.ts') {
    const overlay = owned.find(o => /uioverlay\.tsx$/i.test(o.replace(/\\/g, '/')));
    if (overlay) return overlay.replace(/\\/g, '/');
  }
  // Root project files legitimately repeat in subfolders; an exact match is the same file.
  const tail = ownedTailTwin(owned, rel);
  if (tail) return tail;
  return preferredExistingPath(owned, rel);
}
export function formatProjectBrainForPrompt(
  brain: ProjectBrain,
  rules?: string,
  maxRules = 6000
): string {
  const lines: string[] = ['## Project brain (durable — survives new chats)'];
  if (brain.brief) lines.push(`Original brief: ${brain.brief}`);
  if (brain.delivery) lines.push(`Locked delivery: ${brain.delivery}`);
  if (brain.stack) lines.push(`Stack: ${brain.stack}`);
  if (brain.contractFile) {
    lines.push(
      `Shared contract: \`${brain.contractFile}\`${brain.contractLocked ? ' (LOCKED — extend, do not replace or shrink)' : ''}`
    );
  }
  if (brain.ownedFiles.length) {
    lines.push(
      `Owned files (edit these; do not create a parallel copy):\n${brain.ownedFiles
        .slice(0, 40)
        .map(p => `- ${p}`)
        .join('\n')}`
    );
  }
  if (brain.todo.length) {
    lines.push(
      `Project todo:\n${brain.todo
        .map(t => `- [${t.status}] ${t.id ? `#${t.id} ` : ''}${t.title}`)
        .join('\n')}`
    );
  }
  if (brain.lastVerifyNote) {
    lines.push(
      `Last verify: ${brain.lastVerifyOk ? 'passed' : 'FAILED'} — ${brain.lastVerifyNote.slice(0, 500)}`
    );
  }
  if (brain.lastDistNote) {
    lines.push(`Electron dist: ${brain.lastDistNote.slice(0, 500)}`);
  }
  if (rules?.trim()) {
    lines.push(`## Project rules\n${rules.trim().slice(0, Math.max(500, maxRules))}`);
  }
  if (lines.length === 1) return '';
  return lines.join('\n');
}

/** @path tokens in the composer (Cursor-style file pins). */
export function extractAtMentions(text: string): string[] {
  const out: string[] = [];
  const re = /@([A-Za-z0-9_./\\-]+\.[A-Za-z0-9]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text || '')) !== null) {
    const rel = m[1].replace(/\\/g, '/');
    if (!out.includes(rel)) out.push(rel);
  }
  return out.slice(0, 8);
}
