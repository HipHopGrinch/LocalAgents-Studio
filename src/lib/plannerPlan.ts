import {
  PlannerPlan,
  PlannerPlanStatus,
  PlannerStep,
  PlannerStepStatus,
  PlannerTask,
  ExecutionTaskStatus,
  ExecutionQueue
} from '../types';

export function plannerPlanPath(root: string, conversationId: string): string {
  const sep = root.includes('\\') ? '\\' : '/';
  const safe = conversationId.replace(/[^\w.-]/g, '_');
  return `${root.replace(/[\\/]+$/, '')}${sep}.localagents${sep}plans${sep}${safe}.json`;
}

function touch(plan: PlannerPlan, patch: Partial<PlannerPlan> = {}): PlannerPlan {
  return { ...plan, ...patch, updatedAt: Date.now() };
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
  return touch(plan, {
    status: 'active',
    activeStepId: step.id,
    steps: plan.steps.map(s =>
      s.id === step.id
        ? {
            ...s,
            status: 'failed' as PlannerStepStatus,
            reviewNote: verdict.notes || 'Reviewer requested fixes.',
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

Implement every open task above. Use edit_file/write_file on the files listed (and any others you must touch). Prefer edit_file when the current file body is provided below. Do not start later plan steps.`;
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
Use result nay if the step is incomplete or wrong. Do NOT emit a new <execution_plan> or <review_plan>.`;
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
  }
): PlannerPlan {
  const steps: PlannerStep[] = parsed.steps.map(s => ({
    id: s.id,
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
  return {
    id: `plan-${Date.now()}`,
    summary: parsed.summary || 'Execution plan',
    status: 'active' as PlannerPlanStatus,
    steps,
    activeStepId: first?.id ?? null,
    updatedAt: Date.now(),
    ...(opts?.conversationId ? { conversationId: opts.conversationId } : {}),
    ...(opts?.chosenOptionId ? { chosenOptionId: opts.chosenOptionId } : {}),
    ...(opts?.chosenOptionTitle ? { chosenOptionTitle: opts.chosenOptionTitle } : {})
  };
}

/**
 * Append a newly locked plan onto an existing conversation plan.
 * Prior steps stay (as completed/failed); new steps get remapped ids and become active.
 */
export function appendPlannerPlan(
  existing: PlannerPlan | null | undefined,
  incoming: PlannerPlan
): PlannerPlan {
  if (!existing?.steps?.length) return incoming;

  const usedStepIds = new Set(existing.steps.map(s => String(s.id)));
  const usedTaskIds = new Set(
    existing.steps.flatMap(s => s.tasks.map(t => String(t.id)))
  );

  const remapStepId = (raw: string, index: number): string => {
    let id = String(raw || index + 1);
    if (!usedStepIds.has(id)) {
      usedStepIds.add(id);
      return id;
    }
    let n = existing.steps.length + index + 1;
    while (usedStepIds.has(String(n))) n += 1;
    id = String(n);
    usedStepIds.add(id);
    return id;
  };

  const remapTaskId = (raw: string, stepId: string, tIndex: number): string => {
    let id = String(raw || `${stepId}${String.fromCharCode(97 + tIndex)}`);
    if (!usedTaskIds.has(id)) {
      usedTaskIds.add(id);
      return id;
    }
    let n = 1;
    while (usedTaskIds.has(`${stepId}-${n}`)) n += 1;
    id = `${stepId}-${n}`;
    usedTaskIds.add(id);
    return id;
  };

  const priorSteps: PlannerStep[] = existing.steps.map(s =>
    s.status === 'in_progress' || s.status === 'pending'
      ? { ...s, status: 'completed' as PlannerStepStatus }
      : s
  );

  const newSteps: PlannerStep[] = incoming.steps.map((s, i) => {
    const stepId = remapStepId(s.id, i);
    return {
      ...s,
      id: stepId,
      status: (i === 0 ? 'in_progress' : 'pending') as PlannerStepStatus,
      tasks: s.tasks.map((t, ti) => ({
        ...t,
        id: remapTaskId(t.id, stepId, ti),
        status: (i === 0 ? 'pending' : t.status) as ExecutionTaskStatus
      }))
    };
  });

  const firstNew = newSteps[0];
  const summary =
    incoming.summary && incoming.summary !== existing.summary
      ? `${existing.summary} · ${incoming.summary}`
      : existing.summary || incoming.summary;

  return {
    ...existing,
    id: incoming.id || existing.id,
    summary,
    status: 'active' as PlannerPlanStatus,
    steps: [...priorSteps, ...newSteps],
    activeStepId: firstNew?.id ?? null,
    updatedAt: Date.now(),
    ...(incoming.chosenOptionId ? { chosenOptionId: incoming.chosenOptionId } : {}),
    ...(incoming.chosenOptionTitle ? { chosenOptionTitle: incoming.chosenOptionTitle } : {})
  };
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
