import {
  PlannerPlan,
  PlannerPlanStatus,
  PlannerStep,
  PlannerStepStatus,
  PlannerTask,
  PlanBlockerKind,
  ExecutionTaskStatus,
  ExecutionQueue,
  DeliveryTarget
} from '../types';
import {
  createPathResolver,
  normalizePathText,
  pathKey,
  scanTextForFilePaths
} from './workspacePaths';

export function plannerPlanPath(root: string, conversationId: string): string {
  const sep = root.includes('\\') ? '\\' : '/';
  const safe = conversationId.replace(/[^\w.-]/g, '_');
  return `${root.replace(/[\\/]+$/, '')}${sep}.localagents${sep}plans${sep}${safe}.json`;
}

function touch(plan: PlannerPlan, patch: Partial<PlannerPlan> = {}): PlannerPlan {
  return { ...plan, ...patch, updatedAt: Date.now() };
}

function newStepUid(): string {
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function taskLetter(index: number): string {
  let n = index;
  let out = '';
  do {
    out = String.fromCharCode(97 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

/**
 * Assign display ids 1..N in array order. Preserves step.uid for identity;
 * remaps activeStepId and task ids to match the new display numbers.
 */
export function renumberPlannerSteps(plan: PlannerPlan): PlannerPlan {
  if (!plan.steps.length) return plan;

  const activeBefore = plan.steps.find(s => String(s.id) === String(plan.activeStepId));
  const activeUid = activeBefore?.uid || (activeBefore ? String(activeBefore.id) : null);
  const activeIndex = activeBefore
    ? plan.steps.findIndex(s => String(s.id) === String(plan.activeStepId))
    : -1;

  const steps: PlannerStep[] = plan.steps.map((s, i) => {
    const uid = s.uid || String(s.id) || newStepUid();
    const displayId = String(i + 1);
    const tasks = s.tasks.map((t, ti) => ({
      ...t,
      id: `${displayId}${taskLetter(ti)}`
    }));
    return { ...s, uid, id: displayId, tasks };
  });

  let activeStepId: string | null = null;
  if (activeUid) {
    const match = steps.find(s => String(s.uid) === String(activeUid));
    activeStepId = match?.id ?? (activeIndex >= 0 ? steps[activeIndex]?.id ?? null : null);
  } else if (activeIndex >= 0) {
    activeStepId = steps[activeIndex]?.id ?? null;
  }

  return touch(plan, { steps, activeStepId });
}

export function getActiveStep(plan: PlannerPlan | null | undefined): PlannerStep | undefined {
  if (!plan?.activeStepId) return undefined;
  return plan.steps.find(s => s.id === plan.activeStepId);
}

export function isPlanActive(plan: PlannerPlan | null | undefined): boolean {
  return plan?.status === 'active' && !!plan.steps.length;
}

export function stepTasksComplete(step: PlannerStep): boolean {
  if (!step.tasks.length) return false;
  return step.tasks.every(t => t.status === 'completed');
}

/** Pending work only. Failed and abandoned steps are debt until `retryFailedStep`. */
export function pickNextPendingStep(plan: PlannerPlan): PlannerStep | undefined {
  return plan.steps.find(s => s.status === 'pending');
}

/** Activate the next pending step. An in-progress step stays put; failed debt does not. */
export function activateNextStep(plan: PlannerPlan): PlannerPlan {
  const current = getActiveStep(plan);
  if (current && current.status === 'in_progress') return plan;
  const next = pickNextPendingStep(plan);
  if (!next) {
    return touch(plan, {
      status: planHasDebt(plan) ? 'active' : 'completed',
      activeStepId: null
    });
  }
  return touch(plan, {
    status: 'active',
    activeStepId: next.id,
    steps: plan.steps.map(s =>
      s.id === next.id
        ? {
            ...s,
            status: 'in_progress' as PlannerStepStatus,
            tasks: s.tasks.map(t => ({
              ...t,
              status: (t.status === 'completed' ? 'completed' : 'pending') as ExecutionTaskStatus
            }))
          }
        : s
    )
  });
}

/**
 * Heal budget spent: keep the step failed with the compiler note, remember that
 * its heal budget is exhausted, clear the plan-stopping block, and activate the
 * next pending step so later work still runs.
 * `healExhausted` keeps Play from healing this same step again until Retry. The next step
 * starts with a fresh heal budget; with no next step `healAttempts` stays put.
 */
export function continuePastFailedStep(
  plan: PlannerPlan,
  stepId: string,
  note: string
): PlannerPlan {
  const steps = plan.steps.map(s =>
    String(s.id) === String(stepId)
      ? {
          ...s,
          status: 'failed' as PlannerStepStatus,
          reviewNote: note.slice(0, 1200),
          healExhausted: true
        }
      : s
  );
  const next = steps.find(
    s => String(s.id) !== String(stepId) && (s.status === 'pending' || s.status === 'in_progress')
  );
  if (!next) {
    return touch(plan, {
      steps,
      status: 'active',
      activeStepId: null,
      blockedReason: undefined,
      resumePhase: 'coder'
    });
  }
  return touch(plan, {
    steps: steps.map(s =>
      s.id === next.id ? { ...s, status: 'in_progress' as PlannerStepStatus } : s
    ),
    status: 'active',
    activeStepId: next.id,
    blockedReason: undefined,
    resumePhase: 'coder',
    healAttempts: 0
  });
}

/**
 * Step Play/Heal may run. An exhausted failed step is skipped until Retry clears it.
 * An in-progress active step still wins. Failed debt is only chosen when it can still be healed.
 */
export function pickHealStep(plan: PlannerPlan): PlannerStep | undefined {
  const active = getActiveStep(plan);
  if (active && !active.healExhausted) return active;
  return (
    plan.steps.find(s => s.status === 'failed' && !s.healExhausted) ||
    plan.steps.find(s => s.status === 'in_progress')
  );
}

export function markStepInProgress(plan: PlannerPlan, stepId: string): PlannerPlan {
  return touch(plan, {
    status: 'active',
    activeStepId: stepId,
    steps: plan.steps.map(s =>
      s.id === stepId
        ? {
            ...s,
            status: 'in_progress' as PlannerStepStatus,
            tasks: s.tasks.map(t =>
              t.status === 'completed'
                ? t
                : { ...t, status: 'in_progress' as ExecutionTaskStatus, failureNote: undefined }
            )
          }
        : s
    )
  });
}

export function markStepTaskStatus(
  plan: PlannerPlan,
  stepId: string,
  taskId: string,
  status: ExecutionTaskStatus,
  failureNote?: string
): PlannerPlan {
  return touch(plan, {
    steps: plan.steps.map(s => {
      if (s.id !== stepId) return s;
      return {
        ...s,
        tasks: s.tasks.map(t =>
          t.id === taskId
            ? {
                ...t,
                status,
                ...(status === 'failed' && failureNote ? { failureNote } : {}),
                ...(status === 'completed' ? { failureNote: undefined } : {})
              }
            : t
        )
      };
    })
  });
}

export function markAllStepTasks(
  plan: PlannerPlan,
  stepId: string,
  status: ExecutionTaskStatus
): PlannerPlan {
  return touch(plan, {
    steps: plan.steps.map(s => {
      if (s.id !== stepId) return s;
      return {
        ...s,
        tasks: s.tasks.map(t => ({
          ...t,
          status,
          ...(status === 'completed' ? { failureNote: undefined } : {})
        }))
      };
    })
  });
}

export interface StepVerdict {
  stepId: string;
  result: 'yay' | 'nay';
  notes: string;
}

/** Auto Coder↔Reviewer reworks per step before Planner escalation. */
export const MAX_STEP_REWORKS = 2;
/** How many times a plan may grow via Nay escalation before we stop. */
export const MAX_PLAN_ESCALATIONS = 2;
/** Hard ceiling so a failing file cannot become a 100-step plan. */
export const MAX_PLAN_STEPS = 18;
/** Compiler-driven heal attempts after the escalation wall (no new steps). */
export const MAX_HEAL_ATTEMPTS = 3;

/**
 * Explicit repair pass only: a "Fix:" title, or verify/tsc/compiler wording.
 * A bare "fix" / "repair" / "rework" in a feature title is not a compiler heal.
 */
export function stepLooksLikeFixStep(title: string): boolean {
  const t = (title || '').trim();
  if (!t) return false;
  if (/^(?:fix\s*:\s*)+/i.test(t)) return true;
  if (/\b(?:tsc|typecheck|type-check)\b/i.test(t)) return true;
  if (/\berror\s*TS\d+\b/i.test(t)) return true;
  if (/\bverify\b/i.test(t) && /\b(?:fail(?:ed|ure)?|errors?|fix|repair|heal)\b/i.test(t)) return true;
  if (/\b(?:compiler|compile)\b/i.test(t) && /\b(?:errors?|fail(?:ed|ure)?|fix|repair|heal)\b/i.test(t)) {
    return true;
  }
  return false;
}

/** Record why a step is stuck. Green verify may advance `compiler` only. */
export function setStepBlockerKind(
  plan: PlannerPlan,
  stepId: string,
  kind: PlanBlockerKind | undefined
): PlannerPlan {
  const id = String(stepId);
  if (!plan.steps.some(s => String(s.id) === id)) return plan;
  return touch(plan, {
    blockerKind: kind,
    steps: plan.steps.map(s => (String(s.id) === id ? { ...s, blockerKind: kind } : s))
  });
}

/**
 * True only when this step is blocked by the compiler (or its note is a verify failure).
 * A reviewer Nay stays put on a clean `tsc`.
 */
export function canHealAdvanceOnGreenVerify(
  plan: PlannerPlan | null | undefined,
  stepId: string
): boolean {
  if (!plan || stepId === undefined || stepId === null || String(stepId) === '') return false;
  const step = plan.steps.find(s => String(s.id) === String(stepId));
  if (!step) return false;
  const kind =
    step.blockerKind ||
    (String(plan.activeStepId || '') === String(step.id) ? plan.blockerKind : undefined);
  if (kind === 'review') return false;
  if (kind === 'compiler') return true;
  return notesLookLikeVerifyFailure(step.reviewNote || '');
}

/** Reviewer/verify notes that are compile failures — prefer heal over new plan steps. */
export function notesLookLikeVerifyFailure(notes: string): boolean {
  return /verify failed|error TS\d+|could not compile|^error(\[|:)/im.test(notes || '');
}

export function normalizeStepTitle(title: string): string {
  return (title || '')
    .replace(/^(fix:\s*)+/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Apply Reviewer Yay/Nay to the active (or named) step. */
export function applyStepVerdict(plan: PlannerPlan, verdict: StepVerdict): PlannerPlan {
  const stepId = verdict.stepId || plan.activeStepId || '';
  const step = plan.steps.find(s => s.id === stepId) || getActiveStep(plan);
  if (!step) return plan;

  if (verdict.result === 'yay') {
    const withDone = touch(plan, {
      blockerKind: undefined,
      steps: plan.steps.map(s =>
        s.id === step.id
          ? {
              ...s,
              status: 'completed' as PlannerStepStatus,
              blockerKind: undefined,
              reviewNote: verdict.notes || undefined,
              reworkCount: 0,
              tasks: s.tasks.map(t => ({
                ...t,
                status: 'completed' as ExecutionTaskStatus,
                failureNote: undefined
              }))
            }
          : s
      ),
      activeStepId: null
    });
    return activateNextStep(withDone);
  }

  // Nay — reopen step with notes; tasks go back to pending/failed for rework.
  // Compiler-shaped notes are the only kind a later green verify may auto-advance.
  const kind: PlanBlockerKind = notesLookLikeVerifyFailure(verdict.notes) ? 'compiler' : 'review';
  const nextRework = (step.reworkCount || 0) + 1;
  return touch(plan, {
    status: 'active',
    activeStepId: step.id,
    blockerKind: kind,
    steps: plan.steps.map(s =>
      s.id === step.id
        ? {
            ...s,
            status: 'failed' as PlannerStepStatus,
            blockerKind: kind,
            reviewNote: verdict.notes || 'Reviewer requested fixes.',
            reworkCount: nextRework,
            tasks: s.tasks.map(t => ({
              ...t,
              status: 'failed' as ExecutionTaskStatus,
              failureNote: verdict.notes || 'Needs refining'
            }))
          }
        : s
    )
  });
}

export function abandonPlan(plan: PlannerPlan): PlannerPlan {
  return touch(plan, { status: 'abandoned', activeStepId: null });
}

export function formatPlanForPanel(plan: PlannerPlan): string {
  const lines = plan.steps.map(s => {
    const mark =
      s.status === 'completed'
        ? '[done]'
        : s.status === 'failed'
          ? '[nay]'
          : s.status === 'abandoned'
            ? '[abandoned]'
            : s.status === 'in_progress'
              ? '[active]'
              : '[ ]';
    const tasks = s.tasks
      .map(t => {
        const tm =
          t.status === 'completed' ? 'x' : t.status === 'failed' ? '!' : t.status === 'in_progress' ? '>' : ' ';
        return `    (${tm}) #${t.id} ${t.title}${t.file ? ` — ${t.file}` : ''}`;
      })
      .join('\n');
    return `${mark} Step ${s.id}: ${s.title}\n${tasks}${
      s.reviewNote ? `\n    note: ${s.reviewNote}` : ''
    }`;
  });
  return `Plan (${plan.status}): ${plan.summary}\n${lines.join('\n')}`;
}

const normalizeScannedPath = normalizePathText;

/**
 * Paths named on a step’s tasks (plus light scan of titles/descriptions).
 * `task.file` entries are trusted as written. Scanned paths are deduped case-insensitively,
 * and a scanned path that is a `/`-boundary suffix of any other captured path (`types.ts`,
 * `scene/constants.ts` vs `src/scene/constants.ts`) is dropped. When any task names a `file`, scanned
 * mentions are dependencies, not write targets (see `collectStepContextPaths`); only steps without
 * task files (text-only plans) write the files their text names.
 */
export function collectStepFilePaths(step: PlannerStep): string[] {
  const { writes } = classifyStepPaths(step);
  return writes;
}

/** Scanned dependency mentions of a step that are not its write targets (read-only context). */
export function collectStepContextPaths(step: PlannerStep): string[] {
  const { context } = classifyStepPaths(step);
  return context;
}

/**
 * Context mentions (`game/types.ts`) resolved to the workspace file they name (`src/game/types.ts`).
 * An exact match wins, then the shortest file whose path ends with `/` + the mention. Mentions with
 * no workspace file are skipped.
 */
export function resolveContextPaths(contextPaths: string[], workspaceFiles: string[]): string[] {
  const resolver = createPathResolver({ workspaceFiles, onAmbiguous: 'shortest' });
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of contextPaths) {
    const r = resolver.resolve(raw);
    if ((r.kind !== 'exact' && r.kind !== 'suffix') || !r.path) continue;
    const key = r.path.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r.path);
  }
  return out;
}

function classifyStepPaths(step: PlannerStep): { writes: string[]; context: string[] } {
  const entries: Array<{ path: string; trusted: boolean }> = [];
  const seen = new Set<string>();
  const push = (raw: string | undefined, trusted: boolean) => {
    const p = normalizeScannedPath(raw || '');
    if (!p) return;
    const key = p.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    entries.push({ path: p, trusted });
  };
  for (const t of step.tasks) {
    push(t.file, true);
    for (const p of scanTextForFilePaths(`${t.title}\n${t.description}`)) push(p, false);
  }
  for (const p of scanTextForFilePaths(`${step.title}\n${step.description || ''}`)) push(p, false);
  const isSuffixDuplicate = (e: { path: string }) => {
    const lower = e.path.toLowerCase();
    return entries.some(o => o !== e && o.path.length > e.path.length && o.path.toLowerCase().endsWith(`/${lower}`));
  };
  const kept = entries.filter(e => e.trusted || !isSuffixDuplicate(e));
  if (!step.tasks.some(t => normalizeScannedPath(t.file || ''))) return { writes: kept.map(e => e.path), context: [] };
  return {
    writes: kept.filter(e => e.trusted).map(e => e.path),
    context: kept.filter(e => !e.trusted).map(e => e.path)
  };
}

/**
 * One path identity for a plan. Planners name files by basename (`types.ts`), by a path missing its
 * leading folders (`scene/constants.ts`) or by the full path (`src/scene/constants.ts`), and a worker
 * then writes a stray copy. Every task `file` becomes the file it means, decided by
 * `workspacePaths` against the workspace files and every task file of the whole plan:
 * a `/`-boundary suffix of exactly one file, with plan files preferred over existing ones, and the
 * one a title/description names settling several. Folder-less names that match nothing stay: a new
 * `vite.config.ts` or `index.html` is a root file. File mentions inside task titles/descriptions
 * and the step description are rewritten the same way, so Coders and Reviewers read real paths. Two
 * unfinished tasks of one step that name one file merge into one (one worker per file).
 * `opts.stepId` limits which step is rewritten (the whole plan still supplies known files);
 * finished steps are never rewritten.
 */
export function resolveBareTaskFiles(
  plan: PlannerPlan,
  workspaceFiles: string[],
  opts?: { stepId?: string }
): {
  plan: PlannerPlan;
  renames: Array<{ from: string; to: string }>;
  ambiguous: string[];
  mentions: Array<{ from: string; to: string }>;
  merged: Array<{ file: string; tasks: number }>;
} {
  const renames: Array<{ from: string; to: string }> = [];
  const ambiguous: string[] = [];
  const mentions: Array<{ from: string; to: string }> = [];
  const merged: Array<{ file: string; tasks: number }> = [];
  const result = (next: PlannerPlan) => ({ plan: next, renames, ambiguous, mentions, merged });

  const eligible = (s: PlannerStep): boolean =>
    !(opts?.stepId !== undefined && String(s.id) !== String(opts.stepId)) &&
    s.status !== 'completed' &&
    s.status !== 'abandoned';
  if (!plan.steps.some(eligible)) return result(plan);

  const planPaths = (skipTaskId?: string): string => {
    const parts: string[] = [];
    for (const s of plan.steps) {
      for (const t of s.tasks) {
        if (t.id === skipTaskId) continue;
        parts.push(`${t.file && /[\\/]/.test(t.file) ? `\`${t.file}\`` : ''}\n${t.title}\n${t.description}`);
      }
    }
    return parts.join('\n');
  };

  const allTaskFiles = (p: PlannerPlan): string[] =>
    p.steps.flatMap(s => s.tasks.map(t => normalizePathText(t.file || ''))).filter(Boolean);

  // Pass 1: every unfinished task `file` becomes the file it means.
  const fileResolver = createPathResolver({ workspaceFiles, knownFiles: allTaskFiles(plan) });
  let changed = false;
  let steps = plan.steps.map(s => {
    if (!eligible(s)) return s;
    const tasks = s.tasks.map(t => {
      const norm = normalizePathText(t.file || '');
      if (!norm) return t;
      const r = fileResolver.resolve(t.file, {
        hintTexts: [`${t.title}\n${t.description}\n${s.title}\n${s.description || ''}`, () => planPaths(t.id)]
      });
      if (r.kind === 'ambiguous') {
        if (!ambiguous.includes(norm)) ambiguous.push(norm);
        return t;
      }
      if ((r.kind !== 'exact' && r.kind !== 'suffix') || !r.path || r.path === t.file) return t;
      if (r.path !== norm && !renames.some(x => x.from === norm && x.to === r.path)) {
        renames.push({ from: norm, to: r.path });
      }
      changed = true;
      return { ...t, file: r.path };
    });
    return tasks.some((t, i) => t !== s.tasks[i]) ? { ...s, tasks } : s;
  });

  // Pass 2: file mentions inside prose, against the plan's now-canonical task files.
  const renamedPlan = changed ? touch(plan, { steps }) : plan;
  const textResolver = createPathResolver({ workspaceFiles, knownFiles: allTaskFiles(renamedPlan) });
  const rewrite = (text: string | undefined): string | undefined => {
    if (!text) return text;
    const out = textResolver.rewriteText(text);
    for (const w of out.rewrites) {
      if (!mentions.some(x => x.from === w.from && x.to === w.to)) mentions.push(w);
    }
    return out.text;
  };
  steps = steps.map(s => {
    if (!eligible(s)) return s;
    const description = rewrite(s.description);
    const tasks = s.tasks.map(t => {
      if (t.status === 'completed') return t;
      const title = rewrite(t.title) ?? t.title;
      const desc = rewrite(t.description) ?? t.description;
      return title === t.title && desc === t.description ? t : { ...t, title, description: desc };
    });
    const tasksChanged = tasks.some((t, i) => t !== s.tasks[i]);
    if (!tasksChanged && description === s.description) return s;
    changed = true;
    return { ...s, ...(description !== s.description ? { description } : {}), tasks };
  });

  // Pass 3: one worker per file — unfinished tasks of one step naming one file merge.
  steps = steps.map(s => {
    if (!eligible(s)) return s;
    const groups = new Map<string, PlannerTask[]>();
    for (const t of s.tasks) {
      const key = t.status === 'completed' ? '' : pathKey(t.file);
      if (!key) continue;
      groups.set(key, [...(groups.get(key) || []), t]);
    }
    if (![...groups.values()].some(g => g.length > 1)) return s;
    const rank = (t: PlannerTask) => (t.status === 'failed' ? 2 : t.status === 'in_progress' ? 1 : 0);
    const mergedInto = new Map<PlannerTask, PlannerTask | null>();
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      const [first, ...rest] = group;
      const parts = [first.description, ...rest.map(o => (o.title && o.title !== first.title ? `${o.title}: ${o.description}` : o.description))]
        .map(p => (p || '').trim())
        .filter((p, i, all) => !!p && all.indexOf(p) === i);
      const top = group.reduce((a, b) => (rank(b) > rank(a) ? b : a));
      const note = group.find(g => g.failureNote)?.failureNote;
      mergedInto.set(first, {
        ...first,
        description: parts.join('\n\n'),
        status: top.status,
        ...(note ? { failureNote: note } : {})
      });
      for (const o of rest) mergedInto.set(o, null);
      merged.push({ file: first.file || '', tasks: group.length });
    }
    changed = true;
    const tasks = s.tasks.flatMap(t => (mergedInto.has(t) ? (mergedInto.get(t) ? [mergedInto.get(t)!] : []) : [t]));
    return { ...s, tasks };
  });

  return result(changed ? touch(plan, { steps }) : plan);
}

function escapeForRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Which of a step's files a failure is about, so a rework regenerates those and leaves the
 * rest alone. A file counts when its path or basename (case-insensitive), the module path of
 * an import, or its name as an identifier (`Piece3D`, `Piece3DProps`) appears in the tsc
 * errors, the Reviewer's Nay text or the missing-items list. Nothing matched → every step file.
 */
export function filesImplicatedByFailure(
  stepFiles: string[],
  evidence: { nayNote?: string; tscErrors?: string; reviewerMissing?: string[] }
): string[] {
  const files = (stepFiles || []).filter(Boolean);
  if (files.length < 2) return files;
  const hit = implicatedStepFiles(files, evidence);
  return hit.length ? hit : files;
}

/** Step files the failure evidence names. Empty when it names none of them. */
export function implicatedStepFiles(
  stepFiles: string[],
  evidence: { nayNote?: string; tscErrors?: string; reviewerMissing?: string[] }
): string[] {
  const files = (stepFiles || []).filter(Boolean);
  const text = [evidence?.nayNote, evidence?.tscErrors, ...(evidence?.reviewerMissing || [])]
    .filter((s): s is string => typeof s === 'string' && !!s.trim())
    .join('\n')
    .replace(/\\/g, '/');
  if (!text || !files.length) return [];
  const lower = text.toLowerCase();

  const modules: string[] = [];
  for (const m of text.matchAll(/["'`]([^"'`\s]*\/[^"'`\s]*)["'`]/g)) {
    modules.push(
      m[1]
        .replace(/^(\.{1,2}\/)+/, '')
        .replace(/\.(tsx?|jsx?|mjs|cjs|vue|svelte)$/i, '')
        .replace(/\/index$/i, '')
        .toLowerCase()
    );
  }
  const mentions = (needle: string) =>
    !!needle && new RegExp(`(?<![\\w-])${escapeForRegex(needle)}(?![\\w-])`).test(lower);

  const hit = files.filter(file => {
    const path = file.replace(/\\/g, '/').replace(/^\.\//, '');
    const base = path.split('/').pop() || path;
    if (mentions(path.toLowerCase()) || mentions(base.toLowerCase())) return true;
    const stem = base.includes('.') ? base.slice(0, base.lastIndexOf('.')) : base;
    const key = path.replace(/\.[a-z0-9]+$/i, '').replace(/\/index$/i, '').toLowerCase();
    if (modules.some(s => s && (key === s || key.endsWith(`/${s}`) || s.endsWith(`/${key}`)))) return true;
    return (
      stem.length >= 3 &&
      /[A-Z0-9]/.test(stem) &&
      new RegExp(`(?<![\\w$/])${escapeForRegex(stem)}(?:Props|Type|Options|State|Config)?(?![\\w$/])`).test(text)
    );
  });
  return hit;
}

/** File paths named in free text (Nay notes, briefs), deduped case-insensitively. */
export function filePathsInText(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of scanTextForFilePaths(text)) {
    const key = p.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

/**
 * Files a rework or heal must regenerate. The step files the failure names come first. Files
 * outside the step that the compiler errors (or the Nay) name are added, because re-running only
 * the step's own files cannot fix them and just reproduces the same bytes. Nothing named at
 * all → every step file.
 */
export function reworkTargetFiles(
  stepFiles: string[],
  evidence: { nayNote?: string; tscErrors?: string; reviewerMissing?: string[] },
  namedFiles: string[] = []
): string[] {
  const files = (stepFiles || []).filter(Boolean);
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
  const inStep = new Set(files.map(norm));
  const outside: string[] = [];
  const seen = new Set<string>();
  for (const raw of namedFiles || []) {
    const p = (raw || '').replace(/\\/g, '/').replace(/^\.\//, '').trim();
    const key = norm(p);
    if (!p || inStep.has(key) || seen.has(key) || p.includes('..') || /(^|\/)node_modules\//i.test(p)) continue;
    seen.add(key);
    outside.push(p);
  }
  const hit = implicatedStepFiles(files, evidence);
  if (hit.length) return [...hit, ...outside];
  if (outside.length) return outside;
  return files;
}

/** Prompt for Coders working the active step. */
export function formatStepForCoders(plan: PlannerPlan, step: PlannerStep): string {
  const tasks = step.tasks
    .filter(t => t.status !== 'completed')
    .map(t => {
      const where = t.file ? ` [\`${t.file}\`]` : '';
      const fail = t.failureNote ? `\n   Prior review: ${t.failureNote}` : '';
      return `- #${t.id}${where} ${t.title}: ${t.description}${fail}`;
    });
  const note = step.reviewNote
    ? `\n### Reviewer Nay notes (fix these)\n${step.reviewNote}\n`
    : '';
  return `## PLANNER STEP (implement now — this step only)

Plan: ${plan.summary}
Step #${step.id}: ${step.title}
${step.description ? `${step.description}\n` : ''}${note}
### Tasks
${tasks.join('\n') || '(no open tasks)'}

Implement every open task above. Use edit_file/write_file on the files listed only. Prefer edit_file when the current file body is provided below. The file body must be valid source (import/export/code) — never a review, plan, or <plan_options> essay. Do not start later plan steps. Do not create a parallel file (app.ts beside App.tsx, ui.ts beside UIOverlay).`;
}

/** Prompt for Reviewer verifying one step. */
export function formatStepForReviewer(plan: PlannerPlan, step: PlannerStep): string {
  const tasks = step.tasks
    .map(t => {
      const where = t.file ? ` (${t.file})` : '';
      return `- #${t.id}${where} ${t.title}: ${t.description}`;
    })
    .join('\n');
  return `## Durable plan (do NOT invent a new plan)
${formatPlanForPanel(plan)}

## Active step to verify (#${step.id})
Title: ${step.title}
${step.description ? `Description: ${step.description}\n` : ''}Tasks that were requested:
${tasks}

Verify ONLY this step against the files just written. End with:
<step_verdict step_id="${step.id}">
<result>yay</result>
<notes>why it passes (or what fails)</notes>
</step_verdict>
Use result nay only for a concrete missing/broken behavior (name the file and issue). Do NOT nay for "needs verification", vague fragility, or empty notes. Do NOT emit a new <execution_plan> or <review_plan>.`;
}

export function createPlanFromParsed(
  parsed: {
    summary: string;
    steps: Array<{
      id: string;
      title: string;
      description?: string;
      tasks: Array<{ id: string; title: string; description: string; file?: string }>;
    }>;
  },
  opts?: {
    conversationId?: string;
    chosenOptionId?: string;
    chosenOptionTitle?: string;
    delivery?: DeliveryTarget;
  }
): PlannerPlan {
  const steps: PlannerStep[] = parsed.steps.map(s => ({
    id: s.id,
    uid: newStepUid(),
    title: s.title,
    ...(s.description ? { description: s.description } : {}),
    status: 'pending' as PlannerStepStatus,
    tasks: s.tasks.map(t => ({
      id: t.id,
      title: t.title,
      description: t.description,
      ...(t.file ? { file: t.file } : {}),
      status: 'pending' as ExecutionTaskStatus
    }))
  }));
  const first = steps[0];
  const plan: PlannerPlan = {
    id: `plan-${Date.now()}`,
    summary: parsed.summary || 'Execution plan',
    status: 'active' as PlannerPlanStatus,
    steps,
    activeStepId: first?.id ?? null,
    updatedAt: Date.now(),
    ...(opts?.conversationId ? { conversationId: opts.conversationId } : {}),
    ...(opts?.chosenOptionId ? { chosenOptionId: opts.chosenOptionId } : {}),
    ...(opts?.chosenOptionTitle ? { chosenOptionTitle: opts.chosenOptionTitle } : {}),
    ...(opts?.delivery ? { delivery: opts.delivery } : {})
  };
  return renumberPlannerSteps(plan);
}

export type IncomingFixSteps = {
  summary?: string;
  steps: Array<{
    id: string;
    title: string;
    description?: string;
    tasks: Array<{ id: string; title: string; description: string; file?: string }>;
  }>;
};

/**
 * After Nay rework cap: mark the stuck step completed (superseded), insert Planner
 * fix steps immediately after it, and leave later pending steps untouched.
 */
export function insertFixStepsAfter(
  plan: PlannerPlan,
  afterStepId: string,
  incoming: IncomingFixSteps,
  opts?: { reworkNays?: number }
): PlannerPlan {
  const afterIdx = plan.steps.findIndex(s => String(s.id) === String(afterStepId));
  if (afterIdx < 0 || !incoming.steps.length) return plan;
  if ((plan.escalationCount || 0) >= MAX_PLAN_ESCALATIONS) return plan;
  if (plan.steps.length >= MAX_PLAN_STEPS) return plan;

  const existingTitles = new Set(plan.steps.map(s => normalizeStepTitle(s.title)));
  const fresh = incoming.steps
    .map(s => ({
      ...s,
      title: (s.title || 'Repair the failing files').replace(/^(fix:\s*)+/i, '').trim()
    }))
    .filter(s => {
      const key = normalizeStepTitle(s.title);
      return key.length > 0 && !existingTitles.has(key);
    })
    .slice(0, 1);
  if (!fresh.length) return plan;
  const stepsToAdd = fresh;

  const nays = opts?.reworkNays ?? plan.steps[afterIdx]?.reworkCount ?? 0;
  const priorNote = plan.steps[afterIdx]?.reviewNote;
  const escalateNote = [
    `Escalated to Planner fix steps after ${nays} Nays.`,
    priorNote ? `Last Nay: ${priorNote.slice(0, 400)}` : ''
  ]
    .filter(Boolean)
    .join(' ');

  // Temporary ids — renumberPlannerSteps assigns final 1..N display ids.
  const newSteps: PlannerStep[] = stepsToAdd.map((s, i) => {
    const uid = newStepUid();
    return {
      id: `fix-${uid}`,
      uid,
      title: s.title,
      ...(s.description ? { description: s.description } : {}),
      status: (i === 0 ? 'in_progress' : 'pending') as PlannerStepStatus,
      reworkCount: 0,
      tasks: s.tasks.map((t, ti) => ({
        id: `tmp-${ti}`,
        title: t.title,
        description: t.description,
        ...(t.file ? { file: t.file } : {}),
        status: 'pending' as ExecutionTaskStatus
      }))
    };
  });

  const steps: PlannerStep[] = [];
  for (let i = 0; i < plan.steps.length; i++) {
    const s = plan.steps[i];
    if (i === afterIdx) {
      steps.push({
        ...s,
        uid: s.uid || String(s.id) || newStepUid(),
        status: 'completed' as PlannerStepStatus,
        reviewNote: escalateNote,
        tasks: s.tasks.map(t => ({
          ...t,
          status: 'completed' as ExecutionTaskStatus,
          failureNote: undefined
        }))
      });
      steps.push(...newSteps);
    } else {
      steps.push({ ...s, uid: s.uid || String(s.id) || newStepUid() });
    }
  }

  const firstNewUid = newSteps[0]?.uid;
  const summary =
    incoming.summary && incoming.summary !== plan.summary
      ? `${plan.summary} · ${incoming.summary}`
      : plan.summary;

  const draft = touch(plan, {
    summary,
    status: 'active' as PlannerPlanStatus,
    steps,
    activeStepId: newSteps[0]?.id ?? null,
    resumePhase: 'coder',
    escalationCount: (plan.escalationCount || 0) + 1,
    blockedReason: undefined
  });

  const renumbered = renumberPlannerSteps(draft);
  if (firstNewUid) {
    const first = renumbered.steps.find(s => s.uid === firstNewUid);
    if (first) {
      return touch(renumbered, { activeStepId: first.id, resumePhase: 'coder' });
    }
  }
  return renumbered;
}

/**
 * Append a newly locked plan onto an existing conversation plan.
 * Unfinished prior steps become abandoned debt (not completed). Failed steps stay failed.
 * New steps get remapped ids and the first one becomes active.
 */
export function appendPlannerPlan(
  existing: PlannerPlan | null | undefined,
  incoming: PlannerPlan
): PlannerPlan {
  if (!existing?.steps?.length) return renumberPlannerSteps(incoming);

  const priorSteps: PlannerStep[] = existing.steps.map(s => ({
    ...s,
    uid: s.uid || String(s.id) || newStepUid(),
    status:
      s.status === 'in_progress' || s.status === 'pending'
        ? ('abandoned' as PlannerStepStatus)
        : s.status
  }));

  const newSteps: PlannerStep[] = incoming.steps.map((s, i) => {
    const uid = s.uid || newStepUid();
    return {
      ...s,
      id: `append-${uid}`,
      uid,
      status: (i === 0 ? 'in_progress' : 'pending') as PlannerStepStatus,
      tasks: s.tasks.map((t, ti) => ({
        ...t,
        id: `tmp-${ti}`,
        status: (i === 0 ? 'pending' : t.status) as ExecutionTaskStatus
      }))
    };
  });

  const firstNewUid = newSteps[0]?.uid;
  const summary =
    incoming.summary && incoming.summary !== existing.summary
      ? `${existing.summary} · ${incoming.summary}`
      : existing.summary || incoming.summary;

  const draft: PlannerPlan = {
    ...existing,
    id: incoming.id || existing.id,
    summary,
    status: 'active' as PlannerPlanStatus,
    steps: [...priorSteps, ...newSteps],
    activeStepId: newSteps[0]?.id ?? null,
    updatedAt: Date.now(),
    ...(incoming.chosenOptionId ? { chosenOptionId: incoming.chosenOptionId } : {}),
    ...(incoming.chosenOptionTitle ? { chosenOptionTitle: incoming.chosenOptionTitle } : {}),
    ...(incoming.delivery ? { delivery: incoming.delivery } : {})
  };

  const renumbered = renumberPlannerSteps(draft);
  if (firstNewUid) {
    const first = renumbered.steps.find(s => s.uid === firstNewUid);
    if (first) return { ...renumbered, activeStepId: first.id };
  }
  return renumbered;
}

/** Failed or abandoned steps still need a verdict, a retry, or an explicit skip resolution. */
export function planHasDebt(plan: PlannerPlan | null | undefined): boolean {
  if (!plan?.steps?.length) return false;
  return plan.steps.some(s => s.status === 'failed' || s.status === 'abandoned');
}

/** Final review and dist require every step completed and no unresolved debt. */
export function planReadyForRelease(plan: PlannerPlan | null | undefined): boolean {
  if (!plan || plan.status === 'abandoned') return false;
  if (!plan.steps.length) return false;
  if (planHasDebt(plan)) return false;
  return plan.steps.every(s => s.status === 'completed');
}

/** What the plan says when it has no next step. Never "complete" while a step is failed or skipped. */
export function planEndMessage(plan: PlannerPlan | null | undefined, hint = ''): string {
  const ids = (status: PlannerStepStatus) =>
    (plan?.steps || []).filter(s => s.status === status).map(s => `#${s.id}`);
  const failed = ids('failed');
  const skipped = ids('abandoned');
  const tail = hint ? ` ${hint}` : '';
  const plural = (n: number) => `step${n === 1 ? '' : 's'}`;
  if (failed.length) {
    const also = skipped.length ? ` ${skipped.length} more ${plural(skipped.length)} skipped (${skipped.join(', ')}).` : '';
    return `Plan ended with ${failed.length} failed ${plural(failed.length)} (${failed.join(', ')}), so the project may not work yet.${also} Retry a failed step or send fixes; the open issues are in the project todo.${tail}`;
  }
  if (skipped.length) {
    return `Plan ended with ${skipped.length} skipped ${plural(skipped.length)} (${skipped.join(', ')}), so the project may not be complete. Retry a skipped step or send fixes.${tail}`;
  }
  return `Plan finished.${tail}`;
}

/** Persist final-review only when the plan is actually ready to ship. */
export function markPlanFinalReview(plan: PlannerPlan): PlannerPlan {
  if (!planReadyForRelease(plan)) return plan;
  if (plan.resumePhase === 'final-review' && plan.status === 'completed' && !plan.activeStepId) {
    return plan;
  }
  return touch(plan, { resumePhase: 'final-review', status: 'completed', activeStepId: null });
}

/** User skipped a step. It becomes abandoned debt and the next pending step activates. */
export function skipStep(plan: PlannerPlan, stepId: string, note?: string): PlannerPlan {
  const step = plan.steps.find(s => String(s.id) === String(stepId));
  if (!step || step.status === 'completed') return plan;
  const steps = plan.steps.map(s =>
    String(s.id) === String(stepId)
      ? {
          ...s,
          status: 'abandoned' as PlannerStepStatus,
          reviewNote: (note || s.reviewNote || 'Skipped.').slice(0, 1200)
        }
      : s
  );
  const cleared =
    String(plan.activeStepId || '') === String(stepId) ? null : plan.activeStepId;
  return activateNextStep(touch(plan, { steps, activeStepId: cleared }));
}

/** Edit one task's title, description, or file without changing step status. */
export function editStepTask(
  plan: PlannerPlan,
  stepId: string,
  taskId: string,
  patch: { title?: string; description?: string; file?: string }
): PlannerPlan {
  let changed = false;
  const steps = plan.steps.map(s => {
    if (String(s.id) !== String(stepId)) return s;
    return {
      ...s,
      tasks: s.tasks.map(t => {
        if (String(t.id) !== String(taskId)) return t;
        changed = true;
        return {
          ...t,
          ...(patch.title !== undefined ? { title: patch.title } : {}),
          ...(patch.description !== undefined ? { description: patch.description } : {}),
          ...(patch.file !== undefined ? { file: patch.file } : {})
        };
      })
    };
  });
  if (!changed) return plan;
  return touch(plan, { steps });
}

/**
 * Re-open a failed or abandoned step as in-progress coder work.
 * Pending steps are not retried here — they are already eligible.
 */
export function retryFailedStep(plan: PlannerPlan, stepId: string): PlannerPlan {
  const step = plan.steps.find(s => String(s.id) === String(stepId));
  if (!step || (step.status !== 'failed' && step.status !== 'abandoned')) return plan;
  return touch(plan, {
    status: 'active',
    activeStepId: step.id,
    resumePhase: 'coder',
    blockedReason: undefined,
    healAttempts: 0,
    blockerKind: undefined,
    steps: plan.steps.map(s => {
      if (String(s.id) === String(stepId)) {
        return {
          ...s,
          status: 'in_progress' as PlannerStepStatus,
          blockerKind: undefined,
          healExhausted: false,
          tasks: s.tasks.map(t =>
            t.status === 'completed'
              ? t
              : { ...t, status: 'pending' as ExecutionTaskStatus, failureNote: undefined }
          )
        };
      }
      if (s.status === 'in_progress') return { ...s, status: 'pending' as PlannerStepStatus };
      return s;
    })
  });
}

/**
 * Awaitable plan commit. Callers pass the filesystem writer (main-process IPC).
 * Returns the plan that was written, with a fresh updatedAt.
 */
export async function writePlannerPlan(
  root: string,
  conversationId: string,
  plan: PlannerPlan,
  writeFile: (absPath: string, content: string) => Promise<unknown>
): Promise<PlannerPlan> {
  const next = touch(plan);
  await writeFile(plannerPlanPath(root, conversationId), serializePlannerPlan(next));
  return next;
}

/** Materialize Review fix queue into a PlannerPlan for the Conductor panel. */
export function plannerPlanFromReviewQueue(
  queue: ExecutionQueue,
  opts?: { conversationId?: string; existing?: PlannerPlan | null }
): PlannerPlan {
  const stepId = 'review-fixes';
  const tasks: PlannerTask[] = queue.tasks.map(t => ({
    id: t.id,
    title: t.title,
    description: t.description,
    ...(t.file ? { file: t.file } : {}),
    status: t.status,
    ...(t.failureNote ? { failureNote: t.failureNote } : {})
  }));
  const anyOpen = tasks.some(
    t => t.status === 'pending' || t.status === 'failed' || t.status === 'in_progress'
  );
  const allDone = tasks.length > 0 && tasks.every(t => t.status === 'completed');
  const stepStatus: PlannerStepStatus = allDone
    ? 'completed'
    : anyOpen
      ? 'in_progress'
      : 'pending';
  const step: PlannerStep = {
    id: stepId,
    title: queue.summary || 'Review fix tasks',
    description: 'Tasks from Reviewer for Planner → Coder',
    status: stepStatus,
    tasks
  };

  const existing = opts?.existing;
  if (existing?.steps?.length) {
    const withoutReview = existing.steps.filter(s => s.id !== stepId);
    const steps = [...withoutReview, step];
    return {
      ...existing,
      summary: queue.summary || existing.summary,
      status: allDone ? 'completed' : 'active',
      steps,
      activeStepId: allDone ? null : stepId,
      updatedAt: Date.now()
    };
  }

  return {
    id: `plan-review-${queue.id}`,
    summary: queue.summary || 'Review fix tasks',
    status: allDone ? 'completed' : 'active',
    steps: [step],
    activeStepId: allDone ? null : stepId,
    updatedAt: Date.now(),
    ...(opts?.conversationId ? { conversationId: opts.conversationId } : {})
  };
}

/** Serialize for disk / conversation patch. */
export function serializePlannerPlan(plan: PlannerPlan): string {
  return JSON.stringify(plan, null, 2);
}

export function parsePlannerPlanJson(raw: string): PlannerPlan | null {
  try {
    const data = JSON.parse(raw) as PlannerPlan;
    if (!data || !Array.isArray(data.steps)) return null;
    return data;
  } catch {
    return null;
  }
}
