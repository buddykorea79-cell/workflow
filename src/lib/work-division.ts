import type { DepartmentWorkPlan, Task, User, UserIdentity, WorkspaceData, WorkDivisionSnapshot } from './types';

type PlanState = Pick<WorkspaceData, 'departmentWorkPlans'>;

/** Missing plans are editable drafts; old local stores need no destructive migration. */
export function departmentWorkPlan(state: PlanState, departmentId: string): DepartmentWorkPlan {
  return state.departmentWorkPlans?.find(plan => plan.departmentId === departmentId) ?? { departmentId, status: 'draft', version: 0 };
}

export function isDepartmentConfirmed(state: PlanState, departmentId: string): boolean {
  return departmentWorkPlan(state, departmentId).status === 'confirmed';
}

/** This is the department gate. Individual ownership/access checks still apply. */
export function canEditDepartmentDefinitions(state: PlanState, user: User, departmentId: string): boolean {
  return user.role !== 'head' && (user.role === 'admin' || user.departmentId === departmentId) && !isDepartmentConfirmed(state, departmentId);
}

export function userIdentity(user: User): UserIdentity {
  return { id: user.id, name: user.name, departmentId: user.departmentId, team: user.team };
}

export function isRegisteredWork(state: Pick<WorkspaceData, 'commonTasks'>, task: Task): boolean {
  if (!task.commonId) return true;
  const distribution = state.commonTasks.find(common => common.id === task.commonId)?.distributions.find(item => item.taskId === task.id);
  return !!distribution && ['assigned', 'registered', 'submitted'].includes(distribution.status);
}

/** A division snapshot contains definition state, never live execution or personnel privileges. */
export function workDivisionSnapshot(state: WorkspaceData, departmentId: string): WorkDivisionSnapshot {
  return structuredClone({
    units: state.units.filter(unit => unit.departmentId === departmentId && !unit.deletedAt),
    tasks: state.tasks.filter(task => task.departmentId === departmentId && !task.deletedAt && task.status !== 'archived' && isRegisteredWork(state, task)).map(task => ({
      id: task.id, code: task.code, status: task.status, commonId: task.commonId,
      version: task.version, title: task.title, description: task.description, ...(task.descriptionAttachmentIds ? { descriptionAttachmentIds: [...task.descriptionAttachmentIds] } : {}), completionCriteria: task.completionCriteria,
      unitId: task.unitId, departmentId: task.departmentId, primaryId: task.primaryId, supportIds: task.supportIds, reviewerId: task.reviewerId,
      frequency: task.frequency, dueDate: task.dueDate, card: task.card, workflow: task.workflow.map(({ done: _done, ...step }) => step),
      sourceIds: task.sourceIds, budget: task.budget, expenses: task.expenses, references: task.references,
    })),
    members: state.users.filter(user => user.departmentId === departmentId && user.active).map(userIdentity),
  });
}
