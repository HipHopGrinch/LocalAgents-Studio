import {
  PlannerPlan,
  PlannerPlanStatus,
  PlannerStep,
  PlannerStepStatus,
  PlannerTask,
  ExecutionTaskStatus,
  ExecutionQueue,
  DeliveryTarget
} from '../types';

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

export function pickNextPendingStep(plan: PlannerPlan): PlannerStep | undefined {
  return plan.steps.find(s => s.status === 'pending' || s.status === 'failed');
}

/** Activate first pending/failed step (or keep current). */
export function activateNextStep(plan: PlannerPlan): PlannerPlan {
  const current = getActiveStep(plan);
  if (current && (current.status === 'in_progress' || current.status === 'failed')) {
    return plan;
  }
  const next = pickNextPendingStep(plan);
  if (!next) {
    return touch(plan, { status: 'completed', activeStepId: null });
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

/** True when a step is already a repair pass — appending another Fix: would duplicate. */
export function stepLooksLikeFixStep(title: string): boolean {
  return /\bfix\b|repair|rework|resolve\b.*\b(error|tsc|type|compile)/i.test(title || '');
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
      steps: plan.steps.map(s =>
        s.id === step.id
          ? {
              ...s,
              status: 'completed' as PlannerStepStatus,
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

  // Nay — reopen step with notes; tasks go back to pending/failed for rework
  const nextRework = (step.reworkCount || 0) + 1;
  return touch(plan, {
    status: 'active',
    activeStepId: step.id,
    steps: plan.steps.map(s =>
      s.id === step.id
        ? {
            ...s,
            status: 'failed' as PlannerStepStatus,
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

/** Paths named on a step’s tasks (plus light scan of titles/descriptions). */
export function collectStepFilePaths(step: PlannerStep): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string | undefined) => {
    const p = (raw || '').replace(/\\/g, '/').trim();
    if (!p) return;
    const key = p.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(p);
  };
  for (const t of step.tasks) {
    push(t.file);
    const blob = `${t.title}\n${t.description}`;
    for (const m of blob.matchAll(/`([^`\n]+\.[a-zA-Z0-9]+)`/g)) push(m[1]);
    for (const m of blob.matchAll(
      /(?:^|[\s(/])((?:[\w.-]+\/)*[\w.-]+\.(?:js|jsx|ts|tsx|mjs|cjs|css|html|json|md|py|rs|go|java|cs|php|rb|vue|svelte))\b/g
    )) {
      push(m[1]);
    }
  }
  const stepBlob = `${step.title}\n${step.description || ''}`;
  for (const m of stepBlob.matchAll(/`([^`\n]+\.[a-zA-Z0-9]+)`/g)) push(m[1]);
  return out;
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
 * Prior steps stay (as completed/failed); new steps get remapped ids and become active.
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
        ? ('completed' as PlannerStepStatus)
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
