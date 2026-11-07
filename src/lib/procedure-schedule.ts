import type { WorkflowStep } from './types';

export interface ProcedureScheduleDates { stepId: string; startDate?: string; dueDate?: string }
export interface ProcedureScheduleConflict { stepId: string; prerequisiteId: string }

/** Undated intermediate steps do not remove the order imposed by earlier work. */
export function procedureScheduleConflicts(workflow: readonly Pick<WorkflowStep, 'id' | 'dependsOn'>[], schedules: readonly ProcedureScheduleDates[]): ProcedureScheduleConflict[] {
  const definitions = new Map(workflow.map(step => [step.id, step]));
  const dates = new Map(schedules.map(step => [step.stepId, step]));
  const conflicts: ProcedureScheduleConflict[] = [];
  for (const step of workflow) {
    const schedule = dates.get(step.id);
    const start = schedule?.startDate || schedule?.dueDate;
    if (!start) continue;
    const visited = new Set<string>([step.id]);
    const pending = [...step.dependsOn];
    while (pending.length) {
      const prerequisiteId = pending.pop()!;
      if (visited.has(prerequisiteId)) continue;
      visited.add(prerequisiteId);
      const prior = dates.get(prerequisiteId);
      const end = prior?.dueDate || prior?.startDate;
      if (end && end > start) { conflicts.push({ stepId: step.id, prerequisiteId }); break; }
      pending.push(...(definitions.get(prerequisiteId)?.dependsOn ?? []));
    }
  }
  return conflicts;
}
