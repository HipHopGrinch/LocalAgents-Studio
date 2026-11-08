import type { DeliveryTarget } from '../types';
import type { DeliveryStack } from './deliveryIntent';

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
        : []
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

function stemOf(path: string): string {
  const base = path.replace(/\\/g, '/').split('/').pop() || path;
  return base
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
    .replace(/^(checkers|game|app)/, '')
    .replace(/[^a-z0-9]/g, '');
}

/**
 * If a worker invents a parallel file for a module we already own
 * (`Board.tsx` vs `CheckersBoard.tsx`), return the existing path.
 */
/** Block a second entrypoint (`src/app.ts` beside `src/App.tsx`). */
export function shadowOwnedPath(owned: string[], candidate: string): string | null {
  const rel = (candidate || '').replace(/\\/g, '/').replace(/^\.?\//, '');
  const lower = rel.toLowerCase();
  const has = (p: string) => owned.some(o => o.replace(/\\/g, '/').toLowerCase() === p);
  if ((lower === 'src/app.ts' || lower === 'app.ts') && has('src/app.tsx')) return 'src/App.tsx';
  if (lower === 'src/ui.ts' || lower === 'ui.ts') {
    const overlay = owned.find(o => /uioverlay\.tsx$/i.test(o.replace(/\\/g, '/')));
    if (overlay) return overlay.replace(/\\/g, '/');
  }
  return preferredExistingPath(owned, rel);
}

const GENERIC_STEMS = new Set([
  'index',
  'main',
  'mod',
  'types',
  'test',
  'tests',
  'util',
  'utils',
  'config',
  'common',
  'contract',
  'app'
]);

export function preferredExistingPath(owned: string[], candidate: string): string | null {
  const rel = (candidate || '').replace(/\\/g, '/');
  if (!rel) return null;
  const cStem = stemOf(rel);
  if (cStem.length < 4 || GENERIC_STEMS.has(cStem)) return null;
  const isHtml = (p: string) => /\.html?$/i.test(p);
  const candIsHtml = isHtml(rel);
  for (const o of owned) {
    const ownedRel = o.replace(/\\/g, '/');
    if (ownedRel.toLowerCase() === rel.toLowerCase()) return null;
    if (candIsHtml !== isHtml(ownedRel)) continue;
    const oStem = stemOf(ownedRel);
    if (oStem.length >= 4 && !GENERIC_STEMS.has(oStem) && oStem === cStem) return ownedRel;
  }
  return null;
}

export function formatProjectBrainForPrompt(brain: ProjectBrain, rules?: string): string {
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
  if (rules?.trim()) {
    lines.push(`## Project rules\n${rules.trim().slice(0, 4000)}`);
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
