import type { WorkflowStep } from './types';
import { procedureScheduleConflicts } from './procedure-schedule';

export type ProcedureMoveDirection = 'up' | 'down';
export interface ProcedureOrderChange {
  workflow: WorkflowStep[];
  changed: boolean;
  /** Dates cleared because they contradicted the newly chosen order. Show these changes before saving. */
  clearedScheduleIds: string[];
}

/** Keep the completed part of an occurrence, including its original dependencies, in place. */
export function procedureOrderStart(workflow: WorkflowStep[]): number {
  return workflow.reduce((start, step, index) => step.done ? index + 1 : start, 0);
}

export function canMoveProcedureStep(workflow: WorkflowStep[], id: string, direction: ProcedureMoveDirection): boolean {
  const index = workflow.findIndex(step => step.id === id);
  const destination = index + (direction === 'up' ? -1 : 1);
  const start = procedureOrderStart(workflow);
  return index >= start && destination >= start && destination < workflow.length;
}

export function canRemoveProcedureStep(workflow: WorkflowStep[], id: string): boolean {
  const index = workflow.findIndex(step => step.id === id);
  return index >= procedureOrderStart(workflow) && workflow.length > 1;
}

const unchanged = (workflow: WorkflowStep[]): ProcedureOrderChange => ({ workflow, changed: false, clearedScheduleIds: [] });

/** Array order is the execution order for a manual edit; historical definitions remain untouched. */
function orderedChange(workflow: WorkflowStep[]): ProcedureOrderChange {
  const ordered = structuredClone(workflow);
  const start = procedureOrderStart(ordered);
  const clearedScheduleIds: string[] = [];
  for (let index = start; index < ordered.length; index++) {
    const step = ordered[index];
    const previous = ordered[index - 1];
    step.dependsOn = previous ? [previous.id] : [];
  }
  const conflictingIds = new Set(procedureScheduleConflicts(ordered, ordered.map(step => ({ ...step, stepId: step.id }))).map(issue => issue.stepId));
  for (const step of ordered.slice(start)) {
    if (conflictingIds.has(step.id)) {
      delete step.startDate;
      delete step.dueDate;
      clearedScheduleIds.push(step.id);
    }
  }
  return { workflow: ordered, changed: true, clearedScheduleIds };
}

export function moveProcedureStep(workflow: WorkflowStep[], id: string, direction: ProcedureMoveDirection): ProcedureOrderChange {
  if (!canMoveProcedureStep(workflow, id, direction)) return unchanged(workflow);
  const next = [...workflow];
  const index = next.findIndex(step => step.id === id);
  const destination = index + (direction === 'up' ? -1 : 1);
  [next[index], next[destination]] = [next[destination], next[index]];
  return orderedChange(next);
}

export function appendProcedureStep(workflow: WorkflowStep[], step: WorkflowStep): ProcedureOrderChange {
  if (workflow.length >= 50 || !step.id || workflow.some(item => item.id === step.id)) return unchanged(workflow);
  return orderedChange([...workflow, { ...step, done: false }]);
}

export function removeProcedureStep(workflow: WorkflowStep[], id: string): ProcedureOrderChange {
  if (!canRemoveProcedureStep(workflow, id)) return unchanged(workflow);
  return orderedChange(workflow.filter(step => step.id !== id));
}
