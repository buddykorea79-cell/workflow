import type { WorkflowStep } from './types';

export type ProcedureMoveDirection = 'up' | 'down';
export interface ProcedureOrderChange {
  workflow: WorkflowStep[];
  changed: boolean;
  /** Retained for callers that show explicit schedule changes. Display ordering never clears dates. */
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

/** A display-order edit must never serialize independent branches or discard their dates. */
function orderedChange(workflow: WorkflowStep[]): ProcedureOrderChange {
  return { workflow: structuredClone(workflow), changed: true, clearedScheduleIds: [] };
}

/** Selecting a prerequisite is safe only when it does not depend on the edited step. */
export function canSetProcedureDependency(workflow: WorkflowStep[], stepId: string, prerequisiteId: string): boolean {
  const step = workflow.find(item => item.id === stepId);
  if (!step || step.done || stepId === prerequisiteId || !workflow.some(item => item.id === prerequisiteId)) return false;
  const pending = [prerequisiteId];
  const seen = new Set<string>();
  while (pending.length) {
    const id = pending.pop()!;
    if (id === stepId) return false;
    if (seen.has(id)) continue;
    seen.add(id);
    pending.push(...(workflow.find(item => item.id === id)?.dependsOn ?? []));
  }
  return true;
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
  const removed = workflow.find(step => step.id === id)!;
  // Only children of the removed node inherit its prerequisites. Other branches stay independent.
  return orderedChange(workflow.filter(step => step.id !== id).map(step => ({
    ...step,
    dependsOn: [...new Set(step.dependsOn.flatMap(dependency => dependency === id ? removed.dependsOn : [dependency]))],
  })));
}
