import type { Run, RunProcedureHistory, Task, WorkflowStep } from './types';
import { runWorkflow } from './work-cycles';

/** Preserve a complete previous execution before replacing the live procedure of the same occurrence. */
export function withReplacedRunProcedure(task: Task, run: Run, workflow: WorkflowStep[], version: number, change: Pick<RunProcedureHistory, 'id' | 'replacedAt' | 'replacedBy' | 'reason'>): Run {
  const previous: RunProcedureHistory = structuredClone({
    ...change, definitionVersion: run.definitionVersion, workflowSnapshot: runWorkflow(task, run), steps: run.steps,
    status: run.status, dueDate: run.dueDate, startDate: run.startDate, scheduleDetails: run.scheduleDetails, completedAt: run.completedAt,
    notes: run.notes, primaryId: run.primaryId, supportIds: run.supportIds, reviewerId: run.reviewerId,
  });
  return {
    ...structuredClone(run), definitionVersion: version, workflowSnapshot: structuredClone(workflow), updatedAt: change.replacedAt,
    status: run.status === 'paused' ? 'paused' : 'scheduled', completedAt: undefined,
    procedureHistory: [...structuredClone(run.procedureHistory ?? []), previous],
    steps: workflow.map(step => ({ id: `exec-${run.id}-v${version}-${step.id}`, stepId: step.id, title: step.title, role: step.role, status: 'pending', checklist: step.checklist.map((title, index) => ({ id: `${step.id}-c${index + 1}`, title, done: false })) })),
  };
}
